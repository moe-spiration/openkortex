import { describe, expect, it } from "vitest";
import type { Tab } from "@/lib/shell/prefs";
import { NEW_NOTE_PICK_TEMPLATE, takeNewNotePrefill, writeNewNotePrefill } from "@/lib/shell/new-note";
import {
  NOTE_TEMPLATES,
  applyTemplate,
  hasContent,
  initialDraft,
  newNotePath,
  noteSlug,
  promoteNewNoteTab,
  renameNoteTab,
  templateById,
} from "./new-note";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

const tabs: Tab[] = [
  { key: "home", label: "Home", icon: "home", href: "/home" },
  { key: "note:new", label: "Ohne Titel", icon: "file-plus", href: "/notes/new" },
  { key: "note:n2", label: "Andere", icon: "i-note", href: "/notes/n2" },
];

describe("new-note editor helpers", () => {
  it("takes the prefill exactly once", () => {
    const s = mem();
    writeNewNotePrefill({ title: "Idee", body: "Text" }, s, 1000);
    const first = initialDraft(takeNewNotePrefill(s, 1500));
    expect(first).toEqual({ title: "Idee", body: "Text" });
    expect(initialDraft(takeNewNotePrefill(s, 1600))).toEqual({ title: "", body: "" });
  });

  it("preselects a template from the prefill, or opens the template menu (\"Aus Vorlage …\")", () => {
    const s = mem();
    writeNewNotePrefill({ title: "Kickoff", template: "meeting" }, s, 1000);
    const d = initialDraft(takeNewNotePrefill(s, 1100));
    expect(d.template).toBe("meeting");
    expect(d.title).toBe("Kickoff");
    expect(d.body).toBe(templateById("meeting").body);
    expect(initialDraft({ body: "Mein Text", template: "brief" }).body).toBe(templateById("brief").body.trimEnd() + "\n\nMein Text");
    writeNewNotePrefill({ template: NEW_NOTE_PICK_TEMPLATE }, s, 2000);
    expect(initialDraft(takeNewNotePrefill(s, 2100))).toEqual({ title: "", body: "", pickTemplate: true });
    expect(initialDraft({ template: "unbekannt" })).toEqual({ title: "", body: "" });
  });

  it("has the five templates of the dummy", () => {
    expect(NOTE_TEMPLATES.map((t) => t.label)).toEqual(["Leere Notiz", "Meeting-Notiz", "Tagesnotiz (heute)", "Projekt-Brief", "Lesenotiz"]);
    expect(templateById("meeting").body).toContain("- [ ] ");
  });

  it("puts a template in front of typed text and never drops it", () => {
    // W-18: "Tagesnotiz" opens the day's daily note instead of filling the draft.
    expect(templateById("daily").opens).toBe("daily-note");
    expect(applyTemplate("Text", templateById("daily"))).toBe("Text");
    expect(applyTemplate("Schon da.", templateById("brief"))).toBe("## Ziel\n\n## Warum jetzt\n\n## Erfolg heißt\n\n## Risiken\n\nSchon da.");
    expect(applyTemplate("Schon da.", templateById("blank"))).toBe("Schon da.");
  });

  it("shows the vault path of the new file", () => {
    expect(noteSlug("")).toBe("ohne-titel");
    expect(noteSlug("  Größe & Preis: Q4!  ")).toBe("größe-preis-q4");
    expect(newNotePath("App monetarisieren")).toBe("10_Notes/app-monetarisieren.md");
  });

  it("saves only drafts with content", () => {
    expect(hasContent({ title: " ", body: "\n" })).toBe(false);
    expect(hasContent({ title: "T", body: "" })).toBe(true);
    expect(hasContent({ title: "", body: "/" })).toBe(false);
    expect(hasContent({ title: "", body: "/aufg" })).toBe(false);
    expect(hasContent({ title: "", body: "Text /x" })).toBe(true);
  });

  it("turns the 'Ohne Titel' tab into the note's tab in place", () => {
    const next = promoteNewNoteTab(tabs, { id: "x1", title: "Neue Idee", href: "/notes/x1", icon: "i-note" });
    expect(next.map((t) => t.key)).toEqual(["home", "note:x1", "note:n2"]);
    expect(next[1]).toEqual({ key: "note:x1", label: "Neue Idee", icon: "i-note", href: "/notes/x1" });
    // No new-note tab: append once.
    const appended = promoteNewNoteTab(tabs.filter((t) => t.key !== "note:new"), { id: "x1", title: "", href: "/notes/x1", icon: "i-note" });
    expect(appended.at(-1)).toMatchObject({ key: "note:x1", label: "Ohne Titel" });
    expect(promoteNewNoteTab(appended, { id: "x1", title: "", href: "/notes/x1", icon: "i-note" })).toBe(appended);
  });

  it("renames the note's tab with the title", () => {
    const next = renameNoteTab(tabs, "n2", "Umbenannt");
    expect(next[2]!.label).toBe("Umbenannt");
    expect(renameNoteTab(next, "n2", "Umbenannt")).toBe(next);
    expect(renameNoteTab(tabs, "nope", "x")).toBe(tabs);
  });
});
