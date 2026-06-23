import * as vscode from "vscode";
import { AnsweredQuestion, Assessment, Commit, Question } from "./types";

interface CommitQuickPickItem extends vscode.QuickPickItem {
  commit: Commit;
}

/**
 * Multi-select commit picker. Pre-selects the commits that are ahead of the
 * base branch; returns undefined if the user cancels.
 */
export async function pickCommits(
  commits: Commit[],
  preselectAll: boolean
): Promise<Commit[] | undefined> {
  const items: CommitQuickPickItem[] = commits.map((commit) => ({
    label: commit.subject || "(no subject)",
    description: commit.shortHash,
    detail: `${commit.author} · ${commit.date}`,
    picked: preselectAll,
    commit
  }));

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: "Select the commits to evaluate for an ADR",
    placeHolder: "Pick the commits whose decision you want recorded (others add noise)",
    ignoreFocusOut: true
  });

  if (!selected) {
    return undefined;
  }
  return selected.map((item) => item.commit);
}

/**
 * When the AI is not confident an ADR is warranted, ask whether to proceed.
 * Returns true to continue, false to abort.
 */
export async function confirmDespiteVerdict(assessment: Assessment): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    `These commits don't look like they warrant an ADR (${assessment.confidence}% confidence).\n\n${assessment.reasoning}`,
    { modal: true },
    "Generate anyway"
  );
  return choice === "Generate anyway";
}

/**
 * Ask each generated question with an input box. Empty input or Escape skips
 * the question (which becomes a TODO in the ADR rather than fabricated prose).
 */
export async function askQuestions(questions: Question[]): Promise<AnsweredQuestion[]> {
  const answered: AnsweredQuestion[] = [];

  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    const answer = await vscode.window.showInputBox({
      title: `ADR question ${i + 1} of ${questions.length} · ${question.section}`,
      prompt: question.question,
      placeHolder: "Answer in a sentence or two — leave empty to skip (becomes a TODO)",
      ignoreFocusOut: true
    });

    answered.push({
      question,
      answer: answer && answer.trim().length > 0 ? answer.trim() : undefined
    });
  }

  return answered;
}
