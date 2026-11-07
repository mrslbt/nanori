import { describe, it, expect } from "vitest";
import { rerunOptions } from "../src/rerun.js";
import type { RunBundle } from "../src/types.js";

const prev = (extra: Partial<RunBundle>): RunBundle => ({ id: "card-local-before", url: "http://localhost:4314/", goal: "reach the confirmation screen", createdAt: "", target: "local_reproduction", repairState: "before", baseline: {} as any, cases: [{ identity: { id: "long-name-spaces" } } as any], findings: [], ...extra });

describe("rerunOptions", () => {
  it("carries the simulation disclosure through a rerun", () => {
    const o = rerunOptions(prev({ simulation: "Local finance simulation. Not a test of PayPay or a bank." }), { target: "http://localhost:4315/" }, "x");
    expect(o.simulation).toContain("Not a test of PayPay");
    expect(o.cases).toEqual(["long-name-spaces"]);
    expect(o.comparedTo).toBe("card-local-before");
    expect(o.repairState).toBe("after");
  });
  it("a reproduction does not become a simulation, and --before is honoured", () => {
    const o = rerunOptions(prev({}), { target: "http://localhost:4313/", before: "yotsuya-local-before" }, "x");
    expect(o.simulation).toBeUndefined();
    expect(o.comparedTo).toBe("yotsuya-local-before");
  });
});
