import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "./reindex.mjs";

test("dry run over Recall imports by default", () => {
  assert.deepEqual(parseArgs([]), {
    apply: false,
    scope: "recall",
    json: false,
    user: undefined,
    passes: { tools: true, links: true, embeddings: true },
  });
});

test("flags", () => {
  const a = parseArgs(["--", "--apply", "--scope", "all", "--no-tools", "--no-embeddings"]);
  assert.equal(a.apply, true);
  assert.equal(a.scope, "all");
  assert.deepEqual(a.passes, { tools: false, links: true, embeddings: false });
  assert.throws(() => parseArgs(["--scope", "x"]), /recall\|all/);
  assert.throws(() => parseArgs(["--force"]), /unknown argument/);
});
