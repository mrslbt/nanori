// Recompute checkpoint verification for saved runs from the page model stored on each final step, using the current
// src/checkpoint.ts logic. Prints any outcome that would change. Never rewrites report.json; writes report.reverified.json.
import fs from "node:fs"; import path from "node:path";
import { recogniseCheckpoint, checkNamePreserved, norm } from "../dist/checkpoint.js";
import { toHiragana } from "../dist/kana.js";
for (const dir of process.argv.slice(2)) {
  const b = JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8"));
  const out = [];
  for (const r of [b.baseline, ...b.cases]) {
    const last = r.steps[r.steps.length - 1];
    if (!last?.checkpointModel) { out.push({ case: r.identity.id, saved: r.outcome, recomputed: "n/a (no model saved)", changed: false }); continue; }
    const id = r.identity;
    const nameValues = new Set([id.fullName, id.familyName, id.givenName, id.kanaFull, id.kanaFamily, id.kanaGiven, toHiragana(id.kanaFull), id.kanaFamily && toHiragana(id.kanaFamily), id.kanaGiven && toHiragana(id.kanaGiven)].filter(Boolean).map(norm));
    const latest = new Map();
    for (const o of r.steps.flatMap((s) => s.observations)) if (o.requested && !o.diagnostic) latest.set(o.name ?? o.id ?? o.ref, o);
    const typed = [...latest.values()].filter((o) => nameValues.has(norm(o.requested)));
    const model = { ...last.checkpointModel, bodyText: "" };
    let recomputed;
    if (recogniseCheckpoint(model) !== "recognised") recomputed = "not_determined";
    else if (!typed.length) recomputed = "not_determined";
    else recomputed = typed.every((o) => checkNamePreserved(model, o.requested, undefined, typed.filter((x) => x !== o).map((x) => x.requested)).status === "exact") ? "reached_checkpoint" : "not_determined";
    const saved = r.outcome === "stopped_before_checkpoint" ? r.outcome : r.outcome; // rejections are not checkpoint claims
    const applies = r.outcome !== "stopped_before_checkpoint";
    out.push({ case: r.identity.id, saved: r.outcome, recomputed: applies ? recomputed : "n/a (stopped before checkpoint)", changed: applies && recomputed !== r.outcome, rows: last.checkpointModel.rows.filter((x) => /(名前|氏名|ふりがな|フリガナ)/.test(x.label)) });
  }
  fs.writeFileSync(path.join(dir, "report.reverified.json"), JSON.stringify({ reverifiedAt: new Date().toISOString(), logic: "src/checkpoint.ts at HEAD", results: out }, null, 2));
  console.log(`== ${dir}`); for (const o of out) console.log(`  ${o.case.padEnd(18)} saved=${o.saved.padEnd(26)} recomputed=${o.recomputed.padEnd(26)} ${o.changed ? "CHANGED" : "same"}`);
}
