import { Router } from "express";
import { verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";
import { addNotification } from "./notifications.js";

const router = Router();

// List the logged-in user's projects, newest first.
router.get("/api/projects", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", session.userId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[projects] list failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true, projects: data ?? [] });
});

// Shared field parsing/validation for create + update. Returns null on a
// missing name (the only required field).
function parseProjectBody(body: any) {
  const name = String(body?.name ?? "").trim().slice(0, 120);
  if (!name) return null;
  return {
    name,
    description: String(body?.description ?? "").trim().slice(0, 2000),
    repo_url: String(body?.repoUrl ?? "").trim().slice(0, 500),
    demo_url: String(body?.demoUrl ?? "").trim().slice(0, 500),
    hackatime_projects: Array.isArray(body?.hackatimeProjects)
      ? body.hackatimeProjects.map((p: unknown) => String(p)).slice(0, 50)
      : [],
  };
}

// Create a project, optionally linked to HackTime project names.
router.post("/api/projects", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const fields = parseProjectBody(req.body);
  if (!fields) return res.status(400).json({ ok: false, error: "name_required" });

  const { data, error } = await supabase
    .from("projects")
    .insert({ user_id: session.userId, ...fields })
    .select()
    .single();
  if (error) {
    console.error("[projects] create failed", error);
    return res.status(500).json({ ok: false });
  }
  void addNotification(session.userId, "Project logged", `You logged "${fields.name}".`);
  res.json({ ok: true, project: data });
});

// Update one of the user's own projects.
router.put("/api/projects/:id", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });

  const fields = parseProjectBody(req.body);
  if (!fields) return res.status(400).json({ ok: false, error: "name_required" });

  const { data, error } = await supabase
    .from("projects")
    .update(fields)
    .eq("id", id)
    .eq("user_id", session.userId)
    .select()
    .single();
  if (error) {
    console.error("[projects] update failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true, project: data });
});

// Delete one of the user's own projects.
router.delete("/api/projects/:id", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });

  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", id)
    .eq("user_id", session.userId);
  if (error) {
    console.error("[projects] delete failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true });
});

export default router;
