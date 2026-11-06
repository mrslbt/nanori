// Diagnostic probe: find the maximum accepted length of one name field by trying strings of increasing length.
// Usage: node scripts/diag-length.mjs <url> <fieldName> <confirmButtonText> [min] [max]
import { chromium } from "playwright";
const [url, field, btnText, minArg = "10", maxArg = "40"] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
async function accepts(n) {
  const ctx = await browser.newContext({ locale: "ja-JP" });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const value = "Maria Clara Santos Dela Cruz Garcia Lopez Fernandez".slice(0, n);
  await page.fill(`[name="${field}"]`, value);
  // Fill the other required fields minimally so only the name can fail.
  for (const [sel, v] of [["[name=furigana]", "まりあ"], ["[name=tel]", "09012345678"], ["[name=email]", "test@example.com"], ["[name=email_confirm]", "test@example.com"], ["[name=symptom]", "テスト"]]) { if (await page.locator(sel).count()) await page.fill(sel, v).catch(() => {}); }
  for (const t of await page.locator("textarea").all()) { if (!(await t.inputValue())) await t.fill("テスト").catch(() => {}); }
  for (const r of await page.locator("input[type=radio]").all()) { try { if (!(await page.locator(`input[type=radio][name="${await r.getAttribute("name")}"]:checked`).count())) await r.check(); } catch {} }
  for (const s of await page.locator("select").all()) { try { const opts = await s.locator("option").allInnerTexts(); if (opts.length > 1) await s.selectOption({ index: 1 }); } catch {} }
  for (const d of await page.locator("input[type=text]").all()) { const nm = await d.getAttribute("name"); const val = await d.inputValue(); if (!val && nm !== field) await d.fill(/date|day|日/.test(nm ?? "") ? "2026年11月09日" : "テスト").catch(() => {}); }
  await page.locator(`button:has-text("${btnText}"), input[type=submit][value*="${btnText}"]`).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(1200);
  const err = await page.evaluate((f) => { const el = document.querySelector(`[name="${f}"]`); const box = el?.closest("td, dd, div, li, tr"); return box ? Array.from(box.querySelectorAll(".error, [class*=error]")).map((e) => e.textContent.trim()).filter(Boolean).join(" | ") : ""; }, field);
  await ctx.close();
  return { n, value, err };
}
let lo = Number(minArg), hi = Number(maxArg);
const r1 = await accepts(lo), r2 = await accepts(hi);
console.log(JSON.stringify(r1)); console.log(JSON.stringify(r2));
if (!r1.err && r2.err) {
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); const r = await accepts(mid); console.log(JSON.stringify(r)); if (r.err) hi = mid; else lo = mid; }
  console.log(`\nLimit: ${lo} characters accepted, ${hi} rejected.`);
} else console.log("\nCould not bracket the limit with these bounds.");
await browser.close();
