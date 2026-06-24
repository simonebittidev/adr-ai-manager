import * as vscode from "vscode";
import * as path from "node:path";
import { AdrAiConfig, getConfig } from "./config";
import {
  collectChanges,
  detectBaseBranch,
  getCommitsAheadOfBase,
  getCurrentBranch,
  getRepoRoot,
  isGitRepo,
  listCommits,
  uniqueAuthors
} from "./git";
import { assess, generateAdr } from "./llm";
import { createLlmClient, Provider, resolveModel } from "./provider";
import {
  ensureAdrDir,
  nextAdrNumber,
  slugify,
  updateIndex,
  writeAdr
} from "./adr";
import { askQuestions, confirmDespiteVerdict, pickCommits } from "./ui";
import { Assessment } from "./types";

const SECRET_PREFIX = "adrAi.apiKey.";
const LEGACY_ANTHROPIC_SECRET = "adrAi.anthropicApiKey";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("adrAi.generateFromCommits", () =>
      runGenerateFromCommits(context)
    ),
    vscode.commands.registerCommand("adrAi.setApiKey", () => setApiKey(context)),
    vscode.commands.registerCommand("adrAi.clearApiKey", () => clearApiKey(context))
  );
}

export function deactivate(): void {
  // nothing to clean up
}

async function runGenerateFromCommits(context: vscode.ExtensionContext): Promise<void> {
  try {
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      vscode.window.showErrorMessage(
        "ADR AI: no git repository found in the current workspace."
      );
      return;
    }

    const config = getConfig();
    const model = resolveModel(config.provider, config.model, config.baseUrl);

    const apiKey = await getApiKey(context, config);
    if (apiKey === undefined) {
      vscode.window.showWarningMessage(
        `ADR AI: an API key is required for ${providerLabel(config.provider)}. Run “ADR AI: Set API Key”.`
      );
      return;
    }

    const branch = await getCurrentBranch(repoRoot);
    const base = await detectBaseBranch(repoRoot, config.baseBranch);

    const aheadCommits = await getCommitsAheadOfBase(repoRoot, base);
    const preselectAll = !!aheadCommits;
    const commits =
      aheadCommits ?? (await listCommits(repoRoot, undefined, config.commitLimit));

    if (commits.length === 0) {
      vscode.window.showInformationMessage("ADR AI: no commits found to evaluate.");
      return;
    }

    const selected = await pickCommits(commits, preselectAll);
    if (!selected || selected.length === 0) {
      return; // cancelled or nothing selected
    }

    const changes = await collectChanges(repoRoot, selected, config.maxDiffChars);
    const client = createLlmClient({
      provider: config.provider,
      model,
      apiKey,
      baseUrl: config.baseUrl || undefined,
      azureEndpoint: config.azureEndpoint || undefined,
      azureApiVersion: config.azureApiVersion || undefined
    });

    // --- AI call #1: verdict + questions ---
    const assessment = await runWithProgress(
      `ADR AI: evaluating commits (${client.label})…`,
      (signal) => assess(client, branch, selected, changes, config.maxQuestions, signal)
    );
    if (!assessment) {
      return; // cancelled
    }

    if (!assessment.needsAdr) {
      const proceed = await confirmDespiteVerdict(assessment);
      if (!proceed) {
        return;
      }
    }

    // --- targeted questions (each skippable) ---
    const answered = await askQuestions(assessment.questions);

    // --- AI call #2: generate the ADR ---
    const dirState = await ensureAdrDir(repoRoot, config.directory);
    const adrNumber = await nextAdrNumber(dirState.absDir);
    const date = new Date().toISOString().slice(0, 10);
    const deciders = uniqueAuthors(selected).join(", ");

    const markdown = await runWithProgress("ADR AI: writing the ADR…", (signal) =>
      generateAdr(
        client,
        adrNumber,
        assessment.title,
        date,
        deciders,
        selected,
        changes,
        answered,
        signal
      )
    );
    if (!markdown) {
      return; // cancelled
    }

    const slug = slugify(assessment.title);
    const filePath = await writeAdr(dirState.absDir, adrNumber, slug, markdown);
    await updateIndex(dirState.absDir);

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(doc, { preview: false });

    const relPath = path.relative(repoRoot, filePath);
    const initMsg = dirState.initialized ? ` (initialized ${config.directory}/)` : "";
    showAssessmentSummary(assessment, relPath, initMsg);
  } catch (err) {
    if (isAbort(err)) {
      return;
    }
    vscode.window.showErrorMessage(`ADR AI: ${describeError(err)}`);
  }
}

function showAssessmentSummary(
  assessment: Assessment,
  relPath: string,
  initMsg: string
): void {
  const verdict = assessment.needsAdr
    ? `ADR warranted (${assessment.confidence}%)`
    : `generated on request (${assessment.confidence}%)`;
  vscode.window.showInformationMessage(`ADR AI: created ${relPath}${initMsg} — ${verdict}.`);
}

/** Run an async, cancellable task in the notification area. */
async function runWithProgress<T>(
  title: string,
  task: (signal: AbortSignal) => Promise<T>
): Promise<T | undefined> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: true },
    async (_progress, token) => {
      const controller = new AbortController();
      const sub = token.onCancellationRequested(() => controller.abort());
      try {
        return await task(controller.signal);
      } catch (err) {
        if (isAbort(err)) {
          return undefined;
        }
        throw err;
      } finally {
        sub.dispose();
      }
    }
  );
}

async function findRepoRoot(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }

  // Prefer the folder containing the active editor's file.
  const activePath = vscode.window.activeTextEditor?.document.uri.fsPath;
  const ordered = [...folders].sort((a, b) => {
    const aMatch = activePath?.startsWith(a.uri.fsPath) ? 0 : 1;
    const bMatch = activePath?.startsWith(b.uri.fsPath) ? 0 : 1;
    return aMatch - bMatch;
  });

  for (const folder of ordered) {
    const cwd = folder.uri.fsPath;
    if (await isGitRepo(cwd)) {
      return (await getRepoRoot(cwd)) ?? cwd;
    }
  }
  return undefined;
}

/**
 * Resolve the API key for the active provider. Returns:
 *  - a key string (possibly empty for local OpenAI-compatible endpoints),
 *  - undefined when a key is required but unavailable (caller should abort).
 */
async function getApiKey(
  context: vscode.ExtensionContext,
  config: AdrAiConfig
): Promise<string | undefined> {
  const provider = config.provider;

  const stored = await context.secrets.get(secretKey(provider));
  if (stored) {
    return stored;
  }
  if (provider === "anthropic") {
    const legacy = await context.secrets.get(LEGACY_ANTHROPIC_SECRET);
    if (legacy) {
      return legacy;
    }
  }

  const fromEnv = process.env[envVar(provider)]?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const fromSetting =
    provider === "anthropic"
      ? config.anthropicApiKey
      : provider === "openai"
        ? config.openaiApiKey
        : "";
  if (fromSetting) {
    return fromSetting;
  }

  // Local OpenAI-compatible endpoints typically need no key.
  if (provider === "openai" && config.baseUrl) {
    return "";
  }

  const entered = await promptForKey(provider);
  if (entered) {
    await context.secrets.store(secretKey(provider), entered);
    return entered;
  }
  return undefined;
}

async function setApiKey(context: vscode.ExtensionContext): Promise<void> {
  const provider = await pickProvider();
  if (!provider) {
    return;
  }
  const entered = await promptForKey(provider);
  if (entered) {
    await context.secrets.store(secretKey(provider), entered);
    vscode.window.showInformationMessage(
      `ADR AI: ${providerLabel(provider)} API key saved to Secret Storage.`
    );
  }
}

async function clearApiKey(context: vscode.ExtensionContext): Promise<void> {
  const provider = await pickProvider();
  if (!provider) {
    return;
  }
  await context.secrets.delete(secretKey(provider));
  if (provider === "anthropic") {
    await context.secrets.delete(LEGACY_ANTHROPIC_SECRET);
  }
  vscode.window.showInformationMessage(
    `ADR AI: stored ${providerLabel(provider)} API key cleared.`
  );
}

async function pickProvider(): Promise<Provider | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: "Anthropic", value: "anthropic" as const },
      { label: "OpenAI / OpenAI-compatible (incl. local)", value: "openai" as const },
      { label: "Azure OpenAI", value: "azure" as const }
    ],
    { title: "Which provider's API key?", placeHolder: "Select a provider" }
  );
  return picked?.value;
}

async function promptForKey(provider: Provider): Promise<string | undefined> {
  const entered = await vscode.window.showInputBox({
    title: `${providerLabel(provider)} API key`,
    prompt: "Stored securely in VS Code Secret Storage",
    password: true,
    ignoreFocusOut: true,
    placeHolder: provider === "anthropic" ? "sk-ant-…" : "sk-…"
  });
  return entered?.trim() || undefined;
}

function secretKey(provider: Provider): string {
  return SECRET_PREFIX + provider;
}

function envVar(provider: Provider): string {
  if (provider === "anthropic") {
    return "ANTHROPIC_API_KEY";
  }
  if (provider === "azure") {
    return "AZURE_OPENAI_API_KEY";
  }
  return "OPENAI_API_KEY";
}

function providerLabel(provider: Provider): string {
  if (provider === "anthropic") {
    return "Anthropic";
  }
  if (provider === "azure") {
    return "Azure OpenAI";
  }
  return "OpenAI";
}

function isAbort(err: unknown): boolean {
  if (!err) {
    return false;
  }
  const name = (err as { name?: string }).name;
  return name === "AbortError" || name === "APIUserAbortError";
}

function describeError(err: unknown): string {
  const status = (err as { status?: number }).status;
  if (status === 401) {
    return "authentication failed — check your API key (run “ADR AI: Set API Key”).";
  }
  if (status === 404) {
    return "model or endpoint not found — check 'adrAi.model' and 'adrAi.baseUrl' for the selected provider.";
  }
  if (status === 429) {
    return "rate limited by the model provider — try again shortly.";
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/econnrefused|fetch failed|enotfound|network/i.test(message)) {
    return "could not reach the model endpoint — check that the server is running and 'adrAi.baseUrl' is correct.";
  }
  return message;
}
