import type { Identity } from "./types.js";

const common = {
  email: "test@example.com",
  phone: "09012345678",
  postal: "1500001",
  address: "東京都渋谷区神宮前1-1-1",
};

/** Baseline: a typical Japanese customer. Everything else in the battery keeps these contact details. */
export const baseline: Identity = {
  id: "baseline",
  tests: "Japanese name, kanji with katakana reading",
  fullName: "山田 太郎",
  familyName: "山田",
  givenName: "太郎",
  kanaFamily: "ヤマダ",
  kanaGiven: "タロウ",
  kanaFull: "ヤマダ タロウ",
  guidance: "n/a (control case)",
  ...common,
};

/**
 * Name-format test cases. These are test fixtures, not verified legal identities.
 * Labelled by the property they test. Contact details are identical to the baseline.
 */
export const battery: Identity[] = [
  {
    id: "latin-own",
    tests: "Latin letters only, no kanji, space between given and family name",
    fullName: "Marsel Bait",
    familyName: "Bait",
    givenName: "Marsel",
    kanaFamily: "バイト",
    kanaGiven: "マーセル",
    kanaFull: "マーセル バイト",
    guidance: "p.27: name fields accept multiple scripts incl. Latin letters",
    ...common,
  },
  {
    id: "long-name-spaces",
    tests: "Long name with two middle names and spaces",
    fullName: "Maria Clara Santos Dela Cruz",
    familyName: "Dela Cruz",
    givenName: "Maria Clara Santos",
    kanaFamily: "デラ クルス",
    kanaGiven: "マリア クララ サントス",
    kanaFull: "マリア クララ サントス デラ クルス",
    guidance: "p.27: sufficient max length; middle and compound names fit in one field",
    ...common,
  },
  {
    id: "single-name",
    tests: "Single name, no family name at all",
    fullName: "Sukarno",
    familyName: null,
    givenName: "Sukarno",
    kanaFamily: null,
    kanaGiven: "スカルノ",
    kanaFull: "スカルノ",
    guidance: "p.27: single full-name field accommodates names without a surname",
    ...common,
  },
  {
    id: "diacritics",
    tests: "Latin letters with diacritics",
    fullName: "Nguyễn Thị Hương",
    familyName: "Nguyễn",
    givenName: "Thị Hương",
    kanaFamily: "グエン",
    kanaGiven: "ティ フオン",
    kanaFull: "グエン ティ フオン",
    guidance: "p.27: multiple scripts accepted in name fields",
    ...common,
  },
  {
    id: "hyphen-compound",
    tests: "Hyphenated compound family name",
    fullName: "Ana García-López",
    familyName: "García-López",
    givenName: "Ana",
    kanaFamily: "ガルシア ロペス",
    kanaGiven: "アナ",
    kanaFull: "アナ ガルシア ロペス",
    guidance: "p.27: compound names and punctuation accepted",
    ...common,
  },
];

export function identityById(id: string): Identity | undefined {
  return id === "baseline" ? baseline : battery.find((b) => b.id === id);
}
