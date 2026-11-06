// Re-render scan.html from an existing scan.json (after a renderer change) without re-probing any site.
import fs from "node:fs"; import path from "node:path";
import { renderScan } from "../dist/scan.js";
const dir = process.argv[2]; const data = JSON.parse(fs.readFileSync(path.join(dir, "scan.json"), "utf8"));
fs.writeFileSync(path.join(dir, "scan.html"), renderScan(data.results)); console.log("rendered", path.join(dir, "scan.html"));
