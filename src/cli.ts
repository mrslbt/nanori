#!/usr/bin/env node
import { Command } from "commander";
import { loadEnv } from "./env.js";
loadEnv();
import fs from "node:fs";
import path from "node:path";
import { runAll } from "./run.js";
import { battery } from "./battery.js";
import { scan } from "./scan.js";
import { preflight, exitOnSetupError, SetupError } from "./preflight.js";
import { rerunOptions } from "./rerun.js";

const program = new Command();
program.name("nanoru").description("Test a Japanese web form with name-format test cases that conventional test data can miss.").version("0.1.0");

program.command("run")
  .argument("<url>", "form URL")
  .argument("<goal>", "what counts as done, e.g. \"reach the reservation review screen\"")
  .option("-c, --cases <ids>", "comma-separated case ids (default: all)", (v) => v.split(","))
  .option("--headless", "run without a visible browser", false)
  .option("--max-steps <n>", "agent step budget per case", (v) => Number(v), 40)
  .option("--local", "mark this run as a local reproduction", false)
  .option("--repaired", "with --local: this copy has the repair applied (otherwise it is the before state)", false)
  .option("--before <runId>", "with --repaired: the saved run to show as 'before' in the repair table")
  .option("--run-id <id>", "fixed run id (default: timestamp)")
  .option("--simulation <text>", "with --local: this copy is a simulation built from published rules, not an observed site; the text is printed on the report")
  .action(async (url, goal, o) => {
    await preflight({ url, needsKey: true }).catch(exitOnSetupError);
    const { dir } = await runAll({ url, goal, cases: o.cases, headless: o.headless, maxSteps: o.maxSteps, target: o.local ? "local_reproduction" : "public", repairState: o.local ? (o.repaired ? "after" : "before") : undefined, comparedTo: o.repaired ? o.before : undefined, runId: o.runId, simulation: o.simulation }).catch(exitOnSetupError);
    console.log(`\nopen ${path.join(dir, "report.html")}`);
  });

program.command("rerun")
  .argument("<runId>", "a previous run id under ./runs")
  .requiredOption("--target <url>", "where to rerun (usually the local reproduction). Explicit on purpose: never silently compare two sites.")
  .option("--before <runId>", "the run to show as 'before' (default: the run being rerun; use the local before-repair run for a same-reproduction pair)")
  .option("--headless", "run without a visible browser", false)
  .action(async (runId, o) => {
    const file = path.join("runs", runId, "report.json");
    if (!fs.existsSync(file)) exitOnSetupError(new SetupError(`No saved run at ${file}. Run ids are the folder names under runs/.`));
    await preflight({ url: o.target, needsKey: true }).catch(exitOnSetupError);
    const prev = JSON.parse(fs.readFileSync(file, "utf8"));
    const { dir } = await runAll(rerunOptions(prev, o, `${runId}-rerun-${Date.now().toString(36)}`)).catch(exitOnSetupError);
    console.log(`\nBefore: runs/${o.before ?? runId}/report.html\nAfter:  ${path.join(dir, "report.html")}`);
  });

program.command("scan")
  .argument("<file>", "text file with one form URL per line")
  .option("-c, --cases <ids>", "comma-separated case ids (default: all)", (v) => v.split(","))
  .option("--headless", "run without a visible browser", false)
  .option("--out <dir>", "output directory", `runs/scan-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`)
  .description("probe the name fields of many forms, no model in the loop, nothing submitted")
  .action(async (file, o) => {
    await preflight({ needsKey: false }).catch(exitOnSetupError);
    if (!fs.existsSync(file)) exitOnSetupError(new SetupError(`No such file: ${file}`));
    const urls = fs.readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    await scan(urls, { outDir: o.out, cases: o.cases, headless: o.headless });
    console.log(`\nopen ${path.join(o.out, "scan.html")}`);
  });

program.command("cases").description("list the name-format test cases").action(() => {
  for (const b of battery) console.log(`${b.id.padEnd(18)} ${b.fullName.padEnd(30)} ${b.tests}`);
});

program.parseAsync();
