import type { Finding } from "./types.js";

/**
 * One finding per thing the person would see. When a family name and a given name were typed into separate fields
 * but the review screen shows them in one row, the diagnosis produces one finding per typed field with the same
 * retained row text. Merge those into one finding for the row: the first one's text is kept, the entered values are
 * joined, and the field names the row. Pure, so saved runs can be merged at render time.
 */
export function mergeFindings(findings: Finding[]): Finding[] {
  const out: Finding[] = [];
  for (const f of findings) {
    const row = /review row/i.test(f.field);
    const twin = row ? out.find((o) => o.identity === f.identity && o.stepIndex === f.stepIndex && o.kind === f.kind && o.retained === f.retained && o.classification === f.classification && /review row/i.test(o.field)) : undefined;
    if (!twin) { out.push({ ...f }); continue; }
    if (!twin.requested.split(" / ").includes(f.requested)) twin.requested = `${twin.requested} / ${f.requested}`;
    const label = f.field.match(/review row\s*([^)]+)/i)?.[1]?.trim();
    if (label) twin.field = `${label} (review row)`;
  }
  return out;
}
