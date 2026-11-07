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
  it("no review heading, but a review instruction in a paragraph, the inputs gone and a name row shown: recognised (the hotel)", () => {
    expect(recogniseCheckpoint({ urlChanged: true, nameInputsPresent: false, headings: ["氏名", "フリガナ", "お問い合わせ"], bodyText: "", rows: [{ label: "氏名", value: "山田　太郎" }], cues: ["入力内容をご確認の上、よろしければ送信ボタンを押してください。"] })).toBe("recognised");
  });
  it("a shipping-method step with a read-only name summary and no review instruction: not recognised", () => {
    expect(recogniseCheckpoint({ urlChanged: true, nameInputsPresent: false, headings: ["配送方法の選択"], bodyText: "配送方法を選択してください", rows: [{ label: "氏名", value: "山田 太郎" }], cues: [] })).toBe("not_recognised");
  });
  it("a hidden review heading does not count: the browser never puts it in the model, and a generic instruction is not enough", () => {
    expect(recogniseCheckpoint({ urlChanged: true, nameInputsPresent: false, headings: ["配送方法の選択"], bodyText: "", rows: [{ label: "氏名", value: "山田 太郎" }], cues: ["配送先をご確認ください"] })).toBe("not_recognised");
    expect(recogniseCheckpoint({ urlChanged: true, nameInputsPresent: false, headings: ["在庫確認"], bodyText: "", rows: [{ label: "氏名", value: "山田 太郎" }], cues: [] })).toBe("not_recognised");
  });
  it("the demonstrated review screens still recognise: dental heading, clinic heading, finance paragraph", () => {
    expect(recogniseCheckpoint({ urlChanged: true, nameInputsPresent: false, headings: ["入力内容の確認"], bodyText: "", rows: [{ label: "お名前", value: "x" }] })).toBe("recognised");
    expect(recogniseCheckpoint({ urlChanged: true, nameInputsPresent: false, headings: ["3. 入力内容の確認"], bodyText: "", rows: [{ label: "お名前", value: "x" }] })).toBe("recognised");
    expect(recogniseCheckpoint({ urlChanged: false, nameInputsPresent: false, headings: ["クレジットカード お申込み"], bodyText: "", rows: [{ label: "お名前（漢字）", value: "x" }], cues: ["入力内容をご確認の上、よろしければ「申し込む」ボタンを押してください。"] })).toBe("not_recognised");
    expect(recogniseCheckpoint({ urlChanged: true, nameInputsPresent: false, headings: ["クレジットカード お申込み"], bodyText: "", rows: [{ label: "お名前（漢字）", value: "x" }], cues: ["入力内容をご確認の上、よろしければ「申し込む」ボタンを押してください。"] })).toBe("recognised");
  });
  it("a stray 確認 word is not a review instruction", () => {
    expect(recogniseCheckpoint({ urlChanged: true, nameInputsPresent: false, headings: ["配送方法の選択"], bodyText: "", rows: [{ label: "氏名", value: "山田 太郎" }], cues: ["在庫を確認中です"] })).toBe("not_recognised");
  });
  it("no review heading and the name inputs still present: not recognised even with a name row", () => {
    expect(recogniseCheckpoint({ urlChanged: true, nameInputsPresent: true, headings: ["氏名"], bodyText: "", rows: [{ label: "氏名", value: "山田 太郎" }] })).toBe("not_recognised");
  });
  it("no review heading and the URL did not change: not recognised", () => {
    expect(recogniseCheckpoint({ urlChanged: false, nameInputsPresent: false, headings: ["氏名"], bodyText: "", rows: [{ label: "氏名", value: "山田 太郎" }] })).toBe("not_recognised");
  });
  it("a URL change alone is not enough", () => {
    expect(recogniseCheckpoint({ urlChanged: true, nameInputsPresent: false, headings: ["エラー"], bodyText: "", rows: [] })).toBe("not_recognised");
  });
});

describe("name preservation", () => {
  it("a Latin name with only a kana row on the screen is unverified, not changed", () => {
    const m = review([{ label: "フリガナ", value: "マーセル バイト" }]);
    expect(checkNamePreserved(m, "Marsel Bait").status).toBe("unknown");
  });
  it("a reading with only a name row on the screen is unverified, not changed", () => {
    const m = review([{ label: "氏名", value: "Marsel Bait" }]);
    expect(checkNamePreserved(m, "マーセル バイト").status).toBe("unknown");
  });
  it("a corrupted 氏名 row is still a change for the Latin name typed into it (the hotel)", () => {
    const m = review([{ label: "氏名", value: "Nguy&#7877;n　Th&#7883; H&#432;&#417;ng" }, { label: "フリガナ", value: "グエン　ティ フオン" }]);
    const p = checkNamePreserved(m, "Nguyễn", undefined, ["Thị Hương"]);
    expect(p.status).toBe("differs");
    expect(p.shown).toContain("&#7877;");
    expect(checkNamePreserved(m, "グエン", undefined, ["ティ フオン"]).status).toBe("exact");
  });
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

describe("no unordered subset counts as exact", () => {
  const row = (v: string) => review([{ label: "お名前", value: v }]);
  it("an extra separate word is not exact", () => {
    expect(checkNamePreserved(row("Marsel Bait EXTRA"), "Marsel Bait").status).toBe("differs");
  });
  it("a changed order of a single typed value is not exact", () => {
    expect(checkNamePreserved(row("Bait Marsel"), "Marsel Bait").status).toBe("differs");
  });
  it("a missing component is not exact", () => {
    expect(checkNamePreserved(row("Marsel"), "Marsel Bait").status).toBe("differs");
  });
  it("a repeated component is not exact", () => {
    expect(checkNamePreserved(row("Marsel Bait Bait"), "Marsel Bait").status).toBe("differs");
  });
  it("separately typed family and given names may appear joined in one row, either order, nothing else", () => {
    expect(checkNamePreserved(row("山田 太郎"), "山田", undefined, ["太郎"]).status).toBe("exact");
    expect(checkNamePreserved(row("太郎 山田"), "山田", undefined, ["太郎"]).status).toBe("exact");
    expect(checkNamePreserved(row("山田 太郎 様"), "山田", undefined, ["太郎"]).status).toBe("differs");
  });
});
