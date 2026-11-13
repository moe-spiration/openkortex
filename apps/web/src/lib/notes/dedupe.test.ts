import { describe, expect, it } from "vitest";
import { joinDisplay, normalizeForCompare, rebaseDisplay, splitForDisplay } from "./dedupe";

const opts = { title: "Local-First Software", summary: "Daten gehören dem Nutzer." };
const roundtrip = (md: string, o = opts) => {
  const s = splitForDisplay(md, o);
  expect(s.frontmatter + s.hidden + s.body).toBe(md);
  expect(joinDisplay(s, s.body)).toBe(md);
  return s;
};

describe("display dedupe (decision 4: hide in the view, keep in the file)", () => {
  it("hides a matching H1 and a TL;DR paragraph, keeps them verbatim", () => {
    const md = "# Local-First Software\n\n**TL;DR:** Daten gehören dem Nutzer.\n\nErster Absatz.\n\n## Notizen\n";
    const s = roundtrip(md);
    expect(s.body).toBe("Erster Absatz.\n\n## Notizen\n");
    expect(s.hidden).toBe("# Local-First Software\n\n**TL;DR:** Daten gehören dem Nutzer.\n\n");
    expect(s.hiddenTitle && s.hiddenSummary).toBe(true);
  });

  it("re-attaches the hidden head in front of an edited body", () => {
    const md = "# Local-First Software\n\n> **TL;DR:** Kurz.\n\nAlt.\n";
    const s = splitForDisplay(md, opts);
    expect(s.body).toBe("Alt.\n");
    expect(joinDisplay(s, "Neu.\n\n- [ ] Aufgabe\n")).toBe("# Local-First Software\n\n> **TL;DR:** Kurz.\n\nNeu.\n\n- [ ] Aufgabe\n");
    // An emptied body still keeps title and summary.
    expect(joinDisplay(s, "")).toBe("# Local-First Software\n\n> **TL;DR:** Kurz.\n\n");
  });

  it("keeps frontmatter in front and out of the view", () => {
    const md = "---\nid: 1\ntitle: x\n---\n# Local-First Software\n\nText.\n";
    const s = roundtrip(md);
    expect(s.frontmatter).toBe("---\nid: 1\ntitle: x\n---\n");
    expect(s.body).toBe("Text.\n");
    expect(joinDisplay(s, "Mehr.")).toBe("---\nid: 1\ntitle: x\n---\n# Local-First Software\n\nMehr.");
  });

  it("no H1: only a leading summary paragraph is hidden (by label or equal to the summary)", () => {
    const a = roundtrip("Zusammenfassung: Daten gehören dem Nutzer.\n\nText.");
    expect(a.body).toBe("Text.");
    expect(a.hiddenTitle).toBe(false);
    const b = roundtrip("Daten gehören dem *Nutzer*\n\nText.");
    expect(b.hiddenSummary).toBe(true);
    expect(b.body).toBe("Text.");
    const c = roundtrip("Ein ganz normaler Anfang.\n\n**TL;DR:** später.\n");
    expect(c.hidden).toBe("");
    expect(c.body).toBe("Ein ganz normaler Anfang.\n\n**TL;DR:** später.\n");
  });

  it("a different H1 stays visible, and so does everything after it", () => {
    const md = "# Ganz anderer Titel\n\n**TL;DR:** Daten gehören dem Nutzer.\n\nText.\n";
    const s = roundtrip(md);
    expect(s.hidden).toBe("");
    expect(s.body).toBe(md);
  });

  it("several paragraphs: only the first one after the title can be the summary", () => {
    const md = "# Local-First Software\n\nErster Absatz,\nzweite Zeile.\n\n**TL;DR:** Daten gehören dem Nutzer.\n\nDritter.";
    const s = roundtrip(md);
    expect(s.hiddenTitle).toBe(true);
    expect(s.hiddenSummary).toBe(false);
    expect(s.body).toBe("Erster Absatz,\nzweite Zeile.\n\n**TL;DR:** Daten gehören dem Nutzer.\n\nDritter.");
  });

  it("already removed (or never there): nothing is hidden and the text is unchanged", () => {
    const md = "Text ohne Kopf.\n\n## Abschnitt\n";
    const s = roundtrip(md);
    expect(s.hidden).toBe("");
    expect(s.body).toBe(md);
    expect(joinDisplay(s, "x")).toBe("x");
    expect(roundtrip("").body).toBe("");
  });

  it("never hides lists, headings or callouts that sit where a summary could be", () => {
    expect(roundtrip("# Local-First Software\n\n- Daten gehören dem Nutzer.\n").hiddenSummary).toBe(false);
    expect(roundtrip("# Local-First Software\n\n> [!note] TL;DR: x\n").hiddenSummary).toBe(false);
    expect(roundtrip("# Local-First Software\n\n## Daten gehören dem Nutzer.\n").hiddenSummary).toBe(false);
  });

  it("handles a title-only note, CRLF line ends and a closing-hash H1", () => {
    expect(roundtrip("# Local-First Software").body).toBe("");
    const crlf = roundtrip("# Local-First Software\r\n\r\n**TL;DR:** x\r\n\r\nText\r\n");
    expect(crlf.body).toBe("Text\r\n");
    expect(roundtrip("# Local-First Software ##\n\nText").body).toBe("Text");
  });

  it("compares titles without emphasis, case or trailing punctuation", () => {
    expect(normalizeForCompare("**Local-First** Software!")).toBe(normalizeForCompare("local-first   software"));
  });

  it("rebase keeps the hidden head stable while the body is edited", () => {
    const md = "# Local-First Software\n\nAlt.";
    const first = splitForDisplay(md, opts);
    // The user's new first paragraph looks like a summary: it must stay visible.
    const edited = joinDisplay(first, "**TL;DR:** selbst geschrieben\n\nAlt.");
    const next = rebaseDisplay(edited, first, opts);
    expect(next.body).toBe("**TL;DR:** selbst geschrieben\n\nAlt.");
    expect(next.hidden).toBe(first.hidden);
    // Nothing hidden before: stays that way while typing.
    const plain = splitForDisplay("Text", opts);
    expect(rebaseDisplay("# Local-First Software\n\nText", plain, opts).body).toBe("# Local-First Software\n\nText");
    // Head changed elsewhere: split anew.
    expect(rebaseDisplay("Neu.", first, opts)).toMatchObject({ hidden: "", body: "Neu." });
    expect(rebaseDisplay(md, null, opts).body).toBe("Alt.");
  });
});
