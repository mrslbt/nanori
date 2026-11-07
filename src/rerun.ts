import type { RunBundle } from "./types.js";
import type { RunOptions } from "./run.js";

/** The options a rerun passes to runAll, built from the saved run. Pure, so provenance can be tested without a browser or a model call. */
export function rerunOptions(prev: RunBundle, o: { target: string; before?: string; headless?: boolean }, runId: string): RunOptions {
  return {
    url: o.target,
    goal: prev.goal,
    cases: prev.cases.map((c) => c.identity.id),
    headless: o.headless,
    target: "local_reproduction",
    repairState: "after",
    comparedTo: o.before ?? prev.id,
    runId,
    // A simulation stays a simulation when it is rerun; a reproduction never becomes one.
    simulation: prev.simulation,
  };
}
