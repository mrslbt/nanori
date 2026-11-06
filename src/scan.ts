import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import type { ElementInfo, Identity } from "./types.js";
import { baseline, battery } from "./battery.js";
import { snapshotElements, observeField } from "./agent/page.js";
import { checkField } from "./checks/index.js";

/**
 * nanori scan: a name-field probe with no model in the loop.
 * For each URL and each name case: load the page, find the name fields, fill them, trigger validation,
 * try the confirmation button (never a final submit), and record what each field did.
 * It answers "did the name fields reject or cut this input", nothing more.
 */

const NOT_NAME = /(会社|法人|店|学校|商品|件名|団体|組織|部署|company|subject|organization|school|product|title|user ?name|username|login|nickname|ニックネーム|ユーザー)/i;
const KANA = /(フリガナ|ふりがな|カナ|かな|kana|furigana|セイ|メイ|ｾｲ|ﾒｲ)/i;
const NAME = /(氏名|名前|姓|名|name|sei|mei|last|first|family|given|surname)/i;
const FAMILY = /(姓|セイ|ｾｲ|sei|last|family|surname)/i;
const GIVEN = /(名|メイ|ﾒｲ|mei|first|given)/i;
const FULLHINT = /(氏名|お名前|名前|fullname|full_name|your-name|your_name)/i;
const ADVANCE = /(確認|次へ|次に進む|入力内容|confirm|next|続ける|進む)/i;
const FORBIDDEN = /(送信|確定|申し?込|予約する|予約を確定|決済|支払|submit|send|purchase|pay|place order)/i;

type Role = "family" | "given" | "full" | "kana_family" | "kana_given" | "kana_full";

export function classifyField(e: ElementInfo): Role | null {
  if (!["input", "textarea"].includes(e.tag)) return null;
  if (e.type && !["text", null, "search"].includes(e.type)) return null;
  const hay = [e.label, e.name, e.id, e.placeholder].filter(Boolean).join(" ");
  if (!hay || NOT_NAME.test(hay)) return null;
  const kana = KANA.test(hay);
  if (!kana && !NAME.test(hay)) return null;
  const fam = FAMILY.test(hay), giv = GIVEN.test(hay);
  const full = FULLHINT.test(hay) || (fam && giv) || (!fam && !giv);
  if (kana) return full ? "kana_full" : fam ? "kana_family" : "kana_given";
  return full ? "full" : fam ? "family" : "given";
}

function valueFor(id: Identity, role: Role): string {
  switch (role) {
    case "family": return id.familyName ?? id.fullName;
    case "given": return id.givenName ?? "";
    case "full": return id.fullName;
    case "kana_family": return id.kanaFamily ?? id.kanaFull;
    case "kana_given": return id.kanaGiven ?? "";
    case "kana_full": return id.kanaFull;
  }
}

export interface ProbeField { ref: string; role: Role; label: string | null; requested: string; afterBlur: string; afterAdvance: string | null; error: string; retained: string; maxlength: number | null; pattern: string | null }
export interface ProbeResult { url: string; identity: string; status: "probed" | "no_name_fields" | "blocked" | "error"; note: string; fields: ProbeField[]; advanced: boolean; worst: "accepted" | "rejected" | "truncated" | "altered" | "unknown" }

async function probeOne(page: Page, url: string, id: Identity): Promise<ProbeResult> {
  const base: ProbeResult = { url, identity: id.id, status: "probed", note: "", fields: [], advanced: false, worst: "unknown" };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(800);
    const elements = await snapshotElements(page);
    const named = elements.map((e) => ({ e, role: classifyField(e) })).filter((x): x is { e: ElementInfo; role: Role } => !!x.role);
    if (!named.length) return { ...base, status: "no_name_fields", note: "no name fields detected on first page" };
    if (elements.some((e) => /recaptcha|captcha/i.test(`${e.id} ${e.name} ${e.text}`))) base.note = "captcha present; blur-level only";

    for (const { e, role } of named) {
      const v = valueFor(id, role);
      if (!v) continue;
      const loc = page.locator(`[data-nanori-ref="${e.ref}"]`);
      try { await loc.fill(v, { timeout: 3000 }); await loc.dispatchEvent("blur").catch(() => {}); } catch (err: any) { base.fields.push({ ref: e.ref, role, label: e.label, requested: v, afterBlur: "fill failed", afterAdvance: null, error: String(err?.message ?? err).slice(0, 120), retained: "", maxlength: e.maxlength, pattern: e.pattern }); continue; }
      await page.waitForTimeout(150);
      const o = await observeField(page, e.ref, v);
      const c = checkField(o);
      base.fields.push({ ref: e.ref, role, label: e.label, requested: v, afterBlur: c.kind, afterAdvance: null, error: c.detail, retained: o.retained, maxlength: o.maxlength, pattern: o.pattern });
    }
    // Try to advance to a confirmation screen. Never a final submit.
    const btn = elements.find((e) => (e.tag === "button" || e.type === "submit" || e.tag === "a") && e.text && ADVANCE.test(e.text) && !FORBIDDEN.test(e.text));
    if (btn) {
      const beforeUrl = page.url();
      await page.locator(`[data-nanori-ref="${btn.ref}"]`).click({ timeout: 5000 }).catch(() => {});
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForTimeout(800);
      const stillThere = await page.locator(`[data-nanori-ref="${named[0].e.ref}"]`).count();
      base.advanced = page.url() !== beforeUrl || stillThere === 0;
      if (!base.advanced) {
        for (const f of base.fields) {
          if (f.afterBlur === "fill failed") continue;
          const o = await observeField(page, f.ref, f.requested);
          const c = checkField(o);
          f.afterAdvance = c.kind; if (c.kind !== "accepted") { f.error = c.detail || f.error; f.retained = o.retained; }
        }
      }
    } else {
      base.note += (base.note ? "; " : "") + "no confirmation button found; blur-level only";
    }
    const kinds = base.fields.flatMap((f) => [f.afterBlur, f.afterAdvance].filter(Boolean) as string[]);
    base.worst = kinds.includes("rejected") || kinds.includes("required_empty") ? "rejected" : kinds.includes("truncated") ? "truncated" : kinds.includes("altered") ? "altered" : kinds.includes("accepted") ? "accepted" : "unknown";
    if (base.fields.every((f) => f.afterBlur === "fill failed")) { base.status = "blocked"; base.worst = "unknown"; }
    return base;
  } catch (e: any) {
    return { ...base, status: "error", note: String(e?.message ?? e).slice(0, 160) };
  }
}

export async function scan(urls: string[], opts: { outDir: string; cases?: string[]; headless?: boolean; log?: (s: string) => void }) {
  const log = opts.log ?? console.log;
  fs.mkdirSync(opts.outDir, { recursive: true });
  const ids = [baseline, ...(opts.cases?.length ? battery.filter((b) => opts.cases!.includes(b.id)) : battery)];
  const browser = await chromium.launch({ channel: "chrome", headless: opts.headless ?? false });
  const results: ProbeResult[] = [];
  for (const url of urls) {
    log(`\n${url}`);
    for (const id of ids) {
      const context = await browser.newContext({ locale: "ja-JP" });
      const page = await context.newPage();
      await page.setViewportSize({ width: 1200, height: 900 });
      const r = await probeOne(page, url, id);
      results.push(r);
      log(`  ${id.id.padEnd(18)} ${r.status.padEnd(15)} ${r.worst.padEnd(9)} ${r.fields.map((f) => `${f.role}:${f.afterAdvance ?? f.afterBlur}`).join(" ")} ${r.note}`);
      await context.close();
      await page.waitForTimeout(0).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 1500)); // be polite between sites
  }
  await browser.close();
  fs.writeFileSync(path.join(opts.outDir, "scan.json"), JSON.stringify({ createdAt: new Date().toISOString(), results }, null, 2));
  fs.writeFileSync(path.join(opts.outDir, "scan.html"), renderScan(results));
  return results;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function renderScan(results: ProbeResult[]): string {
  const urls = [...new Set(results.map((r) => r.url))];
  const ids = [...new Set(results.map((r) => r.identity))];
  const probedUrls = urls.filter((u) => results.some((r) => r.url === u && r.status === "probed"));
  const baselineOk = (u: string) => results.find((r) => r.url === u && r.identity === "baseline")?.worst === "accepted";
  const rejecting = probedUrls.filter((u) => baselineOk(u) && results.some((r) => r.url === u && r.identity !== "baseline" && ["rejected", "truncated", "altered"].includes(r.worst)));
  const rows = urls.map((u) => {
    const cells = ids.map((id) => {
      const r = results.find((x) => x.url === u && x.identity === id);
      const w = r?.status === "probed" ? r.worst : r?.status ?? "";
      const title = r ? r.fields.map((f) => `${f.role}: ${f.afterAdvance ?? f.afterBlur}${f.error ? " (" + f.error + ")" : ""}`).join("\n") + (r.note ? "\n" + r.note : "") : "";
      return `<td class="${esc(w)}" title="${esc(title)}">${esc(w)}</td>`;
    }).join("");
    return `<tr><th><a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a></th>${cells}</tr>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>nanori scan</title>
<style>body{font:14px/1.5 -apple-system,"Hiragino Sans",system-ui,sans-serif;margin:32px;color:#1b1f2a;background:#fbfaf7}
table{border-collapse:collapse}th,td{border:1px solid #e6e2d8;padding:6px 10px;text-align:left;background:#fff}th{font-weight:500;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
td.accepted{background:#e6f4ec;color:#1f7a4d}td.rejected,td.truncated,td.altered{background:#fbe9e7;color:#b3261e}td.unknown,td.no_name_fields,td.error,td.blocked{color:#6b7280}
.verdict{font-size:20px;margin:8px 0 20px}.muted{color:#6b7280}</style></head><body>
<h1>nanori scan</h1>
<div class="verdict">${rejecting.length} of ${probedUrls.length} probed forms rejected, cut, or altered at least one name-format test input. ${urls.length - probedUrls.length} forms could not be probed.</div>
<p class="muted">Probe only: name fields filled, validation triggered, confirmation attempted, nothing submitted. Our sample, not a statistic. A form counts only if the Japanese baseline name was accepted. Hover a cell for field detail. Unique forms, recorded ${esc(new Date().toISOString())}.</p>
<table><thead><tr><th>Form</th>${ids.map((i) => `<th>${esc(i)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
}
