import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import type { ElementInfo, Identity } from "./types.js";
import { baseline, battery } from "./battery.js";
import { snapshotElements, observeField } from "./agent/page.js";
import { checkField } from "./checks/index.js";
import { toHiragana } from "./kana.js";

/**
 * nanori scan: a name-field probe with no model in the loop.
 * For each URL and each name case: load the page, find the name fields, fill them, trigger validation,
 * try the confirmation button (never a final submit), and record what each field did.
 * It answers "did the name fields reject or cut this input", nothing more.
 */

const NOT_NAME = /(会社|法人|店|学校|商品|件名|団体|組織|部署|名称|組合|施設|コース|プラン|役職|building|company|subject|organization|school|product|title|user ?name|username|login|nickname|ニックネーム|ユーザー)/i;
const KANA = /(フリガナ|ふりがな|カナ|かな|kana|furigana|セイ|メイ|ｾｲ|ﾒｲ)/i;
const NAME = /(氏名|名前|姓|名|name|sei|mei|last|first|family|given|surname)/i;
const FAMILY = /(姓|セイ|ｾｲ|sei|last|family|surname)/i;
const GIVEN = /(名|メイ|ﾒｲ|mei|first|given)/i;
const FULLHINT = /(氏名|お名前|名前|fullname|full_name|your-name|your_name)/i;
const ADVANCE = /(確認|次へ|次に進む|入力内容|confirm|next|続ける|進む)/i;
const FORBIDDEN = /(送信|確定|申し?込|予約する|予約を確定|決済|支払|submit|send|purchase|pay|place order)/i;

type Role = "family" | "given" | "full" | "kana_family" | "kana_given" | "kana_full";
type Script = "katakana" | "hiragana";

export { toHiragana };

/** Which kana script the field asks for. Convention: ふりがな/ひらがな → hiragana, フリガナ/カタカナ → katakana. */
export function kanaScript(e: ElementInfo, rowText = ""): Script {
  const hay = [e.label, e.placeholder, rowText].filter(Boolean).join(" ");
  if (/(ひらがな|平仮名|hiragana)/i.test(hay)) return "hiragana";
  if (/(カタカナ|カナ|片仮名|katakana)/i.test(hay)) return "katakana";
  if (/[ぁ-ん]{2,}/.test(e.placeholder ?? "")) return "hiragana";
  if (/[ァ-ヶ]{2,}/.test(e.placeholder ?? "")) return "katakana";
  if (/ふりがな/.test(hay)) return "hiragana";
  return "katakana";
}

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

function valueFor(id: Identity, role: Role, script: Script = "katakana"): string {
  const k = (v: string | null) => (v == null ? "" : script === "hiragana" ? toHiragana(v) : v);
  switch (role) {
    case "family": return id.familyName ?? id.fullName;
    case "given": return id.givenName ?? "";
    case "full": return id.fullName;
    case "kana_family": return k(id.kanaFamily ?? id.kanaFull);
    case "kana_given": return k(id.kanaGiven);
    case "kana_full": return k(id.kanaFull);
  }
}

export interface ProbeField { ref: string; key: { name: string | null; id: string | null }; role: Role; script?: Script; label: string | null; requested: string; afterBlur: string; afterAdvance: string | null; error: string; retained: string; maxlength: number | null; pattern: string | null }
export interface ProbeResult { url: string; identity: string; status: "probed" | "no_name_fields" | "blocked" | "error"; note: string; fields: ProbeField[]; advanced: boolean; worst: "accepted" | "rejected" | "truncated" | "altered" | "unknown"; screenshot?: string; afterUrl?: string; clicked?: string }

const SUPPORT: Array<{ re: RegExp; type?: RegExp; value: (id: Identity) => string }> = [
  { re: /(mail|メール)/i, value: (id) => id.email },
  { re: /(tel|phone|電話|携帯)/i, value: (id) => id.phone },
  { re: /(zip|postal|郵便)/i, value: (id) => id.postal },
  { re: /(住所|address|addr|市区|町|番地|建物)/i, value: (id) => id.address },
  { re: /(年齢|age)/i, value: () => "35" },
  { re: /(生年|birth|誕生)/i, value: () => "1990-01-01" },
  { re: /(会社|法人|company|organization|学校名)/i, value: () => "テスト" },
  { re: /(件名|subject|title)/i, value: () => "テスト（自動入力のテストです。送信しません）" },
];
const NOTE = "nanori による自動入力テストです。送信はしません。";

async function fillSupporting(page: Page, elements: ElementInfo[], skip: string[], id: Identity) {
  for (const e of elements) {
    if (skip.includes(e.ref)) continue;
    const loc = page.locator(`[data-nanori-ref="${e.ref}"]`);
    const hay = [e.label, e.name, e.id, e.placeholder, e.type].filter(Boolean).join(" ");
    try {
      if (e.tag === "textarea") { await loc.fill(NOTE, { timeout: 2000 }); continue; }
      if (e.tag === "select") { const opt = (e.options ?? []).find((o) => o.split("|")[0] !== ""); if (opt) await loc.selectOption({ value: opt.split("|")[0] }, { timeout: 2000 }).catch(() => {}); continue; }
      if (e.tag === "input") {
        if (e.type === "checkbox") { await loc.check({ timeout: 2000 }).catch(() => {}); continue; }
        if (e.type === "radio") { if (!(await page.locator(`input[type=radio][name="${e.name}"]:checked`).count())) await loc.check({ timeout: 2000 }).catch(() => {}); continue; }
        if (e.type && !["text", "email", "tel", "number", "date", "url", "search"].includes(e.type)) continue;
        if (e.value) continue;
        const rule = SUPPORT.find((r) => r.re.test(hay) || (e.type && r.re.test(e.type)));
        if (rule) await loc.fill(rule.value(id), { timeout: 2000 });
        else if (e.required) await loc.fill("テスト", { timeout: 2000 });
      }
    } catch { /* supporting fields are best effort */ }
  }
}

async function probeOne(page: Page, url: string, id: Identity, outDir: string, idx: number): Promise<ProbeResult> {
  const base: ProbeResult = { url, identity: id.id, status: "probed", note: "", fields: [], advanced: false, worst: "unknown" };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(800);
    const elements = await snapshotElements(page);
    const named = elements.map((e) => ({ e, role: classifyField(e) })).filter((x): x is { e: ElementInfo; role: Role } => !!x.role);
    if (!named.length) return { ...base, status: "no_name_fields", note: "no name fields detected on first page" };
    if (elements.some((e) => /recaptcha|captcha/i.test(`${e.id} ${e.name} ${e.text}`))) base.note = "captcha present; blur-level only";

    for (const { e, role } of named) {
      const script = role.startsWith("kana") ? kanaScript(e) : undefined;
      const v = valueFor(id, role, script);
      const key = { name: e.name, id: e.id };
      if (!v) continue;
      const loc = page.locator(`[data-nanori-ref="${e.ref}"]`);
      try { await loc.fill(v, { timeout: 3000 }); await loc.dispatchEvent("blur").catch(() => {}); } catch (err: any) { base.fields.push({ ref: e.ref, key, role, script, label: e.label, requested: v, afterBlur: "fill failed", afterAdvance: null, error: String(err?.message ?? err).slice(0, 120), retained: "", maxlength: e.maxlength, pattern: e.pattern }); continue; }
      await page.waitForTimeout(150);
      const o = await observeField(page, e.ref, v, key);
      const c = checkField(o);
      base.fields.push({ ref: e.ref, key, role, script, label: e.label, requested: v, afterBlur: c.kind, afterAdvance: null, error: c.detail, retained: o.retained, maxlength: o.maxlength, pattern: o.pattern });
    }
    // Fill the other fields a confirmation step usually requires, with the same contact data for every case.
    await fillSupporting(page, elements, named.map((n) => n.e.ref), id);
    // Try to advance to a confirmation screen. Never a final submit.
    const fresh = await snapshotElements(page);
    const btn = fresh.find((e) => (e.tag === "button" || e.type === "submit" || e.type === "image" || e.tag === "a" || e.tag === "input") && e.text && ADVANCE.test(e.text) && !FORBIDDEN.test(e.text));
    if (btn) {
      const beforeUrl = page.url();
      base.clicked = btn.text ?? "";
      await page.locator(`[data-nanori-ref="${btn.ref}"]`).click({ timeout: 5000 }).catch(() => {});
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForTimeout(800);
      // Advanced only if the URL changed or the page no longer has the name fields (by name/id, refs may be re-rendered).
      const after = await snapshotElements(page);
      const stillHasNames = after.some((e) => classifyField(e) && (named.some((n) => (n.e.name && n.e.name === e.name) || (n.e.id && n.e.id === e.id))));
      const strip = (u: string) => u.replace(/#.*$/, "");
      base.advanced = strip(page.url()) !== strip(beforeUrl) || !stillHasNames;
      base.afterUrl = page.url();
      base.screenshot = `${String(idx).padStart(3, "0")}-${id.id}.jpg`;
      await page.screenshot({ path: path.join(outDir, base.screenshot), type: "jpeg", quality: 55 }).catch(() => {});
      if (base.advanced) {
        // On the review screen: is the name shown in full, cut, or missing?
        const norm = (t: string) => t.replace(/[\s\u3000]+/g, " ");
        const text = norm(await page.evaluate(() => document.body?.innerText ?? ""));
        for (const f of base.fields) {
          if (!f.requested || f.afterBlur === "fill failed") continue;
          const req = norm(f.requested);
          if (text.includes(req)) { f.afterAdvance = "accepted"; continue; }
          // Review screen printing HTML entities (e.g. &#7877; for ễ): the name was escaped twice and is shown corrupted.
          const entity = req.replace(/[^\x00-\x7F]/g, (c) => `&#${c.codePointAt(0)};`);
          if (entity !== req && text.includes(entity)) { f.afterAdvance = "altered"; f.error = "review screen shows the name as HTML entities (double-escaped), e.g. " + entity.slice(0, 40); f.retained = entity; continue; }
          const compact = req.replace(/ /g, "");
          if (text.replace(/ /g, "").includes(compact)) { f.afterAdvance = "altered"; f.error = "shown without spaces on review screen"; continue; }
          let cut = 0;
          for (let n = [...req].length - 1; n >= 3; n--) { const pre = [...req].slice(0, n).join(""); if (text.includes(pre)) { cut = n; break; } }
          if (cut) { f.afterAdvance = "truncated"; f.error = `review screen shows only the first ${cut} of ${[...req].length} characters`; f.retained = [...req].slice(0, cut).join(""); }
          else { f.afterAdvance = "unknown"; f.error = "name not found on the next screen"; }
        }
      } else {
        base.note += (base.note ? "; " : "") + "stayed on the input page after confirm (other fields may be incomplete)";
        for (const f of base.fields) {
          if (f.afterBlur === "fill failed") continue;
          const o = await observeField(page, f.ref, f.requested, f.key);
          const c = checkField(o);
          f.afterAdvance = c.kind; if (c.kind !== "accepted") { f.error = c.detail || f.error; f.retained = o.retained; }
        }
      }
    } else {
      base.note += (base.note ? "; " : "") + "no confirmation button found; blur-level only";
    }
    const kinds = base.fields.flatMap((f) => [f.afterBlur, f.afterAdvance].filter((k) => k && k !== "unknown") as string[]);
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
  let idx = 0;
  for (const url of urls) {
    idx += 1;
    log(`\n${url}`);
    for (const id of ids) {
      const context = await browser.newContext({ locale: "ja-JP" });
      const page = await context.newPage();
      await page.setViewportSize({ width: 1200, height: 900 });
      const r = await probeOne(page, url, id, opts.outDir, idx);
      results.push(r);
      log(`  ${id.id.padEnd(18)} ${r.status.padEnd(15)} ${r.worst.padEnd(9)} ${r.fields.map((f) => `${f.role}:${f.afterAdvance ?? f.afterBlur}`).join(" ")} ${r.note}${r.clicked ? ` [clicked "${r.clicked}" → ${r.advanced ? "advanced" : "stayed"}]` : ""}`);
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
  const byUrl = (u: string) => results.filter((r) => r.url === u);
  const flaggedKinds = ["rejected", "truncated", "altered"];
  // Categories (each form lands in exactly one):
  // A. no name fields detected / error.  B. confirmed comparable journey: baseline advanced to a confirmation screen with the name shown,
  // and every case either advanced or showed a name-field error.  C. field-level observation only: some name-field result was recorded
  // but completion was not established for every case.  D. incomplete: nothing conclusive.
  const cat = (u: string): "A" | "B" | "C" | "D" => {
    const rows = byUrl(u); const base = rows.find((r) => r.identity === "baseline");
    if (!base || base.status !== "probed") return "A";
    const concluded = (r: ProbeResult) => r.advanced || r.fields.some((f) => flaggedKinds.includes(f.afterAdvance ?? f.afterBlur));
    if (base.advanced && base.worst === "accepted" && rows.every(concluded)) return "B";
    if (rows.some((r) => r.fields.some((f) => flaggedKinds.includes(f.afterAdvance ?? f.afterBlur)))) return "C";
    return "D";
  };
  const cats = Object.fromEntries(urls.map((u) => [u, cat(u)]));
  const count = (c: string) => urls.filter((u) => cats[u] === c).length;
  const flagged = (u: string) => byUrl(u).some((r) => r.identity !== "baseline" && flaggedKinds.includes(r.worst));
  const flaggedB = urls.filter((u) => cats[u] === "B" && flagged(u)).length;
  const flaggedC = urls.filter((u) => cats[u] === "C" && flagged(u)).length;
  const CAT_LABEL = { A: "no name fields detected", B: "confirmed comparable journey", C: "field-level observation only", D: "incomplete" };
  const rows = urls.map((u) => {
    const cells = ids.map((id) => {
      const r = byUrl(u).find((x) => x.identity === id);
      const w = r?.status === "probed" ? r.worst : r?.status ?? "";
      const title = r ? r.fields.map((f) => `${f.role}: ${f.afterAdvance ?? f.afterBlur}${f.error ? " (" + f.error + ")" : ""}`).join("\n") + (r.note ? "\n" + r.note : "") + (r.clicked ? `\nclicked "${r.clicked}" → ${r.advanced ? "advanced" : "stayed"}` : "") : "";
      return `<td class="${esc(w)}" title="${esc(title)}">${esc(w)}</td>`;
    }).join("");
    return `<tr><th><a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a></th><td class="cat">${CAT_LABEL[cats[u]]}</td>${cells}</tr>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>nanori scan</title>
<style>body{font:14px/1.5 -apple-system,"Hiragino Sans",system-ui,sans-serif;margin:32px;color:#1b1f2a;background:#fbfaf7}
table{border-collapse:collapse}th,td{border:1px solid #e6e2d8;padding:6px 10px;text-align:left;background:#fff}th{font-weight:500;max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
td.accepted{background:#e6f4ec;color:#1f7a4d}td.rejected,td.truncated,td.altered{background:#fbe9e7;color:#b3261e}td.unknown,td.no_name_fields,td.error,td.blocked{color:#6b7280}td.cat{color:#6b7280;white-space:nowrap}
.verdict{font-size:20px;margin:8px 0 12px}.muted{color:#6b7280}ul{margin:0 0 16px}</style></head><body>
<h1>nanori scan</h1>
<div class="verdict">Flagged observations pending review: ${flaggedB + flaggedC} forms (${flaggedB} in confirmed comparable journeys, ${flaggedC} field-level only).</div>
<ul class="muted">
<li>${urls.length} forms attempted.</li>
<li>${urls.length - count("A")} had name fields the probe could fill; ${count("A")} did not (or errored).</li>
<li>${count("B")} confirmed comparable journeys: the Japanese baseline reached a confirmation screen with the name shown, and every test case either reached it or showed a name-field error. ${flaggedB} of these flagged at least one test input.</li>
<li>${count("C")} field-level observations only: a name field reacted, but completion was not established for every case (other required fields incomplete). ${flaggedC} flagged.</li>
<li>${count("D")} incomplete: no conclusive name-field result.</li>
</ul>
<p class="muted">A flag is an observation (rejected, cut, or altered input), not a proven exclusion: each needs human review for documented alternatives. Probe only: name fields filled, validation triggered, a confirmation button attempted, nothing submitted. Our sample, not a statistic. Hover a cell for field detail. Recorded ${esc(new Date().toISOString())}.</p>
<table><thead><tr><th>Form</th><th>Category</th>${ids.map((i) => `<th>${esc(i)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
}
