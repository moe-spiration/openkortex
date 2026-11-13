import { describe, expect, it, vi } from "vitest";
import { withLocale } from "@kortex/i18n";
import { resolveLanguage } from "../src/i18n";
import { createApiClient } from "../src/lib/api";
import { describeFailure } from "../src/lib/errors";
import { applyLimits, fitTranscript } from "../src/lib/limits";
import { toastFor } from "../src/lib/page-toast";
import { tabCount } from "../src/lib/session-view";
import { DEFAULT_SETTINGS } from "../src/lib/settings";

describe("language", () => {
  it("an explicit choice wins, auto follows the browser (English as the fallback)", () => {
    expect(resolveLanguage("de")).toBe("de");
    expect(resolveLanguage("en")).toBe("en");
    expect(["en", "de"]).toContain(resolveLanguage("auto"));
    expect(resolveLanguage(undefined)).toBe(resolveLanguage("auto"));
    expect(DEFAULT_SETTINGS.language).toBe("auto");
  });

  it("the same text comes out in English and in German", () => {
    const failure = { ok: false as const, error: { code: "setup_required" as const, message: "" } };
    expect(describeFailure(failure).title).toBe("Noch nicht verbunden");
    expect(tabCount(2)).toBe("2 Tabs");
    withLocale("en", () => {
      expect(describeFailure(failure).title).toBe("Not connected yet");
      expect(toastFor(null).title).toBe("Page could not be read");
      expect(tabCount(1)).toBe("1 tab");
      expect(tabCount(2)).toBe("2 tabs");
    });
  });

  it("generated notes follow the language, numbers included", () => {
    const long = `### User\n\n${"x".repeat(400)}`;
    expect(fitTranscript(long, 200).value).toMatch(/> Hinweis: Export gekürzt \(Limit 200 Zeichen\)$/);
    withLocale("en", () => {
      expect(fitTranscript(long, 200).value).toMatch(/> Note: export shortened \(limit 200 characters\)$/);
      const fitted = applyLimits({
        kind: "note",
        client: { name: "kortex-extension", version: "0" },
        captured_at: "2026-11-11T00:00:00.000Z",
        title: "t".repeat(600),
        content_md: "x",
      });
      expect(fitted.notices).toEqual(["Title shortened to 500 characters"]);
    });
  });

  it("requests tell the server the language without a custom header (CORS preflight)", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, user_id: "u" }), { status: 200 }));
    const api = createApiClient({
      getSettings: async () => ({ ...DEFAULT_SETTINGS, baseUrl: "https://kortex.example.com", token: "kx_test", mockMode: false }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await api.ping();
    const headers = (fetchImpl.mock.calls[0] as unknown as [URL, RequestInit])[1].headers as Record<string, string>;
    expect(headers["Accept-Language"]).toBe("de");
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("x-kortex-locale");
  });
});
