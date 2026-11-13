import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hookArgs } from "./precommit.mjs";

describe("pre-commit hook arguments", () => {
  it("runs typecheck and lint only by default, on affected packages", () => {
    assert.deepEqual(hookArgs({ withTests: false, hasParent: true }), ["turbo", "run", "typecheck", "lint", "--concurrency=2", "--filter=...[HEAD^1]"]);
  });
  it("adds the tests when KORTEX_HOOK_TESTS=1", () => {
    assert.deepEqual(hookArgs({ withTests: true, hasParent: true }), ["turbo", "run", "typecheck", "lint", "test", "--concurrency=2", "--filter=...[HEAD^1]"]);
  });
  it("does a full run when there is no HEAD^1", () => {
    assert.ok(!hookArgs({ withTests: false, hasParent: false }).some((a) => a.startsWith("--filter")));
  });
  it("reads the opt-in from the environment", () => {
    const old = process.env.KORTEX_HOOK_TESTS;
    process.env.KORTEX_HOOK_TESTS = "1";
    assert.ok(hookArgs({ hasParent: true }).includes("test"));
    delete process.env.KORTEX_HOOK_TESTS;
    assert.ok(!hookArgs({ hasParent: true }).includes("test"));
    if (old !== undefined) process.env.KORTEX_HOOK_TESTS = old;
  });
});
