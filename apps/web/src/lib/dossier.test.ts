import { describe, expect, it } from "vitest";
import { dossierTimeline, isDossierType, parseDossier, setSection, updateDossier } from "./dossier";

const DOSSIER = `# Jonas Weber

> CTO bei Nordlicht Systems

## Stand der Dinge

Jonas prüft das Angebot.

## Offene Punkte

- Staffelpreise nachreichen
- [x] Erstgespräch führen
- [ ] Zeitplan abstimmen

## Eigene Notizen

Mag kurze Mails.

- und klare Zahlen
`;

describe("parseDossier", () => {
  it("reads the three sections in German and English", () => {
    expect(parseDossier(DOSSIER)).toEqual({
      state: "Jonas prüft das Angebot.",
      open: ["Staffelpreise nachreichen", "Zeitplan abstimmen"],
      own: "Mag kurze Mails.\n\n- und klare Zahlen",
      has: { state: true, open: true, own: true },
    });
    const en = parseDossier("## Where things stand:\nFine.\n### Detail\nMore.\n## Open points\n1. One\n## My notes\nMine");
    expect(en.state).toBe("Fine.\n### Detail\nMore.");
    expect(en.open).toEqual(["One"]);
    expect(en.own).toBe("Mine");
  });

  it("finds nothing in a plain note and ignores headings inside code", () => {
    const d = parseDossier("Nur Text.\n\n```\n## Stand der Dinge\n```\n");
    expect(d.has).toEqual({ state: false, open: false, own: false });
    expect(d.state).toBe("");
    expect(d.open).toEqual([]);
  });
});

describe("setSection", () => {
  it("replaces the body of an existing section and keeps the rest", () => {
    const next = setSection(DOSSIER, "state", "Angebot ist angenommen.", "de");
    expect(parseDossier(next).state).toBe("Angebot ist angenommen.");
    expect(parseDossier(next).own).toBe(parseDossier(DOSSIER).own);
    expect(parseDossier(next).open).toEqual(parseDossier(DOSSIER).open);
    expect(next.startsWith("# Jonas Weber\n\n> CTO bei Nordlicht Systems\n\n## Stand der Dinge\n\nAngebot ist angenommen.\n\n## Offene Punkte\n")).toBe(true);
  });

  it("inserts missing sections in order: under the title, before the user's notes", () => {
    const plain = "# Nordlicht Systems\n\n> Kunde seit Oktober\n\nFreier Text.\n";
    const withState = setSection(plain, "state", "Läuft.", "de");
    expect(withState).toBe("# Nordlicht Systems\n\n> Kunde seit Oktober\n\n## Stand der Dinge\n\nLäuft.\n\n## Eigene Notizen\n\nFreier Text.\n");

    const own = "## Eigene Notizen\n\nMeins.\n";
    expect(setSection(own, "open", "- A", "de")).toBe("## Offene Punkte\n\n- A\n\n## Eigene Notizen\n\nMeins.\n");
    expect(setSection("## Where things stand\n\nOk.\n\n## My notes\n\nMine.\n", "open", "- A", "en")).toBe(
      "## Where things stand\n\nOk.\n\n## Open points\n\n- A\n\n## My notes\n\nMine.\n",
    );
    expect(setSection("", "state", "Neu.", "de")).toBe("## Stand der Dinge\n\nNeu.\n");
  });
});

describe("updateDossier", () => {
  it("writes state and open points as plain bullets and never touches the user's notes", () => {
    const next = updateDossier(DOSSIER, { state: "Neu.", open: ["  Preise\nnachreichen ", "", "Termin"] }, "de");
    const d = parseDossier(next);
    expect(d.state).toBe("Neu.");
    expect(d.open).toEqual(["Preise nachreichen", "Termin"]);
    expect(d.own).toBe("Mag kurze Mails.\n\n- und klare Zahlen");
    expect(next).not.toContain("- [ ]");
    expect(updateDossier(DOSSIER, {}, "de")).toBe(DOSSIER);
  });

  it("builds a dossier out of a plain note", () => {
    const next = updateDossier("Notiz von mir.\n", { state: "Stand.", open: ["Punkt"] }, "en");
    expect(next).toBe("## Where things stand\n\nStand.\n\n## Open points\n\n- Punkt\n\n## My notes\n\nNotiz von mir.\n");
    expect(parseDossier(updateDossier(next, { state: "Anders." }, "en")).own).toBe("Notiz von mir.");
  });
});

describe("dossierTimeline", () => {
  it("merges meetings and mentions, newest first", () => {
    const e = (id: string, date: string, time = "") => ({ id, title: id, type: "note", date, time });
    expect(dossierTimeline([e("m1", "2026-11-05"), e("m2", "2026-11-10", "09:00")], [e("c", "2026-11-10", "14:00"), e("old", "2026-10-01")], 3).map((x) => x.id)).toEqual(["c", "m2", "m1"]);
  });
});

describe("isDossierType", () => {
  it("covers persons, companies and projects", () => {
    expect(["person", "organization", "project", "note", "concept"].map(isDossierType)).toEqual([true, true, true, false, false]);
  });
});
