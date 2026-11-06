import { describe, it, expect } from "vitest";
import { classifyField } from "../src/scan.js";
import type { ElementInfo } from "../src/types.js";
const el = (p: Partial<ElementInfo>): ElementInfo => ({ ref: "n1", tag: "input", type: "text", name: null, id: null, label: null, placeholder: null, text: null, required: false, maxlength: null, pattern: null, value: "", ...p });
describe("classifyField", () => {
  it("maps Japanese labels to roles", () => {
    expect(classifyField(el({ label: "姓" }))).toBe("family");
    expect(classifyField(el({ label: "名" }))).toBe("given");
    expect(classifyField(el({ label: "お名前" }))).toBe("full");
    expect(classifyField(el({ label: "セイ（全角カタカナ）" }))).toBe("kana_family");
    expect(classifyField(el({ label: "メイ" }))).toBe("kana_given");
    expect(classifyField(el({ label: "フリガナ" }))).toBe("kana_full");
  });
  it("ignores company, subject and email fields", () => {
    expect(classifyField(el({ label: "会社名" }))).toBeNull();
    expect(classifyField(el({ label: "件名" }))).toBeNull();
    expect(classifyField(el({ label: "メールアドレス", type: "email" }))).toBeNull();
  });
  it("uses name/id when there is no label", () => {
    expect(classifyField(el({ name: "your-name" }))).toBe("full");
    expect(classifyField(el({ id: "seikana" }))).toBe("kana_family");
  });
});
import { toHiragana, kanaScript } from "../src/scan.js";
describe("kana script", () => {
  it("converts katakana to hiragana keeping spaces and long vowel marks", () => {
    expect(toHiragana("マーセル バイト")).toBe("まーせる ばいと");
  });
  it("picks hiragana for ふりがな and katakana for フリガナ", () => {
    expect(kanaScript(el({ label: "ふりがな" }))).toBe("hiragana");
    expect(kanaScript(el({ label: "フリガナ" }))).toBe("katakana");
    expect(kanaScript(el({ label: "お名前（ふりがな）", placeholder: "例）やまもと　たろう" }))).toBe("hiragana");
    expect(kanaScript(el({ label: "セイ（全角カタカナ）" }))).toBe("katakana");
  });
});
