import fs from "node:fs";
import path from "node:path";

/** Load ./.env (or the one next to the package) into process.env without overriding existing values. */
export function loadEnv(): void {
  for (const p of [path.resolve(".env"), path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", ".env")]) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return;
  }
}
