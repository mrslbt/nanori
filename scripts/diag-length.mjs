// Boundary diagnostic for one name field: strings of increasing length, everything else identical.
// Records per attempt: value, retained value, whether the checkpoint was reached, all visible errors, and a screenshot.
// Usage: node scripts/diag-length.mjs <url> <fieldName> <confirmButtonText> <outDir> [min] [max]
// Fixed non-name values are read from <outDir>/scenario.json: {"fills": {"name": "value"}, "selects": {"name": "value"}, "radios": {"name": "value"}}
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const [url, field, btnText, outDir, minArg = "10", maxArg = "40"] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const scenario = JSON.parse(fs.readFileSync(path.join(outDir, "scenario.json"), "utf8"));
const SAMPLE = "Maria Clara Santos Dela Cruz Garcia Lopez Fernandez";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const attempts = [];
async function attempt(n) {
  // Exact-length strings that never end on a space (a trailing space would test whitespace, not length).
  let value = SAMPLE.slice(0, n); if (value.endsWith(" ")) value = SAMPLE.slice(0, n + 1).replace(/ (\S)$/, "$1").slice(0, n);
  const ctx = await browser.newContext({ locale: "ja-JP" });
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  for (const [k, v] of Object.entries(scenario.fills ?? {})) await page.fill(`[name="${k}"]`, v);
  for (const [k, v] of Object.entries(scenario.selects ?? {})) await page.selectOption(`[name="${k}"]`, v);
  for (const [k, v] of Object.entries(scenario.radios ?? {})) await page.check(`input[name="${k}"][value="${v}"]`);
  await page.fill(`[name="${field}"]`, value);
  const beforeUrl = page.url();
  const btn = page.locator(`button:has-text("${btnText}"), input[type=submit][value*="${btnText}"]`).first();
  let clicked = true;
  try { await btn.click({ timeout: 5000 }); } catch { clicked = false; }
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(1500);
  const state = await page.evaluate(({ f, v }) => {
    const el = document.querySelector(`[name="${f}"]`);
    const errs = Array.from(document.querySelectorAll(".error, [class*=error], [role=alert]")).map((e) => e.textContent.trim()).filter(Boolean);
    const fieldBox = el?.closest("td, dd, div, li, tr");
    const fieldErrs = fieldBox ? Array.from(fieldBox.querySelectorAll(".error, [class*=error]")).map((e) => e.textContent.trim()).filter(Boolean) : [];
    const text = (document.body?.innerText ?? "").replace(/[\s　]+/g, " ");
    return { fieldPresent: !!el, retained: el ? el.value : null, fieldErrors: fieldErrs, allErrors: errs.slice(0, 10), valueShown: text.includes(v.replace(/[\s　]+/g, " ")), title: document.title };
  }, { f: field, v: value });
  const checkpointReached = (page.url().replace(/#.*$/, "") !== beforeUrl.replace(/#.*$/, "") || !state.fieldPresent) && state.valueShown;
  const shot = `len-${String(n).padStart(2, "0")}.jpg`;
  await page.screenshot({ path: path.join(outDir, shot), type: "jpeg", quality: 55, fullPage: true }).catch(() => {});
  await ctx.close();
  const rec = { requestedLength: n, actualLength: [...value].length, n, value, clicked, retained: state.retained, fieldErrors: state.fieldErrors, allErrors: state.allErrors, checkpointReached, valueShownOnPage: state.valueShown, screenshot: shot };
  attempts.push(rec);
  console.log(JSON.stringify(rec));
  // accepted = checkpoint reached with no field error; rejected = field error present and checkpoint not reached; else undetermined
  return rec.checkpointReached && rec.fieldErrors.length === 0 ? "accepted" : !rec.checkpointReached && rec.fieldErrors.length > 0 ? "rejected" : "undetermined";
}
let lo = Number(minArg), hi = Number(maxArg);
const a = await attempt(lo), b = await attempt(hi);
let result;
if (a === "accepted" && b === "rejected") {
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); const r = await attempt(mid); if (r === "rejected") hi = mid; else if (r === "accepted") lo = mid; else { result = { status: "undetermined", note: `attempt at ${mid} was undetermined` }; break; } }
  if (!result) result = { status: "bracketed", accepted: lo, rejected: hi, wording: `Observed boundary for the tested strings: ${lo} accepted; ${hi} rejected. The server implementation was not inspected.` };
} else result = { status: "undetermined", note: `bounds gave ${a} at ${lo} and ${b} at ${hi}` };
console.log("\n" + JSON.stringify(result));
fs.writeFileSync(path.join(outDir, "diag-length.json"), JSON.stringify({ url, field, confirmButton: btnText, measuredAt: new Date().toISOString(), method: "same page, same non-name values from scenario.json, only the name length varies; accepted = checkpoint reached with the value shown and no field error; rejected = field error shown and checkpoint not reached", scenario, attempts, result }, null, 2));
await browser.close();
