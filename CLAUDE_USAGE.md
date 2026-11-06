# How Claude was used in this build

One line per real use. Written as it happens, not reconstructed afterwards.

- 2026-11-06 09:xx Claude Code scaffolded the repo (package.json, tsconfig, folder layout) from NANORI_BUILD.md.
- 2026-11-06 16:50 Claude Code wrote the fixture clinic form (3 steps, katakana-only furigana, maxlength 10, half-width phone) so the loop can be built before a real site is chosen.
- 2026-11-06 16:55 Claude Code wrote src/checks (pure, tested with vitest, 9 tests) before any model code, so measurement never depends on a model.
- 2026-11-06 17:05 Claude Code wrote the agent loop (Claude Sonnet drives Chrome via one strict "act" tool; forbidden-button guard; no-progress stop) and the diagnosis step (Claude Opus writes findings from measured facts, structured output, marked "proposed").
- 2026-11-06 17:10 Wrote the jp-form-checks Skill: check semantics + Tokyo guidance p.27/p.31 text, loaded into the diagnosis system prompt.
