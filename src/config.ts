import * as vscode from "vscode";
import { Provider } from "./provider";

export interface AdrAiConfig {
  provider: Provider;
  /** Raw model id from settings; may be empty (resolved per provider). */
  model: string;
  baseUrl: string;
  directory: string;
  maxQuestions: number;
  baseBranch: string;
  commitLimit: number;
  maxDiffChars: number;
  anthropicApiKey: string;
  openaiApiKey: string;
}

export function getConfig(): AdrAiConfig {
  const cfg = vscode.workspace.getConfiguration("adrAi");
  const provider = cfg.get<string>("provider", "anthropic") === "openai" ? "openai" : "anthropic";
  return {
    provider,
    model: cfg.get<string>("model", "").trim(),
    baseUrl: cfg.get<string>("baseUrl", "").trim(),
    directory: cfg.get<string>("directory", "docs/adr").trim() || "docs/adr",
    maxQuestions: clamp(cfg.get<number>("maxQuestions", 3), 0, 5),
    baseBranch: cfg.get<string>("baseBranch", "").trim(),
    commitLimit: clamp(cfg.get<number>("commitLimit", 30), 1, 200),
    maxDiffChars: Math.max(cfg.get<number>("maxDiffChars", 60000), 4000),
    anthropicApiKey: cfg.get<string>("anthropicApiKey", "").trim(),
    openaiApiKey: cfg.get<string>("openaiApiKey", "").trim()
  };
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(Math.max(Math.round(value), min), max);
}
