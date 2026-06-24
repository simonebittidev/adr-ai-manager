import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Commit } from "./types";

const pexec = promisify(execFile);

const FIELD = "\x1f"; // unit separator between fields
const RECORD = "\x1e"; // record separator between commits

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await pexec("git", args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024
  });
  return stdout;
}

async function tryGit(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    return await git(cwd, args);
  } catch {
    return undefined;
  }
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const out = await tryGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return out?.trim() === "true";
}

/** Resolve the absolute repository root for a path inside a working tree. */
export async function getRepoRoot(cwd: string): Promise<string | undefined> {
  const out = await tryGit(cwd, ["rev-parse", "--show-toplevel"]);
  return out?.trim() || undefined;
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  const out = await tryGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return out?.trim() || "HEAD";
}

/**
 * Determine the branch to diff against. Honours an explicit configuration,
 * otherwise tries origin/HEAD then common default branch names.
 */
export async function detectBaseBranch(
  cwd: string,
  configured: string
): Promise<string | undefined> {
  if (configured) {
    return configured;
  }

  const symbolic = await tryGit(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (symbolic?.trim()) {
    return symbolic.trim(); // e.g. "origin/main"
  }

  for (const candidate of ["main", "master", "develop"]) {
    const verified = await tryGit(cwd, ["rev-parse", "--verify", "--quiet", candidate]);
    if (verified?.trim()) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Returns the commits on the current branch that are ahead of `base`, or
 * undefined when there is no resolvable base / no commits ahead.
 */
export async function getCommitsAheadOfBase(
  cwd: string,
  base: string | undefined
): Promise<Commit[] | undefined> {
  if (!base) {
    return undefined;
  }
  const mergeBase = (await tryGit(cwd, ["merge-base", base, "HEAD"]))?.trim();
  if (!mergeBase) {
    return undefined;
  }
  const commits = await listCommits(cwd, `${mergeBase}..HEAD`, undefined);
  return commits.length > 0 ? commits : undefined;
}

/** List recent commits, either in a range or the last `limit` commits. */
export async function listCommits(
  cwd: string,
  range: string | undefined,
  limit: number | undefined
): Promise<Commit[]> {
  const format = ["%H", "%h", "%an", "%ad", "%s", "%b"].join(FIELD) + RECORD;
  const args = ["log", `--pretty=format:${format}`, "--date=short"];
  if (limit) {
    args.push(`-n`, String(limit));
  }
  if (range) {
    args.push(range);
  }
  const out = await tryGit(cwd, args);
  if (!out) {
    return [];
  }

  return out
    .split(RECORD)
    .map((record) => record.replace(/^\s+/, ""))
    .filter((record) => record.length > 0)
    .map((record) => {
      const [hash, shortHash, author, date, subject, ...rest] = record.split(FIELD);
      return {
        hash: hash ?? "",
        shortHash: shortHash ?? "",
        author: author ?? "",
        date: date ?? "",
        subject: subject ?? "",
        body: (rest.join(FIELD) ?? "").trim()
      } satisfies Commit;
    })
    .filter((commit) => commit.hash.length > 0);
}

/** The stat + patch for a single commit (no commit header). */
export async function getCommitDiff(cwd: string, hash: string): Promise<string> {
  const out = await tryGit(cwd, ["show", hash, "--no-color", "--stat", "--patch", "--format="]);
  return (out ?? "").replace(/^\s+/, "").trimEnd();
}

/**
 * Build a single text blob describing the selected commits and their diffs,
 * truncated to stay within `maxChars`.
 */
export async function collectChanges(
  cwd: string,
  commits: Commit[],
  maxChars: number
): Promise<string> {
  const parts: string[] = [];
  let total = 0;

  for (const commit of commits) {
    const headerLines = [`### Commit ${commit.shortHash}: ${commit.subject}`];
    if (commit.body) {
      headerLines.push("", commit.body);
    }
    const header = headerLines.join("\n") + "\n";

    const remaining = maxChars - total - header.length;
    if (remaining <= 200) {
      parts.push("\n_(remaining commits omitted to stay within size limits)_\n");
      break;
    }

    let diff = await getCommitDiff(cwd, commit.hash);
    if (diff.length > remaining) {
      diff = diff.slice(0, remaining) + "\n…(diff truncated)…";
    }

    const block = `${header}\n\`\`\`diff\n${diff}\n\`\`\`\n`;
    parts.push(block);
    total += block.length;
  }

  return parts.join("\n");
}

/** Unique commit authors, in first-seen order. */
export function uniqueAuthors(commits: Commit[]): string[] {
  const seen = new Set<string>();
  const authors: string[] = [];
  for (const commit of commits) {
    if (commit.author && !seen.has(commit.author)) {
      seen.add(commit.author);
      authors.push(commit.author);
    }
  }
  return authors;
}
