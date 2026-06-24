import { z } from "zod";

/** A single git commit, as parsed from `git log`. */
export interface Commit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
  body: string;
}

/**
 * One targeted question the AI wants the developer to answer. Questions are
 * generated from the diff and only cover the "why" that the code cannot reveal.
 */
export const QuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  /** Why the AI is asking — references something concrete in the diff. */
  rationale: z.string(),
  /** Which ADR section this answer feeds (e.g. "Considered Options"). */
  section: z.string()
});
export type Question = z.infer<typeof QuestionSchema>;

/** Result of the first AI call: the verdict plus any questions. */
export const AssessmentSchema = z.object({
  /** Whether these commits embody an architecturally significant decision. */
  needsAdr: z.boolean(),
  /** Confidence in the verdict, 0–100. */
  confidence: z.number(),
  /** Short, plain explanation of the verdict. */
  reasoning: z.string(),
  /** Proposed ADR title. */
  title: z.string(),
  questions: z.array(QuestionSchema)
});
export type Assessment = z.infer<typeof AssessmentSchema>;

/** A question paired with the developer's answer (or a skip). */
export interface AnsweredQuestion {
  question: Question;
  /** The developer's answer, or undefined if they skipped it. */
  answer?: string;
}
