import type { RunBundle, RunResult, Finding, Step, FieldObservation } from "../types.js";
import { norm } from "../checkpoint.js";
import { identityById } from "../battery.js";
import { verdict, describe, headline } from "../verdict.js";
import { checkField } from "../checks/index.js";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const CLASS_LABEL: Record<Finding["classification"], string> = {
  site_defect: "Site defect, supported by evidence",
  agent_limit: "Agent limitation",
  no_issue: "No observed issue",
  inconclusive: "Inconclusive",
};

function tone(o: RunResult["outcome"]) {
  return o === "reached_checkpoint" ? "ok" : o === "stopped_before_checkpoint" ? "bad" : "warn";
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

export function renderHtml(b: RunBundle): string {
  const all = [b.baseline, ...b.cases];
  const verdictText = verdict(b);
  const hl = headline(b);
  const scope = b.target === "local_reproduction"
    ? (b.repairState === "after" ? "Repair verified on a local reproduction. Original website unchanged." : "Local reproduction, before repair. Original website unchanged.")
    : "Public page. Nothing was submitted.";

  // Comparison rows: one per name, task-stage summary instead of raw action columns.
  const rows = all.map((r) => {
    const p = firstProblem(r);
    const shot = evidenceShot(r, p?.step);
    const where = p
      ? `<div class="where"><span class="field">${esc(p.field)}</span> <span class="kind">${esc(p.kind)}</span>${p.detail ? `<div class="detail" ${p.source === "site" ? 'lang="ja"' : ""}>${esc(p.detail)}${p.source === "nanori" ? ' <span class="muted">(nanori measurement)</span>' : ""}</div>` : ""}</div>`
      : `<span class="muted">no measured problem</span>`;
    const short = r.outcome === "reached_checkpoint" ? "Confirmation screen reached" : r.outcome === "stopped_before_checkpoint" ? "Stopped: test input rejected" : r.outcome === "reached_with_workaround" ? "Reached with a workaround" : "Not determined";
    const label = (r.identity as any).label ?? identityById(r.identity.id)?.label ?? r.identity.tests;
    return `<tr class="${r.identity.id === "baseline" ? "baseline" : ""}">
      <th><div class="who">${esc(label)}</div><div class="tests">${esc(r.identity.fullName)}${r.identity.id === "baseline" ? "" : r.identity.id === "latin-own" ? " · creator's name" : " · test input"}</div></th>
      <td class="outcome ${tone(r.outcome)}">${esc(short)}<details class="why"><summary>agent note</summary>${esc(r.stopReason)}</details></td>
      <td>${where}</td>
      <td class="num">${r.steps.length}</td>
      <td>${shot ? `<a href="${esc(shot)}" target="_blank">screenshot</a>` : ""}</td></tr>`;
  }).join("");

  // Selected finding: the first supported site defect, else the first finding.
  const selected = b.findings.find((f) => f.classification === "site_defect") ?? b.findings[0];
  const selRun = selected ? b.cases.find((c) => c.identity.id === selected.identity) : undefined;
  const selStep = selRun?.steps.find((s) => s.index === selected!.stepIndex) ?? (selRun ? firstProblem(selRun)?.step : undefined);
  const selShot = selRun ? evidenceShot(selRun, selStep) : null;
  const baseShot = evidenceShot(b.baseline, undefined);

  const selectedHtml = selected ? `
    <section class="selected ${selected.classification}">
      <div class="pair">
        <figure><div class="crop"><img src="${esc(selShot)}" alt="Detail: the name field and the error"></div><figcaption>Detail crop (the same screenshot, magnified around the centre; nothing edited) · <a href="${esc(selShot)}" target="_blank">open the untouched full screenshot</a></figcaption></figure>
        <figure><a href="${esc(baseShot)}" target="_blank"><img src="${esc(baseShot)}" alt="Baseline, final screen"></a><figcaption>Baseline · ${esc(b.baseline.identity.fullName)} · ${esc(describe(b.baseline.outcome))} · <a href="${esc(baseShot)}" target="_blank">full screenshot</a></figcaption></figure>
      </div>
      <div class="facts">
        <span class="badge">${CLASS_LABEL[selected.classification]}</span> <span class="rev">${selected.reviewState === "proposed" ? "proposed by Claude from measured facts, not yet reviewed by a person" : "reviewed"}</span>
        <dl>
          <dt>Field</dt><dd>${esc(selected.field)}</dd>
          <dt>Entered</dt><dd><code class="big">${esc(selected.requested)}</code></dd>
          <dt>Kept by the field</dt><dd><code class="big">${esc(selected.retained)}</code></dd>
          <dt>The page said</dt><dd><code class="big" lang="ja">${esc(selected.errorText) || "(no error text)"}</code></dd>
          <dt>What happened</dt><dd>${esc(selected.observation)}</dd>
          <dt>Why it matters</dt><dd>${esc(selected.relevance)}</dd>
          <dt>Basis</dt><dd>${esc(selected.basis)} <span class="muted">(${selected.guidance === "applicable" ? "applicable recommendation" : selected.guidance === "analogy" ? "analogy, for review" : "no matching recommendation"}${selected.guidanceRef ? `; ${esc(selected.guidanceRef)}` : ""})</span></dd>
          <dt>Cause</dt><dd>${esc(selected.cause)}</dd>
          <dt>Proposed repair</dt><dd>${esc(selected.fix)}</dd>
        </dl>
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
    <details><summary>${esc(r.identity.fullName)} · ${r.steps.length} actions · ${esc(describe(r.outcome))}</summary>
    <ol class="log">${r.steps.map((s) => { const bad = s.observations.some((o) => checkField(o).kind !== "accepted"); return `<li class="${bad ? "bad" : ""}"><span class="act">${esc(s.action.action)}</span> ${esc(s.action.ref ?? "")} ${s.action.value ? `<code>${esc(s.action.value)}</code>` : ""} <span class="muted">${esc(s.action.reason)}</span> <a href="${esc(r.identity.id)}/${esc(s.screenshot)}" target="_blank">before</a>${s.screenshotAfter ? ` · <a href="${esc(r.identity.id)}/${esc(s.screenshotAfter)}" target="_blank">after</a>` : ""}${s.observations.length ? `<ul>${s.observations.map((o) => { const c = checkField(o); return `<li><span class="muted">${esc(o.label ?? o.name)}</span>: ${esc(c.kind)}${c.detail ? ` <span lang="ja">${esc(c.detail)}</span>` : ""}${c.source === "nanori" ? " <em>(nanori measurement)</em>" : ""}</li>`; }).join("")}</ul>` : ""}</li>`; }).join("")}</ol></details>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>nanori report</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#fbfaf7;--ink:#1b1f2a;--muted:#6b7280;--line:#e6e2d8;--ok:#1f7a4d;--bad:#b3261e;--warn:#9a6700;--okbg:#e6f4ec;--badbg:#fbe9e7;--warnbg:#fff4d6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,"Hiragino Sans","Noto Sans JP",system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:32px 24px}
h1{font-size:28px;margin:0 0 4px}h2{font-size:20px;margin:40px 0 12px}
.meta{color:var(--muted);font-size:14px;word-break:break-all}.verdict{font-size:24px;line-height:1.35;margin:20px 0;padding:16px 20px;border-left:4px solid var(--ink);background:#fff}
.scope{display:inline-block;background:var(--warnbg);color:var(--warn);padding:6px 12px;border-radius:6px;font-size:14px;font-weight:600}
table{border-collapse:collapse;width:100%;background:#fff;border:1px solid var(--line)}th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}thead th{font-size:13px;color:var(--muted);font-weight:500}
tr.baseline th{border-left:4px solid var(--ink)}.who{font-weight:600}.tests{font-size:13px;color:var(--muted)}
td.outcome{font-weight:600;white-space:nowrap}td.ok,.ok{color:var(--ok)}td.bad,.bad{color:var(--bad)}td.warn,.warn{color:var(--warn)}.why{font-weight:400;font-size:12px;color:var(--muted);white-space:normal;max-width:260px;border:0;background:none;padding:0;margin:4px 0 0}.why summary{font-weight:400;cursor:pointer}
.where .field{font-weight:600}.where .kind{font-size:12px;background:var(--badbg);color:var(--bad);padding:1px 8px;border-radius:999px;margin-left:6px}.detail{font-size:14px;margin-top:4px}td.num{text-align:right;color:var(--muted)}
.selected{background:#fff;border:1px solid var(--line);border-radius:10px;padding:24px;margin:16px 0}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px}.pair figure{margin:0}.pair img{width:100%;height:auto;border:1px solid var(--line);border-radius:6px}.pair figcaption{font-size:13px;color:var(--muted);margin-top:6px}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-weight:600;font-size:13px;background:var(--warnbg);color:var(--warn)}
.site_defect .badge{background:var(--badbg);color:var(--bad)}.no_issue .badge{background:var(--okbg);color:var(--ok)}.agent_limit .badge{background:#eceff3;color:#374151}
.rev{color:var(--muted);font-size:13px;margin-left:8px}dl{display:grid;grid-template-columns:160px 1fr;gap:8px 16px;margin:16px 0 0}dt{color:var(--muted);font-size:14px}dd{margin:0}
code{font:14px ui-monospace,SFMono-Regular,Menlo,monospace;background:#f3f1ea;padding:1px 6px;border-radius:4px;word-break:break-all}code.big{font-size:20px;padding:4px 10px}
.muted{color:var(--muted);font-size:14px}details{background:#fff;border:1px solid var(--line);border-radius:8px;padding:10px 16px;margin:10px 0}summary{cursor:pointer;font-weight:600}details.cmp{padding:4px 16px}details.cmp h2{margin-top:12px}
.finding dl{grid-template-columns:140px 1fr}.log{font-size:14px;padding-left:20px}.log li{margin:4px 0}.log li.bad{color:var(--bad)}.log .act{font-weight:600}.log ul{margin:2px 0 6px;color:var(--ink)}
table.ba td{font-weight:600}.verdict .head{font-size:26px;font-weight:600;line-height:1.3}.verdict .support{font-size:16px;color:var(--muted);margin-top:6px}
.crop{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:6px;aspect-ratio:4/3;background:#fff}.crop img{position:absolute;left:50%;top:50%;width:200%;max-width:none;transform:translate(-50%,-50%)}
.passed{background:var(--okbg);color:var(--ok);padding:14px 18px;border-radius:8px;font-weight:600}
td.outcome{white-space:normal}
@media (max-width:800px){.pair{grid-template-columns:1fr}dl{grid-template-columns:1fr}.verdict .head{font-size:21px}
 table:not(.ba){display:block}table:not(.ba) thead{display:none}table:not(.ba) tbody,table:not(.ba) tr{display:block}table:not(.ba) tr{border:1px solid var(--line);border-radius:8px;margin:10px 0;padding:8px 12px;background:#fff}table:not(.ba) th,table:not(.ba) td{display:block;border:0;padding:4px 0;min-width:0}td.num{text-align:left}
 table.ba{display:block;overflow-x:auto;white-space:nowrap}.meta{word-break:break-all}}
footer{margin-top:48px;color:var(--muted);font-size:13px}
</style></head><body><main>
<h1>nanori</h1>
<div class="meta">${esc(b.url)} · goal: ${esc(b.goal)} · recorded run ${esc(b.id)} on ${esc(b.createdAt)}</div>
<p><span class="scope">${esc(scope)}</span></p>
<div class="verdict"><div class="head">${esc(hl.head)}</div>${hl.support ? `<div class="support">${esc(hl.support)}</div>` : ""}</div>

${b.before ? beforeAfter : ""}
${b.before ? `<details class="cmp"><summary>Comparison table for this run (all cases)</summary>` : ""}
<h2>Comparison</h2>
<p class="muted">${b.scenario ? "Same form, same goal, same contact details, and the same fixed non-name choices (date rule, first options, message). Only the name and its reading change between rows; the run log shows what was actually selected." : "Same form, same goal, same contact details. Non-name choices (options, message) were left to the agent in this run and may differ between rows; see the run log."} Names other than the baseline are name-format test cases, not verified identities. Recorded run, not live.</p>
<table><thead><tr><th>Name format</th><th>Outcome</th><th>Name check: first measured problem</th><th>Actions</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table>
<p class="muted">Examples test name formats. Except for the creator's name, they are sample inputs, not research participants.</p>
${(() => { const od = all.flatMap((r) => otherDiagnostics(r).map((d) => ({ r, ...d }))); return od.length ? `<details class="other"><summary>Other diagnostics (${od.length}, not name findings; kept in the data)</summary><ul>${od.map((d) => `<li><span class="muted">${esc(d.r.identity.fullName)} · step ${d.step.index} · ${esc(d.o.label ?? d.o.name)}</span>: ${esc(d.c.kind)}${d.c.detail ? ` <span lang="ja">${esc(d.c.detail)}</span>` : ""}${d.c.source === "nanori" ? " <em>(nanori measurement)</em>" : ""}<br><span class="muted">typed "${esc(d.o.requested)}", field kept "${esc(d.o.retained)}"${d.o.diagnostic ? "; uncertain: " + esc(d.o.diagnostic.note) : ""}</span></li>`).join("")}</ul></details>` : ""; })()}

${b.before ? `</details>` : ""}

<h2>Evidence</h2>
${b.findings.length ? selectedHtml : `<p class="passed">${esc(b.before ? "Every case reached the confirmation screen on the repaired reproduction, with each name shown exactly in its review row. No name finding; no site error text was recorded." : "No findings.")}</p>`}
${others ? `<h3 class="muted">Other findings</h3>${others}` : ""}
${b.publicRun ? `<p class="muted">The public finding this repair answers: <a href="../${esc(b.publicRun)}/report.html">${esc(b.publicRun)}/report.html</a>.</p>` : ""}
${b.probe ? `<p class="muted">Separate boundary probe (same page, fixed inputs, only the name length varied): ${esc(b.probe.summary)} <a href="${esc(b.probe.href)}" target="_blank">probe evidence</a>. The model-written cause above was captured before this probe and is left as recorded.</p>` : ""}

<h2>Run details</h2>
${log}

<footer>Measurements (retained value, validation message, aria-invalid, visible error text, checkpoint rendering) are made by code. Classifications marked "proposed" were written by Claude from those measurements and have not been reviewed by a person. Guidance cited: GovTech Tokyo Input Form Guidance ver 1.1 (March 2026), scoped to Tokyo Metropolitan Government forms; for other sites we say only "inconsistent with this guidance". nanori does not attempt alternate entry paths; where a page documents one, it is reported as documented but untested. Nothing was submitted.</footer>
</main></body></html>`;
}
