import { expect, it } from "vitest";
import { createChatActionHandlers } from "../chat/action";
import { FakeSupabase } from "./fake-supabase";
import { mockModel, mockRouter, setup, USER_ID } from "./helpers";

// G9: the copilot's "Als Task extrahieren" keeps priority and links a named project / goal.

const NOTE = "77777777-7777-4777-8777-000000000001";
const PROJECT = "77777777-7777-4777-8777-000000000002";
const GOAL = "77777777-7777-4777-8777-000000000003";

it("tasks action: priority kept, project and goal linked, saved with project_item_id", async () => {
  const db = new FakeSupabase({
    knowledge_items: [
      { id: NOTE, user_id: USER_ID, type: "note", title: "Sync", content_md: "Release planen, Intervalle laufen." },
      { id: PROJECT, user_id: USER_ID, type: "project", title: "Kortex", status: "processed", content_md: "" },
      { id: GOAL, user_id: USER_ID, type: "goal", title: "Hyrox 2027", status: "processed", content_md: "" },
    ],
  });
  db.authUser = { id: USER_ID };
  const base = { description: null, assignee: "Me", due_date: null, source_timestamp_sec: null };
  const tasks = {
    action_items: [
      { ...base, title: "Release planen", priority: "urgent", project: "Kortex" },
      { ...base, title: "Intervalle laufen", priority: "low", project: "Hyrox 2027" },
      { ...base, title: "Müll rausbringen", priority: "medium", project: "Unbekannt" },
    ],
  };
  const s = setup({ db, models: mockRouter({ chat: mockModel([tasks]) }) });
  const res = await createChatActionHandlers(() => s.deps).POST(
    new Request("https://kortex.test/api/chat/action", {
      method: "POST",
      body: JSON.stringify({ action: "tasks", item_id: NOTE, save: true }),
      headers: { cookie: "sb-kortex-auth-token=x", "content-type": "application/json" },
    }),
  );
  const body = await res.json();
  expect(body.action_items.map((a: Record<string, unknown>) => [a.title, a.priority, a.project_item_id])).toEqual([
    ["Release planen", "urgent", PROJECT],
    ["Intervalle laufen", "low", GOAL],
    ["Müll rausbringen", "medium", null],
  ]);
  expect(db.rows("action_items").map((r) => [r.title, r.priority, r.project_item_id ?? null])).toEqual([
    ["Release planen", "urgent", PROJECT],
    ["Intervalle laufen", "low", GOAL],
    ["Müll rausbringen", "medium", null],
  ]);
});
