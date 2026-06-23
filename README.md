# ADR AI Manager

A VS Code extension that turns selected commits into an honest Architecture
Decision Record. You pick the commits, Claude reads the diff and decides whether
the change actually warrants an ADR, asks you a couple of targeted questions
about the *why* it can't see in the code, and then writes a structured
[MADR](https://adr.github.io/madr/) record — leaving anything it doesn't know as
an explicit `TODO` instead of inventing it.

## Why this exists

A diff tells you **what** changed, not **why**. An ADR lives on its rationale:
the decision drivers, the alternatives that were rejected, the trade-offs that
were accepted. None of that is in the code — it's in your head. So this tool does
not try to guess it:

- **It classifies first.** Not every branch deserves an ADR. Claude gives a
  verdict (and a confidence) before anything is written, and stays conservative
  — a generator that fires on every bug fix gets ignored.
- **It asks instead of inventing.** The questions are generated from your actual
  diff (not a fixed questionnaire) and only cover what the code can't reveal.
- **It never fabricates rationale.** If you skip a question, that section becomes
  a `TODO`, not made-up prose. A half-empty honest ADR beats a full fictional one.
- **It preserves the trail.** Your exact answers and the commit list are saved in
  the ADR, so the original reasoning isn't lost to formatting.

## How it works

```
Pick commits (multi-select)
  → Claude: verdict + targeted questions   (AI call #1)
  → You answer or skip each question
  → Claude: generate the ADR from diff + answers   (AI call #2)
  → Initialize docs/adr/ on first run, write NNNN-slug.md, open it
```

## Setup

1. Install the extension (or run it from source — see below).
2. Provide an Anthropic API key, in order of preference:
   - **Command Palette → `ADR AI: Set Anthropic API Key`** (stored in VS Code
     Secret Storage — recommended).
   - the `ANTHROPIC_API_KEY` environment variable.
   - the `adrAi.anthropicApiKey` setting (least secure).

## Usage

- Open the Command Palette and run **`ADR AI: Generate ADR from Commits…`**
  (also available as a button in the Source Control view title bar).
- The commit picker is pre-populated with the commits on your current branch that
  are ahead of the base branch (auto-detected, or set `adrAi.baseBranch`). If the
  branch has nothing ahead of base, it falls back to the most recent commits.
- Deselect the noise (`wip`, `fix typo`, unrelated changes) and keep the commits
  whose decision you want recorded.
- Answer the questions, or press Enter on an empty box to skip one.
- The ADR is written to `docs/adr/` and opened in the editor.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `adrAi.directory` | `docs/adr` | Where ADRs live (relative to the repo root). |
| `adrAi.model` | `claude-opus-4-8` | Anthropic model used for both calls. |
| `adrAi.maxQuestions` | `3` | Cap on targeted questions (keep it low). |
| `adrAi.baseBranch` | `""` | Branch to diff against; empty = auto-detect. |
| `adrAi.commitLimit` | `30` | Recent commits to list when nothing is ahead of base. |
| `adrAi.maxDiffChars` | `60000` | Max diff characters sent to the model. |
| `adrAi.anthropicApiKey` | `""` | API key (prefer the command or env var). |

## Output

On first run the extension initializes the ADR directory with:

- `0000-record-architecture-decisions.md` — the decision to use ADRs,
- `adr-template.md` — the MADR template,
- `README.md` — an auto-maintained index of all records.

Each generated ADR follows MADR (Context, Decision Drivers, Considered Options,
Decision Outcome, Consequences) plus a **Decision Notes** section that preserves
the raw questions, your answers, and the commit list.

## Develop from source

```bash
npm install
npm run build      # bundle to out/extension.js
npm run watch      # rebuild on change
npm run check-types
```

Then press `F5` in VS Code to launch an Extension Development Host.

## License

MIT
