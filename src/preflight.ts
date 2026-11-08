import { chromium, type Browser } from "playwright";

/** A problem the person can fix; printed as one plain sentence, no stack trace. */
export class SetupError extends Error {}

/** Checks that run before any browser or model call: Node version, API key, and that the target answers. */
export async function preflight(opts: { url?: string; needsKey: boolean }): Promise<void> {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new SetupError(`nanoru needs Node 22.12 or newer; this is Node ${process.versions.node}.`);
  if (opts.needsKey) {
    const key = process.env.ANTHROPIC_API_KEY ?? "";
    if (!key || key === "sk-ant-...") throw new SetupError("No API key. Copy .env.example to .env and put your ANTHROPIC_API_KEY in it (the file is gitignored).");
  }
  if (opts.url) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      const res = await fetch(opts.url, { method: "GET", redirect: "follow", signal: ctl.signal });
      clearTimeout(t);
      if (res.status >= 500) throw new SetupError(`${opts.url} answered with HTTP ${res.status}. Is the form up?`);
    } catch (e) {
      if (e instanceof SetupError) throw e;
      const hint = /localhost|127\.0\.0\.1/.test(opts.url) ? " If this is the bundled fixture, start it first in another terminal: npm run fixture" : "";
      throw new SetupError(`Cannot reach ${opts.url} (${(e as Error).name === "AbortError" ? "timed out after 8 s" : (e as Error).message}).${hint}`);
    }
  }
}

/** Launch Google Chrome through Playwright, turning the install errors into plain instructions. */
export async function launchChrome(headless: boolean): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chrome", headless });
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (/chrome.*not found|Chromium distribution 'chrome'|executable doesn't exist|Failed to launch/i.test(msg)) {
      throw new SetupError("Google Chrome was not found. Install Chrome, or run: npx playwright install chrome");
    }
    throw e;
  }
}

/** Print a SetupError plainly and exit; let anything else through with its stack. */
export function exitOnSetupError(e: unknown): never {
  if (e instanceof SetupError) { console.error(`\n${e.message}\n`); process.exit(2); }
  throw e;
}
