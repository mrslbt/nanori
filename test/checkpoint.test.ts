import { describe, it, expect } from "vitest";
import { recogniseCheckpoint, checkNamePreserved, type PageModel } from "../src/checkpoint.js";

const review = (rows: PageModel["rows"], extra: Partial<PageModel> = {}): PageModel => ({ urlChanged: true, nameInputsPresent: false, headings: ["入力内容の確認"], bodyText: rows.map((r) => r.label + " " + r.value).join("\n"), rows, ...extra });

describe("checkpoint recognition", () => {
  it("an entry form with a live name preview and a Next button is not a review screen", () => {
    const m: PageModel = { urlChanged: false, nameInputsPresent: true, headings: ["お客様情報の入力"], bodyText: "プレビュー: Marsel Bait 次へ", rows: [{ label: "プレビュー", value: "Marsel Bait" }] };
    expect(recogniseCheckpoint(m)).toBe("not_recognised");
  });
  it("a review heading with the inputs gone is recognised", () => {
    expect(recogniseCheckpoint(review([{ label: "お名前", value: "Marsel Bait" }]))).toBe("recognised");
  });
  it("a URL change alone is not enough", () => {
    expect(recogniseCheckpoint({ urlChanged: true, nameInputsPresent: false, headings: ["エラー"], bodyText: "", rows: [] })).toBe("not_recognised");
  });
});

describe("name preservation", () => {
  it("a name shown with XYZ appended is not exact", () => {
    const m = review([{ label: "お名前", value: "Marsel BaitXYZ" }, { label: "ふりがな", value: "まーせる ばいとXYZ" }]);
    expect(checkNamePreserved(m, "Marsel Bait").status).toBe("differs");
  });
  it("exact value in the labelled row is exact, full-width space tolerated", () => {
    expect(checkNamePreserved(review([{ label: "お名前", value: "山田　太郎" }]), "山田 太郎").status).toBe("exact");
  });
  it("no labelled name row means unknown, not verified", () => {
    expect(checkNamePreserved(review([{ label: "電話番号", value: "0901" }]), "Marsel Bait").status).toBe("unknown");
  });
  it("substring elsewhere on the page does not count", () => {
    const m = review([{ label: "お名前", value: "Maria Clar" }], { bodyText: "footer mentions Maria Clara Santos Dela Cruz" });
    expect(checkNamePreserved(m, "Maria Clara Santos Dela Cruz").status).toBe("differs");
  });
});

describe("reading rows", () => {
  it("a typed reading is matched against the furigana row, not the kanji row", () => {
    const m = review([{ label: "必須お名前", value: "山田 太郎" }, { label: "必須ふりがな", value: "やまだ たろう" }]);
    expect(checkNamePreserved(m, "やまだ たろう").status).toBe("exact");
    expect(checkNamePreserved(m, "山田 太郎").status).toBe("exact");
  });
});
