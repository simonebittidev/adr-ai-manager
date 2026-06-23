# Changelog

## 0.1.0

Initial release.

- `ADR AI: Generate ADR from Commits…` command (also in the Source Control title bar).
- Multi-select commit picker, pre-populated with commits ahead of the base branch.
- AI assessment (Claude): verdict + confidence on whether the commits warrant an
  ADR, plus targeted questions generated from the diff.
- Skippable question loop — skipped questions become `TODO`s instead of
  fabricated rationale.
- MADR ADR generation that merges diff and answers, preserving the raw Q&A and
  commit list in a "Decision Notes" section.
- Automatic ADR directory initialization (template, ADR 0000, index README) and
  zero-padded numbering.
- API key via Secret Storage (`ADR AI: Set Anthropic API Key`), `ANTHROPIC_API_KEY`
  env var, or setting.
