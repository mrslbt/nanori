#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { runAll } from "./run.js";
import { battery } from "./battery.js";

const program = new Command();
program.name("nanori").description("Test a Japanese web form with the names of real residents, not just Japanese test data.").version("0.1.0");

program.command("run")
  .argument("<url>", "form URL")
  .argument("<goal>", "what counts as done, e.g. \"reach the reservation review screen\"")
  .option("-c, --cases <ids>", "comma-separated case ids (default: all)", (v) => v.split(","))
  .option("--headless", "run without a visible browser", false)
  .option("--max-steps <n>", "agent step budget per case", (v) => Number(v), 25)
  .option("--local", "mark this run as a local reproduction (repair verification)", false)
  .option("--run-id <id>", "fixed run id (default: timestamp)")
  .action(async (url, goal, o) => {
    const { dir } = await runAll({ url, goal, cases: o.cases, headless: o.headless, maxSteps: o.maxSteps, target: o.local ? "local_reproduction" : "public", runId: o.runId });
    console.log(`\nopen ${path.join(dir, "report.html")}`);
  });

program.command("rerun")
  .argument("<runId>", "a previous run id under ./runs")
  .requiredOption("--target <url>", "where to rerun (usually the local reproduction). Explicit on purpose: never silently compare two sites.")
  .option("--headless", "run without a visible browser", false)
  .action(async (runId, o) => {
    const prev = JSON.parse(fs.readFileSync(path.join("runs", runId, "report.json"), "utf8"));
    const cases = prev.cases.map((c: any) => c.identity.id);
    const { dir } = await runAll({ url: o.target, goal: prev.goal, cases, headless: o.headless, target: "local_reproduction", runId: `${runId}-rerun-${Date.now().toString(36)}` });
    console.log(`\nBefore: runs/${runId}/report.html\nAfter:  ${path.join(dir, "report.html")}`);
  });

program.command("cases").description("list the name-format test cases").action(() => {
  for (const b of battery) console.log(`${b.id.padEnd(18)} ${b.fullName.padEnd(30)} ${b.tests}`);
});

program.parseAsync();
