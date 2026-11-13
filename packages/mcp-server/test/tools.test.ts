import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DOMAIN_OBJECT_TYPES } from "@kortex/db";
import { connect, FIXED_NOW } from "./helpers";

let t: Awaited<ReturnType<typeof connect>>;
beforeEach(async () => {
  t = await connect();
});
afterEach(() => t.close());

const save = async (args: Record<string, unknown>) => (await t.call("brain_save_item", args)).json;

describe("tool listing", () => {
  it("exposes exactly the six brain tools with descriptions and input schemas", async () => {
    const { tools } = await t.client.listTools();
    expect(tools.map((x) => x.name).sort()).toEqual([
      "brain_get_item",
      "brain_log_agent_memory",
      "brain_manage_tasks",
      "brain_organize",
      "brain_save_item",
      "brain_search",
    ]);
    for (const tool of tools) {
      expect(tool.description?.length).toBeGreaterThan(40);
      expect(tool.inputSchema.type).toBe("object");
    }
    const byName = Object.fromEntries(tools.map((x) => [x.name, x.inputSchema]));
    expect(byName.brain_search?.required ?? []).toEqual([]);
    expect(byName.brain_get_item?.required).toEqual(["id"]);
    expect(byName.brain_save_item?.required ?? []).toEqual([]);
    expect(byName.brain_organize?.required).toEqual(["action"]);
    expect(byName.brain_log_agent_memory?.required?.sort()).toEqual([
      "agent_name",
      "summary_md",
      "topic",
    ]);
    expect(byName.brain_manage_tasks?.required).toEqual(["action"]);
    const organize = byName.brain_organize?.properties as Record<string, { enum?: string[] }>;
    expect(organize.action?.enum).toEqual([
      "create_folder",
      "move_item",
      "add_tags",
      "snooze",
      "clear_reminder",
      "turn_into_object",
    ]);
    expect(organize.object_type?.enum).toEqual([...DOMAIN_OBJECT_TYPES]);
  });
});

describe("brain_save_item / brain_get_item", () => {
  it("saves into the Inbox by default and reads the item back", async () => {
    const saved = await save({
      title: "Hyrox Training Plan",
      content_md: "# Plan\n\nRun fast.",
      tags: ["#Fitness/Hyrox", "fitness/hyrox"],
    });
    expect(saved).toMatchObject({
      title: "Hyrox Training Plan",
      type: "note",
      slug: "hyrox-training-plan",
      folder_path: "00_Inbox",
      tags: ["fitness/hyrox"],
      status: "inbox",
    });
    const { json } = await t.call("brain_get_item", { id: saved.id });
    expect(json.item.content_md).toBe("# Plan\n\nRun fast.");
    expect(json.item.is_manual_placement).toBe(false);
    expect(json.highlights).toBeUndefined();
  });

  it("treats an explicit folder_path as manual placement and creates the folder", async () => {
    const saved = await save({
      title: "Offer",
      content_md: "x",
      folder_path: "Work\\Clients//Acme/",
    });
    expect(saved.folder_path).toBe("Work/Clients/Acme");
    const item = (await t.call("brain_get_item", { id: saved.id })).json.item;
    expect(item.is_manual_placement).toBe(true);
    expect(t.repo.folders).toContain("Work/Clients");
  });

  it("puts domain objects and AI chats in their home folders and keeps slugs unique", async () => {
    const p = await save({ title: "Ada", content_md: "", type: "person" });
    expect(p.folder_path).toBe("70_Objects/People");
    const a = await save({ title: "Same", content_md: "1" });
    const b = await save({ title: "Same", content_md: "2" });
    expect([a.slug, b.slug]).toEqual(["same", "same-2"]);
  });

  it("returns highlights only on request", async () => {
    const saved = await save({
      title: "Article",
      content_md: "text",
      type: "article",
      source_url: "https://example.com/a",
    });
    t.repo.addHighlight(saved.id, "important quote", "my note");
    const withHl = (await t.call("brain_get_item", { id: saved.id, include_highlights: true }))
      .json;
    expect(withHl.highlights).toHaveLength(1);
    expect(withHl.highlights[0]).toMatchObject({
      quote_text: "important quote",
      note_text: "my note",
    });
    expect(withHl.item.source_url).toBe("https://example.com/a");
  });

  it("rejects invalid input", async () => {
    expect((await t.call("brain_save_item", { title: "", content_md: "x" })).isError).toBe(true);
    expect(
      (await t.call("brain_save_item", { title: "x", content_md: "x", type: "banana" })).isError,
    ).toBe(true);
    expect(
      (
        await t.call("brain_save_item", {
          title: "x",
          content_md: "x",
          source_url: "javascript:alert(1)",
        })
      ).isError,
    ).toBe(true);
    expect(
      (await t.call("brain_save_item", { title: "x", content_md: "x", folder_path: "a/../b" }))
        .text,
    ).toMatch(/must not contain/);
    expect(
      (await t.call("brain_save_item", { title: "x", content_md: "x", tags: ["bad tag!"] })).text,
    ).toMatch(/Invalid tag/);
    expect((await t.call("brain_get_item", { id: "not-a-uuid" })).isError).toBe(true);
    const missing = await t.call("brain_get_item", { id: randomUUID() });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/not found/);
  });
});

describe("brain_search", () => {
  beforeEach(async () => {
    await save({
      title: "MCP servers explained",
      content_md: "Model Context Protocol servers expose tools.",
      tags: ["ai/mcp"],
      type: "article",
    });
    await save({
      title: "Pasta recipe",
      content_md: "Boil water. MCP not involved.",
      tags: ["rezepte"],
      type: "recipe",
      folder_path: "50_Recipes",
    });
    await save({ title: "Unrelated", content_md: "nothing to see" });
  });

  it("ranks title matches first and filters by type, folder and hierarchical tags", async () => {
    const all = (await t.call("brain_search", { query: "mcp" })).json;
    expect(all.mode).toBe("fulltext");
    expect(all.results.map((r: { title: string }) => r.title)).toEqual([
      "MCP servers explained",
      "Pasta recipe",
    ]);

    const byType = (await t.call("brain_search", { query: "mcp", type: "recipe" })).json;
    expect(byType.results.map((r: { title: string }) => r.title)).toEqual(["Pasta recipe"]);

    const byFolder = (await t.call("brain_search", { query: "mcp", folder_path: "50_Recipes" }))
      .json;
    expect(byFolder.count).toBe(1);

    const byTag = (await t.call("brain_search", { query: "mcp", tags: ["AI"] })).json;
    expect(byTag.results.map((r: { title: string }) => r.title)).toEqual(["MCP servers explained"]);

    expect((await t.call("brain_search", { query: "mcp", limit: 1 })).json.count).toBe(1);
    expect((await t.call("brain_search", { query: "zzzz" })).json.count).toBe(0);
  });

  it("rejects bad parameters", async () => {
    expect((await t.call("brain_search", { query: "" })).isError).toBe(true);
    expect((await t.call("brain_search", { query: "x", limit: 0 })).isError).toBe(true);
    expect((await t.call("brain_search", { query: "x", limit: 51 })).isError).toBe(true);
    expect((await t.call("brain_search", { query: "x", type: "nope" })).isError).toBe(true);
  });

  it("uses the embedder for hybrid search and falls back to full-text when it fails", async () => {
    await t.close();
    t = await connect({ embedder: { embed: async () => [0.1, 0.2] } });
    await save({ title: "Vector note", content_md: "hello" });
    const hybrid = (await t.call("brain_search", { query: "vector" })).json;
    expect(hybrid.mode).toBe("hybrid");
    expect(t.repo.seenEmbeddings.at(-1)).toEqual([0.1, 0.2]);

    await t.close();
    t = await connect({
      embedder: {
        embed: async () => {
          throw new Error("rate limited");
        },
      },
    });
    await save({ title: "Vector note", content_md: "hello" });
    const degraded = await t.call("brain_search", { query: "vector" });
    expect(degraded.isError).toBe(false);
    expect(degraded.json.mode).toBe("fulltext");
  });
});

describe("brain_organize", () => {
  it("create_folder normalises the path, creates ancestors and is idempotent", async () => {
    const first = (
      await t.call("brain_organize", {
        action: "create_folder",
        folder_path: "/Projects/Kortex//Specs/",
      })
    ).json;
    expect(first).toMatchObject({ folder_path: "Projects/Kortex/Specs", created: true });
    expect(t.repo.folders).toContain("Projects/Kortex");
    const again = (
      await t.call("brain_organize", {
        action: "create_folder",
        folder_path: "Projects/Kortex/Specs",
      })
    ).json;
    expect(again.created).toBe(false);
    expect((await t.call("brain_organize", { action: "create_folder" })).text).toMatch(
      /"folder_path" is required/,
    );
  });

  it("move_item sets is_manual_placement and creates the target folder", async () => {
    const { id } = await save({ title: "Move me", content_md: "x" });
    const res = (
      await t.call("brain_organize", {
        action: "move_item",
        item_id: id,
        folder_path: "Reading/Later",
      })
    ).json;
    expect(res).toMatchObject({ folder_path: "Reading/Later", is_manual_placement: true });
    expect(t.repo.items.get(id)?.is_manual_placement).toBe(true);
    expect(t.repo.folders).toContain("Reading/Later");

    expect((await t.call("brain_organize", { action: "move_item", item_id: id })).text).toMatch(
      /"folder_path" is required/,
    );
    expect(
      (await t.call("brain_organize", { action: "move_item", folder_path: "x" })).text,
    ).toMatch(/"item_id" is required/);
    expect(
      (
        await t.call("brain_organize", {
          action: "move_item",
          item_id: randomUUID(),
          folder_path: "x",
        })
      ).text,
    ).toMatch(/not found/);
  });

  it("add_tags merges and normalises tags", async () => {
    const { id } = await save({ title: "Tag me", content_md: "x", tags: ["a"] });
    const res = (
      await t.call("brain_organize", {
        action: "add_tags",
        item_id: id,
        tags: ["#B", "a", "ai/mcp"],
      })
    ).json;
    expect(res.tags).toEqual(["a", "b", "ai/mcp"]);
    expect(
      (await t.call("brain_organize", { action: "add_tags", item_id: id, tags: [] })).text,
    ).toMatch(/"tags" is required/);
    expect((await t.call("brain_organize", { action: "add_tags", item_id: id })).isError).toBe(
      true,
    );
  });

  describe("turn_into_object", () => {
    it("retypes the item, moves it to the object folder and stores validated metadata", async () => {
      const { id } = await save({ title: "Ada Lovelace", content_md: "Mathematician." });
      const res = (
        await t.call("brain_organize", {
          action: "turn_into_object",
          item_id: id,
          object_type: "person",
          metadata: { role: "Analyst", contact_info: { email: "ada@example.com" } },
        })
      ).json;
      expect(res).toMatchObject({
        type: "person",
        folder_path: "70_Objects/People",
        metadata: { role: "Analyst", contact_info: { email: "ada@example.com" } },
      });
      expect(t.repo.items.get(id)?.type).toBe("person");
    });

    it("validates metadata for each of the seven object types", async () => {
      const valid: Record<string, Record<string, unknown>> = {
        person: { role: "CTO", organization: "Acme", relationship: "friend" },
        project: {
          project_status: "active",
          priority: "high",
          target_date: "2026-12-31",
          tech_stack: ["ts"],
          repo_or_url: "https://x",
        },
        organization: {
          industry: "Auto",
          org_type: "OEM",
          location: "Munich",
          website: "https://acme.com",
          key_contacts: ["Ada"],
        },
        concept: { category: "ai", maturity: "seed", related_tools: ["mcp"] },
        tool: { tool_category: "dev", usage_status: "daily", pricing: "free", url: "https://tool" },
        asset: { asset_type: "etf", location: "broker", status: "active", monthly_value: 250.5 },
        goal: {
          goal_timeframe: "2026",
          target_metric: "10k",
          progress_pct: 40,
          status: "on-track",
        },
      };
      expect(Object.keys(valid).sort()).toEqual([...DOMAIN_OBJECT_TYPES].sort());
      for (const [type, metadata] of Object.entries(valid)) {
        const { id } = await save({ title: `obj ${type}`, content_md: "" });
        const res = await t.call("brain_organize", {
          action: "turn_into_object",
          item_id: id,
          object_type: type,
          metadata,
        });
        expect(res.isError, `${type}: ${res.text}`).toBe(false);
        expect(res.json.metadata).toEqual(metadata);
      }
    });

    it("rejects invalid or foreign metadata with a helpful message and leaves the item untouched", async () => {
      const { id } = await save({ title: "Bad", content_md: "" });
      const cases: [string, Record<string, unknown>, RegExp][] = [
        ["person", { favourite_colour: "blue" }, /Allowed fields: role, organization/],
        ["project", { priority: "asap" }, /priority/],
        ["project", { target_date: "next week" }, /ISO date/],
        ["goal", { progress_pct: 140 }, /progress_pct/],
        ["asset", { monthly_value: "lots" }, /monthly_value/],
        ["tool", { tech_stack: ["x"] }, /Invalid metadata for tool/],
      ];
      for (const [type, metadata, message] of cases) {
        const res = await t.call("brain_organize", {
          action: "turn_into_object",
          item_id: id,
          object_type: type,
          metadata,
        });
        expect(res.isError).toBe(true);
        expect(res.text).toMatch(message);
      }
      expect(t.repo.items.get(id)?.type).toBe("note");
      expect(
        (await t.call("brain_organize", { action: "turn_into_object", item_id: id })).text,
      ).toMatch(/"object_type" is required/);
      expect(
        (
          await t.call("brain_organize", {
            action: "turn_into_object",
            item_id: id,
            object_type: "spaceship",
          })
        ).isError,
      ).toBe(true);
    });

    it("keeps a manually placed item in its folder (manual placement is respected)", async () => {
      const { id } = await save({ title: "Pinned", content_md: "", folder_path: "Work/Clients" });
      const res = (
        await t.call("brain_organize", {
          action: "turn_into_object",
          item_id: id,
          object_type: "organization",
          metadata: {},
        })
      ).json;
      expect(res).toMatchObject({ type: "organization", folder_path: "Work/Clients" });
    });

    it("merges metadata on repeated calls", async () => {
      const { id } = await save({ title: "Proj", content_md: "" });
      await t.call("brain_organize", {
        action: "turn_into_object",
        item_id: id,
        object_type: "project",
        metadata: { project_status: "active" },
      });
      const res = (
        await t.call("brain_organize", {
          action: "turn_into_object",
          item_id: id,
          object_type: "project",
          metadata: { priority: "low" },
        })
      ).json;
      expect(res.metadata).toEqual({ project_status: "active", priority: "low" });
    });
  });

  it("rejects unknown actions", async () => {
    expect((await t.call("brain_organize", { action: "delete_everything" })).isError).toBe(true);
  });
});

describe("brain_log_agent_memory", () => {
  it("files an ai_chat in 40_AI_Memories as YYYY-MM-DD_topic-slug", async () => {
    const res = (
      await t.call("brain_log_agent_memory", {
        agent_name: "Claude Code",
        topic: "MCP-Server: Auth & Transport Überblick",
        summary_md: "Implemented **bearer auth**.",
        decisions: ["Stateless HTTP"],
        next_steps: ["Wire embedder", "Live test"],
      })
    ).json;
    expect(res).toMatchObject({
      folder_path: "40_AI_Memories",
      slug: "2026-10-23_mcp-server-auth-transport-uberblick",
      file: "40_AI_Memories/2026-10-23_mcp-server-auth-transport-uberblick.md",
    });
    const item = t.repo.items.get(res.id)!;
    expect(item).toMatchObject({
      type: "ai_chat",
      cluster_name: "AI & Engineering",
      is_manual_placement: false,
    });
    expect(item.tags).toEqual(["ai/agent-memory", "agent/claude-code"]);
    expect(item.metadata).toMatchObject({
      agent_name: "Claude Code",
      decisions: ["Stateless HTTP"],
    });
    expect(item.content_md).toContain("# MCP-Server: Auth & Transport Überblick");
    expect(item.content_md).toContain("*Agent: Claude Code · 2026-10-23*");
    expect(item.content_md).toContain("## Decisions\n\n- Stateless HTTP");
    expect(item.content_md).toContain("## Next steps\n\n- Wire embedder\n- Live test");
    expect(item.created_at).toBe(FIXED_NOW.toISOString());
  });

  it("omits empty sections, disambiguates same-day duplicates and validates input", async () => {
    const args = { agent_name: "a", topic: "Same topic", summary_md: "s" };
    const a = (await t.call("brain_log_agent_memory", args)).json;
    const b = (await t.call("brain_log_agent_memory", args)).json;
    expect([a.slug, b.slug]).toEqual(["2026-10-23_same-topic", "2026-10-23_same-topic-2"]);
    expect(t.repo.items.get(a.id)?.content_md).not.toContain("## Decisions");
    expect((await t.call("brain_log_agent_memory", { agent_name: "a", topic: "t" })).isError).toBe(
      true,
    );
    expect((await t.call("brain_log_agent_memory", { ...args, topic: "" })).isError).toBe(true);
  });
});

describe("brain_manage_tasks", () => {
  it("creates, lists (sorted by due date), completes and hides done tasks", async () => {
    const later = (
      await t.call("brain_manage_tasks", {
        action: "create",
        title: "Later",
        due_date: "2026-12-01",
        priority: "low",
      })
    ).json.task;
    const soon = (
      await t.call("brain_manage_tasks", {
        action: "create",
        title: "Soon",
        due_date: "2026-11-01T10:00:00Z",
        priority: "urgent",
      })
    ).json.task;
    const none = (await t.call("brain_manage_tasks", { action: "create", title: "No date" })).json
      .task;
    expect(soon).toMatchObject({
      status: "open",
      priority: "urgent",
      due_date: "2026-11-01T10:00:00.000Z",
    });
    expect(none).toMatchObject({ priority: "medium", due_date: null });

    const list = (await t.call("brain_manage_tasks", { action: "list" })).json;
    expect(list.tasks.map((x: { title: string }) => x.title)).toEqual(["Soon", "Later", "No date"]);

    const done = (await t.call("brain_manage_tasks", { action: "complete", task_id: soon.id })).json
      .task;
    expect(done).toMatchObject({ status: "done", completed_at: FIXED_NOW.toISOString() });
    // completing again is a harmless no-op
    expect(
      (await t.call("brain_manage_tasks", { action: "complete", task_id: soon.id })).json.task
        .completed_at,
    ).toBe(done.completed_at);

    expect((await t.call("brain_manage_tasks", { action: "list" })).json.count).toBe(2);
    expect(
      (await t.call("brain_manage_tasks", { action: "list", include_done: true })).json.count,
    ).toBe(3);
    expect(later.id).toBeTruthy();
  });

  it("reports missing and invalid arguments", async () => {
    expect((await t.call("brain_manage_tasks", { action: "create" })).text).toMatch(
      /"title" is required/,
    );
    expect(
      (await t.call("brain_manage_tasks", { action: "create", title: "x", due_date: "tomorrow" }))
        .text,
    ).toMatch(/Invalid due_date/);
    expect(
      (await t.call("brain_manage_tasks", { action: "create", title: "x", priority: "whenever" }))
        .isError,
    ).toBe(true);
    expect((await t.call("brain_manage_tasks", { action: "complete" })).text).toMatch(
      /"task_id" is required/,
    );
    expect(
      (await t.call("brain_manage_tasks", { action: "complete", task_id: "nope" })).isError,
    ).toBe(true);
    expect(
      (await t.call("brain_manage_tasks", { action: "complete", task_id: randomUUID() })).text,
    ).toMatch(/not found/);
    expect((await t.call("brain_manage_tasks", { action: "explode" })).isError).toBe(true);
  });
});
