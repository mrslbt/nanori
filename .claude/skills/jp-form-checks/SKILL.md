---
name: jp-form-checks
description: How nanori's form checks work, how to read their results, and the GovTech Tokyo input-form guidance each check maps to. Load when writing findings or fixes for a nanori run.
---

# jp-form-checks

nanori measures, then interprets. The checks in `src/checks/` are code and produce facts. This skill is how to turn facts into findings without overclaiming.

## The checks (code, deterministic)

| kind | What was measured | Typical cause |
|---|---|---|
| rejected | The field has aria-invalid, a native validationMessage, or visible error text next to it after the value was entered or the page was advanced | pattern or server rule rejects the string |
| truncated | The field retained a strict prefix of what was requested | maxlength attribute, or server-side cut |
| altered | The field retained something else (not a prefix) | normalisation, stripping, auto-conversion |
| accepted | Retained equals requested, no error | nothing to report |

Extra facts: `patternRejects` is true when the element's own `pattern` attribute rejects the requested string (cause observed in source). `shape` lists properties of the string (contains a space, contains Latin letters, N characters) to phrase the cause precisely.

## Reading the facts honestly

- Observation, relevance and basis are separate. Observation is what the page did. Relevance is why this person is an intended user. Basis is which published text the behaviour is inconsistent with, or "no matching recommendation".
- A required furigana field is not a defect. The person has a katakana reading. It is a defect only if that reading was rejected (for example because it contains a space, or because the field also wants kanji).
- A rejection where the page shows a documented way to enter the name (an example, a note, an alternate field) that the agent did not use is inconclusive, not a defect.
- Agent mistakes (wrong field, wrong format for phone, failed navigation) are agent_limit. They say nothing about the site.
- If the baseline also failed at the same step, every case is inconclusive at that step.
- Reaching the next screen is not enough. Silent truncation on the review screen is a finding.
- The cause is "observed in source" only when the pattern or maxlength attribute is visible in the DOM. Otherwise it is "reproduced from behaviour" and the fix is a demonstration, not proof of the site's rule.

## GovTech Tokyo Input Form Guidance ver 1.1 (March 2026)

Source: https://www.digitalservice.metro.tokyo.lg.jp/documents/d/digitalservice/inputform_guidance_v11
Scope: guidance for Tokyo Metropolitan Government input forms. Not a law. For other sites, say "inconsistent with this guidance" and nothing stronger.

Page 27, Name (氏名):
1. A single full-name field accommodates middle names and compound names; avoid forcing a two-part split when the person's name does not split that way.
2. The furigana field accepts kanji, hiragana, katakana and Latin letters, in full or half width, rather than katakana only.
3. Set a sufficient maximum length, because foreign names need more characters.
4. Allow spaces within names.

Page 31, Phone (電話番号):
- One field, digits 0-9 with an optional hyphen, full or half width accepted and normalised, maximum 13 digits.
- This page does not require accepting international formats. Do not cite it for overseas numbers.

## Fix rules

- A fix must keep genuinely invalid input rejected. Removing validation entirely is not a fix.
- Prefer: widen the pattern to allow spaces and Latin letters; raise maxlength; accept a full-name field; normalise width server-side.
- A fix on a local reproduction verifies the reproduction, not the live site. Label it that way.
