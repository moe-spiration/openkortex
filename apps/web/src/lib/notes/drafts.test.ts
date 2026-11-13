// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clearDraft, saveDrafts, takeRestorableDrafts } from "./drafts";

const T0 = new Date("2026-10-25T10:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

beforeEach(() => window.localStorage.clear());

describe("note drafts", () => {
  it("restores a draft when the server copy is older and different", () => {
    saveDrafts([["n1", "lokal"]], T0);
    const r = takeRestorableDrafts({ n1: { contentMd: "server", updatedAt: "2026-10-25T09:59:00Z" } }, later(1000));
    expect(r).toEqual([{ id: "n1", md: "lokal" }]);
    // Taken: storage is empty afterwards.
    expect(takeRestorableDrafts({ n1: { contentMd: "server" } }, later(2000))).toEqual([]);
  });

  it("drops a draft when the server copy changed after it (edit on another device)", () => {
    saveDrafts([["n1", "lokal"]], T0);
    expect(takeRestorableDrafts({ n1: { contentMd: "anderswo", updatedAt: "2026-10-25T10:05:00Z" } }, later(10 * 60_000))).toEqual([]);
  });

  it("drops drafts that equal the server text, of unknown notes, or older than two weeks", () => {
    saveDrafts([["same", "x"], ["gone", "y"], ["old", "z"]], new Date(T0.getTime() - 15 * 24 * 3600_000));
    saveDrafts([["same", "x"], ["gone", "y"]], T0);
    expect(takeRestorableDrafts({ same: { contentMd: "x" }, old: { contentMd: "alt" } }, later(1000))).toEqual([]);
  });

  it("clearDraft removes the draft only for the saved text", () => {
    saveDrafts([["n1", "v2"]], T0);
    clearDraft("n1", "v1");
    expect(takeRestorableDrafts({ n1: { contentMd: "v0" } }, later(1000))).toEqual([{ id: "n1", md: "v2" }]);
    saveDrafts([["n1", "v2"]], T0);
    clearDraft("n1", "v2");
    expect(takeRestorableDrafts({ n1: { contentMd: "v0" } }, later(1000))).toEqual([]);
  });
});
