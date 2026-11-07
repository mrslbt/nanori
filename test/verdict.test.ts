import { describe, it, expect } from "vitest";
import { verdict, tally, headline } from "../src/verdict.js";
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
    expect(tally([run("a", "reached_checkpoint"), run("b", "not_determined")])).toEqual({ total: 2, reached: 1, changed: 0, workaround: 0, stopped: 0, undetermined: 1 });
  });
  it("a baseline whose name was shown changed is inconclusive and is not described as having failed to reach", () => {
    const b = { baseline: run("b", "reached_name_changed"), cases: [run("a", "reached_checkpoint")] };
    expect(headline(b).head).toContain("inconclusive");
    expect(headline(b).support).toContain("reached the confirmation screen, but its name was displayed differently");
    expect(verdict(b)).not.toContain("did not reach");
  });
  it("a name shown changed on the review screen is its own headline, never counted as reached", () => {
    const b = { baseline: run("b", "reached_checkpoint"), cases: [run("a", "reached_checkpoint"), run("c", "reached_name_changed")] };
    expect(tally(b.cases)).toEqual({ total: 2, reached: 1, changed: 1, workaround: 0, stopped: 0, undetermined: 0 });
    expect(verdict(b)).not.toMatch(/All .* reached/);
    expect(verdict(b)).toContain("name shown changed");
    expect(headline(b).head).toContain("shown changed");
  });
});
