import { Router } from "express";
import { issueSessionToken, verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";

const router = Router();

// Normalized roots (see normalize below): lowercase, leetspeak folded, symbols
// stripped. Substring match, so common evasions like f.u-c_k or sh1t still hit.
const BLOCKED = [
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "cunt",
  "dick",
  "cock",
  "pussy",
  "whore",
  "slut",
  "faggot",
  "nigger",
  "nigga",
  "retard",
  "rape",
  "nazi",
  "hitler",
  "kys",
  "chink",
  "spic",
  "kike",
  "tranny",
  "wanker",
  "bastard",
  "douche",
  "penis",
  "vagina",
  "porn",
  "sexy",
];

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[@4]/g, "a")
    .replace(/[0]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/[3]/g, "e")
    .replace(/[5$]/g, "s")
    .replace(/[7]/g, "t")
    .replace(/[^a-z]/g, "");
}

// Returns a human-readable rejection reason, or null when the name is fine.
export function nameProblem(raw: string): string | null {
  const name = raw.trim();
  if (name.length < 2) return "That name is too short — use at least 2 characters.";
  if (name.length > 24) return "That name is too long — keep it under 24 characters.";
  if (!/^[\p{L}\p{N} ._'-]+$/u.test(name))
    return "Only letters, numbers, spaces and . _ ' - are allowed.";
  const flat = normalize(name);
  for (const bad of BLOCKED) {
    if (flat.includes(bad))
      return "That name isn't okay here. Pick something friendly — this is a warning.";
  }
  return null;
}

router.post("/api/profile/name", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false, reason: "Not signed in." });

  const raw = typeof req.body?.name === "string" ? req.body.name : "";
  const name = raw.trim().replace(/\s+/g, " ");
  const problem = nameProblem(name);
  if (problem) return res.json({ ok: false, reason: problem });

  const { error } = await supabase
    .from("users")
    .update({ display_name: name })
    .eq("id", session.userId);
  if (error) {
    console.error("Failed to update display_name", error);
    return res.status(500).json({ ok: false, reason: "Database error." });
  }

  // Re-issue the session token so the embedded displayName matches the new one.
  const fresh = issueSessionToken({ userId: session.userId, displayName: name });
  res.json({ ok: true, name, token: fresh });
});

export default router;
