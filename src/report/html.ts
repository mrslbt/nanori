import type { RunBundle, RunResult, Finding, Step, FieldObservation } from "../types.js";
import { norm, defaultContract } from "../checkpoint.js";
import { identityById } from "../battery.js";
import { verdict, describe, headline, tally } from "../verdict.js";
import { checkField } from "../checks/index.js";
import { mergeFindings } from "../findings.js";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const CLASS_LABEL: Record<Finding["classification"], string> = {
  site_defect: "Site defect, supported by evidence",
  agent_limit: "Agent limitation",
  no_issue: "No observed issue",
  inconclusive: "Inconclusive",
};

function tone(o: RunResult["outcome"]) {
  return o === "reached_checkpoint" ? "ok" : o === "stopped_before_checkpoint" || o === "reached_name_changed" ? "bad" : "warn";
}

/** Is this observation about a name field? Decided by the typed value matching one of the identity's name values, or the field label. */
function isNameObservation(o: FieldObservation, r: RunResult): boolean {
  const id = r.identity;
  const vals = [id.fullName, id.familyName, id.givenName, id.kanaFull, id.kanaFamily, id.kanaGiven].filter(Boolean).map((v) => norm(v!));
  const hira = vals.map((v) => v.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)));
  if (vals.includes(norm(o.requested)) || hira.includes(norm(o.requested))) return true;
  return /(氏名|名前|姓|名|フリガナ|ふりがな|セイ|メイ|カナ|name|kana)/i.test(o.label ?? o.name ?? "");
}

/** The step where a run first hit a measured NAME problem, if any. Non-name observations go to "Other diagnostics". */
function firstProblem(r: RunResult): { step: Step; field: string; detail: string; kind: string; source: string } | null {
  for (const s of r.steps) {
    for (const o of s.observations) {
      if (!isNameObservation(o, r)) continue;
      const c = checkField(o);
      if (c.kind !== "accepted" && c.kind !== "not_verified") return { step: s, field: o.label ?? o.name ?? o.ref, detail: c.detail, kind: c.kind, source: c.source ?? "site" };
    }
  }
  const stuck = r.steps.find((s) => s.action.action === "stuck");
  return stuck ? { step: stuck, field: "", detail: stuck.action.reason, kind: "agent stopped", source: "agent" } : null;
}

function otherDiagnostics(r: RunResult): Array<{ step: Step; o: FieldObservation; c: ReturnType<typeof checkField> }> {
  const out: Array<{ step: Step; o: FieldObservation; c: ReturnType<typeof checkField> }> = [];
  for (const s of r.steps) for (const o of s.observations) { if (isNameObservation(o, r)) continue; const c = checkField(o); if (c.kind !== "accepted") out.push({ step: s, o, c }); }
  return out;
}

function evidenceShot(r: RunResult, s: Step | undefined): string | null {
  if (!s) { const last = r.steps[r.steps.length - 1]; return last ? `${r.identity.id}/${last.screenshotAfter ?? last.screenshot}` : null; }
  return `${r.identity.id}/${s.screenshotAfter ?? s.screenshot}`;
}

export function renderHtml(input: RunBundle): string {
  const b: RunBundle = { ...input, findings: mergeFindings(input.findings) };
  const all = [b.baseline, ...b.cases];
  const verdictText = verdict(b);
  const hl = headline(b);
  const t = tally(b.cases);
  const vtone = b.baseline.outcome !== "reached_checkpoint" ? "warn" : t.stopped || t.changed ? "bad" : t.reached === t.total ? "ok" : "warn";
  const scope = b.target === "local_reproduction"
    ? (b.simulation
      ? (b.repairState === "after" ? "Local simulation, repaired. Not a test of any real provider." : "Local simulation, before repair. Not a test of any real provider.")
      : (b.repairState === "after" ? "Repair verified on a local reproduction. Original website unchanged." : "Local reproduction, before repair. Original website unchanged."))
    : "Public page. Nothing was submitted.";

  // Comparison rows: one per name, task-stage summary instead of raw action columns.
  const rows = all.map((r) => {
    const p = firstProblem(r);
    const shot = evidenceShot(r, p?.step);
    const where = p
      ? `<div class="where"><span class="field">${esc(p.field)}</span> <span class="kind">${esc(p.kind)}</span>${p.detail ? `<div class="detail" ${p.source === "site" ? 'lang="ja"' : ""}>${esc(p.detail)}${p.source === "nanori" ? ' <span class="muted">(nanori measurement)</span>' : ""}</div>` : ""}${shot ? `<div class="detail"><a href="${esc(shot)}" target="_blank">Screenshot, step ${p.step.index}</a></div>` : ""}</div>`
      : `<span class="muted">No measured problem.</span>${shot ? ` <a class="muted" href="${esc(shot)}" target="_blank">Final screen</a>` : ""}`;
    // The agent's note: first sentence inline, the rest behind a toggle.
    const [noteHead, ...noteRest] = r.stopReason.split(/(?<=[.。])\s+/);
    const note = `<div class="note">${esc(noteHead)}${noteRest.length ? ` <details class="why"><summary>more</summary>${esc(noteRest.join(" "))} (${r.steps.length} actions)</details>` : ` <span class="muted">(${r.steps.length} actions)</span>`}</div>`;
    const short = r.outcome === "reached_checkpoint" ? "Confirmation screen reached" : r.outcome === "stopped_before_checkpoint" ? "Stopped: test input rejected" : r.outcome === "reached_name_changed" ? "Reached, but the name was shown changed" : r.outcome === "reached_with_workaround" ? "Reached with a workaround" : "Not determined";
    const label = (r.identity as any).label ?? identityById(r.identity.id)?.label ?? r.identity.tests;
    return `<tr class="${r.identity.id === "baseline" ? "baseline" : ""}">
      <th><div class="who">${esc(label)}</div><div class="tests">${esc(r.identity.fullName)}</div></th>
      <td class="outcome"><span class="${tone(r.outcome)}">${esc(short)}</span>${note}</td>
      <td>${where}</td></tr>`;
  }).join("");

  // Were the non-name inputs really the same? Compare the non-name rows of each case's confirmation screen with the
  // baseline's. A shared scenario prompt is an instruction, not proof; this is the measurement.
  const nonName = (r: RunResult) => { const m = r.steps[r.steps.length - 1]?.checkpointModel; if (!m) return null; const out = new Map<string, string>(); for (const row of m.rows) if (!defaultContract.nameRowLabel.test(row.label)) out.set(norm(row.label), norm(row.value)); return out; };
  const baseRows = nonName(b.baseline);
  const inputDiffs = b.cases.map((r) => { const rows = nonName(r); if (!baseRows || !rows) return { r, diffs: null as null | Array<{ label: string; base: string; got: string }> }; const diffs: Array<{ label: string; base: string; got: string }> = []; for (const [label, base] of baseRows) { const got = rows.get(label); if (got !== undefined && got !== base) diffs.push({ label, base, got }); } return { r, diffs }; });
  const compared = inputDiffs.filter((d) => d.diffs !== null);
  const differing = compared.filter((d) => d.diffs!.length);
  const inputsNote = !baseRows ? "Non-name inputs could not be compared: the baseline's confirmation screen was not recorded."
    : !compared.length ? "Non-name inputs could not be compared on the confirmation screen for any case; cases that stop before it leave no rows to compare."
    : differing.length ? `Non-name inputs differed from the baseline on the confirmation screen in ${differing.length} ${differing.length === 1 ? "case" : "cases"} (measured): ${differing.map((d) => `${d.r.identity.fullName}: ${d.diffs!.map((x) => `${x.label} was "${x.base || "(empty)"}" in the baseline and "${x.got || "(empty)"}" here`).join("; ")}`).join(". ")}. That pair is not a fully controlled comparison.`
    : `Non-name values on the confirmation screen matched the baseline's row for row in ${compared.length === b.cases.length ? "every case" : `the ${compared.length} ${compared.length === 1 ? "case" : "cases"} that reached it`} (measured).`;

  // Selected finding: the first supported site defect, else the first finding.
  const selected = b.findings.find((f) => f.classification === "site_defect") ?? b.findings[0];
  const selRun = selected ? b.cases.find((c) => c.identity.id === selected.identity) : undefined;
  const selStep = selRun?.steps.find((s) => s.index === selected!.stepIndex) ?? (selRun ? firstProblem(selRun)?.step : undefined);
  const selShot = selRun ? evidenceShot(selRun, selStep) : null;
  const baseShot = evidenceShot(b.baseline, undefined);
  // Crop around the measured field when the run recorded where it was; older runs fall back to the centre.
  const fx = Math.round((selStep?.focus?.x ?? 0.5) * 100), fy = Math.round((selStep?.focus?.y ?? 0.5) * 100);
  const cropStyle = `object-position:${fx}% ${fy}%;transform-origin:${fx}% ${fy}%`;
  const cropNote = selStep?.focus ? "magnified around the measured field" : "magnified around the centre";

  // Repair brief: a self-contained block the developer can paste into Claude Code or an issue.
  const brief = selected ? [
    `nanori repair brief`,
    `Run: ${b.id} (${b.target === "local_reproduction" ? "local reproduction" + (b.repairState ? ", " + b.repairState + " repair" : "") : "public page, nothing submitted"}), recorded ${b.createdAt}`,
    `Form: ${b.url}`,
    `Goal given to the agent: ${b.goal}`,
    ``,
    `Finding (${CLASS_LABEL[selected.classification]}; proposed by Claude from measured facts, not yet reviewed by a person)`,
    `Field: ${selected.field}`,
    ...(selected.components?.length ? selected.components.map((c) => `Entered, ${c.field}: ${c.requested}`) : [`Entered: ${selected.requested}`]),
    `${/review row/i.test(selected.field) ? "Shown on confirmation" : "Kept by the field"}: ${selected.retained}`,
    `The page said: ${selected.errorText || "(no error text)"}`,
    `What happened: ${selected.observation}`,
    `Basis: ${selected.basis}${selected.guidanceRef ? ` (${selected.guidanceRef})` : ""}`,
    ``,
    `Results in this run (same form, same goal, same contact details)`,
    inputsNote,
    ...all.map((r) => `- ${r.identity.fullName}${r.identity.id === "baseline" ? " (baseline)" : ""}: ${describe(r.outcome)}`),
    ``,
    `Evidence, paths relative to this report's folder:`,
    `- failing case: ${selShot ?? "(none)"}`,
    `- baseline: ${baseShot ?? "(none)"}`,
    ``,
    `Proposed cause (Claude's reading of the measurements, not verified against the form's source): ${selected.cause}`,
    `Proposed repair: ${selected.fix}`,
    ``,
    `Rules for the fix`,
    `- Change only a form you own, or a local reproduction of it. Do not touch a third-party website.`,
    `- Keep the required-field checks and every behaviour that already works. Genuinely invalid input must still be rejected.`,
    `- Do not change the test cases to fit the form.`,
    ``,
    `Confirm the fix (run from the nanori folder, with the fixed form being served):`,
    `node dist/cli.js rerun ${b.id} --target <URL of the fixed form>`,
    ...(b.target === "local_reproduction" ? [] : [`Optional: if you first ran nanori against an unrepaired local copy of this form, add --before <that run id> so the before column shows the local copy instead of this public run.`]),
    `Then open the new runs/<id>/report.html and read the before/after table.`,
    ...(b.simulation ? [``, `Note: ${b.simulation}`] : []),
  ].join("\n") : "";

  const selectedHtml = selected ? `
    <section class="selected ${selected.classification}" id="finding">
      <div class="pair">
        <figure><div class="crop"><img src="${esc(selShot)}" style="${cropStyle}" alt="Detail: the name field and the error"></div><figcaption>${esc(selRun?.identity.fullName ?? "")}: the same screenshot, ${cropNote}, nothing edited. <a href="${esc(selShot)}" target="_blank">${esc(selRun?.identity.fullName ?? "")}, full screenshot</a></figcaption></figure>
        <figure><a href="${esc(baseShot)}" target="_blank"><img src="${esc(baseShot)}" alt="Baseline, final screen"></a><figcaption>Baseline ${esc(b.baseline.identity.fullName)}: ${esc(describe(b.baseline.outcome))}. <a href="${esc(baseShot)}" target="_blank">Baseline, full screenshot</a></figcaption></figure>
      </div>
      <div class="facts">
        <div class="clsrow"><p class="cls"><strong>${CLASS_LABEL[selected.classification]}.</strong> ${selected.reviewState === "proposed" ? "Proposed by Claude from measured facts, not yet reviewed by a person." : "Reviewed."}</p>
          <button type="button" id="copy-brief" title="Copies this finding as plain text, for Claude Code or an issue">Copy repair brief</button></div>
        <dl class="measured">
          <dt>Field</dt><dd>${esc(selected.field)}</dd>
          ${selected.components?.length ? selected.components.map((c) => `<dt>Entered, ${esc(c.field)}</dt><dd><code class="big">${esc(c.requested)}</code></dd>`).join("") : `<dt>Entered</dt><dd><code class="big">${esc(selected.requested)}</code></dd>`}
          <dt>${/review row/i.test(selected.field) ? "Shown on confirmation" : "Kept by the field"}</dt><dd><code class="big ${selected.retained !== selected.requested ? "diff" : ""}">${esc(selected.retained)}</code></dd>
          <dt>The page said</dt><dd><code class="big said" lang="ja">${esc(selected.errorText) || "(no error text)"}</code></dd>
        </dl>
        <p class="sep">The values above were measured by code. What follows was written by Claude from them.</p>
        <dl>
          <dt>What happened</dt><dd>${esc(selected.observation)}</dd>
          <dt>Why it matters</dt><dd>${esc(selected.relevance)}</dd>
          <dt>Basis</dt><dd>${esc(selected.basis)} <span class="muted">(${selected.guidance === "applicable" ? "applicable recommendation" : selected.guidance === "analogy" ? "analogy, for review" : "no matching recommendation"}${selected.guidanceRef ? `; ${esc(selected.guidanceRef)}` : ""})</span></dd>
          <dt>Cause</dt><dd>${esc(selected.cause)}</dd>
          <dt>Proposed repair</dt><dd>${esc(selected.fix)}</dd>
        </dl>
        <div class="brief"><details><summary>The repair brief as text</summary><textarea id="brief-text" readonly rows="18" spellcheck="false">${esc(brief)}</textarea></details></div>
      </div>
    </section>` : `<p class="muted">No findings.</p>`;

  const others = b.findings.filter((f) => f !== selected).map((f) => `
    <details class="finding ${f.classification}"><summary><span class="badge">${CLASS_LABEL[f.classification]}</span> ${esc(f.identity)} · ${esc(f.field)} · ${esc(f.kind)}</summary>
      <dl>
        <dt>Entered</dt><dd><code>${esc(f.requested)}</code></dd><dt>Kept</dt><dd><code>${esc(f.retained)}</code></dd><dt>The page said</dt><dd lang="ja"><code>${esc(f.errorText) || "(none)"}</code></dd>
        <dt>What happened</dt><dd>${esc(f.observation)}</dd><dt>Why it matters</dt><dd>${esc(f.relevance)}</dd><dt>Basis</dt><dd>${esc(f.basis)}</dd><dt>Cause</dt><dd>${esc(f.cause)}</dd><dt>Proposed repair</dt><dd>${esc(f.fix)}</dd>
      </dl><p><a href="${esc(f.identity)}/${esc(f.screenshot)}" target="_blank">screenshot</a> · ${f.reviewState === "proposed" ? "proposed, not reviewed" : "reviewed"}</p></details>`).join("");

  // Before / after when this run is a repair rerun.
  const beforeAfter = b.before ? `
    <h2>Repair verification</h2>
    <table class="ba"><thead><tr><th>Name format</th><th>Before (${esc(b.before.id)}, ${esc(b.before.target === "public" ? "public page" : "local reproduction, before repair")})</th><th>After (this run, local reproduction, repaired)</th><th>Name shown exactly in review row</th></tr></thead><tbody>
    ${all.map((r) => { const bo = b.before!.outcomes[r.identity.id]; const intact = !r.steps.flatMap((s) => s.observations).some((o) => o.diagnostic && !/not a name finding/.test(o.diagnostic.note)); return `<tr><th>${esc(r.identity.fullName)}</th><td class="${tone(bo ?? "not_determined")}">${esc(bo ? describe(bo) : "not run")}</td><td class="${tone(r.outcome)}">${esc(describe(r.outcome))}</td><td>${r.outcome === "reached_checkpoint" ? (intact ? "yes" : "see diagnostics") : "n/a"}</td></tr>`; }).join("")}
    </tbody></table>
    <p class="muted">${b.before.target === "public" ? `"Before" is the saved public run; "after" is this run on the repaired local copy.` : `Both columns are the same local reproduction, before and after the repair; the public finding is linked separately.`} Passing results prove these cases on the reproduction, not the live site. "Exactly" means the review row's value equals the typed value after whitespace and Unicode normalisation. Genuinely invalid input must still be rejected; the local copy's banner says what was changed.</p>` : "";

  // Run details: the full action log, collapsed.
  const log = all.map((r) => `
    <details><summary>${esc(r.identity.fullName)}: ${r.steps.length} actions, ${esc(describe(r.outcome))}</summary>
    <ol class="log">${r.steps.map((s) => { const bad = s.observations.some((o) => checkField(o).kind !== "accepted"); return `<li class="${bad ? "bad" : ""}"><span class="act">${esc(s.action.action)}</span> ${esc(s.action.ref ?? "")} ${s.action.value ? `<code>${esc(s.action.value)}</code>` : ""} <span class="muted">${esc(s.action.reason)}</span> <a href="${esc(r.identity.id)}/${esc(s.screenshot)}" target="_blank" aria-label="Step ${s.index}, screenshot before">before</a>${s.screenshotAfter ? ` · <a href="${esc(r.identity.id)}/${esc(s.screenshotAfter)}" target="_blank" aria-label="Step ${s.index}, screenshot after">after</a>` : ""}${s.observations.length ? `<ul>${s.observations.map((o) => { const c = checkField(o); return `<li><span class="muted">${esc(o.label ?? o.name)}</span>: ${esc(c.kind)}${c.detail ? ` <span lang="ja">${esc(c.detail)}</span>` : ""}${c.source === "nanori" ? " <em>(nanori measurement)</em>" : ""}</li>`; }).join("")}</ul>` : ""}</li>`; }).join("")}</ol></details>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>nanori report: ${esc(b.id)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+JP:wght@400;500;600;700&display=swap" rel="stylesheet">
<script>try{var t=localStorage.getItem("nanori-theme");if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>
<style>
:root{--bg:#fbfaf8;--ink:#17191d;--text:#2b2e34;--muted:#6b6e75;--rule:#e2dfd8;--ok:#1a6b43;--bad:#b8291b;--warn:#8a5a00;--code:#f0eee9;--diff:#f9e3df;--white:#fff;--btn:#17191d;--btntext:#fff;
--sans:"IBM Plex Sans JP","Hiragino Sans","Noto Sans JP",sans-serif;--mono:"IBM Plex Mono",Menlo,monospace;color-scheme:light}
:root[data-theme="dark"]{--bg:#141517;--ink:#f0ede6;--text:#cfccc4;--muted:#8f8d86;--rule:#2b2d31;--ok:#6cc495;--bad:#f28b7d;--warn:#dcae4c;--code:#222428;--diff:#4a221d;--white:#1b1d20;--btn:#f0ede6;--btntext:#141517;color-scheme:dark}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141517;--ink:#f0ede6;--text:#cfccc4;--muted:#8f8d86;--rule:#2b2d31;--ok:#6cc495;--bad:#f28b7d;--warn:#dcae4c;--code:#222428;--diff:#4a221d;--white:#1b1d20;--btn:#f0ede6;--btntext:#141517;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 var(--sans)}
main{max-width:1040px;margin:0 auto;padding:36px 28px 72px}
a{color:var(--ink);text-underline-offset:3px;text-decoration-thickness:1px}
.top{padding-bottom:20px;border-bottom:1px solid var(--rule)}
.sim{color:var(--ink);margin-top:6px;max-width:80ch}.brandrow{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px}.brand{font-weight:600;font-size:18px;color:var(--ink)}
#theme{font:14px var(--sans);color:var(--muted);background:none;border:0;padding:0;cursor:pointer;text-decoration:underline;text-underline-offset:3px}#theme:hover{color:var(--ink)}.meta{font-size:14px;color:var(--muted);line-height:1.6}.meta .url{overflow-wrap:anywhere}.meta strong{color:var(--text);font-weight:600}
.verdict{margin:40px 0 8px}.verdict h1{font-size:32px;line-height:1.2;font-weight:600;letter-spacing:-.015em;margin:0;color:var(--ink);text-wrap:balance}.verdict.v-bad h1{color:var(--bad)}.verdict.v-ok h1{color:var(--ok)}.verdict.v-warn h1{color:var(--warn)}
.verdict p{font-size:17px;margin:10px 0 0;max-width:70ch}
h2{font-size:19px;font-weight:600;color:var(--ink);margin:52px 0 10px}h3{font-size:14px;font-weight:600;margin:28px 0 6px;color:var(--ink)}
.muted{color:var(--muted);font-size:14px}p.muted{max-width:90ch}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:12px 12px 12px 0;border-bottom:1px solid var(--rule);vertical-align:top}th:last-child,td:last-child{padding-right:0}
thead th{font-size:14px;font-weight:500;color:var(--muted);padding-top:0}
.who{font-weight:600;color:var(--ink)}.tests{font:14px var(--mono);color:var(--muted);margin-top:2px}
table.cmp th:first-child{width:26%}table.cmp th:nth-child(2){width:37%}td.outcome span.ok,td.outcome span.bad,td.outcome span.warn{font-weight:600}.note{font-size:14px;color:var(--muted);margin-top:4px;max-width:40ch}.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}
.why{display:inline;font-weight:400;font-size:14px;color:var(--muted);margin:0;border:0;padding:0}.why summary{display:inline;cursor:pointer;font-weight:400;color:var(--ink);text-decoration:underline;text-underline-offset:3px}.why[open] summary{display:block}
.where .field{font-weight:600;color:var(--ink)}.where .kind{color:var(--bad);margin-left:6px}.detail{font-size:14px;margin-top:3px}
.selected{margin:16px 0}
.pair{display:grid;grid-template-columns:1.15fr 1fr;gap:20px;margin-bottom:24px}.pair figure{margin:0}.pair img{width:100%;height:auto;display:block;border:1px solid var(--rule)}.pair figcaption{font-size:14px;color:var(--muted);margin-top:8px;line-height:1.5}
.crop{position:relative;overflow:hidden;border:1px solid var(--rule);aspect-ratio:4/3;background:var(--white)}.crop img{width:100%;height:100%;object-fit:cover;transform:scale(2);border:0}
.clsrow{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}.cls{margin:0 0 4px;flex:1 1 40ch}.cls strong{color:var(--ink)}.site_defect .cls strong{color:var(--bad)}.no_issue .cls strong{color:var(--ok)}
dl{display:grid;grid-template-columns:150px 1fr;gap:8px 20px;margin:14px 0 0}dt{font-size:14px;color:var(--muted);padding-top:2px}dd{margin:0}
dl.measured dd{color:var(--ink)}.sep{font-size:14px;color:var(--muted);margin:18px 0 0}
code{font:14px var(--mono);background:var(--code);padding:1px 6px;word-break:break-all}code.big{font-size:18px;padding:4px 10px;display:inline-block}code.big.diff{background:var(--diff);color:var(--bad)}code.big.said{background:var(--white);border:1px solid var(--rule)}
details{padding:10px 0;margin:8px 0;border-bottom:1px solid var(--rule)}summary{cursor:pointer;font-weight:500;color:var(--ink)}details.cmp{border:0;padding:0}details.cmp h2{margin-top:16px}
details.other summary,details.finding summary{font-size:15px}.finding dl{grid-template-columns:140px 1fr}
.log{font-size:14px;padding-left:22px}.log li{margin:5px 0}.log li.bad{color:var(--bad)}.log .act{font-weight:600}.log ul{margin:2px 0 6px;color:var(--text);font-size:14px}
table.ba td{font-weight:600}
.passed{color:var(--ok);font-weight:600;font-size:16px;margin:12px 0}
#copy-brief{font:600 14px var(--sans);padding:9px 16px;border:1px solid var(--btn);background:var(--btn);color:var(--btntext);cursor:pointer;flex:0 0 auto}#copy-brief:hover{opacity:.9}#copy-brief.done{background:var(--ok);border-color:var(--ok);color:#fff}
.brief{margin-top:16px}.brief details{border:0;padding:0;margin:0}.brief summary{font-weight:400;font-size:14px;color:var(--muted)}.brief textarea{width:100%;font:13px/1.5 var(--mono);padding:12px;border:1px solid var(--rule);background:var(--white);color:var(--ink);margin-top:8px}
footer{margin-top:64px;padding-top:16px;border-top:1px solid var(--rule);color:var(--muted);font-size:14px;max-width:90ch}
@media (max-width:820px){main{padding:24px 16px 56px}.top{grid-template-columns:1fr;gap:8px}.note{max-width:none}
 .verdict h1{font-size:24px}.pair{grid-template-columns:1fr}dl{grid-template-columns:1fr;gap:2px 0}dt{padding-top:10px}
 table:not(.ba){display:block}table:not(.ba) thead{display:none}table:not(.ba) tbody,table:not(.ba) tr{display:block}table:not(.ba) tr{border-bottom:1px solid var(--rule);padding:12px 0}table:not(.ba) th,table:not(.ba) td{display:block;border:0;padding:3px 0;min-width:0}
 table.ba{display:block;overflow-x:auto;white-space:nowrap}}
</style></head><body><main>
<header class="top">
  <div class="brandrow"><div class="brand">nanori</div><button type="button" id="theme" aria-label="Switch colour theme">Dark mode</button></div>
  <div class="meta"><div class="url">${esc(b.url)}</div><div>Goal: ${esc(b.goal)}</div><div>Run ${esc(b.id)}, ${esc(b.createdAt.replace("T", " ").replace(/\.\d+Z$/, " UTC"))}</div><div><strong>${esc(scope)}</strong></div>${b.simulation ? `<div class="sim">${esc(b.simulation)}</div>` : ""}</div>
</header>
<section class="verdict v-${vtone}"><h1>${esc(hl.head)}</h1>${hl.support ? `<p>${esc(hl.support)}${b.findings.length ? ` <a href="#finding">See the evidence.</a>` : ""}</p>` : ""}</section>

${b.before ? beforeAfter : ""}
${b.before ? `<details class="cmp"><summary>Comparison table for this run (all cases)</summary>` : ""}
<h2>Comparison</h2>
<p class="muted">${b.scenario ? "Same form, same goal, same contact details; the agent was told to make the same fixed non-name choices (date rule, first options, message) in every case." : "Same form, same goal, same contact details. Non-name choices (options, message) were left to the agent in this run and may differ between rows."} ${esc(inputsNote)} Names other than the baseline are name-format test cases, not verified identities. Recorded run, not live.</p>
<table class="cmp"><thead><tr><th>Name format</th><th>Outcome</th><th>What the form did to the name</th></tr></thead><tbody>${rows}</tbody></table>
<p class="muted">Examples test name formats. Except for the creator's name, they are sample inputs, not research participants.</p>
${(() => { const od = all.flatMap((r) => otherDiagnostics(r).map((d) => ({ r, ...d }))); return od.length ? `<details class="other"><summary>Other diagnostics (${od.length}, not about names)</summary><ul>${od.map((d) => `<li><span class="muted">${esc(d.r.identity.fullName)} · step ${d.step.index} · ${esc(d.o.label ?? d.o.name)}</span>: ${esc(d.c.kind)}${d.c.detail ? ` <span lang="ja">${esc(d.c.detail)}</span>` : ""}${d.c.source === "nanori" ? " <em>(nanori measurement)</em>" : ""}<br><span class="muted">typed "${esc(d.o.requested)}", field kept "${esc(d.o.retained)}"${d.o.diagnostic ? "; uncertain: " + esc(d.o.diagnostic.note) : ""}</span></li>`).join("")}</ul></details>` : ""; })()}

${b.before ? `</details>` : ""}

<h2>Evidence</h2>
${b.findings.length ? selectedHtml : `<p class="passed">${esc(b.before ? "Every case reached the confirmation screen on the repaired reproduction, with each name shown exactly in its review row. No name finding; no site error text was recorded." : "No findings.")}</p>`}
${others ? `<h3 class="muted">Other findings</h3>${others}` : ""}
${b.publicRun ? `<p class="muted">The public finding this repair answers: <a href="../${esc(b.publicRun)}/report.html">${esc(b.publicRun)}/report.html</a>.</p>` : ""}
${b.probe ? `<p class="muted">Separate boundary probe (same page, fixed inputs, only the name length varied): ${esc(b.probe.summary)} <a href="${esc(b.probe.href)}" target="_blank">probe evidence</a>. The model-written cause above was captured before this probe and is left as recorded.</p>` : ""}

<h2>Run details</h2>
${log}

<footer>Measurements (retained value, validation message, aria-invalid, visible error text, checkpoint rendering) are made by code. Classifications marked "proposed" were written by Claude from those measurements and have not been reviewed by a person. Guidance cited: GovTech Tokyo Input Form Guidance ver 1.1 (March 2026), scoped to Tokyo Metropolitan Government forms; for other sites we say only "inconsistent with this guidance". nanori does not attempt alternate entry paths; where a page documents one, it is reported as documented but untested. Nothing was submitted.</footer>
</main>
<script>
(function(){var btn=document.getElementById("theme"),root=document.documentElement;function cur(){var a=root.getAttribute("data-theme");return a||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")}
function label(){btn.textContent=cur()==="dark"?"Light mode":"Dark mode"}label();
btn.addEventListener("click",function(){var n=cur()==="dark"?"light":"dark";root.setAttribute("data-theme",n);try{localStorage.setItem("nanori-theme",n)}catch(e){}label()})})();
(function(){var b=document.getElementById("copy-brief"),t=document.getElementById("brief-text");if(!b||!t)return;
b.addEventListener("click",function(){var done=function(){b.textContent="Copied";b.classList.add("done");setTimeout(function(){b.textContent="Copy repair brief";b.classList.remove("done")},2000)};
var fail=function(){t.closest("details").open=true;t.focus();t.select();b.textContent="Copy the text below"};
if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t.value).then(done,fail)}else{fail()}})})();
</script>
</body></html>`;
}
