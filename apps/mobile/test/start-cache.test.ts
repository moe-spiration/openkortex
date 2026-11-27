import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({ default: {} }));

import { fitSnapshot, parseSnapshot, snapshotKey, type StartSnapshot } from "../src/data/startCache";
import type { ItemRow } from "../src/data/live";

const row = (id: string, body: string) => ({ id, title: id, content_md: body }) as unknown as ItemRow;
const snap = (items: ItemRow[]): StartSnapshot => ({ v: 1, at: 1, items, tasks: [], home: null, life: null });

describe("start cache", () => {
  it("keeps whole rows, newest first, until the budget is used", () => {
    const items = [row("a", "x".repeat(400)), row("b", "y".repeat(400)), row("c", "z".repeat(400))];
    const fit = fitSnapshot(snap(items), 1000)!;
    expect(fit.items.map((r) => r.id)).toEqual(["a", "b"]);
    // Never shortened: a row is either in whole or not at all.
    expect(fit.items[0]!.content_md).toHaveLength(400);
  });

  it("stores nothing when not even the rest fits", () => {
    expect(fitSnapshot(snap([]), 10)).toBeNull();
  });

  it("reads only its own format", () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot("{broken")).toBeNull();
    expect(parseSnapshot(JSON.stringify({ v: 2, items: [] }))).toBeNull();
    expect(parseSnapshot(JSON.stringify(snap([row("a", "b")])))?.items).toHaveLength(1);
  });

  it("is per account and server, and off without an account", () => {
    expect(snapshotKey("https://a", "User@Example.com")).toBe(snapshotKey("https://a", "user@example.com"));
    expect(snapshotKey("https://a", "m@x.de")).not.toBe(snapshotKey("https://b", "m@x.de"));
    expect(snapshotKey("https://a", null)).toBeNull();
  });
});
