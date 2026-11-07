import type { RunBundle, RunResult, Outcome } from "./types.js";

export interface Tally { total: number; reached: number; changed: number; workaround: number; stopped: number; undetermined: number }

export function tally(cases: RunResult[]): Tally {
  const t: Tally = { total: cases.length, reached: 0, changed: 0, workaround: 0, stopped: 0, undetermined: 0 };
  for (const c of cases) {
    if (c.outcome === "reached_checkpoint") t.reached++;
    else if (c.outcome === "reached_name_changed") t.changed++;
    else if (c.outcome === "reached_with_workaround") t.workaround++;
    else if (c.outcome === "stopped_before_checkpoint") t.stopped++;
    else t.undetermined++;
  }
  return t;
}

/** Headline + supporting line. Never claims "all reached" unless every case was verified reached. */
export function headline(b: Pick<RunBundle, "baseline" | "cases">): { head: string; support: string } {
  const t = tally(b.cases);
  if (b.baseline.outcome !== "reached_checkpoint") return { head: "Comparison inconclusive.", support: `The kanji-name baseline did not reach the confirmation screen (${describe(b.baseline.outcome)}).` };
  if (t.total === 0) return { head: "No name cases were run.", support: "" };
  const stoppedCases = b.cases.filter((c) => c.outcome === "stopped_before_checkpoint");
  const names = stoppedCases.map((c) => (c.identity as any).label ?? c.identity.tests);
  if (t.reached === t.total) return { head: "All tested name formats reached confirmation.", support: `Kanji-name baseline + ${t.total} other ${t.total === 1 ? "case" : "cases"} reached the confirmation screen.` };
  if (t.stopped === 1 && t.changed === 0 && t.undetermined === 0 && t.workaround === 0) return { head: `One test was rejected: ${names[0]}.`, support: `Kanji-name baseline + ${t.reached} other ${t.reached === 1 ? "case" : "cases"} reached confirmation; this one did not.` };
  const changedCases = b.cases.filter((c) => c.outcome === "reached_name_changed").map((c) => (c.identity as any).label ?? c.identity.tests);
  if (t.changed === 1 && t.stopped === 0 && t.undetermined === 0 && t.workaround === 0) return { head: `One name was shown changed on the confirmation screen: ${changedCases[0]}.`, support: `${t.reached ? `Kanji-name baseline + ${t.reached} other ${t.reached === 1 ? "case" : "cases"}` : "The kanji-name baseline"} reached confirmation with the name shown exactly; this one reached it with the name displayed differently.` };
  return { head: verdict(b), support: "" };
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
  if (t.changed) parts.push(`${t.changed} reached it with the name shown changed`);
  if (t.undetermined) parts.push(`${t.undetermined} ${t.undetermined === 1 ? "run was" : "runs were"} not determined`);
  if (t.workaround) parts.push(`${t.workaround} reached it only with a workaround`);
  if (t.reached) parts.push(`${t.reached} reached it`);
  return parts.join("; ") + ". The Japanese baseline reached it.";
}

export function describe(o: Outcome): string {
  return { reached_checkpoint: "reached the review screen", reached_name_changed: "reached the review screen, name shown changed", reached_with_workaround: "reached with a workaround", stopped_before_checkpoint: "stopped before the review screen", not_determined: "not determined" }[o];
}
