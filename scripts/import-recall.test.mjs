import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs, selectFiles } from "./import-recall.mjs";

test("dry run with limit 10 by default", () => {
  const a = parseArgs(["C:/exports"]);
  assert.equal(a.folder, "C:/exports");
  assert.equal(a.apply, false);
  assert.equal(a.limit, 10);
  assert.equal(a.ai, "content");
  assert.equal(a.recrawl, true);
  assert.equal(parseArgs(["x", "--no-recrawl"]).recrawl, false);
  assert.equal(a.objects, false);
  assert.equal(parseArgs(["x", "--with-objects"]).objects, true);
});

test("limit is hard-capped at 20 unless --all", () => {
  assert.equal(parseArgs(["x", "--limit", "15", "--apply"]).limit, 15);
  assert.equal(parseArgs(["x", "--limit", "20"]).limit, 20);
  assert.throws(() => parseArgs(["x", "--limit", "21"]), /cap of 20/);
  assert.throws(() => parseArgs(["x", "--limit", "1114", "--apply"]), /cap/);
  assert.throws(() => parseArgs(["x", "--limit", "0"]), /at least 1/);
  assert.throws(() => parseArgs(["x", "--limit", "abc"]), /positive integer/);
  assert.equal(parseArgs(["x", "--all"]).limit, Number.POSITIVE_INFINITY);
  assert.equal(parseArgs(["x", "--all", "--limit", "50"]).limit, 50);
});

test("argument errors", () => {
  assert.throws(() => parseArgs([]), /usage/);
  assert.throws(() => parseArgs(["x", "--force"]), /unknown argument/);
  assert.throws(() => parseArgs(["x", "--ai", "max"]), /content\|all\|none/);
});

test("selects the first N markdown files by name, skips conflict copies", () => {
  const names = ["b.md", "a.md", "c.txt", "a.conflict-1.md", "C.md"];
  assert.deepEqual(selectFiles(names, 2), ["a.md", "b.md"]);
  assert.deepEqual(selectFiles(names, 10), ["a.md", "b.md", "C.md"]);
});
