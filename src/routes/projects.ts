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

function isGithubRepoUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return false;
  return u.pathname.split("/").filter(Boolean).length >= 2;
}

export const PROJECT_TYPES = ["game", "website", "app", "cli", "hardware", "other"] as const;

interface ProjectFields {
  name: string;
  description: string;
  repo_url: string;
  demo_url: string;
  type: string;
  hackatime_projects: string[];
}

// Shared field parsing/validation for create + update. Returns an error code
// on a missing name or a repo link that isn't a GitHub repository.
function parseProjectBody(
  body: any,
): { error: string; fields?: never } | { error?: never; fields: ProjectFields } {
  const name = String(body?.name ?? "").trim().slice(0, 120);
  if (!name) return { error: "name_required" };
  const repoUrl = String(body?.repoUrl ?? "").trim().slice(0, 500);
  if (repoUrl && !isGithubRepoUrl(repoUrl)) return { error: "repo_not_github" };
  const type = String(body?.type ?? "other").trim();
  return {
    fields: {
      name,
      description: String(body?.description ?? "").trim().slice(0, 2000),
      repo_url: repoUrl,
      demo_url: String(body?.demoUrl ?? "").trim().slice(0, 500),
      type: (PROJECT_TYPES as readonly string[]).includes(type) ? type : "other",
      hackatime_projects: Array.isArray(body?.hackatimeProjects)
        ? body.hackatimeProjects.map((p: unknown) => String(p)).slice(0, 50)
        : [],
    },
  };
}

// Create a project, optionally linked to HackTime project names.
router.post("/api/projects", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const parsed = parseProjectBody(req.body);
  if (parsed.error !== undefined)
    return res.status(400).json({ ok: false, error: parsed.error });

  const { data, error } = await supabase
    .from("projects")
    .insert({ user_id: session.userId, ...parsed.fields })
    .select()
    .single();
  if (error) {
    console.error("[projects] create failed", error);
    return res.status(500).json({ ok: false });
  }
  void addNotification(session.userId, "Project logged", `You logged "${parsed.fields.name}".`);
  res.json({ ok: true, project: data });
});

// Update one of the user's own projects.
router.put("/api/projects/:id", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });

  const parsed = parseProjectBody(req.body);
  if (parsed.error !== undefined)
    return res.status(400).json({ ok: false, error: parsed.error });

  const { data, error } = await supabase
    .from("projects")
    .update(parsed.fields)
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

// Ship a project for review: draft/needs_changes -> shipped. Requires a repo link.
router.post("/api/projects/:id/ship", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });

  const { data: project, error } = await supabase
    .from("projects")
    .select("id, name, status, repo_url, demo_url")
    .eq("id", id)
    .eq("user_id", session.userId)
    .maybeSingle();
  if (error || !project) return res.status(404).json({ ok: false });

  if (project.status !== "draft" && project.status !== "needs_changes")
    return res.status(400).json({ ok: false, error: "already_shipped" });
  if (!project.repo_url)
    return res.status(400).json({ ok: false, error: "repo_required" });
  if (!project.demo_url)
    return res.status(400).json({ ok: false, error: "demo_required" });

  const { data, error: updateError } = await supabase
    .from("projects")
    .update({ status: "shipped", shipped_at: new Date().toISOString(), review_note: "" })
    .eq("id", id)
    .eq("user_id", session.userId)
    .select()
    .single();
  if (updateError) {
    console.error("[projects] ship failed", updateError);
    return res.status(500).json({ ok: false });
  }
  void addNotification(
    session.userId,
    "Project shipped",
    `"${project.name}" is in the review queue. You'll hear back here once it's reviewed.`,
  );
  res.json({ ok: true, project: data });
});

async function ownsProject(userId: string, projectId: number): Promise<boolean> {
  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[projects] ownership check failed", error);
    return false;
  }
  return data !== null;
}

// List journal entries for one of the user's own projects, newest first.
router.get("/api/projects/:id/journal", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });
  if (!(await ownsProject(session.userId, id)))
    return res.status(404).json({ ok: false });

  const { data, error } = await supabase
    .from("project_journals")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[projects] journal list failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true, entries: data ?? [] });
});

// Add a journal entry (markdown content + optional hours) to an own project.
router.post("/api/projects/:id/journal", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });
  if (!(await ownsProject(session.userId, id)))
    return res.status(404).json({ ok: false });

  const content = String(req.body?.content ?? "").trim().slice(0, 5000);
  if (!content)
    return res.status(400).json({ ok: false, error: "content_required" });
  let hours = Number(req.body?.hours ?? 0);
  if (!Number.isFinite(hours) || hours < 0) hours = 0;
  hours = Math.min(Math.round(hours * 100) / 100, 100);

  const { data, error } = await supabase
    .from("project_journals")
    .insert({ project_id: id, user_id: session.userId, content, hours })
    .select()
    .single();
  if (error) {
    console.error("[projects] journal create failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true, entry: data });
});

// Delete one of the user's own journal entries.
router.delete("/api/projects/:id/journal/:entryId", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  const entryId = Number(req.params.entryId);
  if (!Number.isFinite(id) || !Number.isFinite(entryId))
    return res.status(400).json({ ok: false });

  const { error } = await supabase
    .from("project_journals")
    .delete()
    .eq("id", entryId)
    .eq("project_id", id)
    .eq("user_id", session.userId);
  if (error) {
    console.error("[projects] journal delete failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true });
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
