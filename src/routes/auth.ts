import { Router } from "express";
import crypto from "crypto";
import { supabase, type UserRow } from "../db/client.js";
import { issueSessionToken } from "../auth/session.js";

const router = Router();

router.get("/auth/demo", async (req, res) => {
  if (process.env.ALLOW_DEMO_LOGIN !== "true") {
    return res.status(403).json({ error: "Demo login disabled" });
  }

  const name = (req.query.name as string)?.trim();
  if (!name) {
    return res.status(400).json({ error: "Missing ?name= query param" });
  }

  const demoOauthId = `demo_${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

  const { data: existingUsers, error: lookupError } = await supabase
    .from("users")
    .select("*")
    .eq("oauth_provider", "demo")
    .eq("oauth_id", demoOauthId)
    .limit(1);

  if (lookupError) {
    console.error("Supabase lookup failed", lookupError);
    return res.status(500).json({ error: "Database error" });
  }

  let userId: string;
  let displayName: string;

  if (existingUsers && existingUsers.length > 0) {
    const existing = existingUsers[0] as UserRow;
    userId = existing.id;
    displayName = existing.display_name;
  } else {
    const { data: created, error: insertError } = await supabase
      .from("users")
      .insert({
        oauth_provider: "demo",
        oauth_id: demoOauthId,
        display_name: name,
        avatar_url: null,
      })
      .select()
      .single();

    if (insertError || !created) {
      console.error("Supabase insert failed", insertError);
      return res.status(500).json({ error: "Database error" });
    }

    const row = created as UserRow;
    userId = row.id;
    displayName = row.display_name;

    const { error: stateError } = await supabase
      .from("player_state")
      .insert({ user_id: userId });

    if (stateError) {
      console.error("Failed to seed player_state", stateError);
    }
  }

  const sessionToken = issueSessionToken({ userId, displayName });
  res.json({ token: sessionToken, name: displayName });
});

const HCA_BASE_URL = "https://auth.hackclub.com";
const CLIENT_ID = process.env.HCA_CLIENT_ID!;
const CLIENT_SECRET = process.env.HCA_CLIENT_SECRET!;
const REDIRECT_URI = process.env.HCA_REDIRECT_URI!;

const pendingStates = new Set<string>();

interface HackClubTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

interface HackClubMeResponse {
  identity: {
    id: string;
    first_name?: string;
    last_name?: string;
    primary_email?: string;
    slack_id?: string;
    verification_status?: string;
    [key: string]: unknown;
  };
  scopes: string[];
}

router.get("/auth/hackclub", (_req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.add(state);

  const url = new URL(`${HCA_BASE_URL}/oauth/authorize`);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "scope",
    "openid profile email name slack_id verification_status",
  );
  url.searchParams.set("state", state);

  res.redirect(url.toString());
});

router.get("/auth/hackclub/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;

  if (!code || !state || !pendingStates.has(state)) {
    return res.status(400).send("Invalid OAuth state");
  }
  pendingStates.delete(state);

  const tokenRes = await fetch(`${HCA_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    console.error("HCA token exchange failed", await tokenRes.text());
    return res.status(502).send("Failed to exchange authorization code");
  }

  const tokens = (await tokenRes.json()) as HackClubTokenResponse;

  const meRes = await fetch(`${HCA_BASE_URL}/api/v1/me`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!meRes.ok) {
    console.error("HCA /me fetch failed", await meRes.text());
    return res.status(502).send("Failed to fetch user identity");
  }

  const me = (await meRes.json()) as HackClubMeResponse;
  const identity = me.identity;
  const fullName = [identity.first_name, identity.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  const displayNameFromHca =
    fullName ||
    identity.primary_email ||
    `user_${identity.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}`;

  const { data: existingUsers, error: lookupError } = await supabase
    .from("users")
    .select("*")
    .eq("oauth_provider", "hackclub")
    .eq("oauth_id", identity.id)
    .limit(1);

  if (lookupError) {
    console.error("Supabase lookup failed", lookupError);
    return res.status(500).send("Database error");
  }

  let userId: string;
  let displayName: string;

  if (existingUsers && existingUsers.length > 0) {
    const existing = existingUsers[0] as UserRow;
    userId = existing.id;
    displayName = existing.display_name;
  } else {
    const { data: created, error: insertError } = await supabase
      .from("users")
      .insert({
        oauth_provider: "hackclub",
        oauth_id: identity.id,
        display_name: displayNameFromHca,
        avatar_url: null,
      })
      .select()
      .single();

    if (insertError || !created) {
      console.error("Supabase insert failed", insertError);
      return res.status(500).send("Database error");
    }

    const row = created as UserRow;
    userId = row.id;
    displayName = row.display_name;

    const { error: stateError } = await supabase
      .from("player_state")
      .insert({ user_id: userId });

    if (stateError) {
      console.error("Failed to seed player_state", stateError);
    }
  }

  const sessionToken = issueSessionToken({ userId, displayName });

  const localCallback = new URL("http://localhost:7777/callback");
  localCallback.searchParams.set("token", sessionToken);
  localCallback.searchParams.set("name", displayName);

  res.redirect(localCallback.toString());
});

export default router;
