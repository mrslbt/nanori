import type { RunBundle, RunResult, Outcome } from "./types.js";

export interface Tally { total: number; reached: number; workaround: number; stopped: number; undetermined: number }

export function tally(cases: RunResult[]): Tally {
  const t: Tally = { total: cases.length, reached: 0, workaround: 0, stopped: 0, undetermined: 0 };
  for (const c of cases) {
    if (c.outcome === "reached_checkpoint") t.reached++;
    else if (c.outcome === "reached_with_workaround") t.workaround++;
    else if (c.outcome === "stopped_before_checkpoint") t.stopped++;
    else t.undetermined++;
  }
  return t;
}

/** One honest sentence. Never claims "all reached" unless every case was verified reached. */
export function verdict(b: Pick<RunBundle, "baseline" | "cases">): string {
  const t = tally(b.cases);
  const noun = (n: number) => (n === 1 ? "name" : "names");
  if (b.baseline.outcome !== "reached_checkpoint") {
    return `The baseline (Japanese name) did not reach the review screen (${describe(b.baseline.outcome)}), so the name comparison is inconclusive.`;
  }
  if (t.total === 0) return "No name cases were run.";
  if (t.reached === t.total) return `All ${t.total} tested ${noun(t.total)} reached the review screen, as the baseline did.`;
  const parts: string[] = [];
  if (t.stopped) parts.push(`${t.stopped} of ${t.total} tested ${noun(t.total)} could not reach the review screen`);
  if (t.undetermined) parts.push(`${t.undetermined} ${t.undetermined === 1 ? "run was" : "runs were"} not determined`);
  if (t.workaround) parts.push(`${t.workaround} reached it only with a workaround`);
  if (t.reached) parts.push(`${t.reached} reached it`);
  return parts.join("; ") + ". The Japanese baseline reached it.";
}

export function describe(o: Outcome): string {
  return { reached_checkpoint: "reached the review screen", reached_with_workaround: "reached with a workaround", stopped_before_checkpoint: "stopped before the review screen", not_determined: "not determined" }[o];
}
