import * as vscode from "vscode";
import * as path from "node:path";
import { getConfig } from "./config";
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
import { assess, createClient, generateAdr } from "./llm";
import {
  ensureAdrDir,
  nextAdrNumber,
  slugify,
  updateIndex,
  writeAdr
} from "./adr";
import { askQuestions, confirmDespiteVerdict, pickCommits } from "./ui";
import { Assessment } from "./types";

const SECRET_KEY = "adrAi.anthropicApiKey";

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

    const apiKey = await getApiKey(context, config.anthropicApiKey);
    if (!apiKey) {
      vscode.window.showWarningMessage(
        "ADR AI: an Anthropic API key is required. Run “ADR AI: Set Anthropic API Key”."
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
    const client = createClient(apiKey);

    // --- AI call #1: verdict + questions ---
    const assessment = await runWithProgress(
      "ADR AI: evaluating commits…",
      (signal) =>
        assess(client, config.model, branch, selected, changes, config.maxQuestions, signal)
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
        config.model,
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

async function getApiKey(
  context: vscode.ExtensionContext,
  fromSetting: string
): Promise<string | undefined> {
  const stored = await context.secrets.get(SECRET_KEY);
  if (stored) {
    return stored;
  }
  const fromEnv = process.env.ANTHROPIC_API_KEY?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  if (fromSetting) {
    return fromSetting;
  }

  const entered = await promptForKey();
  if (entered) {
    await context.secrets.store(SECRET_KEY, entered);
    return entered;
  }
  return undefined;
}

async function setApiKey(context: vscode.ExtensionContext): Promise<void> {
  const entered = await promptForKey();
  if (entered) {
    await context.secrets.store(SECRET_KEY, entered);
    vscode.window.showInformationMessage("ADR AI: Anthropic API key saved to Secret Storage.");
  }
}

async function clearApiKey(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(SECRET_KEY);
  vscode.window.showInformationMessage("ADR AI: stored Anthropic API key cleared.");
}

async function promptForKey(): Promise<string | undefined> {
  const entered = await vscode.window.showInputBox({
    title: "Anthropic API key",
    prompt: "Stored securely in VS Code Secret Storage",
    password: true,
    ignoreFocusOut: true,
    placeHolder: "sk-ant-…"
  });
  return entered?.trim() || undefined;
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
    return "authentication failed — check your Anthropic API key (run “ADR AI: Set Anthropic API Key”).";
  }
  if (status === 429) {
    return "rate limited by the Anthropic API — try again shortly.";
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
