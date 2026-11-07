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
}
export interface CheckpointContract {
  /** Heading or title text that identifies the review screen. */
  heading: RegExp;
  /** Labels of review rows that hold name values. */
  nameRowLabel: RegExp;
}
/** Default contract for Japanese forms: a review heading and a name row. Site adapters can narrow it. */
export const defaultContract: CheckpointContract = {
  heading: /(入力内容の確認|入力内容をご確認|確認画面|ご確認ください|内容確認|確認)/,
  nameRowLabel: /(お名前|氏名|名前|姓名|フリガナ|ふりがな|カナ|かな|セイ|メイ|name|kana|furigana)/i,
};

export const norm = (t: string) => t.normalize("NFC").replace(/[\s　]+/g, " ").trim();

export type Recognition = "recognised" | "not_recognised";
export function recogniseCheckpoint(m: PageModel, c: CheckpointContract = defaultContract): Recognition {
  const headingOk = m.headings.some((h) => c.heading.test(h));
  // A review screen has no editable name inputs and announces itself; a URL change alone proves nothing.
  return headingOk && !m.nameInputsPresent ? "recognised" : "not_recognised";
}

export type Preservation = { status: "exact" | "differs" | "unknown"; shown: string | null; note: string };
/** Compare one typed name value with the labelled review row. Substring matches do not count. */
export function checkNamePreserved(m: PageModel, typed: string, c: CheckpointContract = defaultContract): Preservation {
  const rows = m.rows.filter((r) => c.nameRowLabel.test(r.label));
  if (!rows.length) return { status: "unknown", shown: null, note: "no labelled name row found on this screen" };
  const want = norm(typed);
  for (const r of rows) {
    const got = norm(r.value);
    if (got === want) return { status: "exact", shown: r.value, note: "" };
    // A row may hold family and given name together, or name and reading; accept exact equality of a whitespace-separated part set.
    const parts = got.split(" ");
    const wantParts = want.split(" ");
    if (wantParts.every((p) => parts.includes(p)) && wantParts.length > 0) return { status: "exact", shown: r.value, note: "matched as whole words inside the row" };
  }
  const closest = rows[0];
  return { status: "differs", shown: closest.value, note: `review row "${closest.label}" shows "${closest.value}"` };
}
