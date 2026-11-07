import { describe, it, expect } from "vitest";
import { mergeFindings } from "../src/findings.js";
import type { Finding } from "../src/types.js";

const f = (p: Partial<Finding>): Finding => ({ id: "F", identity: "diacritics", stepIndex: 14, field: "", kind: "altered", requested: "", retained: "", errorText: "", classification: "site_defect", guidance: "analogy", guidanceRef: "", observation: "", relevance: "", basis: "", cause: "", fix: "", screenshot: "", reviewState: "proposed", ...p });

describe("mergeFindings", () => {
  it("merges two typed name fields shown in the same corrupted review row into one finding", () => {
    const a = f({ id: "F1", field: "NameSei (review row 氏名)", requested: "Nguyễn", retained: "Nguy&#7877;n Th&#7883;" });
    const b = f({ id: "F2", field: "NameMei (review row 氏名)", requested: "Thị Hương", retained: "Nguy&#7877;n Th&#7883;" });
    const m = mergeFindings([a, b]);
    expect(m).toHaveLength(1);
    expect(m[0].components).toEqual([{ field: "NameSei", requested: "Nguyễn" }, { field: "NameMei", requested: "Thị Hương" }]);
    expect(m[0].requested).not.toContain("/");
    expect(m[0].field).toBe("氏名 (review row)");
  });
  it("is idempotent: merging an already-merged finding keeps its components", () => {
    const a = f({ id: "F1", field: "NameSei (review row 氏名)", requested: "Nguyễn", retained: "x" });
    const b = f({ id: "F2", field: "NameMei (review row 氏名)", requested: "Thị Hương", retained: "x" });
    const once = mergeFindings([a, b]); const twice = mergeFindings(once);
    expect(twice).toEqual(once);
  });
  it("keeps findings apart when the row text, step, kind or case differs", () => {
    const a = f({ id: "F1", field: "sei (review row 氏名)", retained: "x" });
    const b = f({ id: "F2", field: "mei (review row 氏名)", retained: "y" });
    const c = f({ id: "F3", field: "mei (review row 氏名)", retained: "x", identity: "single-name" });
    const d = f({ id: "F4", field: "mei", retained: "x" });
    expect(mergeFindings([a, b, c, d])).toHaveLength(4);
  });
});
