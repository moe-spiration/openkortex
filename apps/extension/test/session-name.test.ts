import { describe, expect, it } from "vitest";
import { autoSessionName } from "../src/lib/session-name";
import { buildSession } from "../src/lib/sessions";

describe("automatic session names", () => {
  it("names a topic the tabs share, with its sites", () => {
    expect(
      autoSessionName([
        { url: "https://www.youtube.com/watch?v=1", title: "Kubernetes Tutorial for Beginners - YouTube" },
        { url: "https://www.youtube.com/watch?v=2", title: "Kubernetes Networking explained - YouTube" },
        { url: "https://github.com/k/k", title: "kubernetes/kubernetes: Container Orchestration · GitHub" },
      ]),
    ).toBe("Kubernetes · YouTube, GitHub");
    expect(
      autoSessionName([
        { url: "https://www.amazon.de/x", title: "Amazon.de: Sony WH-1000XM5 Kopfhörer" },
        { url: "https://www.idealo.de/y", title: "Sony WH-1000XM5 ab 279 € | Preisvergleich bei idealo.de" },
      ]),
    ).toBe("Sony WH-1000XM5 · amazon.de, idealo.de");
  });

  it("names one site by its name and first page, mixed sites by the main ones", () => {
    expect(
      autoSessionName([
        { url: "https://github.com/moe/kortex", title: "moe/kortex · GitHub" },
        { url: "https://github.com/a/b/pull/2", title: "Fix bug · Pull Request #2 · a/b · GitHub" },
      ]),
    ).toBe("GitHub · moe/kortex +1");
    expect(autoSessionName([{ url: "https://a.dev/x", title: "A" }, { url: "https://b.dev/" }, { url: "https://c.dev/" }])).toBe("a.dev, b.dev +1");
  });

  it("uses the page title for a single tab and nothing without http tabs", () => {
    expect(autoSessionName([{ url: "https://x.dev/p", title: "Pricing plans - Xdev" }])).toBe("Pricing plans");
    expect(autoSessionName([{ url: "chrome://settings" }])).toBe("");
  });

  it("puts the automatic name into the saved title, a given name wins", () => {
    const now = new Date("2026-11-12T09:00:00Z");
    const tabs = [
      { url: "https://chefkoch.de/a", title: "Lasagne Rezept | Chefkoch" },
      { url: "https://chefkoch.de/b", title: "Vegane Lasagne | Chefkoch" },
    ];
    expect(buildSession(tabs, now).title).toBe("Lasagne · Chefkoch · Session 2026-11-12 09:00 (2 Tabs)");
    expect(buildSession(tabs, now, "Essen").title).toBe("Essen · Session 2026-11-12 09:00 (2 Tabs)");
  });
});
