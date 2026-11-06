import { describe, it, expect } from "vitest";
import { verdict, tally } from "../src/verdict.js";
import type { RunResult, Identity } from "../src/types.js";
const id = (i: string): Identity => ({ id: i, tests: "", fullName: i, familyName: null, givenName: null, kanaFamily: null, kanaGiven: null, kanaFull: "", email: "", phone: "", postal: "", address: "", guidance: "" });
const run = (i: string, outcome: RunResult["outcome"]): RunResult => ({ identity: id(i), outcome, stopReason: "", steps: [], startedAt: "", endedAt: "", model: "" });

describe("verdict never overstates", () => {
  it("does not say all reached when a case is not determined", () => {
    const v = verdict({ baseline: run("b", "reached_checkpoint"), cases: [run("a", "not_determined")] });
    expect(v).not.toMatch(/All .* reached/);
    expect(v).toContain("not determined");
  });
  it("says all reached only when every case is verified reached", () => {
    const v = verdict({ baseline: run("b", "reached_checkpoint"), cases: [run("a", "reached_checkpoint"), run("c", "reached_checkpoint")] });
    expect(v).toMatch(/All 2 tested names reached/);
  });
  it("mixes counts explicitly", () => {
    const v = verdict({ baseline: run("b", "reached_checkpoint"), cases: [run("a", "reached_checkpoint"), run("c", "stopped_before_checkpoint"), run("d", "not_determined")] });
    expect(v).toContain("1 of 3 tested names could not reach");
    expect(v).toContain("1 run was not determined");
    expect(v).toContain("1 reached it");
  });
  it("is inconclusive when the baseline did not reach", () => {
    expect(verdict({ baseline: run("b", "not_determined"), cases: [run("a", "reached_checkpoint")] })).toContain("inconclusive");
  });
  it("tally counts every outcome", () => {
    expect(tally([run("a", "reached_checkpoint"), run("b", "not_determined")])).toEqual({ total: 2, reached: 1, workaround: 0, stopped: 0, undetermined: 1 });
  });
});
