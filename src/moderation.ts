import { supabase } from "./db/client.js";

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

export function normalize(raw: string): string {
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

export function containsBlocked(raw: string): boolean {
  const flat = normalize(raw);
  return BLOCKED.some((bad) => flat.includes(bad));
}

// Replaces each offending word with asterisks, leaving the rest of the
// message intact. Words are checked normalized, so leet evasions get starred.
export function censorChat(text: string): string {
  return text
    .split(" ")
    .map((word) => (containsBlocked(word) ? "*".repeat(word.length) : word))
    .join(" ");
}

// Fire-and-forget moderation log; the dashboard reads these.
export function logViolation(
  userId: string,
  kind: "chat" | "name",
  content: string,
): void {
  void supabase
    .from("violations")
    .insert({ user_id: userId, kind, content })
    .then(({ error }) => {
      if (error) console.error("Failed to log violation", error);
    });
}

export interface BanRow {
  id: number;
  user_id: string;
  reason: string;
  banned_by: string;
  expires_at: string | null;
  lifted_at: string | null;
  created_at: string;
}

// Returns the active ban for a user, or null. A ban is active while it hasn't
// been lifted and either never expires or expires in the future.
export async function activeBan(userId: string): Promise<BanRow | null> {
  const { data, error } = await supabase
    .from("bans")
    .select("*")
    .eq("user_id", userId)
    .is("lifted_at", null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error("Failed to check bans", error);
    return null;
  }
  return (data && (data[0] as BanRow)) ?? null;
}
