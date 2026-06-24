# ADR AI Manager

A VS Code extension that turns selected commits into an honest Architecture
Decision Record. You pick the commits, an AI model reads the diff and decides
whether the change actually warrants an ADR, asks you a couple of targeted
questions about the *why* it can't see in the code, and then writes a structured
[MADR](https://adr.github.io/madr/) record — leaving anything it doesn't know as
an explicit `TODO` instead of inventing it.

Bring your own model: Claude (Anthropic), OpenAI, or any OpenAI-compatible
endpoint including local runtimes like Ollama, LM Studio, and vLLM — see
[Providers](#providers).

## Why this exists

A diff tells you **what** changed, not **why**. An ADR lives on its rationale:
the decision drivers, the alternatives that were rejected, the trade-offs that
were accepted. None of that is in the code — it's in your head. So this tool does
not try to guess it:

- **It classifies first.** Not every branch deserves an ADR. The model gives a
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
  → Model: verdict + targeted questions   (AI call #1)
  → You answer or skip each question
  → Model: generate the ADR from diff + answers   (AI call #2)
  → Initialize docs/adr/ on first run, write NNNN-slug.md, open it
```

## Providers

The extension is model-agnostic. Set `adrAi.provider`:

- **`anthropic`** (default) — Claude via the Anthropic API.
- **`openai`** — OpenAI, or any **OpenAI-compatible** endpoint. Point
  `adrAi.baseUrl` at a local runtime to use a local model — no data leaves your
  machine:

  | Runtime | `adrAi.baseUrl` | `adrAi.model` example |
  | --- | --- | --- |
  | Ollama | `http://localhost:11434/v1` | `llama3.1`, `qwen2.5-coder` |
  | LM Studio | `http://localhost:1234/v1` | (the loaded model id) |
  | vLLM | `http://localhost:8000/v1` | (the served model id) |
  | LiteLLM / OpenRouter | proxy URL | (proxied model id) |
  | OpenAI | _empty_ | `gpt-4o` (default) |

  Set `adrAi.model` explicitly for local runtimes (there is no safe default).
  Local servers that need no key can leave the key unset.

> Quality matters here: the assessment and the question generation lean on the
> model's judgement. Larger/stronger models give better verdicts and sharper,
> more specific questions; very small local models may produce weaker JSON
> (the extension retries once) and blunter questions.

## Setup

1. Install the extension (or run it from source — see below).
2. Pick your provider (`adrAi.provider`) and, for local models, set
   `adrAi.baseUrl` and `adrAi.model`.
3. Provide an API key (not needed for keyless local servers), in order of
   preference:
   - **Command Palette → `ADR AI: Set API Key`** (pick the provider; stored in
     VS Code Secret Storage — recommended).
   - the `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` environment variable.
   - the `adrAi.anthropicApiKey` / `adrAi.openaiApiKey` setting (least secure).

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
| `adrAi.provider` | `anthropic` | `anthropic` or `openai` (OpenAI-compatible). |
| `adrAi.baseUrl` | `""` | OpenAI-compatible base URL (for local runtimes). |
| `adrAi.model` | `""` | Model id; empty = provider default. Required for local. |
| `adrAi.directory` | `docs/adr` | Where ADRs live (relative to the repo root). |
| `adrAi.maxQuestions` | `3` | Cap on targeted questions (keep it low). |
| `adrAi.baseBranch` | `""` | Branch to diff against; empty = auto-detect. |
| `adrAi.commitLimit` | `30` | Recent commits to list when nothing is ahead of base. |
| `adrAi.maxDiffChars` | `60000` | Max diff characters sent to the model. |
| `adrAi.anthropicApiKey` | `""` | Anthropic key (prefer the command or env var). |
| `adrAi.openaiApiKey` | `""` | OpenAI key (prefer the command or env var). |

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
