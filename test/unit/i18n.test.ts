import { describe, expect, it } from "vitest";
import { en, zhCN } from "../../src/ui/i18n/dict";

/**
 * English is the source of truth; a locale that lags behind silently renders the
 * English string, which is how two hints on the sync page shipped untranslated.
 */
describe("ui dictionary", () => {
  const enKeys = Object.keys(en).sort();
  const zhKeys = Object.keys(zhCN).sort();

  it("has a Chinese entry for every English key", () => {
    expect(enKeys.filter((key) => !(key in zhCN))).toEqual([]);
  });

  it("has no Chinese key that English lost", () => {
    expect(zhKeys.filter((key) => !(key in en))).toEqual([]);
  });

  it("has no empty strings", () => {
    const empty = [...enKeys, ...zhKeys].filter((key) => !(en[key] ?? zhCN[key] ?? "").trim());
    expect([...new Set(empty)].sort()).toEqual([]);
  });

  it("keeps the same {{placeholders}} in both locales", () => {
    const slots = (text: string): string[] =>
      [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] as string).sort();

    const mismatched = enKeys.filter(
      (key) => key in zhCN && slots(en[key] as string).join() !== slots(zhCN[key] as string).join(),
    );
    expect(mismatched).toEqual([]);
  });
});
