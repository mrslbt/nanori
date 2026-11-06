import type { RunBundle, RunResult, Finding } from "../types.js";
import { verdict } from "../verdict.js";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const OUTCOME_LABEL: Record<RunResult["outcome"], string> = {
  reached_checkpoint: "Reached the review screen",
  reached_with_workaround: "Reached, with a workaround",
  stopped_before_checkpoint: "Stopped before the review screen",
  not_determined: "Not determined",
};
const CLASS_LABEL: Record<Finding["classification"], string> = {
  site_defect: "Site defect (supported by evidence)",
  agent_limit: "Agent limitation",
  no_issue: "No observed issue",
  inconclusive: "Inconclusive",
};

function outcomeTone(o: RunResult["outcome"]) {
  return o === "reached_checkpoint" ? "ok" : o === "stopped_before_checkpoint" ? "bad" : "warn";
}

export function renderHtml(b: RunBundle, runDir: string): string {
  const all = [b.baseline, ...b.cases];
  const verdictText = verdict(b);

  const maxSteps = Math.max(...all.map((r) => r.steps.length));
  const grid = all.map((r) => {
    const cells = Array.from({ length: maxSteps }, (_, i) => {
      const s = r.steps[i];
      if (!s) return `<td class="cell empty"></td>`;
      const bad = s.observations.some((o) => o.ariaInvalid || o.validationMessage || o.visibleErrors.length || o.retained !== o.requested) || s.action.action === "stuck" || !s.ok;
      const cls = s.action.action === "done" ? "ok" : bad ? "bad" : "neutral";
      const label = s.action.action === "fill" ? `fill ${esc(s.observations[0]?.label ?? s.action.ref)}` : s.action.action === "click" ? `click` : s.action.action;
      return `<td class="cell ${cls}" title="${esc(s.action.reason)}"><a href="${esc(r.identity.id)}/${esc(s.screenshot)}" target="_blank">${label}</a></td>`;
    }).join("");
    return `<tr class="${r.identity.id === "baseline" ? "baseline" : ""}">
      <th><div class="who">${esc(r.identity.fullName)}</div><div class="tests">${esc(r.identity.tests)}</div></th>
      <td class="outcome ${outcomeTone(r.outcome)}">${OUTCOME_LABEL[r.outcome]}<div class="why">${esc(r.stopReason)}</div></td>${cells}</tr>`;
  }).join("");

  const findings = b.findings.map((f) => `
    <article class="finding ${f.classification}">
      <header><span class="badge">${CLASS_LABEL[f.classification]}</span> <span class="rev">${f.reviewState === "proposed" ? "Proposed by Claude, not yet reviewed" : "Reviewed"}</span></header>
      <h3>${esc(f.identity)} · ${esc(f.field)} · ${esc(f.kind)}</h3>
      <dl>
        <dt>What nanori entered</dt><dd><code>${esc(f.requested)}</code></dd>
        <dt>What the field kept</dt><dd><code>${esc(f.retained)}</code></dd>
        <dt>What the page reported</dt><dd lang="ja"><code>${esc(f.errorText) || "(no error text)"}</code></dd>
        <dt>Observation</dt><dd>${esc(f.observation)}</dd>
        <dt>Relevance</dt><dd>${esc(f.relevance)}</dd>
        <dt>Basis</dt><dd>${esc(f.basis)} <span class="muted">(${f.guidance === "applicable" ? "applicable recommendation" : f.guidance === "analogy" ? "analogy, for review" : "no matching recommendation"}${f.guidanceRef ? `, ${esc(f.guidanceRef)}` : ""})</span></dd>
        <dt>Cause</dt><dd>${esc(f.cause)}</dd>
        <dt>Proposed repair</dt><dd>${esc(f.fix)}</dd>
      </dl>
      <p><a href="${esc(f.identity)}/${esc(f.screenshot)}" target="_blank">Screenshot, step ${f.stepIndex}</a></p>
    </article>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>nanori report</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#fbfaf7;--ink:#1b1f2a;--muted:#6b7280;--line:#e6e2d8;--ok:#1f7a4d;--bad:#b3261e;--warn:#9a6700;--okbg:#e6f4ec;--badbg:#fbe9e7;--warnbg:#fff4d6}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,"Hiragino Sans","Noto Sans JP",system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:32px 24px}
h1{font-size:28px;margin:0 0 4px}h2{font-size:20px;margin:40px 0 12px}h3{font-size:16px;margin:0 0 8px}
.meta{color:var(--muted);font-size:14px}.verdict{font-size:22px;margin:24px 0;padding:16px 20px;border-left:4px solid var(--ink);background:#fff}
.label{display:inline-block;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin-right:8px}
table.grid{border-collapse:separate;border-spacing:0 6px;width:100%}
table.grid th{text-align:left;padding:8px 12px;background:#fff;border:1px solid var(--line);border-right:0;border-radius:6px 0 0 6px;min-width:200px}
.who{font-weight:600}.tests{font-size:13px;color:var(--muted)}
td.outcome{padding:8px 12px;background:#fff;border:1px solid var(--line);border-left:0;min-width:200px;font-weight:600}
td.outcome.ok{color:var(--ok)}td.outcome.bad{color:var(--bad)}td.outcome.warn{color:var(--warn)}
.why{font-weight:400;font-size:12px;color:var(--muted)}
td.cell{padding:6px 8px;font-size:12px;border:1px solid var(--line);border-left:0;background:#fff;white-space:nowrap}
td.cell a{color:inherit;text-decoration:none}td.cell.ok{background:var(--okbg);color:var(--ok)}td.cell.bad{background:var(--badbg);color:var(--bad)}td.cell.empty{background:transparent;border-color:transparent}
tr.baseline th{border-left:4px solid var(--ink)}
.finding{background:#fff;border:1px solid var(--line);border-radius:8px;padding:20px 24px;margin:16px 0}
.finding header{display:flex;gap:12px;align-items:center;margin-bottom:8px;font-size:13px}
.badge{padding:2px 10px;border-radius:999px;font-weight:600;background:var(--warnbg);color:var(--warn)}
.site_defect .badge{background:var(--badbg);color:var(--bad)}.no_issue .badge{background:var(--okbg);color:var(--ok)}.agent_limit .badge{background:#eceff3;color:#374151}
.rev{color:var(--muted)}dl{display:grid;grid-template-columns:180px 1fr;gap:6px 16px;margin:0}dt{color:var(--muted);font-size:14px}dd{margin:0}
code{font:14px ui-monospace,SFMono-Regular,Menlo,monospace;background:#f3f1ea;padding:1px 6px;border-radius:4px}
.muted{color:var(--muted);font-size:14px}.scope{background:var(--warnbg);color:var(--warn);padding:8px 12px;border-radius:6px;display:inline-block;font-size:14px;font-weight:600}
footer{margin-top:48px;color:var(--muted);font-size:13px}
</style></head><body><main>
<h1>nanori</h1>
<div class="meta">${esc(b.url)} · goal: ${esc(b.goal)} · recorded ${esc(b.createdAt)} · run ${esc(b.id)}</div>
${b.target === "local_reproduction" ? `<p><span class="scope">${b.repairState === "after" ? "Repair verified on a local reproduction. Original website unchanged." : "Local reproduction, before repair. Original website unchanged."}</span></p>` : ""}
<div class="verdict">${esc(verdictText)}</div>

<h2>Comparison</h2>
<p class="muted">Same form, same contact details, same goal. Only the name changes between rows. Each cell is one agent action; click a cell to open its screenshot. Recorded run, not live.</p>
<table class="grid"><tbody>${grid}</tbody></table>

<h2>Evidence</h2>
${findings || `<p class="muted">No findings.</p>`}

<footer>Results are from recorded runs on ${esc(b.createdAt)}. Classifications marked "proposed" were written by Claude from measured facts and have not been reviewed by a person. Guidance cited: GovTech Tokyo Input Form Guidance ver 1.1 (March 2026); it applies to Tokyo Metropolitan Government forms, and for other sites we say only "inconsistent with this guidance". Nothing was submitted.</footer>
</main></body></html>`;
}
