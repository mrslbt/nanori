import type { FieldObservation } from "../types.js";

/**
 * Pure checks. Input: what the page did with one field. Output: measured facts.
 * No model calls, no interpretation of intent. Interpretation lives in diagnosis.
 */
export interface CheckResult {
  kind:
    | "rejected"
    | "truncated"
    | "altered"
    | "accepted";
  detail: string;
}

export function checkField(o: FieldObservation): CheckResult {
  const rejected = o.ariaInvalid || o.validationMessage.trim().length > 0 || o.visibleErrors.length > 0;
  if (rejected) {
    const msg = o.validationMessage || o.visibleErrors.join(" / ");
    return { kind: "rejected", detail: msg };
  }
  if (o.retained !== o.requested) {
    if (o.requested.startsWith(o.retained) && o.retained.length < o.requested.length) {
      return {
        kind: "truncated",
        detail: `requested ${o.requested.length} chars, field kept ${o.retained.length}` + (o.maxlength ? ` (maxlength=${o.maxlength})` : ""),
      };
    }
    return { kind: "altered", detail: `field now holds "${o.retained}"` };
  }
  return { kind: "accepted", detail: "" };
}

/** True when the field's own pattern attribute rejects the string (client-side rule visible in source). */
export function patternRejects(pattern: string | null, value: string): boolean | null {
  if (!pattern) return null;
  try {
    return !new RegExp(`^(?:${pattern})$`, "u").test(value);
  } catch {
    return null;
  }
}

/** Which property of the string a katakana-only rule trips on. Used only to phrase the cause. */
export function describeStringShape(s: string): string[] {
  const shapes: string[] = [];
  if (/\s/.test(s)) shapes.push("contains a space");
  if (/-/.test(s)) shapes.push("contains a hyphen");
  if (/[A-Za-z]/.test(s)) shapes.push("contains Latin letters");
  if (/[À-ɏḀ-ỿ]/.test(s)) shapes.push("contains letters with diacritics");
  if (/[ァ-ヶー]/.test(s)) shapes.push("contains katakana");
  if (/[一-龯]/.test(s)) shapes.push("contains kanji");
  if (/[０-９]/.test(s)) shapes.push("contains full-width digits");
  shapes.push(`${[...s].length} characters`);
  return shapes;
}
