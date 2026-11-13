import { describe, expect, it } from "vitest";
import { initialKnowledgeItems } from "@/lib/workspace-data";
import { groupBacklinks, lastMeeting, relatedItems } from "./backlinks";

const all = Object.fromEntries(initialKnowledgeItems().map((i) => [i.id, i]));

describe("backlinks", () => {
  it("counts links in both directions", () => {
    // Sven Albrecht (o-p2) links n2; nothing links back to him yet
    const ids = relatedItems(all["o-p2"]!, all).map((i) => i.id);
    expect(ids).toEqual(["n2"]);
    // n2 is linked from the objects that mention it, e.g. o-p1 and o-p2
    expect(relatedItems(all.n2!, all).map((i) => i.id)).toEqual(expect.arrayContaining(["o-p1", "o-p2", "n4"]));
  });

  it("groups meetings, open action items and mentions", () => {
    const g = groupBacklinks(all.n4!, all);
    expect(g.meetings.map((m) => m.id)).toEqual(["n2"]);
    expect(g.actions.every(({ action }) => !action.done)).toBe(true);
    expect(g.actions.map(({ action }) => action.id)).toContain("n2-a1");
    expect(g.mentions.map((m) => m.id)).toEqual(expect.arrayContaining(["n14", "n13", "o-o2"]));
    expect(g.mentions.every((m) => m.type !== "meeting")).toBe(true);
  });

  it("finds the most recent meeting for the person pill", () => {
    expect(lastMeeting(all["o-p2"]!, all)?.id).toBe("n2");
    expect(lastMeeting(all["o-p4"]!, all)).toBeUndefined();
  });
});
