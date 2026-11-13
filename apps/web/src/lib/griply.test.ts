import { describe, expect, it } from "vitest";
import { cleanServerUrl, createdTaskId, griplyTaskInput, matchGriplyArea, nextCursor, parseHierarchy, toolErrorText, toolJson } from "./griply";

// Synthetic data in the shape of Griply's get_hierarchy answer.
const page1 = {
  lifeAreas: [
    { id: "a-health", name: "Health", archived: false },
    { id: "a-social", name: "Love & Social" },
    { id: "a-dev", name: "PersonalDev" },
    { id: "a-old", name: "Old", archived: true },
  ],
  goals: [
    { id: "g1", name: "Run a marathon", lifeAreas: [{ id: "a-health", name: "Health" }], deadline: "2027-10-01", progressPercent: 12.4, completed: false, archived: false },
    { id: "g2", name: "Sleep 8 hours", lifeAreas: [{ id: "a-health" }], progressPercent: 40 },
    { id: "g3", name: "Done already", lifeAreas: [{ id: "a-health" }], completed: true },
    { id: "g4", name: "Read 12 books", lifeAreas: [{ id: "a-dev" }], deadline: "2027-12-31" },
  ],
  projects: [{ id: "p1", name: "Training plan", lifeAreas: [{ id: "a-health" }], deadline: "2027-03-01", progressPercent: 0 }],
  habits: [{ id: "h1", name: "Workout", lifeAreas: [{ id: "a-health" }, { id: "a-dev" }], completionRate4w: 66.7 }],
  nextCursor: "c2",
};
const page2 = { goals: [{ id: "g5", name: "Call a friend weekly", lifeAreas: [{ id: "a-social" }], deadline: "2027-01-31" }], projects: [], habits: [] };

describe("griply", () => {
  it("reads a tool result as JSON, structured content first", () => {
    expect(toolJson({ structuredContent: { a: 1 }, content: [{ type: "text", text: "{}" }] })).toEqual({ a: 1 });
    expect(toolJson({ content: [{ type: "text", text: "no json" }, { type: "text", text: '{"b":2}' }] })).toEqual({ b: 2 });
    expect(toolJson({ content: [] })).toBeUndefined();
    expect(toolErrorText({ isError: true, content: [{ type: "text", text: "not allowed" }] })).toBe("not allowed");
    expect(toolErrorText({ content: [{ type: "text", text: "fine" }] })).toBeUndefined();
  });

  it("groups open goals, projects and habits by life area over several pages", () => {
    expect(nextCursor(page1)).toBe("c2");
    expect(nextCursor(page2)).toBeUndefined();
    const o = parseHierarchy([page1, page2]);
    expect(o.areas.map((a) => a.name)).toEqual(["Health", "Love & Social", "PersonalDev"]);
    const health = o.areas[0]!;
    expect(health.goals).toEqual([
      { id: "g1", name: "Run a marathon", deadline: "2027-10-01", progress: 12 },
      { id: "g2", name: "Sleep 8 hours", progress: 40 },
    ]);
    expect(health.projects).toEqual([{ id: "p1", name: "Training plan", deadline: "2027-03-01", progress: 0 }]);
    expect(health.habits).toEqual([{ id: "h1", name: "Workout", rate: 67 }]);
    expect(o.areas[1]!.goals.map((g) => g.id)).toEqual(["g5"]);
    expect(parseHierarchy([undefined, "x", { lifeAreas: "no" }])).toEqual({ areas: [] });
  });

  it("matches a Kortex area to a Griply life area by key, label and usual names", () => {
    const o = parseHierarchy([page1, page2]);
    expect(matchGriplyArea(o, "health", ["Gesundheit"])?.id).toBe("a-health");
    expect(matchGriplyArea(o, "relations", ["Beziehungen"])?.id).toBe("a-social");
    expect(matchGriplyArea(o, "growth", ["Wachstum"])?.id).toBe("a-dev");
    expect(matchGriplyArea(o, "finance", ["Finanzen"])).toBeUndefined();
  });

  it("accepts only https addresses of public hosts", () => {
    expect(cleanServerUrl(" https://mcp.example.com/mcp#x ")).toBe("https://mcp.example.com/mcp");
    for (const bad of ["", "mcp.example.com", "http://mcp.example.com", "https://localhost/mcp", "https://10.0.0.1/mcp", "https://[::1]/mcp", "https://box.local/mcp", "https://user:pw@mcp.example.com"]) {
      expect(cleanServerUrl(bad)).toBeNull();
    }
  });

  it("builds the task for create_tasks and reads the new id", () => {
    expect(griplyTaskInput({ id: "t1", title: " Send the offer ", due: "2026-11-20T00:00:00Z", context: " From the sync ", priority: "high" })).toEqual({
      name: "Send the offer",
      clientRequestId: "t1",
      deadline: "2026-11-20",
      description: "From the sync",
      priority: "high",
    });
    expect(griplyTaskInput({ id: "t2", title: "Plain", due: null, priority: "urgent" })).toEqual({ name: "Plain", clientRequestId: "t2" });
    expect(createdTaskId({ structuredContent: { results: [{ created: true, id: "x1", type: "task" }] } })).toEqual({ id: "x1" });
    expect(createdTaskId({ structuredContent: { results: [{ created: false, reason: "name too long" }] } })).toEqual({ error: "name too long" });
    expect(createdTaskId({ isError: true, content: [{ type: "text", text: "read only" }] })).toEqual({ error: "read only" });
  });
});
