import * as vscode from "vscode";

export interface AdrAiConfig {
  directory: string;
  model: string;
  maxQuestions: number;
  baseBranch: string;
  commitLimit: number;
  maxDiffChars: number;
  anthropicApiKey: string;
}

export function getConfig(): AdrAiConfig {
  const cfg = vscode.workspace.getConfiguration("adrAi");
  return {
    directory: cfg.get<string>("directory", "docs/adr").trim() || "docs/adr",
    model: cfg.get<string>("model", "claude-opus-4-8").trim() || "claude-opus-4-8",
    maxQuestions: clamp(cfg.get<number>("maxQuestions", 3), 0, 5),
    baseBranch: cfg.get<string>("baseBranch", "").trim(),
    commitLimit: clamp(cfg.get<number>("commitLimit", 30), 1, 200),
    maxDiffChars: Math.max(cfg.get<number>("maxDiffChars", 60000), 4000),
    anthropicApiKey: cfg.get<string>("anthropicApiKey", "").trim()
  };
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(Math.max(Math.round(value), min), max);
}
