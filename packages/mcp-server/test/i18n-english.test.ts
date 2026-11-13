import { getLocale, withLocale } from "@kortex/i18n";
import { describe, expect, it } from "vitest";
import { localeOfAcceptLanguage, runWithLocale } from "../src/i18n";
import { renderConsentPage, renderErrorPage } from "../src/oauth/pages";

// The suite runs in German (test/setup.ts); this covers the English side and the per-request
// language of the HTTP server.

const page = () =>
  renderConsentPage({ clientName: "Claude", redirectUri: "https://claude.ai/cb", request: "signed" });

describe("language per request", () => {
  it("reads en and de from Accept-Language, nothing else", () => {
    expect(localeOfAcceptLanguage("en-US,en;q=0.9,de;q=0.8")).toBe("en");
    expect(localeOfAcceptLanguage("de-DE,de;q=0.9")).toBe("de");
    expect(localeOfAcceptLanguage(["fr-FR", "en"])).toBe("en");
    expect(localeOfAcceptLanguage("fr-FR,fr;q=0.9")).toBeUndefined();
    expect(localeOfAcceptLanguage(undefined)).toBeUndefined();
  });

  it("runWithLocale scopes the language to the request, also across awaits", async () => {
    expect(getLocale()).toBe("de");
    const [a, b] = await Promise.all([
      runWithLocale("en", async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getLocale();
      }),
      runWithLocale("de", async () => {
        await new Promise((r) => setTimeout(r, 1));
        return getLocale();
      }),
    ]);
    expect([a, b]).toEqual(["en", "de"]);
    // No language for the request: the process-wide one applies.
    expect(runWithLocale(undefined, () => getLocale())).toBe("de");
    expect(getLocale()).toBe("de");
  });
});

describe("OAuth pages", () => {
  it("are English for an English request and German for a German one", () => {
    const english = runWithLocale("en", page);
    expect(english).toContain('<html lang="en">');
    expect(english).toContain("<h1>Connect Kortex</h1>");
    expect(english).toContain("<strong>Claude</strong> wants to access your Second Brain.");
    expect(english).toContain(">Allow</button>");
    expect(english).toContain(">Deny</button>");
    // Enter in the password field presses the first submit button: that has to be Allow.
    expect(english.indexOf(">Allow</button>")).toBeLessThan(english.indexOf(">Deny</button>"));

    const german = page();
    expect(german).toContain('<html lang="de">');
    expect(german).not.toBe(english);
    expect(german).not.toContain("wants to access your Second Brain");

    expect(withLocale("en", () => renderErrorPage("x"))).toContain("<h1>That did not work</h1>");
    expect(renderErrorPage("x")).not.toContain("That did not work");
  });
});
