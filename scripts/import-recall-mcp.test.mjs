import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchCard, listCards, parseArgs, rateLimitWaitMs, toolJson } from "./import-recall-mcp.mjs";

test("dry run, limit 10 by default, capped at 20 unless --all", () => {
  assert.deepEqual(parseArgs([]), {
    limit: 10,
    apply: false,
    all: false,
    json: false,
    user: undefined,
  });
  assert.equal(parseArgs(["--limit", "20", "--apply"]).limit, 20);
  assert.throws(() => parseArgs(["--limit", "21"]), /cap of 20/);
  assert.equal(parseArgs(["--all"]).limit, Number.POSITIVE_INFINITY);
  assert.throws(() => parseArgs(["--force"]), /unknown argument/);
});

test("tool results: JSON text part, structured content, errors", () => {
  assert.deepEqual(toolJson({ content: [{ type: "text", text: '{"a":1}' }] }), { a: 1 });
  assert.deepEqual(toolJson({ structuredContent: { b: 2 } }), { b: 2 });
  assert.throws(
    () => toolJson({ isError: true, content: [{ type: "text", text: "rate limit" }] }),
    /rate limit/,
  );
});

test("lists cards oldest first across pages, up to the limit", async () => {
  const calls = [];
  const call = async (name, args) => {
    calls.push([name, args]);
    return args.cursor
      ? { results: [{ id: "c" }], has_more: false }
      : { results: [{ id: "a" }, { id: "b" }], has_more: true, next_cursor: "n1" };
  };
  const cards = await listCards(call, 3);
  assert.deepEqual(
    cards.map((c) => c.id),
    ["a", "b", "c"],
  );
  assert.equal(calls[0][1].sort_order, "asc");
  assert.deepEqual(
    (await listCards(call, 1)).map((c) => c.id),
    ["a"],
  );
});

test("fetches every content page of a card", async () => {
  const call = async (name, args) => {
    assert.equal(name, "fetch");
    assert.equal(args.part, "content");
    return args.cursor
      ? { text: " Teil 2", has_more: false }
      : {
          id: "x",
          title: "T",
          text: "Teil 1",
          metadata: { source_url: "https://a.b" },
          has_more: true,
          next_cursor: "p2",
        };
  };
  const card = await fetchCard(call, "x");
  assert.equal(card.text, "Teil 1 Teil 2");
  assert.equal(card.metadata.source_url, "https://a.b");
});

test("Recall's rate-limit message waits as long as it says", () => {
  const e = new Error(
    "recall: Recall allows 180 requests per minute per account. Try again in 16 seconds.",
  );
  assert.equal(rateLimitWaitMs(e), 17_000);
  assert.equal(rateLimitWaitMs(new Error("HTTP 429")), 20_000);
  assert.equal(rateLimitWaitMs(new Error("recall: card not found")), null);
});
