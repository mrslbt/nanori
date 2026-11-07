import { describe, it, expect } from "vitest";
import { renderHtml } from "../src/report/html.js";
import type { RunBundle, RunResult, Identity, Outcome } from "../src/types.js";

const id = (i: string): Identity => ({ id: i, tests: "", label: i, fullName: i, familyName: null, givenName: null, kanaFamily: null, kanaGiven: null, kanaFull: "", email: "", phone: "", postal: "", address: "", guidance: "" } as Identity);
const run = (i: string, outcome: Outcome): RunResult => ({ identity: id(i), outcome, stopReason: "", steps: [], startedAt: "", endedAt: "", model: "" });
const bundle = (baseline: Outcome, cases: Outcome[]): RunBundle => ({ id: "t", url: "http://localhost/", goal: "g", createdAt: "2026-11-08T00:00:00.000Z", target: "local_reproduction", repairState: "after", before: { id: "b", target: "local_reproduction", outcomes: {} }, baseline: run("baseline", baseline), cases: cases.map((o, k) => run("c" + k, o)), findings: [] } as RunBundle);

describe("a repaired report with no findings", () => {
  it("claims every case passed only when the baseline and every case reached the checkpoint", () => {
    expect(renderHtml(bundle("reached_checkpoint", ["reached_checkpoint"]))).toContain("Every case reached the confirmation screen");
  });
  for (const o of ["not_determined", "stopped_before_checkpoint", "reached_name_changed"] as Outcome[]) {
    it(`does not claim a pass when a case is ${o}`, () => {
      const html = renderHtml(bundle("reached_checkpoint", [o]));
      expect(html).not.toContain("Every case reached the confirmation screen");
      expect(html).toContain("No diagnosis was produced");
      expect(html).not.toContain("Repair verified");
    });
  }
  it("does not claim a pass when the baseline failed", () => {
    const html = renderHtml(bundle("not_determined", ["reached_checkpoint"]));
    expect(html).not.toContain("Every case reached the confirmation screen");
    expect(html).not.toContain("Repair verified");
  });
  it("does not claim a pass with no cases", () => { expect(renderHtml(bundle("reached_checkpoint", []))).not.toContain("Every case reached"); });
});
