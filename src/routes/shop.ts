import { Router } from "express";
import { verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";
import { activeEvents } from "../events.js";

const router = Router();

// Active catalog, plus mystery-merchant items while their event runs — those
// stay inactive in the dashboard so they vanish the moment the event ends.
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
  const items: Record<string, unknown>[] = (data ?? []).map((i) => ({ ...i, limited: false }));

  const merchants = await activeEvents(["mystery_merchant"]);
  const limitedIds = [
    ...new Set(
      merchants.flatMap((ev) =>
        Array.isArray(ev.config.itemIds) ? ev.config.itemIds.map(Number) : [],
      ),
    ),
  ].filter((id) => Number.isFinite(id) && !items.some((i) => i.id === id));
  if (limitedIds.length > 0) {
    const { data: limited } = await supabase
      .from("shop_items")
      .select("id, name, description, price, image_url, options")
      .in("id", limitedIds);
    const endsAt = merchants.map((m) => m.ends_at).sort()[0];
    for (const i of limited ?? []) items.unshift({ ...i, limited: true, limited_until: endsAt });
  }
  res.json({ ok: true, items });
});

export default router;
