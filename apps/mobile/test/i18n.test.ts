import { describe, expect, it } from "vitest";
import { withLocale } from "@kortex/i18n";
import { dueLabel, shortDay } from "../src/data/live";
import { chooseLocale, getLocale, localeHeader, LOCALE_KEY, restoreLocale, subscribeLocale, type LocaleStorage } from "../src/i18n";
import { greetingFor } from "../src/lib/greeting";
import { remindOptions } from "../src/lib/remind";

/* The tests run in German (test/setup.ts). These check the English side of the central helpers and the language storage. */

const memory = (start: Record<string, string> = {}): LocaleStorage & { data: Record<string, string> } => {
  const data = { ...start };
  return {
    data,
    getItem: async (k) => data[k] ?? null,
    setItem: async (k, v) => {
      data[k] = v;
    },
  };
};

describe("English and German texts", () => {
  const now = new Date(2026, 9, 22, 9, 0);

  it("greets in both languages", () => {
    expect(greetingFor("Max Muster")).toBe("Hi Max");
    expect(greetingFor(null)).toBe("Hallo");
    withLocale("en", () => {
      expect(greetingFor("Max Muster")).toBe("Hi Max");
      expect(greetingFor(null)).toBe("Hello");
    });
  });

  it("names days in both languages", () => {
    const iso = (d: number) => new Date(2026, 9, d, 8, 0).toISOString();
    expect([shortDay(iso(22), now), shortDay(iso(21), now), shortDay(iso(19), now), shortDay(iso(2), now)]).toEqual(["Heute", "Gestern", "Mo", "02.10."]);
    withLocale("en", () => {
      expect([shortDay(iso(22), now), shortDay(iso(21), now), shortDay(iso(19), now), shortDay(iso(2), now)]).toEqual(["Today", "Yesterday", "Mon", "10/02"]);
    });
  });

  it("labels due dates in both languages", () => {
    const dues = ["2026-10-20", "2026-10-22", "2026-10-23", "2026-11-05"];
    expect(dues.map((d) => dueLabel(d, now))).toEqual(["überfällig", "Heute", "Morgen", "05.11."]);
    withLocale("en", () => {
      expect(dues.map((d) => dueLabel(d, now))).toEqual(["overdue", "Today", "Tomorrow", "11/05"]);
    });
  });

  it("offers reminder times in both languages", () => {
    expect(remindOptions(now).map((o) => o.label)).toEqual(["Heute Abend", "Morgen", "Nächste Woche"]);
    withLocale("en", () => expect(remindOptions(now).map((o) => o.label)).toEqual(["This evening", "Tomorrow", "Next week"]));
  });
});

describe("language on the device", () => {
  it("sends the language in use with requests", () => {
    expect(localeHeader()).toEqual({ "X-Kortex-Locale": "de" });
    withLocale("en", () => expect(localeHeader()).toEqual({ "X-Kortex-Locale": "en" }));
  });

  it("stores a choice, tells listeners and restores it", async () => {
    const storage = memory();
    let calls = 0;
    const off = subscribeLocale(() => calls++);
    try {
      expect(await chooseLocale(storage, "en")).toBe("en");
      expect(getLocale()).toBe("en");
      expect(storage.data[LOCALE_KEY]).toBe("en");
      expect(calls).toBe(1);
      expect(await restoreLocale(memory({ [LOCALE_KEY]: "de" }))).toBe("de");
      expect(calls).toBe(2);
    } finally {
      off();
      await chooseLocale(memory(), "de");
    }
  });

  it("keeps the language in use when nothing valid is stored", async () => {
    expect(await restoreLocale(memory())).toBe("de");
    expect(await restoreLocale(memory({ [LOCALE_KEY]: "fr" }))).toBe("de");
  });
});
