// Regenerate src/report/logo.ts from docs/brand/nanori-logo-report.png.
import fs from "node:fs";
const b64 = fs.readFileSync("docs/brand/nanori-logo-report.png").toString("base64");
fs.writeFileSync("src/report/logo.ts", `// Generated from docs/brand/nanori-logo-report.png (280 x 108, shown at 140 x 54 CSS px). Embedded so a report\n// shows its branding when opened by itself, hosted on Pages, or served from runs/ alone. Regenerate with scripts/embed-logo.mjs.\nexport const LOGO_DATA_URI = "data:image/png;base64,${b64}";\nexport const LOGO_WIDTH = 140;\nexport const LOGO_HEIGHT = 54;\n`);
console.log("src/report/logo.ts regenerated");
