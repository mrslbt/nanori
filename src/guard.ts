/**
 * The one place that decides whether a control may be clicked by the agent or the scan.
 * Final actions (submit, send, confirm, pay, register, book) are never clicked. Confirmation-type
 * controls (go to the review screen) may be. Anything else that looks like it could complete a
 * transaction is treated as final. This is a word list plus accessible-name coverage, not a proof:
 * a button labelled "Next" can still submit on some sites, so runs stop for review when unsure.
 */
export interface ControlLabel { text?: string | null; ariaLabel?: string | null; value?: string | null; alt?: string | null; title?: string | null }

const FINAL = /(送信|送る|確定|申し?込|申込|予約する|予約を確定|登録する|登録を完了|完了する|決済|支払|購入|注文|submit|send|confirm booking|complete registration|complete|register|book now|place order|purchase|pay|checkout|finish)/i;
const REVIEW = /(確認画面|入力内容を確認|内容確認|確認する|確認へ|次へ|次に進む|進む|review|preview|next|continue)/i;

export function controlName(c: ControlLabel): string {
  return [c.text, c.ariaLabel, c.value, c.alt, c.title].filter((x): x is string => !!x && x.trim().length > 0).join(" | ").trim();
}

/** True when any visible or accessible name of the control reads like a final action. */
export function isFinalAction(c: ControlLabel): boolean {
  const name = controlName(c);
  if (!name) return true; // an unnamed control (icon only, no label) is never clicked
  // "確認画面へ" and "確認する" are review controls even though they contain 確; "予約を確定" is final.
  if (REVIEW.test(name) && !FINAL.test(name.replace(/確認[^ ]*/g, ""))) return false;
  return FINAL.test(name);
}

/** True when the control reads like "go to the review screen" and not like a final action. */
export function isReviewAdvance(c: ControlLabel): boolean {
  const name = controlName(c);
  return !!name && REVIEW.test(name) && !isFinalAction(c);
}
