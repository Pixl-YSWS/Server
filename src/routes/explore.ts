import { Router } from "express";
import { verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";

const router = Router();

// Public-to-players directory: browse everyone, their projects and journals.
router.get("/api/explore/players", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  let query = supabase
    .from("users")
    .select("id, display_name, skin, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (q) query = query.ilike("display_name", `%${q}%`);
  const { data: users, error } = await query;
  if (error) {
    console.error("[explore] players failed", error);
    return res.status(500).json({ ok: false });
  }

  const ids = (users ?? []).map((u) => u.id as string);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: projects } = await supabase
      .from("projects")
      .select("user_id")
      .in("user_id", ids);
    for (const p of projects ?? [])
      counts.set(p.user_id as string, (counts.get(p.user_id as string) ?? 0) + 1);
  }

  res.json({
    ok: true,
    players: (users ?? []).map((u) => ({
      ...u,
      project_count: counts.get(u.id as string) ?? 0,
    })),
  });
});

router.get("/api/explore/players/:id", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = String(req.params.id);
  const [user, projects] = await Promise.all([
    supabase.from("users").select("id, display_name, skin, created_at").eq("id", id).maybeSingle(),
    supabase.from("projects").select("*").eq("user_id", id).order("created_at", { ascending: false }),
  ]);
  if (user.error || !user.data) return res.status(404).json({ ok: false });

  res.json({ ok: true, player: user.data, projects: projects.data ?? [] });
});

router.get("/api/explore/projects/:id", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });

  const { data: project, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !project) return res.status(404).json({ ok: false });

  const [owner, entries] = await Promise.all([
    supabase
      .from("users")
      .select("id, display_name")
      .eq("id", project.user_id as string)
      .maybeSingle(),
    supabase
      .from("project_journals")
      .select("*")
      .eq("project_id", id)
      .order("created_at", { ascending: false }),
  ]);

  res.json({
    ok: true,
    project,
    owner: owner.data ?? null,
    entries: entries.data ?? [],
  });
});

export default router;
