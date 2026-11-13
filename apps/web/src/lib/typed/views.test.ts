import { describe, expect, it } from "vitest";
import { latestSessions, promptVariables, sessionTabs } from "./views";

describe("prompt variables", () => {
  it("reads {{vars}} from the text and metadata, in order, once", () => {
    expect(promptVariables("Schreib an {{ name }} über {{thema}}. Gruß an {{name}}", { variables: ["ton", "thema"] })).toEqual(["name", "thema", "ton"]);
    expect(promptVariables("Kein Platzhalter")).toEqual([]);
  });
});

describe("session tabs", () => {
  it("uses metadata.tabs, drops duplicates and non-web links", () => {
    const tabs = sessionTabs({
      tabs: [
        { url: "https://www.example.com/a", title: "A" },
        { url: "https://www.example.com/a" },
        { url: "javascript:alert(1)" },
        { url: "https://kortex.dev/b" },
      ],
    });
    expect(tabs).toEqual([
      { url: "https://www.example.com/a", title: "A" },
      { url: "https://kortex.dev/b", title: "kortex.dev" },
    ]);
  });

  it("lists the newest sessions with tabs first", () => {
    const s = (id: string, date: string, tabs: unknown[], dbType = "session") => ({ id, dbType, date, time: "10:00", metadata: { tabs }, contentMd: "" });
    const out = latestSessions(
      [
        s("old", "2026-10-01", [{ url: "https://a.de" }]),
        s("new", "2026-10-30", [{ url: "https://b.de" }]),
        s("empty", "2026-10-31", []),
        s("note", "2026-10-31", [{ url: "https://c.de" }], "note"),
      ],
      2,
    );
    expect(out.map((x) => x.item.id)).toEqual(["new", "old"]);
    expect(out[0]!.tabs).toEqual([{ url: "https://b.de", title: "b.de" }]);
  });

  it("falls back to the Markdown links of the body", () => {
    expect(sessionTabs({}, "- [Docs](https://docs.x.io/start)\n- [Bad](file:///c:/x)")).toEqual([{ url: "https://docs.x.io/start", title: "Docs" }]);
  });
});
