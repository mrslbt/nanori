import type { Page } from "playwright";
import type { ElementInfo, FieldObservation } from "../types.js";

/** Tag every interactive element with a stable ref and return a compact description of each. */
export async function snapshotElements(page: Page): Promise<ElementInfo[]> {
  return page.evaluate(() => {
    const out: any[] = [];
    const nodes = document.querySelectorAll<HTMLElement>("input, select, textarea, button, a[href], [role=button], [role=checkbox]");
    let i = 0;
    const visible = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    };
    const labelFor = (el: HTMLElement) => {
      const id = el.getAttribute("id");
      if (id) {
        const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (l) return (l as HTMLElement).innerText.trim();
      }
      const p = el.closest("label");
      if (p) { const t = (p as HTMLElement).innerText.replace((el as any).value ?? "", "").trim(); if (t) return t; }
      const aria = el.getAttribute("aria-label");
      if (aria) return aria;
      // Table and definition-list layouts: the label is the row header or the preceding dt.
      const tr = el.closest("tr");
      if (tr) { const th = tr.querySelector("th, td:first-child"); if (th && th !== el.closest("td") && (th as HTMLElement).innerText.trim()) return (th as HTMLElement).innerText.trim().slice(0, 80); }
      const dd = el.closest("dd");
      if (dd) { let prev = dd.previousElementSibling; while (prev && prev.tagName !== "DT") prev = prev.previousElementSibling; if (prev) return (prev as HTMLElement).innerText.trim().slice(0, 80); }
      // Generic: nearest preceding short text in the same container.
      const box = el.closest("div, li, p, section, fieldset");
      if (box) { const t = (box as HTMLElement).innerText.replace((el as any).value ?? "", "").trim(); if (t && t.length <= 60) return t; }
      return null;
    };
    for (const el of nodes) {
      if (!visible(el)) continue;
      if ((el as HTMLInputElement).type === "hidden") continue;
      i += 1;
      const ref = `n${i}`;
      el.setAttribute("data-nanori-ref", ref);
      const tag = el.tagName.toLowerCase();
      const info: any = {
        ref,
        tag,
        type: el.getAttribute("type"),
        name: el.getAttribute("name"),
        id: el.getAttribute("id"),
        label: labelFor(el),
        placeholder: el.getAttribute("placeholder"),
        ariaLabel: el.getAttribute("aria-label") || (el.getAttribute("aria-labelledby") ? Array.from(el.getAttribute("aria-labelledby")!.split(/\s+/)).map((i) => document.getElementById(i)?.innerText?.trim() ?? "").join(" ") : null),
        role: el.getAttribute("role"),
        title: el.getAttribute("title"),
        alt: el.getAttribute("alt"),
        text: tag === "button" || tag === "a" || el.getAttribute("role") === "button" ? el.innerText.trim().slice(0, 80)
          : tag === "input" && ["submit", "button", "image"].includes((el as HTMLInputElement).type) ? ((el as HTMLInputElement).value || el.getAttribute("alt") || "").trim().slice(0, 80) : null,
        required: el.hasAttribute("required") || el.getAttribute("aria-required") === "true",
        maxlength: el.hasAttribute("maxlength") ? Number(el.getAttribute("maxlength")) : null,
        pattern: el.getAttribute("pattern"),
        value: (el as HTMLInputElement).value ?? "",
      };
      if (tag === "select") info.options = Array.from((el as HTMLSelectElement).options).map((o) => `${o.value}|${o.text.trim()}`).slice(0, 40);
      out.push(info);
    }
    return out;
  });
}

/** What the page did with a field after we filled it. Measured, not judged. */
export async function observeField(page: Page, ref: string, requested: string, key?: { name: string | null; id: string | null }): Promise<FieldObservation> {
  return page.evaluate(
    ({ ref, requested, key }) => {
      let el = document.querySelector<HTMLInputElement>(`[data-nanori-ref="${ref}"]`);
      if (!el && key?.id) el = document.getElementById(key.id) as HTMLInputElement | null;
      if (!el && key?.name) el = document.querySelector<HTMLInputElement>(`[name="${CSS.escape(key.name)}"]`);
      if (!el) {
        return { ref, label: null, name: key?.name ?? null, id: key?.id ?? null, requested, retained: "", maxlength: null, pattern: null, required: false, validationMessage: "", ariaInvalid: false, visibleErrors: [] };
      }
      const id = el.getAttribute("id");
      let label: string | null = null;
      if (id) { const l = document.querySelector(`label[for="${CSS.escape(id)}"]`); if (l) label = (l as HTMLElement).innerText.trim() || null; }
      if (!label) { const p = el.closest("label"); if (p) label = (p as HTMLElement).innerText.trim() || null; }
      if (!label) { const tr = el.closest("tr"); const th = tr?.querySelector("th"); if (th) label = (th as HTMLElement).innerText.trim() || null; }
      // Visible error text: aria-describedby targets, role=alert, or siblings with error-ish class names near the field.
      const errs = new Set<string>();
      const described = el.getAttribute("aria-describedby");
      if (described) for (const did of described.split(/\s+/)) { const d = document.getElementById(did); if (d && (d as HTMLElement).innerText.trim()) errs.add((d as HTMLElement).innerText.trim()); }
      const container = el.closest("td, dd, div, li, tr, p, fieldset, section") ?? el.parentElement;
      if (container) {
        for (const c of container.querySelectorAll<HTMLElement>("[role=alert], .error, .err, .invalid-feedback, .form-error, .validation, [class*=error], [class*=invalid]")) {
          const r = c.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && c.innerText.trim()) errs.add(c.innerText.trim());
        }
      }
      return {
        ref,
        label,
        name: el.getAttribute("name"),
        id: el.getAttribute("id"),
        requested,
        retained: el.value ?? "",
        maxlength: el.hasAttribute("maxlength") ? Number(el.getAttribute("maxlength")) : null,
        pattern: el.getAttribute("pattern"),
        required: el.hasAttribute("required") || el.getAttribute("aria-required") === "true",
        validationMessage: el.validationMessage ?? "",
        ariaInvalid: el.getAttribute("aria-invalid") === "true",
        visibleErrors: Array.from(errs),
      };
    },
    { ref, requested, key: key ?? null },
  );
}

/** Error-looking text anywhere on the page, for the step record. */
export async function pageErrors(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out = new Set<string>();
    for (const c of document.querySelectorAll<HTMLElement>("[role=alert], .error, .err, .invalid-feedback, .form-error, [class*=error]")) {
      const r = c.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && c.innerText.trim()) out.add(c.innerText.trim().slice(0, 200));
    }
    return Array.from(out).slice(0, 20);
  });
}

export async function visibleText(page: Page, max = 3000): Promise<string> {
  const t = await page.evaluate(() => document.body?.innerText ?? "");
  return t.replace(/\n{3,}/g, "\n\n").slice(0, max);
}

/** Extract the review-screen model: headings, labelled rows (table/dl/label-value pairs), whether the given name inputs still exist. */
export async function pageModel(page: Page, keys: Array<{ name: string | null; id: string | null }>, urlChanged: boolean) {
  return page.evaluate(({ keys, urlChanged }) => {
    const text = (el: Element | null) => (el ? ((el as HTMLElement).innerText ?? el.textContent ?? "").trim() : "");
    const shown = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    // Hidden headings (a later step kept in the same document) are not on the screen the person sees.
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, .title, [class*=title], [class*=heading], legend, th[colspan]")).filter(shown).map(text).filter(Boolean).slice(0, 40);
    headings.push(document.title);
    const rows: Array<{ label: string; value: string }> = [];
    // Rows of a hidden entry form behind the review section are not part of the review screen.
    for (const tr of document.querySelectorAll("tr")) { if (!shown(tr)) continue; const th = tr.querySelector("th"); const tds = tr.querySelectorAll("td"); if (th && tds.length) rows.push({ label: text(th), value: Array.from(tds).map(text).join(" ") }); else if (tds.length >= 2) rows.push({ label: text(tds[0]), value: Array.from(tds).slice(1).map(text).join(" ") }); }
    for (const dt of document.querySelectorAll("dt")) { if (!shown(dt)) continue; let dd = dt.nextElementSibling; while (dd && dd.tagName !== "DD") dd = dd.nextElementSibling; if (dd) rows.push({ label: text(dt), value: text(dd) }); }
    for (const box of document.querySelectorAll("[class*=item], [class*=row], li, p")) { if (!shown(box)) continue; const lab = box.querySelector("[class*=label], [class*=ttl], [class*=title], strong, b, span"); const val = box.querySelector("[class*=value], [class*=data], [class*=text], [class*=content]"); if (lab && val && lab !== val) rows.push({ label: text(lab), value: text(val) }); }
    // Only visible, editable inputs count: a hidden entry form behind a review section is not "still present".
    const vis = (el: Element | null) => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !(el as HTMLInputElement).disabled && !(el as HTMLInputElement).readOnly; };
    const nameInputsPresent = keys.some((k) => vis(k.id ? document.getElementById(k.id) : null) || (k.name ? Array.from(document.querySelectorAll(`input[name="${CSS.escape(k.name)}"], textarea[name="${CSS.escape(k.name)}"]`)).some(vis) : false));
    // Review instructions live in ordinary content elements. Keep short, visible, near-leaf texts only.
    // Candidates only; src/checkpoint.ts decides which texts count as a form-review instruction.
    const cueRe = /(確認|confirm|review)/i;
    const cues: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("p, div, li, td, th, span, legend, label, section, h5, h6")) {
      if (el.children.length > 2) continue;
      const t = text(el); if (!t || t.length > 160 || !cueRe.test(t)) continue;
      if (!shown(el)) continue;
      if (!cues.includes(t)) cues.push(t); if (cues.length >= 20) break;
    }
    return { urlChanged, nameInputsPresent, headings, bodyText: (document.body?.innerText ?? "").slice(0, 20000), rows: rows.slice(0, 200), cues };
  }, { keys, urlChanged });
}
