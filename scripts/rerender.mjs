// Re-render report.html from a saved report.json after a renderer change. Never touches run data.
import fs from "node:fs"; import path from "node:path";
import { renderHtml } from "../dist/report/html.js";
const args = process.argv.slice(2); const bi = args.indexOf("--before"); const beforeDir = bi >= 0 ? args.splice(bi, 2)[1] : null;
for (const dir of args) {
  const b = JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8"));
  if (beforeDir) { const p = JSON.parse(fs.readFileSync(path.join(beforeDir, "report.json"), "utf8")); b.before = { id: p.id, target: p.target, outcomes: Object.fromEntries([p.baseline, ...p.cases].map((r) => [r.identity.id, r.outcome])) }; b.comparedTo = p.id; }
  // Corrected export: evidence references resolve to the post-action screenshot when one exists. The original report.json is preserved.
  const corrected = structuredClone(b);
  for (const f of corrected.findings) { const r = [corrected.baseline, ...corrected.cases].find((c) => c.identity.id === f.identity); const st = r?.steps.find((s) => s.index === f.stepIndex); if (st?.screenshotAfter) { f.screenshotOriginal = f.screenshot; f.screenshot = st.screenshotAfter; } }
  corrected.exportNote = "report.corrected.json: evidence references point at post-action screenshots; original capture history is in report.json. Rendered " + new Date().toISOString();
  fs.writeFileSync(path.join(dir, "report.corrected.json"), JSON.stringify(corrected, null, 2));
  fs.writeFileSync(path.join(dir, "report.html"), renderHtml(corrected));
  console.log("rendered", dir);
}
