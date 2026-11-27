import { describe, expect, it } from "vitest";
import { isDossierType, readDossier } from "../src/lib/dossier";

describe("readDossier", () => {
  it("reads the three sections in German and keeps the rest", () => {
    const md = ["# Jonas Weber", "", "CTO at Nordlicht.", "", "## Stand der Dinge", "", "Prüft das Angebot.", "", "## Offene Punkte", "", "- Staffelpreise", "- [x] Erledigt", "1. Zeitplan Phase 2", "", "## Eigene Notizen", "", "Mag kurze Mails."].join("\n");
    const d = readDossier(md);
    expect(d.state).toBe("Prüft das Angebot.");
    expect(d.open).toEqual(["Staffelpreise", "Zeitplan Phase 2"]);
    expect(d.own).toBe("Mag kurze Mails.");
    expect(d.rest).toBe("CTO at Nordlicht.");
  });

  it("reads English headings and returns empty parts when sections are missing", () => {
    const d = readDossier("## Where things stand:\n\nWaiting for the offer.\n");
    expect(d.state).toBe("Waiting for the offer.");
    expect(d.open).toEqual([]);
    expect(d.own).toBe("");
    expect(d.rest).toBe("");
  });

  it("ignores headings inside code fences", () => {
    const d = readDossier("```\n## Offene Punkte\n- x\n```\n");
    expect(d.open).toEqual([]);
  });

  it("knows the dossier types", () => {
    expect(isDossierType("person")).toBe(true);
    expect(isDossierType("project")).toBe(true);
    expect(isDossierType("note")).toBe(false);
    expect(isDossierType(undefined)).toBe(false);
  });
});
