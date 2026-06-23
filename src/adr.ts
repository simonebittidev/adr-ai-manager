import { promises as fs } from "node:fs";
import * as path from "node:path";

const ADR_FILE_RE = /^(\d{4})-.*\.md$/;

export interface AdrDirState {
  /** Absolute path to the ADR directory. */
  absDir: string;
  /** True when the directory (and its boilerplate) was just created. */
  initialized: boolean;
}

/**
 * Ensure the ADR directory exists. On first creation, drop in the standard
 * boilerplate: a README index, an ADR template, and ADR 0000.
 */
export async function ensureAdrDir(repoRoot: string, relDir: string): Promise<AdrDirState> {
  const absDir = path.join(repoRoot, relDir);
  let initialized = false;

  try {
    await fs.access(absDir);
  } catch {
    await fs.mkdir(absDir, { recursive: true });
    await fs.writeFile(path.join(absDir, "adr-template.md"), TEMPLATE, "utf8");
    await fs.writeFile(
      path.join(absDir, "0000-record-architecture-decisions.md"),
      ADR_0000,
      "utf8"
    );
    initialized = true;
  }

  return { absDir, initialized };
}

/** Next zero-padded ADR number, based on the highest existing one. */
export async function nextAdrNumber(absDir: string): Promise<string> {
  let max = -1;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(absDir);
  } catch {
    entries = [];
  }

  for (const name of entries) {
    const match = ADR_FILE_RE.exec(name);
    if (match) {
      const num = Number.parseInt(match[1], 10);
      if (!Number.isNaN(num) && num > max) {
        max = num;
      }
    }
  }
  return String(max + 1).padStart(4, "0");
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "decision";
}

/** Write the ADR file and return its absolute path. */
export async function writeAdr(
  absDir: string,
  adrNumber: string,
  slug: string,
  content: string
): Promise<string> {
  const fileName = `${adrNumber}-${slug}.md`;
  const filePath = path.join(absDir, fileName);
  await fs.writeFile(filePath, content.endsWith("\n") ? content : content + "\n", "utf8");
  return filePath;
}

/** Rebuild README.md with a table of all decisions in the directory. */
export async function updateIndex(absDir: string): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(absDir);
  } catch {
    return;
  }

  const records: { num: string; title: string; status: string; file: string }[] = [];
  for (const name of entries) {
    if (!ADR_FILE_RE.test(name)) {
      continue;
    }
    const content = await fs.readFile(path.join(absDir, name), "utf8").catch(() => "");
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const statusMatch = content.match(/^[-*]\s*Status:\s*(.+)$/im);
    records.push({
      num: name.slice(0, 4),
      title: titleMatch ? titleMatch[1].trim() : name,
      status: statusMatch ? statusMatch[1].trim() : "—",
      file: name
    });
  }

  records.sort((a, b) => a.num.localeCompare(b.num));

  const rows = records
    .map((r) => `| ${r.num} | [${escapePipes(r.title)}](./${r.file}) | ${escapePipes(r.status)} |`)
    .join("\n");

  const readme = [
    "# Architecture Decision Records",
    "",
    "This directory records the architecturally significant decisions for this project,",
    "using the [MADR](https://adr.github.io/madr/) convention.",
    "",
    "Records are generated with [ADR AI Manager](https://github.com/simonebittidev/adr-ai-manager):",
    "the diff describes *what* changed, the developer's answers capture *why*, and missing",
    "rationale is left as an explicit `TODO` rather than invented.",
    "",
    "## Decisions",
    "",
    "| # | Title | Status |",
    "| --- | --- | --- |",
    rows,
    ""
  ].join("\n");

  await fs.writeFile(path.join(absDir, "README.md"), readme, "utf8");
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, "\\|");
}

const TEMPLATE = `# NNNN. Short title of the decision

- Status: proposed
- Date: YYYY-MM-DD
- Deciders: …

## Context and Problem Statement

What is the issue we are facing, and why does it need a decision?

## Decision Drivers

- driver 1
- driver 2

## Considered Options

- option 1
- option 2

## Decision Outcome

Chosen option: "…", because …

### Consequences

- Good, because …
- Bad, because …

## Decision Notes (raw input)

### Questions & Answers

### Commits
`;

const ADR_0000 = `# 0000. Record architecture decisions

- Status: accepted
- Date: ${new Date().toISOString().slice(0, 10)}

## Context and Problem Statement

We need to record the architecturally significant decisions made on this project,
including the context and consequences, so future contributors understand why the
system is the way it is.

## Decision Outcome

Chosen option: "Use Architecture Decision Records (MADR format)", because lightweight,
versioned, plain-text records that live next to the code are the cheapest way to keep
decision history close to the work.

### Consequences

- Good, because the reasoning behind decisions is preserved alongside the code.
- Good, because each record is small, reviewable, and git-tracked.
- Bad, because it requires discipline to keep records up to date.

## More Information

See Michael Nygard's article, "Documenting Architecture Decisions", and the MADR
template at https://adr.github.io/madr/.
`;
