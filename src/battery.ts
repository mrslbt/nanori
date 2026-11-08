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
  tests: "kanji name with its reading",
  label: "Kanji name, baseline",
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
 * Name-format test cases. Except for the creator's own name, they are sample inputs, not research participants
 * and not verified legal identities. No nationality, biography or job is attached to any of them.
 * Labelled by the property they test. Contact details are identical to the baseline.
 */
export const battery: Identity[] = [
  {
    id: "latin-own",
    tests: "Latin letters, no kanji; the creator's own name and reading as he uses them on Japanese forms",
    label: "Latin letters, creator's name",
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
    tests: "long full name, 28 characters including spaces",
    label: "Long full name, 28 characters",
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
    tests: "single name, no separate surname in this test",
    label: "Single name",
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
    tests: "letters with accents",
    label: "Letters with accents",
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
    tests: "accents and a hyphen (a failure here would not isolate the hyphen)",
    label: "Accents and a hyphen",
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

/**
 * The non-name scenario every case uses, so only the name (and its reading) varies between runs.
 * The agent is told to use these exact choices; the report records what was actually selected.
 */
export const scenario = {
  dateRule: "the first selectable date, and if a date must be typed, 2026年11月20日",
  timeRule: "the first available time option",
  choiceRule: "the first non-empty option in every select, and the first radio in every radio group",
  treatment: "虫歯",
  symptom: "歯が痛いです。",
  message: "nanoru による自動入力テストです。送信はしません。",
  optionalFields: "fill optional email and address fields with the contact data above; leave other optional fields empty",
  age: "35",
  birthDate: "1990年1月1日",
};

export function identityById(id: string): Identity | undefined {
  return id === "baseline" ? baseline : battery.find((b) => b.id === id);
}
