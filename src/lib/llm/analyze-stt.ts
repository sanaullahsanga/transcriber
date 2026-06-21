import type { SttIssue, SttIssueCategory, SttIssueSeverity } from "@/lib/models/SttAnalysis";
import { getSttAnalysisSystemPrompt } from "./stt-prompt";

export type SttAnalysisResult = {
  summary: string;
  qualityScore: number;
  issues: SttIssue[];
};

const VALID_CATEGORIES = new Set<SttIssueCategory>([
  "mishearing",
  "proper_noun",
  "diarization",
  "punctuation",
  "omission",
  "hallucination",
  "accent_clarity",
  "background_noise",
  "formatting",
  "domain_term",
  "other",
]);

const VALID_SEVERITIES = new Set<SttIssueSeverity>(["low", "medium", "high"]);

type AnalyzeInput = {
  transcript: string;
  filename: string;
  provider: string;
  model: string;
  keyterms: string[];
};

function getLlmConfig() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  return { apiKey, baseUrl, model };
}

function normalizeIssue(raw: Record<string, unknown>): SttIssue | null {
  const category = String(raw.category ?? "other") as SttIssueCategory;
  const severity = String(raw.severity ?? "medium") as SttIssueSeverity;
  const excerpt = String(raw.excerpt ?? "").trim();
  const description = String(raw.description ?? "").trim();

  if (!excerpt && !description) return null;

  return {
    category: VALID_CATEGORIES.has(category) ? category : "other",
    severity: VALID_SEVERITIES.has(severity) ? severity : "medium",
    excerpt,
    description,
    suggestion: raw.suggestion ? String(raw.suggestion).trim() : undefined,
  };
}

function parseAnalysisPayload(content: string): SttAnalysisResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error("LLM returned invalid JSON");
  }

  const summary = String(parsed.summary ?? "Analysis complete.").trim();
  const qualityScore = Math.min(100, Math.max(0, Number(parsed.qualityScore ?? 0) || 0));
  const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : [];

  const issues = rawIssues
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map(normalizeIssue)
    .filter((issue): issue is SttIssue => issue !== null);

  return { summary, qualityScore, issues };
}

export function isLlmConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function analyzeTranscriptForSttIssues(input: AnalyzeInput): Promise<SttAnalysisResult> {
  const { apiKey, baseUrl, model } = getLlmConfig();
  const systemPrompt = await getSttAnalysisSystemPrompt();

  const keytermSample = input.keyterms.slice(0, 40).join(", ");
  const userPrompt = [
    `File: ${input.filename}`,
    `STT provider: ${input.provider}`,
    `STT model: ${input.model}`,
    keytermSample ? `Domain keyterms: ${keytermSample}` : "",
    "",
    "Transcript:",
    input.transcript,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM error (${response.status}): ${body.slice(0, 500)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned an empty response");
  }

  return parseAnalysisPayload(content);
}

export async function getLlmModelName(): Promise<string> {
  return getLlmConfig().model;
}
