import { describe, expect, it } from "vitest";
import { syncTasksFromBody } from "../notes/service";
import { FakeSupabase } from "./fake-supabase";
import { USER_ID } from "./helpers";

const ITEM = "11111111-1111-4111-8111-aaaaaaaaaaaa";

// The note sheet no longer shows its own task panel: ticking `- [x]` in the text is what closes the task.
describe("body checklist → action_items", () => {
  it("closes and reopens the matching task, leaves others alone", async () => {
    const db = new FakeSupabase({
      action_items: [
        { id: "t1", user_id: USER_ID, source_item_id: ITEM, title: "Angebot senden", status: "open", completed_at: null },
        { id: "t2", user_id: USER_ID, source_item_id: ITEM, title: "Rechnung prüfen", status: "done", completed_at: "2026-11-01T00:00:00Z" },
        { id: "t3", user_id: USER_ID, source_item_id: ITEM, title: "Anrufen", status: "open", completed_at: null },
      ],
    });
    const ctx = { client: db.client, userId: USER_ID };
    await syncTasksFromBody(ctx, ITEM, "# Notiz\n\n- [x] Angebot senden\n- [ ] Rechnung prüfen\n- [ ] Anrufen\n");
    const by = (id: string) => db.rows("action_items").find((r) => r.id === id)!;
    expect(by("t1")).toMatchObject({ status: "done" });
    expect(by("t1").completed_at).toBeTruthy();
    expect(by("t2")).toMatchObject({ status: "open", completed_at: null });
    expect(by("t3")).toMatchObject({ status: "open" });
  });
});
