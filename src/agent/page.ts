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
        return { ref, label: null, name: null, requested, retained: "", maxlength: null, pattern: null, required: false, validationMessage: "element gone", ariaInvalid: false, visibleErrors: [] };
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
