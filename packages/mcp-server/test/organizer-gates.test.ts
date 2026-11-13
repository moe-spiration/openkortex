import { describe, expect, it } from "vitest";
import { createAiCoreEnricher, type EnrichGate } from "../src/ai";
import { mockRouter } from "./ai-mocks";
import { connect } from "./helpers";

/* Backlog P1 #2: the MCP organizer (KORTEX_MCP_ORGANIZE=1) honours budget, connectors, threshold. */

const gate = (r: Awaited<ReturnType<EnrichGate["prepare"]>>): EnrichGate => ({
  prepare: async () => r,
});

describe("MCP organizer gates", () => {
  it("skips the organizer (no AI call) when the gate says so; the item is still saved", async () => {
    const { router, calls } = mockRouter();
    const t = await connect({
      enricher: createAiCoreEnricher(router, { gate: gate({ skip: "daily AI budget reached" }) }),
    });
    const res = await t.call("brain_save_item", { title: "Note", content_md: "Text" });
    expect(res.isError).toBe(false);
    expect(res.json.enrichment).toMatchObject({
      ok: true,
      status: "skipped",
      reason: "daily AI budget reached",
    });
    expect(calls.llm.organizer).toBe(0);
    expect(t.repo.items.get(res.json.id)).toBeDefined();
    await t.close();
  });

  it("only proposes the folder when the organizer is below the auto-place threshold", async () => {
    const { router } = mockRouter({ enrichment: { placement_confidence: 0.3 } });
    const t = await connect({ enricher: createAiCoreEnricher(router, { gate: gate({ threshold: 0.7 }) }) });
    const res = await t.call("brain_save_item", { title: "Unsure", content_md: "Hmm" });
    expect(res.json.enrichment).toMatchObject({ status: "done", proposed_folder: "10_Notes/Engineering" });
    const item = t.repo.items.get(res.json.id)!;
    expect(item.folder_path).not.toBe("10_Notes/Engineering");
    expect(item.metadata).toMatchObject({
      placement: { confidence: 0.3, folder_path: "10_Notes/Engineering", held: true },
    });
    await t.close();
  });

  it("files directly at or above the threshold", async () => {
    const { router } = mockRouter({ enrichment: { placement_confidence: 0.9 } });
    const t = await connect({ enricher: createAiCoreEnricher(router, { gate: gate({ threshold: 0.7 }) }) });
    const res = await t.call("brain_save_item", { title: "Sure", content_md: "Yes" });
    expect(res.json.folder_path).toBe("10_Notes/Engineering");
    expect(res.json.enrichment.proposed_folder).toBeUndefined();
    await t.close();
  });
});
