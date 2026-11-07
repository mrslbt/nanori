import { describe, it, expect } from "vitest";
import { chromium } from "playwright";
import { pageModel } from "../src/agent/page.js";
import { recogniseCheckpoint } from "../src/checkpoint.js";

// Browser-level extraction: a pure PageModel test cannot see hidden DOM content. Needs Google Chrome installed.
describe("page model extraction in a real browser", () => {
  it("ignores hidden headings, hidden cues and hidden rows; a shipping step with a hidden future confirmation is not recognised", async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage();
    await page.setContent(`<h2 hidden>入力内容の確認</h2><p hidden>入力内容をご確認の上、送信してください。</p><h1>配送方法の選択</h1><p>配送先をご確認ください</p>
      <table><tr><th>氏名</th><td>山田 太郎</td></tr></table><table hidden><tr><th>備考</th><td>x</td></tr></table>`);
    const m = await pageModel(page, [{ name: "sei", id: null }], true);
    expect(m.headings).not.toContain("入力内容の確認");
    expect(m.headings).toContain("配送方法の選択");
    expect(m.cues).toEqual(["配送先をご確認ください"]);
    expect(m.rows).toEqual([{ label: "氏名", value: "山田 太郎" }]);
    expect(recogniseCheckpoint(m)).toBe("not_recognised");
    await page.setContent(`<h1>お問い合わせフォーム</h1><p>入力内容をご確認の上、よろしければ送信ボタンを押してください。</p><table><tr><th>氏名</th><td>山田 太郎</td></tr></table>`);
    const m2 = await pageModel(page, [{ name: "sei", id: null }], true);
    expect(recogniseCheckpoint(m2)).toBe("recognised");
    await browser.close();
  }, 30000);
});
