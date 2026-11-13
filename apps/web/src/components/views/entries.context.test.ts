import { describe, expect, it } from "vitest";
import { NOTES } from "@/lib/workspace-data";
import { noteEntry } from "./entries";
import { objectTable } from "./objectRows";

/* Card context (Tactile Craft v2): only real fields, nothing invented. */
describe("noteEntry context", () => {
  const base = NOTES[0]!;

  it("reads source, length, progress and status of a live item", () => {
    const e = noteEntry({
      ...base,
      id: "live-video-1",
      links: [],
      actionItems: [],
      source: { url: "https://www.youtube.com/watch?v=1" },
      metadata: { duration_sec: 2530 },
      status: "processed",
      readingState: { progress: 0.6 },
    });
    expect(e.domain).toBe("youtube.com");
    expect(e.length).toEqual({ label: "42:10", clock: true });
    expect(e.progress).toBe(0.6);
    expect(e.status).toEqual({ label: "Gelesen 60 %", tone: "run" });
    expect(e.tasks).toBeUndefined();
    expect(e.objects).toBeUndefined();
  });

  it("leaves everything out the item does not carry", () => {
    const e = noteEntry({ ...base, id: "live-plain", links: [], actionItems: [] });
    expect(e).not.toHaveProperty("domain");
    expect(e).not.toHaveProperty("length");
    expect(e).not.toHaveProperty("status");
  });

  it("counts the item's tasks and links objects in both directions (mock)", () => {
    const n2 = NOTES.find((n) => n.id === "n2")!;
    const e = noteEntry(n2);
    expect(e.tasks?.[1]).toBeGreaterThan(0);
    expect(e.objects?.map((o) => o.id)).toContain("o-p1");
    expect(e.objects?.find((o) => o.id === "o-p1")?.mono).toBe("PS");
  });
});

describe("objectTable", () => {
  it("builds person rows with frontmatter columns, linked entries and last contact", () => {
    const t = objectTable("person");
    expect(t.columns.map((c) => c.key)).toEqual(["role", "organization"]);
    const priya = t.rows.find((r) => r.entry.id === "o-p1")!;
    expect(priya.values.role).toBe("VP Engineering");
    expect(priya.linked).toBeGreaterThan(0);
    expect(priya.last).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(t.has.status).toBe(false);
  });

  it("shows the status column only where the type has one", () => {
    const t = objectTable("project");
    expect(t.has.status).toBe(true);
    expect(t.rows.every((r) => !r.status || ["ok", "run", "new", "mute"].includes(r.status.tone))).toBe(true);
  });
});
