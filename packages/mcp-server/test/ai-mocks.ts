import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test";
import type { ModelRouter } from "@kortex/ai-core";

type GenerateResult = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;

const jsonResult = (value: unknown): GenerateResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 10, text: 10, reasoning: 0 },
  },
  warnings: [],
});

export interface Enrichment {
  title: string;
  summary: string;
  cluster_name: string | null;
  suggested_folder_path: string | null;
  tags: string[];
  entities: { name: string; type: string }[];
  action_items: unknown[];
  placement_confidence?: number | null;
}

export const DEFAULT_ENRICHMENT: Enrichment = {
  title: "Sync daemon wiring",
  summary: "Session notes about the vault daemon.",
  cluster_name: "Engineering",
  suggested_folder_path: "10_Notes/Engineering",
  tags: ["ai/agent-memory", "kortex/md-sync"],
  entities: [{ name: "Supabase", type: "tool" }],
  action_items: [],
};

export const DEFAULT_TAKEAWAYS = {
  title: "Sync daemon wiring",
  takeaways: [
    "Realtime outages are bridged with exponential backoff and a reconcile on reconnect.",
    "Checksums over frontmatter and body stop echo loops.",
  ],
  open_questions: [],
};

/**
 * One fast model for both LLM calls of the pipeline: the ai-chat adapter's takeaways and the
 * organizer (recognised by its `suggested_folder_path` instruction).
 */
export function mockFastModel(
  opts: { enrichment?: Partial<Enrichment>; failOrganizer?: boolean } = {},
) {
  const calls = { organizer: 0, takeaways: 0 };
  const model = new MockLanguageModelV4({
    modelId: "mock-fast",
    doGenerate: async ({ prompt }) => {
      if (JSON.stringify(prompt).includes("suggested_folder_path")) {
        calls.organizer++;
        if (opts.failOrganizer) throw new Error("organizer model down");
        return jsonResult({ ...DEFAULT_ENRICHMENT, ...opts.enrichment });
      }
      calls.takeaways++;
      return jsonResult(DEFAULT_TAKEAWAYS);
    },
  });
  return { model, calls };
}

const DIMS = 1536;
const tokens = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Deterministic "semantic" vector: hashed bag of words, so shared words => high cosine. */
export function bagOfWords(text: string): number[] {
  const v = new Array<number>(DIMS).fill(0);
  for (const t of tokens(text)) {
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
    v[(h >>> 0) % DIMS]! += 1;
  }
  v[DIMS - 1]! += 0.001; // never all-zero
  return v;
}

export function mockEmbeddingModel() {
  const calls = { texts: 0 };
  const model = new MockEmbeddingModelV4({
    modelId: "mock-embedding",
    maxEmbeddingsPerCall: 100,
    doEmbed: async ({ values }) => {
      calls.texts += values.length;
      return { embeddings: values.map(bagOfWords), warnings: [] };
    },
  });
  return { model, calls };
}

export function mockRouter(opts: Parameters<typeof mockFastModel>[0] = {}) {
  const fast = mockFastModel(opts);
  const embedding = mockEmbeddingModel();
  const router: ModelRouter = {
    modelIds: {
      fast: "mock/fast",
      chat: "mock/chat",
      vision: "mock/vision",
      embedding: "mock/embedding",
    },
    fast: () => fast.model,
    chat: () => fast.model,
    vision: () => fast.model,
    embedding: () => embedding.model,
    // Every task "resolves" to a mock model; embeddings name their model like the real router.
    route: (task) => ({
      task,
      provider: "openrouter",
      modelId: task === "embeddings" ? "mock/embedding" : "mock/fast",
      source: "locked",
    }),
  };
  return { router, calls: { llm: fast.calls, embed: embedding.calls } };
}
