import { AnsweredQuestion, Assessment, AssessmentSchema, Commit } from "./types";
import { LlmClient } from "./provider";
import {
  ASSESS_SYSTEM,
  GEN_SYSTEM,
  buildAssessUser,
  buildGenUser
} from "./prompts";

/** First call: verdict + targeted questions. */
export async function assess(
  client: LlmClient,
  branch: string,
  commits: Commit[],
  changes: string,
  maxQuestions: number,
  signal: AbortSignal
): Promise<Assessment> {
  const system = ASSESS_SYSTEM.replace("{MAX}", String(maxQuestions));
  const user = buildAssessUser(branch, commits, changes, maxQuestions);

  let text = await client.complete({ system, user, maxTokens: 2048, signal });
  let assessment = tryParseAssessment(text);

  if (!assessment) {
    // Weaker/local models sometimes wrap or pad JSON — retry once, stricter.
    const stricter = `${user}\n\nIMPORTANT: reply with ONLY the JSON object, no prose and no markdown fences.`;
    text = await client.complete({ system, user: stricter, maxTokens: 2048, signal });
    assessment = tryParseAssessment(text);
  }

  if (!assessment) {
    throw new Error("the model did not return a valid JSON assessment.");
  }

  assessment.questions = assessment.questions.slice(0, maxQuestions);
  return assessment;
}

/** Second call: generate the ADR markdown from diff + answers. */
export async function generateAdr(
  client: LlmClient,
  adrNumber: string,
  title: string,
  date: string,
  deciders: string,
  commits: Commit[],
  changes: string,
  answered: AnsweredQuestion[],
  signal: AbortSignal
): Promise<string> {
  const text = await client.complete({
    system: GEN_SYSTEM,
    user: buildGenUser(adrNumber, title, date, deciders, commits, changes, answered),
    maxTokens: 8000,
    signal
  });
  return stripOuterFence(text.trim());
}

function tryParseAssessment(text: string): Assessment | undefined {
  const json = extractJson(text);
  if (json === undefined) {
    return undefined;
  }
  const result = AssessmentSchema.safeParse(json);
  return result.success ? result.data : undefined;
}

/** Extract a JSON object from model text, tolerating accidental code fences. */
function extractJson(text: string): unknown {
  let candidate = text.trim();

  const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    candidate = fenced[1].trim();
  }

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    candidate = candidate.slice(start, end + 1);
  }

  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

/** Remove a single ```markdown ... ``` fence wrapping the whole ADR, if present. */
function stripOuterFence(text: string): string {
  const match = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return match ? match[1].trim() : text;
}
