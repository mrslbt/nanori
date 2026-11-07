import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { Action, Identity, RunResult, Step, FieldObservation, Outcome } from "../types.js";
import { snapshotElements, observeField, pageErrors, visibleText, pageModel } from "./page.js";
import { toHiragana } from "../kana.js";
import { recogniseCheckpoint, checkNamePreserved, norm } from "../checkpoint.js";
import { scenario } from "../battery.js";

const ActionSchema = z.object({
  action: z.enum(["click", "fill", "select", "done", "stuck"]),
  ref: z.string().optional(),
  value: z.string().optional(),
  reason: z.string(),
});

const actTool: Anthropic.Tool = {
  name: "act",
  description: "Perform exactly one browser action, or declare the goal reached (done) or that you cannot proceed (stuck).",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: { type: "string", enum: ["click", "fill", "select", "done", "stuck"] },
      ref: { type: "string", description: "Element ref like n3. Required for click, fill, select." },
      value: { type: "string", description: "Text to type (fill) or option value/text (select)." },
      reason: { type: "string", description: "One short sentence: why this action, or why done/stuck." },
    },
    required: ["action", "ref", "value", "reason"],
  },
};

import { isFinalAction, controlName } from "../guard.js";

export interface LoopOptions {
  url: string;
  goal: string;
  identity: Identity;
  outDir: string;
  maxSteps?: number;
  model?: string;
  log?: (s: string) => void;
}

function systemPrompt(identity: Identity, goal: string): string {
  const name = identity.familyName && identity.givenName
    ? `family name "${identity.familyName}", given name "${identity.givenName}"`
    : `a single name "${identity.fullName}" with no family name`;
  return `You are nanori, a form-testing agent. You drive a real browser one action at a time to reach a goal on a Japanese website, filling the form as the person described below. You are testing whether the form accepts this person's name. You never submit anything for real.

Goal: ${goal}
Stop when the goal screen is visible (usually a review or confirmation screen that shows the entered values) and call act with action "done". Do not click any button that would finally submit, confirm, pay or send. If the only way forward is such a button, call "done" with reason "safe checkpoint reached".

The person you are:
- Full name: ${identity.fullName} (${name})
- Reading of the name in katakana: ${identity.kanaFull}${identity.kanaFamily ? ` (family ${identity.kanaFamily}, given ${identity.kanaGiven})` : ""}
- The same reading in hiragana: ${toHiragana(identity.kanaFull)}${identity.kanaFamily ? ` (family ${toHiragana(identity.kanaFamily)}, given ${toHiragana(identity.kanaGiven ?? "")})` : ""}
- Email: ${identity.email}
- Mobile phone: ${identity.phone}
- Postal code: ${identity.postal}
- Address: ${identity.address}

Rules:
- Enter the name exactly as written above. Do not shorten, transliterate into kanji, remove spaces, or invent a family name. If a field demands something this person does not have (for example a family name when they have only one name), enter the full name in that field once and leave the other name field empty, and say so in the reason.
- For reading fields, use the script the field asks for: a field labelled ふりがな or ひらがな (or with a hiragana example) gets the hiragana reading; a field labelled フリガナ, カナ or カタカナ (or with a katakana example) gets the katakana reading. Keep spaces where the name has spaces. Never substitute the other script to get past an error: if the field rejects the correct-script reading, that is the finding.
- For phone and postal fields, enter the digits given, half-width.
- Non-name choices are fixed so that only the name differs between runs. Use exactly: date = ${scenario.dateRule}; time = ${scenario.timeRule}; selects and radios = ${scenario.choiceRule}; if a treatment or purpose is asked, "${scenario.treatment}"; if symptoms or a free-text message is asked, "${scenario.symptom}" for symptoms and "${scenario.message}" for messages; age ${scenario.age}; birth date ${scenario.birthDate}; ${scenario.optionalFields}.
- Fill one field per action. After filling all required fields on a page, click the button that goes to the next step (次へ, 確認, 確認画面へ, Next).
- If an error message appears, read it. If it is about a field you filled with this person's real data, do NOT change the data to make it pass; call "stuck" and quote the error. If it is a mistake of yours (wrong field, wrong format for a non-name field), correct it.
- Only use refs that exist in the current element list. One act call per turn, always.`;
}

/**
 * Checkpoint verification = recognition (is this a review screen?) + preservation (is each typed name value shown exactly in its labelled row?).
 * Both are pure functions in src/checkpoint.ts; this only builds the page model. Unknown is never upgraded to verified.
 */
/**
 * When errors are showing, observe every field that is now invalid, including required fields the agent left empty
 * on purpose (single-name case). The page may have re-rendered (refs gone), so re-snapshot and match previously
 * filled fields by name/id. Adds to step.observations; never duplicates a field already observed on this step.
 */
async function observeInvalidFields(page: Page, steps: Step[], step: Step): Promise<void> {
  const fresh = await snapshotElements(page);
  const prevObs = steps.flatMap((s) => s.observations);
  const requestedFor = (e: typeof fresh[number]) => prevObs.find((o) => (o.name && o.name === e.name) || (o.id && o.id === e.id))?.requested ?? "";
  for (const e of fresh) {
    if (!["input", "select", "textarea"].includes(e.tag)) continue;
    const again = await observeField(page, e.ref, requestedFor(e), { name: e.name, id: e.id });
    const bad = again.ariaInvalid || again.validationMessage || again.visibleErrors.length;
    if (bad && !step.observations.find((o) => (o.name && o.name === again.name) || o.ref === again.ref)) step.observations.push(again);
  }
}

/**
 * Scroll the measured field (by id/name) or the review row holding a text into the middle of the viewport and return
 * where it ended up, as fractions of the viewport, so the report can crop the evidence around it instead of the centre.
 */
async function scrollToEvidence(page: Page, target: { id?: string | null; name?: string | null; text?: string | null }): Promise<{ x: number; y: number } | undefined> {
  const f = await page.evaluate((k) => {
    let el: Element | null = (k.id ? document.getElementById(k.id) : null) ?? (k.name ? document.querySelector(`[name="${CSS.escape(k.name)}"]`) : null);
    if (!el && k.text) {
      const want = k.text.replace(/[\s\u3000]+/g, " ").trim();
      const all = Array.from(document.querySelectorAll<HTMLElement>("td, dd, span, div, p, li, th, dt")).filter((e) => (e.innerText ?? "").replace(/[\s\u3000]+/g, " ").includes(want));
      el = all.sort((a, b) => a.innerText.length - b.innerText.length)[0] ?? null;
    }
    if (!el) return null;
    (el as HTMLElement).scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (r.left + r.width / 2) / window.innerWidth)), y: Math.min(1, Math.max(0, (r.top + r.height / 2) / window.innerHeight)) };
  }, target).catch(() => null);
  if (f) await page.waitForTimeout(200);
  return f ?? undefined;
}

export async function verifyCheckpoint(page: Page, steps: Step[], identity: Identity, startUrl: string): Promise<{ verified: boolean; changed?: boolean; reason: string; observations: FieldObservation[]; model?: Step["checkpointModel"] }> {
  const nameValues = new Set([identity.fullName, identity.familyName, identity.givenName, identity.kanaFull, identity.kanaFamily, identity.kanaGiven, toHiragana(identity.kanaFull), identity.kanaFamily && toHiragana(identity.kanaFamily), identity.kanaGiven && toHiragana(identity.kanaGiven)].filter((v): v is string => !!v).map(norm));
  const latest = new Map<string, FieldObservation>();
  for (const o of steps.flatMap((s) => s.observations)) { if (o.requested && !o.diagnostic) latest.set(o.name ?? o.id ?? o.ref, o); }
  const typedNames = [...latest.values()].filter((o) => nameValues.has(norm(o.requested)));
  const model = await pageModel(page, typedNames.map((o) => ({ name: o.name, id: o.id })), page.url().replace(/#.*$/, "") !== startUrl.replace(/#.*$/, ""));
  const observations: FieldObservation[] = [];
  const saved = { urlChanged: model.urlChanged, nameInputsPresent: model.nameInputsPresent, headings: model.headings, rows: model.rows, cues: model.cues };
  const recognised = recogniseCheckpoint(model) === "recognised";
  if (!recognised) return { verified: false, reason: "this screen was not recognised as a review screen (no review heading, or name inputs still present)", observations, model: saved };
  if (!typedNames.length) return { verified: false, reason: "no name value was typed, nothing to verify", observations, model: saved };
  let allExact = true;
  let changed = false;
  const siblingsOf = (o: FieldObservation) => typedNames.filter((x) => x !== o).map((x) => x.requested);
  for (const o of typedNames) {
    const p = checkNamePreserved(model, o.requested, undefined, siblingsOf(o));
    if (p.status === "exact") continue;
    allExact = false;
    // Review screen printing HTML entities (e.g. &#7877; for ễ): the name was escaped twice and is shown corrupted.
    const entity = o.requested.replace(/[^\x00-\x7F]/g, (c) => `&#${c.codePointAt(0)};`);
    const escaped = p.status === "differs" && entity !== o.requested && !!p.shown && norm(p.shown).includes(norm(entity));
    const kind = escaped ? "checkpoint_escaped" : p.status === "differs" ? "checkpoint_truncated" : "checkpoint_not_verified";
    const note = escaped ? `review row shows the name as HTML entities (double-escaped): ${p.note}` : (p.status === "differs" ? "review row differs from the typed value: " : "could not verify: ") + p.note;
    observations.push({ ...o, ref: o.ref + "@checkpoint", label: (o.label ?? o.name ?? "") + " (review row)", retained: p.shown ?? "", validationMessage: "", ariaInvalid: false, visibleErrors: [], diagnostic: { kind, note } });
    if (p.status === "differs") changed = true;
  }
  return { verified: allExact, changed, reason: allExact ? "review screen recognised; every typed name value shown exactly in its review row" : changed ? "review screen recognised, but a typed name value is shown changed in its review row" : "review screen recognised, but a name value could not be verified", observations, model: saved };
}

export async function runLoop(context: BrowserContext, opts: LoopOptions): Promise<RunResult> {
  const client = new Anthropic();
  const model = opts.model ?? process.env.NANORI_NAV_MODEL ?? "claude-sonnet-5-5";
  const maxSteps = opts.maxSteps ?? 40;
  const log = opts.log ?? (() => {});
  const startedAt = new Date().toISOString();
  fs.mkdirSync(opts.outDir, { recursive: true });

  const page: Page = await context.newPage();
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(opts.url, { waitUntil: "domcontentloaded" });

  const steps: Step[] = [];
  const messages: Anthropic.MessageParam[] = [];
  let outcome: Outcome = "not_determined";
  let stopReason = "";
  let lastSignature = "";
  let noProgress = 0;

  for (let i = 1; i <= maxSteps; i++) {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(300);
    const elements = await snapshotElements(page);
    const text = await visibleText(page);
    const shot = path.join(opts.outDir, `step-${String(i).padStart(2, "0")}.jpg`);
    await page.screenshot({ path: shot, type: "jpeg", quality: 60, fullPage: false });
    const shotB64 = fs.readFileSync(shot).toString("base64");

    const signature = page.url() + "|" + elements.map((e) => e.ref + e.value).join(",");
    noProgress = signature === lastSignature ? noProgress + 1 : 0;
    lastSignature = signature;
    if (noProgress >= 3) { stopReason = "no progress for 3 steps"; outcome = "not_determined"; break; }

    const userContent: Anthropic.ContentBlockParam[] = [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: shotB64 } },
      {
        type: "text",
        text: `Step ${i}/${maxSteps}. URL: ${page.url()}\nTitle: ${await page.title()}\n\nVisible text (truncated):\n${text}\n\nInteractive elements (JSON):\n${JSON.stringify(elements)}\n\nCall act with exactly one action.`,
      },
    ];
    messages.push({ role: "user", content: userContent });

    const response = await client.messages.create({
      model,
      max_tokens: 2000,
      system: [{ type: "text", text: systemPrompt(opts.identity, opts.goal), cache_control: { type: "ephemeral" } }],
      tools: [actTool],
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      output_config: { effort: "low" },
      messages,
    });

    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    // Keep history small: replace the big observation with a short note once acted on.
    messages[messages.length - 1] = { role: "user", content: `Step ${i}: page ${page.url()} (observation omitted)` };
    messages.push({ role: "assistant", content: response.content });

    if (!toolUse) { stopReason = `no action returned (stop_reason=${response.stop_reason})`; break; }
    const parsed = ActionSchema.safeParse(toolUse.input);
    if (!parsed.success) { stopReason = "unparseable action"; break; }
    const action: Action = parsed.data;
    log(`  ${i}. ${action.action} ${action.ref ?? ""} ${action.value ? JSON.stringify(action.value) : ""} - ${action.reason}`);

    const step: Step = { index: i, url: page.url(), title: await page.title(), action, ok: true, screenshot: path.basename(shot), observations: [], pageErrors: [] };
    let resultText = "ok";
    try {
      if (action.action === "done") {
        // The model saying "done" is a claim. Verify: the typed name values must appear on this screen.
        const v = await verifyCheckpoint(page, steps, opts.identity, opts.url);
        outcome = v.verified ? "reached_checkpoint" : v.changed ? "reached_name_changed" : "not_determined";
        stopReason = action.reason + (v.verified ? "" : ` (${v.changed ? "name changed" : "not verified"}: ${v.reason})`);
        step.checkpointModel = v.model;
        step.observations.push(...v.observations);
        // Evidence: the review row that holds the name (changed or not), scrolled into view.
        try {
          const row = v.observations[0]?.retained || opts.identity.fullName;
          step.focus = await scrollToEvidence(page, { text: row });
          const after = path.join(opts.outDir, `step-${String(i).padStart(2, "0")}-after.jpg`);
          await page.screenshot({ path: after, type: "jpeg", quality: 60 });
          step.screenshotAfter = path.basename(after);
        } catch { /* best effort */ }
        steps.push(step);
        messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: "ok" }] });
        break;
      }
      if (action.action === "stuck") {
        outcome = "stopped_before_checkpoint";
        stopReason = action.reason;
        step.pageErrors = await pageErrors(page);
        // The agent may stop because an error appeared on blur, before any click. Measure what the page shows now,
        // so the stop is backed by a field observation and not only by the agent's description.
        if (step.pageErrors.length) await observeInvalidFields(page, steps, step).catch(() => {});
        try {
          const lastBad = [...steps, step].reverse().flatMap((s) => s.observations).find((o) => o.visibleErrors.length || o.ariaInvalid || o.validationMessage);
          if (lastBad) step.focus = await scrollToEvidence(page, { id: lastBad.id, name: lastBad.name });
          const after = path.join(opts.outDir, `step-${String(i).padStart(2, "0")}-after.jpg`);
          await page.screenshot({ path: after, type: "jpeg", quality: 60 });
          step.screenshotAfter = path.basename(after);
        } catch { /* best effort */ }
        steps.push(step);
        messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: "ok" }] });
        break;
      }
      const el = elements.find((e) => e.ref === action.ref);
      if (!el) throw new Error(`unknown ref ${action.ref}`);
      const locator = page.locator(`[data-nanori-ref="${action.ref}"]`);
      if (action.action === "fill") {
        // Errors already showing before the fill (from an earlier submit) are stale, not a reaction to this value.
        const before = await observeField(page, action.ref!, action.value ?? "", { name: el.name, id: el.id });
        await locator.fill(action.value ?? "");
        await locator.dispatchEvent("blur").catch(() => {});
        await page.waitForTimeout(150);
        const obs: FieldObservation = await observeField(page, action.ref!, action.value ?? "", { name: el.name, id: el.id });
        if (before.visibleErrors.length && before.visibleErrors.join("|") === obs.visibleErrors.join("|")) { obs.visibleErrors = []; obs.ariaInvalid = obs.ariaInvalid && before.ariaInvalid ? false : obs.ariaInvalid; }
        step.observations.push(obs);
        resultText = JSON.stringify({ retained: obs.retained, validationMessage: obs.validationMessage, visibleErrors: obs.visibleErrors });
      } else if (action.action === "select") {
        const v = action.value ?? "";
        try { await locator.selectOption({ value: v }); } catch { await locator.selectOption({ label: v }); }
        await page.waitForTimeout(150);
      } else if (action.action === "click") {
        const label = controlName({ text: el.text, ariaLabel: el.ariaLabel, value: el.tag === "input" ? el.value : null, alt: el.alt, title: el.title });
        const clickable = ["button", "a"].includes(el.tag) || el.role === "button" || (el.tag === "input" && ["submit", "button", "image"].includes(el.type ?? ""));
        if (clickable && isFinalAction({ text: el.text, ariaLabel: el.ariaLabel, value: el.tag === "input" ? el.value : null, alt: el.alt, title: el.title })) {
          // A safe stop is not proof the goal screen was reached. Verify below like a "done".
          const v = await verifyCheckpoint(page, steps, opts.identity, opts.url);
          outcome = v.verified ? "reached_checkpoint" : v.changed ? "reached_name_changed" : "not_determined";
          stopReason = `safe stop: refused to click "${label || "(unnamed control)"}"; ${v.reason}`;
          step.checkpointModel = v.model;
          if (v.observations.length) step.observations.push(...v.observations);
          step.ok = false;
          step.error = stopReason;
          steps.push(step);
          messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: "refused: this control reads like a final action; the run stops here" }] });
          break;
        }
        // Re-observe every filled field before leaving the page, so blur-time errors are captured.
        for (const prev of steps.flatMap((s) => s.observations)) {
          const again = await observeField(page, prev.ref, prev.requested, { name: prev.name, id: prev.id });
          if (again.visibleErrors.length || again.ariaInvalid || again.validationMessage) step.observations.push(again);
        }
        await locator.click({ timeout: 5000 });
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        await page.waitForTimeout(400);
        step.pageErrors = await pageErrors(page);
        // If errors are showing after the click, observe every field that is now invalid,
        // including required fields the agent left empty on purpose (single-name case).
        if (step.pageErrors.length) {
          await observeInvalidFields(page, steps, step);
          resultText = JSON.stringify({ pageErrors: step.pageErrors });
        }
      }
    } catch (e: any) {
      step.ok = false;
      step.error = String(e?.message ?? e);
      resultText = `error: ${step.error}`;
    }
    // Evidence: a second screenshot AFTER the action settled. If a field now shows an error, scroll it into view first.
    try {
      const bad = step.observations.find((o) => o.visibleErrors.length || o.ariaInvalid || o.validationMessage);
      if (bad) step.focus = await scrollToEvidence(page, { id: bad.id, name: bad.name });
      const after = path.join(opts.outDir, `step-${String(i).padStart(2, "0")}-after.jpg`);
      await page.screenshot({ path: after, type: "jpeg", quality: 60, fullPage: false });
      step.screenshotAfter = path.basename(after);
    } catch { /* evidence capture is best effort */ }
    steps.push(step);
    messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: resultText }] });
  }
  if (!stopReason) stopReason = `step budget of ${maxSteps} exhausted`;
  const final = path.join(opts.outDir, "final.jpg");
  await page.screenshot({ path: final, type: "jpeg", quality: 60 }).catch(() => {});
  await page.close();
  return { identity: opts.identity, outcome, stopReason, steps, startedAt, endedAt: new Date().toISOString(), model };
}
