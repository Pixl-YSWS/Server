import { supabase } from "./db/client.js";

// XP system: 1 XP per approved hour. The $/hr rate steps up with lifetime XP
// ($4.00 at level 0 to $7.00 at 100 XP); 10 px = $1, so px/hr = $/hr x 10.
// Level = XP / 10, capped at level 10.
export const RATE_STEPS: [number, number][] = [
  [0, 40],
  [10, 45],
  [20, 45],
  [30, 50],
  [40, 50],
  [50, 55],
  [60, 60],
  [70, 60],
  [80, 65],
  [90, 65],
  [100, 70],
];

export function pxPerHourFor(xp: number): number {
  let rate = RATE_STEPS[0][1];
  for (const [threshold, r] of RATE_STEPS) if (xp >= threshold) rate = r;
  return rate;
}

export function levelFor(xp: number): number {
  return Math.min(10, Math.floor(Math.max(xp, 0) / 10));
}

export async function approvedHoursFor(
  userId: string,
  excludeProjectId?: number,
): Promise<number> {
  let q = supabase
    .from("projects")
    .select("id, approved_hours, hackatime_seconds")
    .eq("user_id", userId)
    .eq("status", "approved")
    .is("banned_at", null);
  if (excludeProjectId) q = q.neq("id", excludeProjectId);
  const { data } = await q;
  return (
    Math.round(
      (data ?? []).reduce((s, p) => {
        const h =
          p.approved_hours != null
            ? Number(p.approved_hours)
            : (Number(p.hackatime_seconds) || 0) / 3600;
        return s + (Number.isFinite(h) ? h : 0);
      }, 0) * 10,
    ) / 10
  );
}
