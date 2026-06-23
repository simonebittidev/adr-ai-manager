import Anthropic from "@anthropic-ai/sdk";
import { AnsweredQuestion, Assessment, AssessmentSchema, Commit } from "./types";
import {
  ASSESS_SYSTEM,
  GEN_SYSTEM,
  buildAssessUser,
  buildGenUser
} from "./prompts";

export function createClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

/** First call: verdict + targeted questions. */
export async function assess(
  client: Anthropic,
  model: string,
  branch: string,
  commits: Commit[],
  changes: string,
  maxQuestions: number,
  signal: AbortSignal
): Promise<Assessment> {
  const response = await client.messages.create(
    {
      model,
      max_tokens: 2048,
      system: ASSESS_SYSTEM.replace("{MAX}", String(maxQuestions)),
      messages: [
        { role: "user", content: buildAssessUser(branch, commits, changes, maxQuestions) }
      ]
    },
    { signal }
  );

  const raw = extractJson(textOf(response));
  const assessment = AssessmentSchema.parse(raw);
  // Defend against a model that ignores the cap.
  assessment.questions = assessment.questions.slice(0, maxQuestions);
  return assessment;
}

/** Second call: generate the ADR markdown from diff + answers. */
export async function generateAdr(
  client: Anthropic,
  model: string,
  adrNumber: string,
  title: string,
  date: string,
  deciders: string,
  commits: Commit[],
  changes: string,
  answered: AnsweredQuestion[],
  signal: AbortSignal
): Promise<string> {
  const response = await client.messages.create(
    {
      model,
      max_tokens: 8000,
      system: GEN_SYSTEM,
      messages: [
        {
          role: "user",
          content: buildGenUser(adrNumber, title, date, deciders, commits, changes, answered)
        }
      ]
    },
    { signal }
  );

  return stripOuterFence(textOf(response).trim());
}

function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
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
    throw new Error("The model did not return valid JSON for the assessment.");
  }
}

/** Remove a single ```markdown ... ``` fence wrapping the whole ADR, if present. */
function stripOuterFence(text: string): string {
  const match = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return match ? match[1].trim() : text;
}
