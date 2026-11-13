import assert from "node:assert/strict";
import { test } from "node:test";
import { planBackfill } from "./dedup-backfill.mjs";

const lib = {
  urlKey: (u) => (u ? u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") : null),
  contentHash: async (t) => (t && t.length >= 5 ? `h:${t.toLowerCase()}` : null),
};

const row = (over) => ({
  id: "x",
  type: "bookmark",
  source_url: null,
  source_platform: "web",
  content_md: "",
  metadata: {},
  source_url_norm: null,
  content_hash: null,
  ...over,
});

test("fills only NULL columns, oldest row keeps the URL key, duplicates are reported", async () => {
  const plan = await planBackfill(
    [
      row({ id: "a", source_url: "https://www.x.de/a/", content_md: "Hallo Welt" }),
      row({ id: "b", source_url: "http://x.de/a", content_md: "HALLO WELT" }),
      row({ id: "c", type: "ai_chat", source_url: "https://chat/c/1", metadata: { scope: "answer" } }),
      row({ id: "d", source_platform: "upload", content_md: "Text aus PDF" }),
    ],
    lib,
  );
  assert.deepEqual(plan.updates, [
    { id: "a", patch: { source_url_norm: "x.de/a", content_hash: "h:hallo welt" } },
    { id: "b", patch: { content_hash: "h:hallo welt" } },
  ]);
  assert.deepEqual(plan.urlDuplicates, [{ key: "x.de/a", ids: ["a", "b"] }]);
  assert.deepEqual(plan.hashDuplicates, [{ key: "bookmark:h:hallo welt", ids: ["a", "b"] }]);
});

test("is idempotent: a second run over filled rows plans nothing", async () => {
  const plan = await planBackfill(
    [row({ id: "a", source_url: "https://x.de/a", source_url_norm: "x.de/a", content_hash: "h:1" })],
    lib,
  );
  assert.deepEqual(plan.updates, []);
  assert.deepEqual(plan.urlDuplicates, []);
});
