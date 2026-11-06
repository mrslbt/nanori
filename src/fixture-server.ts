import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", process.env.NANORI_FIXTURE_DIR ?? "fixtures/clinic");
const port = Number(process.env.NANORI_FIXTURE_PORT ?? 4310);
const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };

export function startFixtureServer(dir = root, p = port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    let file = path.join(dir, url.pathname === "/" ? "index.html" : url.pathname);
    if (!file.startsWith(dir) || !fs.existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  server.listen(p);
  return { server, url: `http://localhost:${p}/` };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { url } = startFixtureServer();
  console.log(`fixture form at ${url}  (dir: ${root})`);
}
