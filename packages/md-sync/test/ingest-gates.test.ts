import {
  createIngestionPipeline,
  createMemoryStorageGateway,
  meterModelRouter,
  type BudgetStatus,
  type UsageEntry,
  type UsageLedger,
} from "@kortex/ai-core";
import type { UserSettings } from "@kortex/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exists } from "../src/fs-utils";
import { VaultIngestor, type IngestorEvents } from "../src/ingest";
import { mockRouter } from "./ai-mocks";
import { createHarness, type Harness } from "./helpers";

/*
 * Backlog P1 #2: md-sync honours the same gates as the web ingest route: daily AI budget
 * (kortex.ai_usage), usage logging, enabled_connectors and auto_place_threshold.
 */

let h: Harness;
let ingestor: VaultIngestor;
afterEach(async () => {
  await ingestor?.stop();
  await h?.cleanup();
});

const MEMORY = ['---', 'type: "ai_chat"', "---", "# Memory", "", "Wired the gates.", ""].join("\n");

function fakeLedger(exceeded = false) {
  const entries: Omit<UsageEntry, "userId">[] = [];
  const state = { exceeded };
  const ledger: UsageLedger = {
    status: async (): Promise<BudgetStatus> => ({
      day: "2026-10-31",
      spentEur: state.exceeded ? 2.5 : 0.1,
      budgetEur: 2,
      remainingEur: state.exceeded ? 0 : 1.9,
      exceeded: state.exceeded,
    }),
    record: async (e) => {
      entries.push(e);
    },
  };
  return { ledger, entries, state };
}

async function setup(
  opts: {
    router?: ReturnType<typeof mockRouter>;
    settings?: Partial<UserSettings>;
    ledger?: UsageLedger;
    meter?: boolean;
  } = {},
) {
  h = await createHarness();
  if (opts.settings) h.store.userSettings = opts.settings as UserSettings;
  const mock = opts.router ?? mockRouter();
  const models =
    opts.meter && opts.ledger
      ? meterModelRouter(mock.router, { record: (e) => opts.ledger!.record(e) })
      : mock.router;
  const events: { skipped: string[]; ingested: IngestorEvents["ingested"][0][] } = {
    skipped: [],
    ingested: [],
  };
  ingestor = new VaultIngestor({
    engine: h.engine,
    store: h.store,
    pipeline: createIngestionPipeline({ storage: createMemoryStorageGateway(), models }),
    folders: ["40_AI_Memories", "00_Inbox"],
    debounceMs: 10,
    retryDelayMs: 10,
    budgetRetryMs: 30,
    ...(opts.ledger ? { ledger: opts.ledger } : {}),
  }).start();
  ingestor.on("ingest-skipped", (e) => events.skipped.push(e.reason));
  ingestor.on("ingested", (e) => events.ingested.push(e));
  await h.engine.start();
  await h.settle();
  return { mock, events };
}

async function settleAll() {
  for (let i = 0; i < 3; i++) {
    await h.settle();
    await ingestor.idle();
  }
  await h.settle();
}

async function addLocal(rel: string, text: string) {
  await h.write(rel, text);
  await h.engine.handleLocalFile(rel);
  await settleAll();
}

describe("md-sync ingest gates", () => {
  it("holds an unsure inbox capture in 00_Inbox and only proposes the folder", async () => {
    const { mock, events } = await setup({
      router: mockRouter({ enrichment: { placement_confidence: 0.4 } }),
      settings: { auto_place_threshold: 0.7 },
    });
    await addLocal("00_Inbox/idea.md", "Wire md-sync into ai-core.\n");
    const item = h.store.itemByTitle("idea");
    expect(mock.calls.llm.organizer).toBe(1);
    expect(item).toMatchObject({ folder_path: "00_Inbox", status: "processed" });
    const meta = item?.metadata as { placement?: Record<string, unknown> };
    expect(meta.placement).toMatchObject({
      confidence: 0.4,
      folder_path: "10_Notes/Engineering",
      held: true,
    });
    expect(await exists(h.abs("00_Inbox/idea.md"))).toBe(true);
    expect(h.store.folderByPath("10_Notes/Engineering")).toBeUndefined();
    expect(events.ingested[0]).toMatchObject({
      folderPath: "00_Inbox",
      proposedFolder: "10_Notes/Engineering",
    });
  });

  it("files a sure capture directly; threshold 1 (always review) holds it too", async () => {
    await setup({
      router: mockRouter({ enrichment: { placement_confidence: 0.9 } }),
      settings: { auto_place_threshold: 0.7 },
    });
    await addLocal("00_Inbox/sure.md", "Sure thing.\n");
    expect(h.store.itemByTitle("sure")?.folder_path).toBe("10_Notes/Engineering");

    h.store.userSettings = { auto_place_threshold: 1 } as UserSettings;
    await addLocal("00_Inbox/always.md", "Always review.\n");
    expect(h.store.itemByTitle("always")?.folder_path).toBe("00_Inbox");
  });

  it("skips AI work when the item's connector is switched off", async () => {
    const { mock, events } = await setup({ settings: { enabled_connectors: ["web"] } });
    await addLocal("40_AI_Memories/m.md", MEMORY);
    expect(mock.calls.llm.organizer).toBe(0);
    expect(mock.calls.llm.takeaways).toBe(0);
    expect(events.skipped).toContain("connector ai_chat is switched off");
    expect(h.store.calls.applyEnrichment ?? 0).toBe(0);
    // Plain notes have no connector and still run.
    await addLocal("00_Inbox/plain.md", "Just a thought.\n");
    expect(mock.calls.llm.organizer).toBe(1);
  });

  it("postpones AI work while the daily budget is used up, then runs it", async () => {
    const { ledger, state } = fakeLedger(true);
    const { mock, events } = await setup({ ledger });
    await addLocal("40_AI_Memories/m.md", MEMORY);
    expect(mock.calls.llm.organizer).toBe(0);
    expect(events.skipped).toContain("daily AI budget reached");
    expect(h.store.calls.applyEnrichment ?? 0).toBe(0);

    state.exceeded = false; // budget raised (or the next day)
    await vi.waitFor(
      () => expect(h.store.itemByTitle("m")?.status).toBe("processed"),
      { timeout: 10_000, interval: 25 },
    );
    expect(mock.calls.llm.organizer).toBe(1);
  });

  it("records every AI call of the pipeline as usage", async () => {
    const { ledger, entries } = fakeLedger(false);
    await setup({ ledger, meter: true });
    await addLocal("40_AI_Memories/m.md", MEMORY);
    const tasks = entries.map((e) => e.task);
    expect(tasks).toContain("summarize"); // organizer + takeaways on the fast route
    expect(tasks).toContain("embeddings");
    for (const e of entries) {
      expect(e.costUsd).toBeGreaterThan(0);
      expect(e.inputTokens).toBeGreaterThan(0);
    }
  });
});
