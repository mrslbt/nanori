// Re-render report.html from a saved report.json after a renderer change. Never touches run data.
import fs from "node:fs"; import path from "node:path";
import { renderHtml } from "../dist/report/html.js";
for (const dir of process.argv.slice(2)) { const b = JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8")); fs.writeFileSync(path.join(dir, "report.html"), renderHtml(b)); console.log("rendered", dir); }
