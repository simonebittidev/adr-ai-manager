# Changelog

## 0.2.0

- Multiple model providers via `adrAi.provider`:
  - `anthropic` (Claude) and `openai` (OpenAI, plus any OpenAI-compatible
    endpoint via `adrAi.baseUrl` — Ollama, LM Studio, vLLM, LiteLLM, etc.).
- Local models work with no API key; OpenAI reasoning models that reject
  `max_tokens` are retried with `max_completion_tokens`.
- `adrAi.model` now defaults per provider (empty = `claude-opus-4-8` /
  `gpt-4o`); required for local runtimes.
- Per-provider API keys: `ADR AI: Set API Key` prompts for the provider;
  `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` env vars and
  `adrAi.anthropicApiKey` / `adrAi.openaiApiKey` settings are honored.
- Assessment now retries once if the model returns invalid JSON (helps
  smaller local models).

## 0.1.0

Initial release.

- `ADR AI: Generate ADR from Commits…` command (also in the Source Control title bar).
- Multi-select commit picker, pre-populated with commits ahead of the base branch.
- AI assessment: verdict + confidence on whether the commits warrant an
  ADR, plus targeted questions generated from the diff.
- Skippable question loop — skipped questions become `TODO`s instead of
  fabricated rationale.
- MADR ADR generation that merges diff and answers, preserving the raw Q&A and
  commit list in a "Decision Notes" section.
- Automatic ADR directory initialization (template, ADR 0000, index README) and
  zero-padded numbering.
- API key via Secret Storage (`ADR AI: Set Anthropic API Key`), `ANTHROPIC_API_KEY`
  env var, or setting.
