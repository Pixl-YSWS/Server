import { Router } from "express";
import { verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";

const router = Router();

// Drop a notification into a user's inbox. Best-effort: failures are logged,
// never thrown, so they can't break the action that triggered them.
export async function addNotification(
  userId: string,
  title: string,
  body: string,
): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .insert({ user_id: userId, title, body });
  if (error) console.error("[notifications] insert failed", error);
}

router.get("/api/notifications", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("[notifications] list failed", error);
    return res.status(500).json({ ok: false });
  }
  const notifications = data ?? [];
  const unread = notifications.filter((n: { read?: boolean }) => !n.read).length;
  res.json({ ok: true, notifications, unread });
});

router.post("/api/notifications/read", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("user_id", session.userId)
    .eq("read", false);
  if (error) {
    console.error("[notifications] read failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true });
});

export default router;
