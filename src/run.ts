import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import type { Identity, RunBundle, RunResult } from "./types.js";
import { baseline, battery } from "./battery.js";
import { runLoop } from "./agent/loop.js";
import { diagnose } from "./diagnose.js";
import { renderHtml } from "./report/html.js";

export interface RunOptions {
  url: string;
  goal: string;
  cases?: string[];
  runsDir?: string;
  runId?: string;
  target?: "public" | "local_reproduction";
  repairState?: "before" | "after";
  comparedTo?: string;
  headless?: boolean;
  maxSteps?: number;
  log?: (s: string) => void;
}

export async function runAll(opts: RunOptions): Promise<{ bundle: RunBundle; dir: string }> {
  const log = opts.log ?? console.log;
  const runsDir = opts.runsDir ?? path.resolve("runs");
  const id = opts.runId ?? new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.join(runsDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const selected: Identity[] = opts.cases?.length ? battery.filter((b) => opts.cases!.includes(b.id)) : battery;

  const browser = await chromium.launch({ channel: "chrome", headless: opts.headless ?? false });
  const one = async (identity: Identity): Promise<RunResult> => {
    log(`\n▶ ${identity.id}: ${identity.fullName}`);
    const context = await browser.newContext({ locale: "ja-JP" });
    try {
      return await runLoop(context, { url: opts.url, goal: opts.goal, identity, outDir: path.join(dir, identity.id), maxSteps: opts.maxSteps, log });
    } finally {
      await context.close();
    }
  };

  const baselineRun = await one(baseline);
  log(`  → ${baselineRun.outcome} (${baselineRun.stopReason})`);
  const cases: RunResult[] = [];
  for (const identity of selected) {
    const r = await one(identity);
    log(`  → ${r.outcome} (${r.stopReason})`);
    cases.push(r);
  }
  await browser.close();

  log(`\nDiagnosing with ${process.env.NANORI_DIAG_MODEL ?? "claude-opus-5-5"}...`);
  const findings = await diagnose(baselineRun, cases, opts.url, opts.goal);
  const bundle: RunBundle = {
    id, url: opts.url, goal: opts.goal, createdAt: new Date().toISOString(), target: opts.target ?? "public",
    repairState: opts.repairState, comparedTo: opts.comparedTo,
    baseline: baselineRun, cases, findings,
    summary: `${cases.filter((c) => c.outcome === "stopped_before_checkpoint").length} of ${cases.length} name cases stopped before the checkpoint; baseline ${baselineRun.outcome}.`,
  };
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(bundle, null, 2));
  fs.writeFileSync(path.join(dir, "report.html"), renderHtml(bundle, dir));
  log(`\nReport: ${path.join(dir, "report.html")}`);
  return { bundle, dir };
}
