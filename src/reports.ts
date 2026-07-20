import { supabase } from "./db/client.js";

const MODEL = "google/gemini-2.5-flash-lite";
const LOOKBACK_HOURS = 10;
const DASH_URL = "https://dash.pixl.rsvp";

export interface ReportAiResult {
  score: number;
  verdict: string;
  summary: string;
}

// The reported player's recent messages — the evidence the AI (and a human
// reviewer) judges, since chat is otherwise ephemeral.
export async function fetchTargetChat(
  targetId: string,
  hours = LOOKBACK_HOURS,
): Promise<{ text: string; created_at: string }[]> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { data } = await supabase
    .from("chat_messages")
    .select("text, created_at")
    .eq("user_id", targetId)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(400);
  return data ?? [];
}

export async function analyzeReport(
  targetName: string,
  reason: string,
  chat: { text: string }[],
): Promise<ReportAiResult | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  const transcript =
    chat
      .map((m) => `- ${m.text}`)
      .join("\n")
      .slice(0, 8000) || "(no recent messages)";
  const prompt = [
    `You are a moderation assistant for a kids' game chat. A player was reported: "${targetName}".`,
    `Reporter's reason: ${reason || "(none given)"}`,
    ``,
    `Here are ${targetName}'s recent chat messages:`,
    transcript,
    ``,
    `Assess whether ${targetName} was being mean, harassing, bullying, threatening, or otherwise breaking chat rules.`,
    `Respond ONLY with strict JSON, no prose: {"score": <0-100 integer likelihood they were being mean>, "verdict": "<one of: clear, minor, concerning, severe>", "summary": "<1-2 sentences citing what you saw>"}.`,
  ].join("\n");
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 300,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      console.error("openrouter http", r.status, await r.text().catch(() => ""));
      return null;
    }
    const json = (await r.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    let content = json.choices?.[0]?.message?.content ?? "";
    content = content.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(content) as Partial<ReportAiResult>;
    return {
      score: Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0))),
      verdict: String(parsed.verdict ?? "").slice(0, 40),
      summary: String(parsed.summary ?? "").slice(0, 1000),
    };
  } catch (e) {
    console.error("analyzeReport failed", e);
    return null;
  }
}

export async function runReportAnalysis(
  reportId: number,
  targetId: string,
  targetName: string,
  reason: string,
): Promise<ReportAiResult | null> {
  const chat = await fetchTargetChat(targetId);
  const result = await analyzeReport(targetName, reason, chat);
  if (result) {
    await supabase
      .from("reports")
      .update({
        ai_verdict: result.verdict,
        ai_summary: result.summary,
        ai_score: result.score,
        ai_at: new Date().toISOString(),
      })
      .eq("id", reportId);
  }
  return result;
}

// Ping the report-viewers Slack channel with a deep link to the dashboard.
export async function postReportToSlack(
  reportId: number,
  targetName: string,
  reason: string,
  ai: ReportAiResult | null,
): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.REPORT_SLACK_CHANNEL;
  if (!token || !channel) return;
  const url = `${DASH_URL}/reports/${reportId}`;
  const aiLine = ai
    ? `\n:robot_face: AI: *${ai.verdict}* (${ai.score}/100) — ${ai.summary}`
    : "";
  const text = `:rotating_light: New report against *${targetName}*\nReason: ${reason || "_none given_"}${aiLine}\n<${url}|Open in dashboard>`;
  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel, text, unfurl_links: false }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    console.error("postReportToSlack failed", e);
  }
}
