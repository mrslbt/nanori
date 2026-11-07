import { describe, it, expect } from "vitest";
import { compareRows } from "../src/compare.js";

const base = [{ label: "メールアドレス", value: "test@example.com" }, { label: "携帯電話番号", value: "09012345678" }, { label: "規約への同意", value: "同意する" }];

describe("compareRows", () => {
  it("matches identical row sets", () => { expect(compareRows(base, [...base]).status).toBe("match"); });
  it("a missing row prevents a match", () => { const r = compareRows(base, base.slice(1)); expect(r.status).toBe("coverage_differs"); expect((r as any).missing).toEqual(["メールアドレス"]); });
  it("an extra row prevents a match", () => { const r = compareRows(base, [...base, { label: "年会費", value: "10000円" }]); expect(r.status).toBe("coverage_differs"); expect((r as any).extra).toEqual(["年会費"]); });
  it("no non-name rows at all is no evidence, not a match", () => { expect(compareRows(base, []).status).toBe("coverage_differs"); expect(compareRows([], []).status).toBe("no_rows"); });
  it("a changed value is reported with both values", () => { const r = compareRows(base, [{ ...base[0] }, { label: "携帯電話番号", value: "08000000000" }, base[2]]); expect(r.status).toBe("values_differ"); expect((r as any).diffs[0]).toEqual({ label: "携帯電話番号", base: "09012345678", got: "08000000000" }); });
  it("duplicate labels are compared by position", () => { const d = [{ label: "備考", value: "a" }, { label: "備考", value: "b" }]; expect(compareRows(d, [{ label: "備考", value: "a" }, { label: "備考", value: "b" }]).status).toBe("match"); expect(compareRows(d, [{ label: "備考", value: "b" }, { label: "備考", value: "a" }]).status).toBe("values_differ"); expect(compareRows(d, [{ label: "備考", value: "a" }]).status).toBe("coverage_differs"); });
});
