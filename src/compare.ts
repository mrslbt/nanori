import type { RunResult } from "./types.js";
import { defaultContract, norm } from "./checkpoint.js";

export type RowSet = Array<{ label: string; value: string }>;
export type RowComparison =
  | { status: "no_rows"; note: string }
  | { status: "coverage_differs"; missing: string[]; extra: string[]; note: string }
  | { status: "values_differ"; diffs: Array<{ label: string; base: string; got: string }>; note: string }
  | { status: "match"; count: number; note: string };

/** The non-name rows of a run's recognised confirmation screen, in order, duplicates kept. Null when the screen was not reached or not recorded. */
export function nonNameRows(r: RunResult): RowSet | null {
  if (r.outcome !== "reached_checkpoint" && r.outcome !== "reached_name_changed") return null;
  const m = r.steps[r.steps.length - 1]?.checkpointModel;
  if (!m) return null;
  return m.rows.filter((row) => !defaultContract.nameRowLabel.test(row.label)).map((row) => ({ label: norm(row.label), value: norm(row.value) }));
}

/**
 * Compare the complete observed non-name row sets of two confirmation screens. Label coverage must be identical
 * (missing or extra rows prevent a match; duplicate labels are compared by position); then every value must be equal.
 * This compares observed review rows only; it says nothing about hidden inputs or the actions taken.
 */
export function compareRows(base: RowSet, got: RowSet): RowComparison {
  if (!base.length) return { status: "no_rows", note: "no comparable non-name rows on the baseline's confirmation screen" };
  const count = (rows: RowSet) => { const c = new Map<string, number>(); for (const r of rows) c.set(r.label, (c.get(r.label) ?? 0) + 1); return c; };
  const cb = count(base), cg = count(got);
  const missing: string[] = [], extra: string[] = [];
  for (const [l, n] of cb) { const g = cg.get(l) ?? 0; if (g < n) missing.push(l); }
  for (const [l, n] of cg) { const b = cb.get(l) ?? 0; if (b < n) extra.push(l); }
  if (missing.length || extra.length) {
    return { status: "coverage_differs", missing, extra, note: `the confirmation screens do not show the same rows (${missing.length ? `missing here: ${missing.join(", ")}` : ""}${missing.length && extra.length ? "; " : ""}${extra.length ? `extra here: ${extra.join(", ")}` : ""}), so identical inputs cannot be established` };
  }
  const seen = new Map<string, number>();
  const diffs: Array<{ label: string; base: string; got: string }> = [];
  for (const b of base) {
    const i = seen.get(b.label) ?? 0; seen.set(b.label, i + 1);
    const g = got.filter((r) => r.label === b.label)[i];
    if (g && g.value !== b.value) diffs.push({ label: b.label, base: b.value, got: g.value });
  }
  if (diffs.length) return { status: "values_differ", diffs, note: diffs.map((d) => `${d.label} was "${d.base || "(empty)"}" in the baseline and "${d.got || "(empty)"}" here`).join("; ") };
  return { status: "match", count: base.length, note: `${base.length} non-name rows matched row for row` };
}
