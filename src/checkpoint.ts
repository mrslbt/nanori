/**
 * Checkpoint verification, split in two and kept pure so it can be tested without a browser:
 *   1. Is this a review screen at all?  (checkpoint recognition)
 *   2. Is each typed name value shown exactly in its labelled review row?  (name preservation)
 * The browser side only extracts a PageModel. If either check cannot be established, the result is "unknown", never "verified".
 */
export interface ReviewRow { label: string; value: string }
export interface PageModel {
  urlChanged: boolean;
  /** Are the original name inputs still present (same name/id)? */
  nameInputsPresent: boolean;
  headings: string[];
  bodyText: string;
  rows: ReviewRow[];
  /** Short visible texts that read like a review instruction ("please check your entries"), collected from content elements. */
  cues?: string[];
}
export interface CheckpointContract {
  /** Heading or title text that identifies the review screen. */
  heading: RegExp;
  /** Labels of review rows that hold name values. */
  nameRowLabel: RegExp;
  /** A review instruction in a content element, for screens whose heading does not announce the review. */
  cue: RegExp;
  /** Labels of rows that hold a reading (kana), as opposed to the name itself. */
  kanaRowLabel: RegExp;
}
/** Default contract for Japanese forms: a review heading and a name row. Site adapters can narrow it. */
export const defaultContract: CheckpointContract = {
  heading: /(入力内容の確認|入力内容をご確認|確認画面|ご確認ください|内容確認|確認)/,
  nameRowLabel: /(お名前|氏名|名前|姓名|フリガナ|ふりがな|カナ|かな|セイ|メイ|name|kana|furigana)/i,
  cue: /((入力|登録|申込|申し込み)?内容を?ご?確認|確認の上|ご確認ください|確認してください|よろしければ|please (review|check|confirm)|review your)/i,
  kanaRowLabel: /(フリガナ|ふりがな|カナ|かな|セイ|メイ|kana|furigana|reading)/i,
};
export const isKanaValue = (v: string) => /^[ァ-ヶぁ-ん゛゜ー\s\u3000]+$/.test(v);

export const norm = (t: string) => t.normalize("NFC").replace(/[\s　]+/g, " ").trim();

export type Recognition = "recognised" | "not_recognised";
export function recogniseCheckpoint(m: PageModel, c: CheckpointContract = defaultContract): Recognition {
  if (m.nameInputsPresent) return "not_recognised";
  const headingOk = m.headings.some((h) => c.heading.test(h));
  if (headingOk) return "recognised";
  // Some review screens announce themselves only in a paragraph ("please check your entries, then press send"),
  // not a heading. Then an explicit review instruction in a content element is required, together with the
  // structure: the page changed, the name inputs are gone, and a labelled name row shows a value. A changed URL
  // with a read-only name summary alone (a shipping-method step, say) is not a review screen.
  const cueOk = (m.cues ?? []).some((t) => c.cue.test(t));
  const nameRowShown = m.rows.some((r) => c.nameRowLabel.test(r.label) && norm(r.value).length > 0);
  return cueOk && m.urlChanged && nameRowShown ? "recognised" : "not_recognised";
}

export type Preservation = { status: "exact" | "differs" | "unknown"; shown: string | null; note: string };
/**
 * Compare one typed name value with the labelled review rows. Exact means the row equals the typed value
 * (after NFC and whitespace normalisation). The only other accepted form is an explicit field mapping:
 * when the value was typed into one of several name fields (e.g. family and given typed separately),
 * a row that equals those typed values joined, in either order, with nothing added or missing, is exact.
 * An unordered subset, an extra word, a changed order of a single value, or a missing part is "differs".
 */
export function checkNamePreserved(m: PageModel, typed: string, c: CheckpointContract = defaultContract, siblings: string[] = []): Preservation {
  const rows = m.rows.filter((r) => c.nameRowLabel.test(r.label));
  if (!rows.length) return { status: "unknown", shown: null, note: "no labelled name row found on this screen" };
  const want = norm(typed);
  // A reading belongs in a kana row, a name in a name row. "Differs" is only claimed against a row of the right kind;
  // if no such row exists, the value is unverified, not changed.
  const kana = isKanaValue(want);
  const sameKind = rows.filter((r) => (c.kanaRowLabel.test(r.label) === kana));
  const joined = new Set<string>();
  for (const sib of siblings.map(norm).filter((x) => x && x !== want)) { joined.add(`${want} ${sib}`); joined.add(`${sib} ${want}`); joined.add(`${want}${sib}`); joined.add(`${sib}${want}`); }
  for (const r of rows) {
    const got = norm(r.value);
    if (got === want) return { status: "exact", shown: r.value, note: "" };
    if (joined.has(got)) return { status: "exact", shown: r.value, note: "row equals this value joined with a separately typed name field" };
  }
  if (!sameKind.length) return { status: "unknown", shown: null, note: `no ${kana ? "reading" : "name"} row found on this screen; only ${rows.map((r) => `"${r.label}"`).join(", ")}` };
  const closest = sameKind.find((r) => norm(r.value).includes(want) || want.includes(norm(r.value))) ?? sameKind[0];
  return { status: "differs", shown: closest.value, note: `review row "${closest.label}" shows "${closest.value}"` };
}
