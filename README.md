# nanori

**Your form works with your test data. Does it work with your customers' names?**

nanori is a test tool for people who build or maintain Japanese web forms. Point it at a form and a goal. It drives a real Chrome, tries to reach the goal as a typical Japanese customer, then again with name-format test cases that Japanese test data never covers: Latin letters, long names with spaces, a single name with no surname, diacritics, a hyphenated surname. Where a test name is rejected, cut, or altered and the baseline was not, it reports the field, the exact input, what the field kept, the error the page showed, which published guidance the behaviour is inconsistent with, and a proposed repair. Fix a local copy, rerun, and the report shows before and after.

Built for Built with Claude: Japan 2026 (Nov 2 to 8), by a foreign resident of Tokyo whose name does not fit many Japanese forms.

## What it found on a real form

A public dental reservation form in Tokyo (`runs/yotsuya-dental-*`): the Japanese baseline and four of five test names reach the confirmation screen. The 28-character test name "Maria Clara Santos Dela Cruz" is rejected with 「文字数が正しくありません。」 (character count incorrect). The limit is not in the page source, so nanori measured it: with every other field identical, 20 characters are accepted and 21 are rejected (`runs/yotsuya-dental-1/diag/`). The server implementation was not inspected. A labelled local reproduction of that form, repaired by raising the limit (the required check is kept), passes all six cases on rerun. The live site is unchanged.

Across 32 other public Tokyo forms, a model-free probe (`nanori scan`) flagged a handful of further observations pending review (a review screen printing diacritics as HTML entities, a hiragana field rejecting a long-vowel mark, a parent-name field converting Latin letters to full width and capping at five characters). Those are observations, not proven exclusions; see `runs/scan-tokyo-1/scan.html` for the honest categories.

## Why name handling matters

Documented context, not nanori test results:

- PayPay states that bank-account linking can fail when the registered name differs from identity-verification information, and that unnecessary spaces can stop the next button from working. https://paypay.ne.jp/help/c0147/
- PayPay's identity verification has special instructions for middle names and single names (middle names in the given-name box, single names split across two boxes). A supported path exists, but it has to be found. https://paypay.ne.jp/help/c0422/
- PayPay Card tells applicants with long names to omit middle names or trailing parts to fit ten characters per name field. https://www.paypay-card.co.jp/service/004549.html
- GovTech Tokyo's Input Form Guidance ver 1.1 (March 2026), page 27, asks for one full-name field that fits middle and compound names, acceptance of the scripts people write their names in, spaces allowed, and a sufficient maximum length "because foreign names need more characters". It is guidance for Tokyo Metropolitan Government forms, not a law. https://www.digitalservice.metro.tokyo.lg.jp/documents/d/digitalservice/inputform_guidance_v11

4,281,026 foreign residents lived in Japan as of June 2026 (Immigration Services Agency). That is context for who meets these fields, not a count of people whose names fail.

## Install and run

```bash
npm install
npx playwright install chrome
cp .env.example .env        # add your ANTHROPIC_API_KEY
npm run build
```

```bash
# Full run: baseline + name cases, Claude drives the browser, report in runs/<id>/report.html
node dist/cli.js run https://example.jp/reserve "reach the confirmation screen"

# Only some cases, visible browser, higher step budget
node dist/cli.js run <url> "<goal>" --cases long-name-spaces,single-name --max-steps 40

# Rerun a saved run against a repaired local copy. The target is explicit on purpose.
node dist/cli.js rerun <run-id> --target http://localhost:4313/

# Probe many forms' name fields with no model in the loop (nothing submitted)
node dist/cli.js scan scan/tokyo-forms.txt --headless

# List the name-format test cases
node dist/cli.js cases
```

Try it on the bundled fixture first: `npm run fixture` serves a local clinic form on http://localhost:4310/ with three deliberate name rules (katakana-only reading, 10-character names, half-width phone).

## How a run works

1. Baseline: a Japanese name (kanji with its reading), Tokyo address, Japanese mobile, plain email. Claude (Sonnet) reads each page as an accessibility snapshot plus a screenshot, returns one action at a time through a strict `act` tool, and stops at the goal screen. It never clicks a final submit, confirm, pay or send button; that list is enforced in code, not in the prompt.
2. Name cases: same form, same contact details, same fixed non-name choices. Only the name and its reading change. Reading fields get the script they ask for (hiragana for ふりがな, katakana for フリガナ); nanori never substitutes the other script to get past an error.
3. Measurement is code (`src/checks`, unit-tested): after every fill, the field's retained value, native validation message, aria-invalid and visible error text; after a failed confirm click, every invalid field re-read by name/id; at the goal screen, whether each typed value is shown in full, cut, HTML-escaped, or missing. Errors already on screen before a fill are treated as stale.
4. Diagnosis: Claude (Opus) writes each finding from those measured facts only, with the Tokyo guidance text loaded from the `jp-form-checks` Skill, as structured output. Four classes: site defect supported by evidence, agent limitation, no observed issue, inconclusive. Every finding is marked "proposed, not yet reviewed".
5. Report: `report.html` (verdict, comparison, selected finding with paired screenshots, before/after when it is a rerun, collapsed action log) and `report.json`.

Run outcomes are: reached the review screen (verified: typed values shown on it), stopped before it (a measured rejection), not determined (step budget, no progress, or a safe stop that could not be verified). "Reached with a workaround" exists as a label but nanori does not attempt alternate entry paths yet; where a page documents one, the finding says so.

## What nanori will not claim

- No national failure rate. The scan is our sample, probe only, with its uncounted categories listed.
- Guidance, not law: "inconsistent with the guidance".
- "Reached the confirmation screen", never "completed a booking". Nothing is submitted.
- A required reading field is not a defect. A rejected reading is a defect only in the script the field asked for, with no documented alternative.
- Names in the battery are name-format test cases, not verified legal identities. A long-name limit affects people of any nationality.
- A repair verified on a local reproduction verifies the reproduction, not the live site.

## How Claude was used

Everything in this repo was written with Claude Code during the event. `CLAUDE_USAGE.md` is the log, kept as it happened. In the product: Claude Sonnet drives the browser; Claude Opus diagnoses and proposes repairs; the `jp-form-checks` Skill carries the check semantics and the guidance text into diagnosis; a PostToolUse hook (`.claude/settings.json`, `scripts/rerun-on-edit.sh`) reruns the saved run when a file under `local/` is edited, with path filter, debounce and recursion guard. Measurement never depends on a model.

## Layout

```
src/agent/      browser loop (loop.ts) and page snapshot/observation helpers (page.ts)
src/checks/     pure measurement functions, tested
src/battery.ts  baseline identity, name-format test cases, fixed scenario
src/diagnose.ts Opus writes findings from measured facts
src/report/     HTML report
src/scan.ts     model-free name-field probe across many forms
src/verdict.ts  the one honest sentence at the top of a report
fixtures/       local clinic form with deliberate name rules
local/          labelled local reproductions (before / repaired)
runs/           saved runs: screenshots, report.html, report.json (gitignored except examples)
scripts/        boundary probe, rerender, hook
.claude/skills/jp-form-checks/SKILL.md
```

## Limits and future work

- One site at a time, sequential cases. Parallel subagents were not needed for the demo and were left out.
- The scan stalls on forms whose other required fields it cannot fill (dates, consent); those are reported as incomplete, not as results.
- Provider-specific name rules (payment and identity verification flows) and downstream name preservation are future work, to be tested only in an authorised provider environment.
- Alternate entry paths (documented workarounds) are reported, not attempted.

MIT.
