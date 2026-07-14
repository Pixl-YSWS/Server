const ARCHIVE_URL = "https://ships.hackclub.com/api/v1/ysws_entries";
const CACHE_MS = 10 * 60_000;

let cache: { at: number; urls: Set<string> } | null = null;

export function normalizeProjectUrl(raw: string): string {
  let s = raw.trim().toLowerCase();
  if (s === "") return "";
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.replace(/\.git$/, "");
  s = s.replace(/\/+$/, "");
  return s;
}

async function loadArchive(): Promise<Set<string> | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.urls;
  try {
    const r = await fetch(ARCHIVE_URL, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`status ${r.status}`);
    const json = (await r.json()) as any;
    const entries: unknown[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.entries)
        ? json.entries
        : Array.isArray(json?.data)
          ? json.data
          : [];
    const urls = new Set<string>();
    for (const e of entries) {
      const entry = e as Record<string, unknown>;
      for (const key of ["code_url", "demo_url"]) {
        const u = normalizeProjectUrl(String(entry[key] ?? ""));
        if (u !== "") urls.add(u);
      }
    }
    cache = { at: Date.now(), urls };
    return urls;
  } catch (e) {
    console.error("[ships-archive] fetch failed", e);
    return cache?.urls ?? null;
  }
}

// Returns the first of the given URLs that already exists in the Hack Club
// YSWS archive, or null when none match / the archive is unreachable.
export async function findInYswsArchive(
  repoUrl: string,
  demoUrl: string,
): Promise<string | null> {
  const urls = await loadArchive();
  if (!urls) return null;
  const repo = normalizeProjectUrl(repoUrl);
  if (repo !== "" && urls.has(repo)) return repoUrl;
  const demo = normalizeProjectUrl(demoUrl);
  if (demo !== "" && urls.has(demo)) return demoUrl;
  return null;
}
