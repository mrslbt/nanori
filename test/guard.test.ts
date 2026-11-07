import { describe, it, expect } from "vitest";
import { isFinalAction, isReviewAdvance } from "../src/guard.js";

describe("submission guard", () => {
  it("blocks the Japanese final controls used on the demo form", () => {
    expect(isFinalAction({ text: "送信する" })).toBe(true);
    expect(isFinalAction({ text: "予約を確定する" })).toBe(true);
    expect(isFinalAction({ value: "送信" })).toBe(true);
  });
  it("allows the Japanese confirmation controls used on the demo form", () => {
    expect(isFinalAction({ value: "確認画面へ進む" })).toBe(false);
    expect(isReviewAdvance({ value: "確認画面へ進む" })).toBe(true);
    expect(isFinalAction({ text: "確認画面へ" })).toBe(false);
    expect(isFinalAction({ text: "次へ" })).toBe(false);
  });
  it("blocks English Send, Register, Complete registration, Book now", () => {
    for (const t of ["Send", "Register", "Complete registration", "Book now", "Submit", "Place order"]) expect(isFinalAction({ text: t })).toBe(true);
  });
  it("blocks an icon-only control whose accessible label is Send", () => {
    expect(isFinalAction({ text: "", ariaLabel: "Send" })).toBe(true);
    expect(isFinalAction({ text: "", title: "送信" })).toBe(true);
  });
  it("a final-action word wins over review wording in the same label", () => {
    expect(isFinalAction({ text: "入力内容を確認して送信" })).toBe(true);
    expect(isFinalAction({ text: "確認する（送信）" })).toBe(true);
    expect(isFinalAction({ text: "予約を確定" })).toBe(true);
    expect(isFinalAction({ text: "Review and submit" })).toBe(true);
    expect(isReviewAdvance({ text: "入力内容を確認して送信" })).toBe(false);
    expect(isFinalAction({ text: "確認する" })).toBe(false);
    expect(isFinalAction({ text: "入力内容を確認" })).toBe(false);
  });
  it("never clicks a control with no name at all", () => {
    expect(isFinalAction({ text: "" })).toBe(true);
  });
  it("a Next button is allowed as a review advance but is not a guarantee", () => {
    expect(isReviewAdvance({ text: "Next" })).toBe(true);
  });
});
