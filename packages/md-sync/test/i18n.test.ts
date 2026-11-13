import { getLocale, setLocale, t, withLocale } from "@kortex/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { applyUserLocale, loadUserLocale } from "../src/i18n";

// The suite runs in German (test/setup.ts); the daemon itself takes the account's language.

const client = (result: { data: unknown; error: { message: string } | null } | Error) => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => {
          if (result instanceof Error) throw result;
          return result;
        },
      }),
    }),
  }),
});
const row = (locale: unknown) => client({ data: { locale }, error: null });

afterEach(() => setLocale("de"));

describe("account language", () => {
  it("reads en and de from user_settings.locale, nothing else", async () => {
    expect(await loadUserLocale(row("de"), "u")).toBe("de");
    expect(await loadUserLocale(row("en"), "u")).toBe("en");
    expect(await loadUserLocale(row("fr"), "u")).toBeUndefined();
    expect(await loadUserLocale(client({ data: null, error: null }), "u")).toBeUndefined();
    expect(await loadUserLocale(client({ data: null, error: { message: "no column" } }), "u")).toBeUndefined();
    expect(await loadUserLocale(client(new Error("offline")), "u")).toBeUndefined();
  });

  it("applyUserLocale sets the process language, English without a stored value", async () => {
    expect(await applyUserLocale(row("de"), "u")).toBe("de");
    expect(getLocale()).toBe("de");
    expect(await applyUserLocale(client({ data: null, error: null }), "u")).toBe("en");
    expect(getLocale()).toBe("en");
  });

  it("messages exist in both languages", () => {
    const msg = () => t("on {host}", { host: "nas" });
    expect(withLocale("en", msg)).toBe("on nas");
    expect(msg()).not.toBe("on nas");
    expect(msg()).toContain("nas");
  });
});
