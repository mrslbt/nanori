import type { RunBundle, RunResult, Finding, Step, FieldObservation } from "../types.js";
import { norm } from "../checkpoint.js";
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
    ? (b.repairState === "after" ? "Repair verified on a local reproduction. Original website unchanged." : "Local reproduction, before repair. Original website unchanged.")
    : "Public page. Nothing was submitted.";

  // Comparison rows: one per name, task-stage summary instead of raw action columns.
  const rows = all.map((r) => {
    const p = firstProblem(r);
    const shot = evidenceShot(r, p?.step);
    const where = p
      ? `<div class="where"><span class="field">${esc(p.field)}</span> <span class="kind">${esc(p.kind)}</span>${p.detail ? `<div class="detail" ${p.source === "site" ? 'lang="ja"' : ""}>${esc(p.detail)}${p.source === "nanori" ? ' <span class="muted">(nanori measurement)</span>' : ""}</div>` : ""}</div>`
      : `<span class="muted">no measured problem</span>`;
    const short = r.outcome === "reached_checkpoint" ? "Confirmation screen reached" : r.outcome === "stopped_before_checkpoint" ? "Stopped: test input rejected" : r.outcome === "reached_name_changed" ? "Reached, but the name was shown changed" : r.outcome === "reached_with_workaround" ? "Reached with a workaround" : "Not determined";
    const label = (r.identity as any).label ?? identityById(r.identity.id)?.label ?? r.identity.tests;
    return `<tr class="${r.identity.id === "baseline" ? "baseline" : ""}">
      <th><div class="who">${esc(label)}</div><div class="tests"><span class="mono">${esc(r.identity.fullName)}</span>${r.identity.id === "baseline" ? "" : r.identity.id === "latin-own" ? " · creator's name" : " · test input"}</div></th>
      <td class="outcome"><span class="chip ${tone(r.outcome)}">${esc(short)}</span><details class="why"><summary>agent note</summary>${esc(r.stopReason)}</details></td>
      <td>${where}</td>
      <td class="num mono">${r.steps.length}</td>
      <td>${shot ? `<a href="${esc(shot)}" target="_blank">screenshot</a>` : ""}</td></tr>`;
  }).join("");

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
    `Entered: ${selected.requested}`,
    `Kept by the field: ${selected.retained}`,
    `The page said: ${selected.errorText || "(no error text)"}`,
    `What happened: ${selected.observation}`,
    `Basis: ${selected.basis}${selected.guidanceRef ? ` (${selected.guidanceRef})` : ""}`,
    ``,
    `Results in this run (same form, same goal, same non-name inputs; only the name changed)`,
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
    `node dist/cli.js rerun ${b.id} --target <URL of the fixed form>${b.target === "local_reproduction" ? "" : " --before <run id of the unrepaired local copy, if you made one>"}`,
    `Then open the new runs/<id>/report.html and read the before/after table.`,
  ].join("\n") : "";

  const selectedHtml = selected ? `
    <section class="selected ${selected.classification}">
      <div class="pair">
        <figure><div class="crop"><img src="${esc(selShot)}" style="${cropStyle}" alt="Detail: the name field and the error"></div><figcaption><span class="k">Evidence</span> ${esc(selRun?.identity.fullName ?? "")} · the same screenshot, ${cropNote}; nothing edited · <a href="${esc(selShot)}" target="_blank">untouched full screenshot</a></figcaption></figure>
        <figure><a href="${esc(baseShot)}" target="_blank"><img src="${esc(baseShot)}" alt="Baseline, final screen"></a><figcaption><span class="k">Baseline</span> ${esc(b.baseline.identity.fullName)} · ${esc(describe(b.baseline.outcome))} · <a href="${esc(baseShot)}" target="_blank">full screenshot</a></figcaption></figure>
      </div>
      <div class="facts">
        <span class="badge">${CLASS_LABEL[selected.classification]}</span> <span class="rev">${selected.reviewState === "proposed" ? "proposed by Claude from measured facts, not yet reviewed by a person" : "reviewed"}</span>
        <dl class="measured">
          <dt>Field</dt><dd>${esc(selected.field)}</dd>
          <dt>Entered</dt><dd><code class="big">${esc(selected.requested)}</code></dd>
          <dt>Kept</dt><dd><code class="big ${selected.retained !== selected.requested ? "diff" : ""}">${esc(selected.retained)}</code></dd>
          <dt>The page said</dt><dd><code class="big said" lang="ja">${esc(selected.errorText) || "(no error text)"}</code></dd>
        </dl>
        <div class="k sep">Measured by code above · written by Claude below</div>
        <dl>
          <dt>What happened</dt><dd>${esc(selected.observation)}</dd>
          <dt>Why it matters</dt><dd>${esc(selected.relevance)}</dd>
          <dt>Basis</dt><dd>${esc(selected.basis)} <span class="muted">(${selected.guidance === "applicable" ? "applicable recommendation" : selected.guidance === "analogy" ? "analogy, for review" : "no matching recommendation"}${selected.guidanceRef ? `; ${esc(selected.guidanceRef)}` : ""})</span></dd>
          <dt>Cause</dt><dd>${esc(selected.cause)}</dd>
          <dt>Proposed repair</dt><dd>${esc(selected.fix)}</dd>
        </dl>
        <div class="brief">
          <button type="button" id="copy-brief">Copy repair brief</button>
          <span class="muted">Everything above as plain text, ready to paste into Claude Code or an issue.</span>
          <details><summary>show the text</summary><textarea id="brief-text" readonly rows="18" spellcheck="false">${esc(brief)}</textarea></details>
        </div>
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
<html lang="en"><head><meta charset="utf-8"><title>nanori report · ${esc(b.id)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+JP:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--paper:#f2eee5;--card:#fbf9f4;--ink:#15171c;--ink2:#3d4049;--muted:#6f6b62;--rule:#d8d1c2;--rule2:#e8e2d5;
--ok:#1d6b45;--okbg:#dcefe3;--bad:#c8321f;--badbg:#f7dcd6;--warn:#8a5a00;--warnbg:#f6e7bf;
--sans:"IBM Plex Sans JP","Hiragino Sans","Noto Sans JP",system-ui,sans-serif;--mono:"IBM Plex Mono",ui-monospace,Menlo,monospace}
*{box-sizing:border-box}html{background:var(--paper)}
body{margin:0;color:var(--ink);font:15px/1.55 var(--sans);background:var(--paper);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .06 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
main{max-width:1120px;margin:0 auto;padding:28px 28px 64px}
.mono{font-family:var(--mono)}.k{font:500 11px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
a{color:var(--ink);text-decoration-color:var(--rule);text-underline-offset:3px}a:hover{text-decoration-color:var(--ink)}
.top{display:flex;align-items:baseline;justify-content:space-between;gap:24px;padding:0 0 14px;border-bottom:2px solid var(--ink)}
.brand{font-weight:700;font-size:22px;letter-spacing:-.02em}.brand::before{content:"";display:inline-block;width:10px;height:10px;background:var(--bad);margin-right:10px;vertical-align:2px}
.meta{display:flex;gap:18px;font-size:12px;color:var(--muted);min-width:0}.meta .url{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46vw}
.goal{margin:14px 0 0;font-size:14px;color:var(--ink2);display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center}
.scope{display:inline-block;padding:5px 10px;font:500 12px/1 var(--mono);letter-spacing:.02em}.scope.warn{background:var(--warnbg);color:var(--warn)}.scope.ok{background:var(--okbg);color:var(--ok)}
.verdict{margin:26px 0 8px;padding:22px 26px 24px;background:var(--card);border-top:6px solid var(--ink)}.verdict.bad{border-top-color:var(--bad)}.verdict.ok{border-top-color:var(--ok)}.verdict.warn{border-top-color:var(--warn)}
.verdict .head{font-size:34px;line-height:1.18;font-weight:700;letter-spacing:-.022em;text-wrap:balance}.verdict .support{font-size:16px;color:var(--ink2);margin-top:10px;max-width:70ch}
h2{display:flex;align-items:baseline;gap:14px;font-size:20px;font-weight:600;letter-spacing:-.01em;margin:44px 0 10px;padding-top:12px;border-top:1px solid var(--ink)}h2 .n{font:500 12px var(--mono);color:var(--muted);letter-spacing:.1em}
h3{font-size:14px;font-weight:600;margin:24px 0 6px}
p.muted,.muted{color:var(--muted);font-size:13.5px}
table{border-collapse:collapse;width:100%;background:var(--card)}th,td{text-align:left;padding:12px 14px;border-bottom:1px solid var(--rule2);vertical-align:top}
thead th{font:500 11px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);padding:10px 14px;border-bottom:1px solid var(--rule)}
tr.baseline th{box-shadow:inset 4px 0 0 var(--ink)}.who{font-weight:600}.tests{font-size:12.5px;color:var(--muted);margin-top:2px}.tests .mono{color:var(--ink2)}
.chip{display:inline-block;padding:4px 9px;font:600 12.5px/1.2 var(--sans);white-space:nowrap}.chip.ok{background:var(--okbg);color:var(--ok)}.chip.bad{background:var(--badbg);color:var(--bad)}.chip.warn{background:var(--warnbg);color:var(--warn)}
.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}
.why{font-weight:400;font-size:12px;color:var(--muted);white-space:normal;max-width:280px;border:0;background:none;padding:0;margin:6px 0 0}.why summary{font-weight:400;cursor:pointer;list-style:none}.why summary::before{content:"+ "}.why[open] summary::before{content:"– "}
.where .field{font-weight:600}.where .kind{font:500 11px/1 var(--mono);background:var(--badbg);color:var(--bad);padding:3px 7px;margin-left:6px;vertical-align:1px}.detail{font-size:13.5px;margin-top:5px;color:var(--ink2)}td.num{text-align:right;color:var(--muted)}
.selected{background:var(--card);padding:26px;margin:14px 0;position:relative}.selected::before{content:"";position:absolute;left:0;top:0;bottom:0;width:6px;background:var(--warn)}.selected.site_defect::before{background:var(--bad)}.selected.no_issue::before{background:var(--ok)}.selected.agent_limit::before{background:var(--muted)}
.pair{display:grid;grid-template-columns:1.15fr 1fr;gap:18px;margin-bottom:22px}.pair figure{margin:0}.pair img{width:100%;height:auto;display:block;border:1px solid var(--rule)}.pair figcaption{font-size:12.5px;color:var(--muted);margin-top:8px;line-height:1.5}.pair figcaption .k{margin-right:6px}
.crop{position:relative;overflow:hidden;border:1px solid var(--rule);aspect-ratio:4/3;background:#fff}.crop img{width:100%;height:100%;object-fit:cover;transform:scale(2);border:0}
.crop::after{content:"";position:absolute;inset:0;box-shadow:inset 0 0 0 1px rgba(0,0,0,.06);pointer-events:none}
.badge{display:inline-block;padding:4px 10px;font:600 12px/1.2 var(--sans);background:var(--warnbg);color:var(--warn)}
.site_defect .badge{background:var(--badbg);color:var(--bad)}.no_issue .badge{background:var(--okbg);color:var(--ok)}.agent_limit .badge{background:#e6e2d8;color:var(--ink2)}
.rev{color:var(--muted);font-size:12.5px;margin-left:8px}
dl{display:grid;grid-template-columns:150px 1fr;gap:10px 18px;margin:16px 0 0}dt{font:500 11px/1.6 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);padding-top:3px}dd{margin:0;color:var(--ink2)}
dl.measured{padding:14px 16px 16px;background:#fff;border:1px solid var(--rule2)}dl.measured dd{color:var(--ink)}
.sep{margin:14px 0 2px}
code{font:13.5px var(--mono);background:#ebe6da;padding:1px 6px;word-break:break-all}code.big{font-size:19px;padding:5px 10px;display:inline-block}code.big.diff{background:var(--badbg);color:var(--bad)}code.big.said{background:#fff;box-shadow:inset 0 0 0 1px var(--rule),inset 4px 0 0 var(--bad)}
details{background:var(--card);border:1px solid var(--rule2);padding:10px 16px;margin:10px 0}summary{cursor:pointer;font-weight:600}details.cmp{padding:4px 16px}details.cmp h2{margin-top:14px;border-top:0}
details.other summary,details.finding summary{font-weight:500;font-size:14px}
.finding dl{grid-template-columns:140px 1fr}.log{font-size:13.5px;padding-left:22px}.log li{margin:5px 0}.log li.bad{color:var(--bad)}.log .act{font:600 12px var(--mono);letter-spacing:.04em;text-transform:uppercase}.log ul{margin:2px 0 6px;color:var(--ink);font-size:13px}
table.ba td{font-weight:600}
.passed{background:var(--okbg);color:var(--ok);padding:16px 20px;font-weight:600;border-left:6px solid var(--ok)}
.brief{margin-top:18px;display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center}.brief button{font:600 13.5px var(--sans);padding:10px 16px;border:0;background:var(--ink);color:#fff;cursor:pointer}.brief button:hover{background:#000}.brief button.done{background:var(--ok)}.brief details{flex-basis:100%;background:transparent;border:0;padding:0}.brief summary{font-weight:500;font-size:13px;color:var(--muted)}.brief textarea{width:100%;font:12.5px/1.5 var(--mono);padding:12px;border:1px solid var(--rule);background:#fff;color:var(--ink);margin-top:8px}
footer{margin-top:56px;padding-top:14px;border-top:1px solid var(--rule);color:var(--muted);font-size:12.5px;max-width:90ch}
main>*{animation:rise .5s cubic-bezier(.2,.7,.2,1) both}main>*:nth-child(2){animation-delay:.05s}main>*:nth-child(3){animation-delay:.1s}main>*:nth-child(4){animation-delay:.15s}main>*:nth-child(5){animation-delay:.2s}main>*:nth-child(n+6){animation-delay:.25s}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){main>*{animation:none}}
@media (max-width:820px){main{padding:20px 16px 48px}.top{flex-direction:column;gap:6px}.meta{flex-wrap:wrap;gap:6px 14px}.meta .url{max-width:100%;white-space:normal;word-break:break-all}
 .verdict{padding:18px}.verdict .head{font-size:24px}.pair{grid-template-columns:1fr}dl{grid-template-columns:1fr;gap:4px 0}dt{padding-top:8px}
 table:not(.ba){display:block}table:not(.ba) thead{display:none}table:not(.ba) tbody,table:not(.ba) tr{display:block}table:not(.ba) tr{border:1px solid var(--rule2);margin:10px 0;padding:10px 14px;background:var(--card)}table:not(.ba) th,table:not(.ba) td{display:block;border:0;padding:4px 0;min-width:0}tr.baseline th{box-shadow:none;border-left:4px solid var(--ink);padding-left:10px}td.num{text-align:left}td.num::before{content:"actions: ";color:var(--muted)}
 table.ba{display:block;overflow-x:auto;white-space:nowrap}.selected{padding:18px}.chip{white-space:normal}}
</style></head><body><main>
<header class="top">
  <div class="brand">nanori</div>
  <div class="meta mono"><span>run ${esc(b.id)}</span><span>${esc(b.createdAt.replace("T", " ").replace(/\.\d+Z$/, " UTC"))}</span><span class="url">${esc(b.url)}</span></div>
</header>
<p class="goal"><span class="k">Goal</span> ${esc(b.goal)} <span class="scope ${b.target === "local_reproduction" ? (b.repairState === "after" ? "ok" : "warn") : "warn"}">${esc(scope)}</span></p>
<section class="verdict ${vtone}"><div class="head">${esc(hl.head)}</div>${hl.support ? `<div class="support">${esc(hl.support)}</div>` : ""}</section>

${b.before ? beforeAfter : ""}
${b.before ? `<details class="cmp"><summary>Comparison table for this run (all cases)</summary>` : ""}
<h2><span class="n">01</span>Comparison</h2>
<p class="muted">${b.scenario ? "Same form, same goal, same contact details, and the same fixed non-name choices (date rule, first options, message). Only the name and its reading change between rows; the run log shows what was actually selected." : "Same form, same goal, same contact details. Non-name choices (options, message) were left to the agent in this run and may differ between rows; see the run log."} Names other than the baseline are name-format test cases, not verified identities. Recorded run, not live.</p>
<table><thead><tr><th>Name format</th><th>Outcome</th><th>Name check: first measured problem</th><th>Actions</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table>
<p class="muted">Examples test name formats. Except for the creator's name, they are sample inputs, not research participants.</p>
${(() => { const od = all.flatMap((r) => otherDiagnostics(r).map((d) => ({ r, ...d }))); return od.length ? `<details class="other"><summary>Other diagnostics (${od.length}, not name findings; kept in the data)</summary><ul>${od.map((d) => `<li><span class="muted">${esc(d.r.identity.fullName)} · step ${d.step.index} · ${esc(d.o.label ?? d.o.name)}</span>: ${esc(d.c.kind)}${d.c.detail ? ` <span lang="ja">${esc(d.c.detail)}</span>` : ""}${d.c.source === "nanori" ? " <em>(nanori measurement)</em>" : ""}<br><span class="muted">typed "${esc(d.o.requested)}", field kept "${esc(d.o.retained)}"${d.o.diagnostic ? "; uncertain: " + esc(d.o.diagnostic.note) : ""}</span></li>`).join("")}</ul></details>` : ""; })()}

${b.before ? `</details>` : ""}

<h2><span class="n">02</span>Evidence</h2>
${b.findings.length ? selectedHtml : `<p class="passed">${esc(b.before ? "Every case reached the confirmation screen on the repaired reproduction, with each name shown exactly in its review row. No name finding; no site error text was recorded." : "No findings.")}</p>`}
${others ? `<h3 class="muted">Other findings</h3>${others}` : ""}
${b.publicRun ? `<p class="muted">The public finding this repair answers: <a href="../${esc(b.publicRun)}/report.html">${esc(b.publicRun)}/report.html</a>.</p>` : ""}
${b.probe ? `<p class="muted">Separate boundary probe (same page, fixed inputs, only the name length varied): ${esc(b.probe.summary)} <a href="${esc(b.probe.href)}" target="_blank">probe evidence</a>. The model-written cause above was captured before this probe and is left as recorded.</p>` : ""}

<h2><span class="n">03</span>Run details</h2>
${log}

<footer>Measurements (retained value, validation message, aria-invalid, visible error text, checkpoint rendering) are made by code. Classifications marked "proposed" were written by Claude from those measurements and have not been reviewed by a person. Guidance cited: GovTech Tokyo Input Form Guidance ver 1.1 (March 2026), scoped to Tokyo Metropolitan Government forms; for other sites we say only "inconsistent with this guidance". nanori does not attempt alternate entry paths; where a page documents one, it is reported as documented but untested. Nothing was submitted.</footer>
</main>
<script>
(function(){var b=document.getElementById("copy-brief"),t=document.getElementById("brief-text");if(!b||!t)return;
b.addEventListener("click",function(){var done=function(){b.textContent="Copied";b.classList.add("done");setTimeout(function(){b.textContent="Copy repair brief";b.classList.remove("done")},2000)};
var fail=function(){t.closest("details").open=true;t.focus();t.select();b.textContent="Select and copy the text below"};
if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t.value).then(done,fail)}else{fail()}})})();
</script>
</body></html>`;
}
