import { Router } from "express";
import { verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";

const router = Router();

router.get("/api/shop/items", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const { data, error } = await supabase
    .from("shop_items")
    .select("id, name, description, price, image_url, options")
    .eq("active", true)
    .order("position", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    console.error("[shop] items failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true, items: data ?? [] });
});

export default router;
