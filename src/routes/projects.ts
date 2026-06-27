import { Router } from "express";
import { verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";

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

// Create a project, optionally linked to HackTime project names.
router.post("/api/projects", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const name = String(req.body?.name ?? "").trim().slice(0, 120);
  if (!name) return res.status(400).json({ ok: false, error: "name_required" });
  const description = String(req.body?.description ?? "").trim().slice(0, 2000);
  const repoUrl = String(req.body?.repoUrl ?? "").trim().slice(0, 500);
  const demoUrl = String(req.body?.demoUrl ?? "").trim().slice(0, 500);
  const hackatimeProjects = Array.isArray(req.body?.hackatimeProjects)
    ? req.body.hackatimeProjects.map((p: unknown) => String(p)).slice(0, 50)
    : [];

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: session.userId,
      name,
      description,
      repo_url: repoUrl,
      demo_url: demoUrl,
      hackatime_projects: hackatimeProjects,
    })
    .select()
    .single();
  if (error) {
    console.error("[projects] create failed", error);
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
