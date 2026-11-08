import { describe, it, expect } from "vitest";
import { checkField, patternRejects, describeStringShape } from "../src/checks/index.js";
import type { FieldObservation } from "../src/types.js";

const base: FieldObservation = {
  ref: "n1", label: "セイ", name: "seikana", id: "seikana", requested: "マリア クララ", retained: "マリア クララ",
  maxlength: null, pattern: null, required: true, validationMessage: "", ariaInvalid: false, visibleErrors: [],
};

describe("checkField", () => {
  it("accepts when nothing changed and no error", () => {
    expect(checkField(base).kind).toBe("accepted");
  });
  it("reports rejection from visible error text", () => {
    const r = checkField({ ...base, visibleErrors: ["セイは全角カタカナで入力してください"], ariaInvalid: true });
    expect(r.kind).toBe("rejected");
    expect(r.detail).toContain("カタカナ");
  });
  it("reports rejection from native validationMessage", () => {
    expect(checkField({ ...base, validationMessage: "Please match the requested format." }).kind).toBe("rejected");
  });
  it("detects silent truncation by maxlength", () => {
    const r = checkField({ ...base, requested: "Maria Clara Santos", retained: "Maria Clar", maxlength: 10 });
    expect(r.kind).toBe("truncated");
    expect(r.detail).toContain("maxlength=10");
  });
  it("detects alteration that is not a prefix", () => {
    expect(checkField({ ...base, requested: "García", retained: "Garcia" }).kind).toBe("altered");
  });
  it("accepted name is not a rejection just because the field is required", () => {
    expect(checkField({ ...base, required: true }).kind).toBe("accepted");
  });
});

describe("patternRejects", () => {
  it("katakana-only pattern rejects a space", () => {
    expect(patternRejects("[ァ-ヶー]+", "マリア クララ")).toBe(true);
    expect(patternRejects("[ァ-ヶー]+", "マリア")).toBe(false);
  });
  it("returns null without a pattern", () => {
    expect(patternRejects(null, "x")).toBeNull();
  });
});

describe("describeStringShape", () => {
  it("names the properties that matter", () => {
    const s = describeStringShape("Ana García-López");
    expect(s).toContain("contains a space");
    expect(s).toContain("contains a hyphen");
    expect(s).toContain("contains letters with diacritics");
  });
});

describe("required_empty", () => {
  it("an error on a field the agent left empty is reported as required_empty, not rejected", () => {
    const r = checkField({ ...base, requested: "", retained: "", visibleErrors: ["名を入力してください"], ariaInvalid: true });
    expect(r.kind).toBe("required_empty");
  });
});

describe("nanoru diagnostics are not site errors", () => {
  it("a checkpoint note is reported with source nanoru, never as a site rejection", () => {
    const r = checkField({ ...base, requested: "Nguyễn Thị Hương", retained: "Nguy", diagnostic: { kind: "checkpoint_truncated", note: "prefix match" } });
    expect(r.kind).toBe("truncated");
    expect(r.source).toBe("nanoru");
  });
  it("a missing value is not_verified, not rejected", () => {
    const r = checkField({ ...base, requested: "x y", retained: "", diagnostic: { kind: "checkpoint_missing", note: "not found" } });
    expect(r.kind).toBe("not_verified");
  });
});
