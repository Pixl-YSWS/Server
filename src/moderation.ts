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
