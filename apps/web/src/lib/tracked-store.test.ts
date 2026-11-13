// @vitest-environment jsdom
import { act, createContext, createElement, useContext, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTracked, useTrackedStore, type TrackedStore } from "./tracked-store";

interface State {
  a: number;
  b: number;
  items: Record<string, string>;
  get: (id: string) => string | undefined;
  bumpA: () => void;
  bumpB: () => void;
}

const Ctx = createContext<TrackedStore<State> | null>(null);
let api: { bumpA: () => void; bumpB: () => void; setItem: (id: string, v: string) => void } | null = null;

function Provider({ children }: { children: ReactNode }) {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [items, setItems] = useState<Record<string, string>>({ x: "1" });
  // A new state object every render, like the shell and notes providers.
  const value: State = { a, b, items, get: (id) => items[id], bumpA: () => setA((n) => n + 1), bumpB: () => setB((n) => n + 1) };
  api = { bumpA: value.bumpA, bumpB: value.bumpB, setItem: (id, v) => setItems((all) => ({ ...all, [id]: v })) };
  const store = useTrackedStore(value, { get: "items" });
  return createElement(Ctx.Provider, { value: store }, children);
}
const useS = () => useTracked(useContext(Ctx)!);

const renders: Record<string, number> = {};
const seen: Record<string, unknown> = {};
const count = (k: string) => (renders[k] = (renders[k] ?? 0) + 1);
let actionRefs: unknown[] = [];

function ReadsA() {
  count("a");
  seen.a = useS().a;
  return null;
}
function ActionsOnly() {
  count("actions");
  const { bumpA } = useS();
  actionRefs.push(bumpA);
  return null;
}
function UsesGetter() {
  count("getter");
  seen.x = useS().get("x");
  return null;
}
function Conditional({ readB }: { readB: boolean }) {
  count("cond");
  const s = useS();
  seen.cond = readB ? s.b : s.a;
  return null;
}

let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  for (const k of Object.keys(renders)) delete renders[k];
  actionRefs = [];
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(() => root.unmount());
});

const mount = (...children: ReactNode[]) => act(() => root.render(createElement(Provider, null, ...children)));

describe("tracked store", () => {
  it("re-renders a consumer only when a field it read changes", async () => {
    await mount(createElement(ReadsA, { key: 1 }), createElement(ActionsOnly, { key: 2 }));
    expect(renders).toEqual({ a: 1, actions: 1 });
    await act(() => api!.bumpB());
    expect(renders).toEqual({ a: 1, actions: 1 });
    await act(() => api!.bumpA());
    expect(renders).toEqual({ a: 2, actions: 1 });
    expect(seen.a).toBe(1);
  });

  it("hands out stable actions that call the latest implementation", async () => {
    await mount(createElement(ActionsOnly, { key: 1 }), createElement(ReadsA, { key: 2 }));
    const first = actionRefs[0] as () => void;
    await act(() => api!.bumpB());
    await act(() => first());
    await act(() => first());
    expect(seen.a).toBe(2);
    expect(renders.actions).toBe(1);
  });

  it("a getter declared in `reads` subscribes to its field", async () => {
    await mount(createElement(UsesGetter, { key: 1 }));
    expect(seen.x).toBe("1");
    await act(() => api!.bumpA());
    expect(renders.getter).toBe(1);
    await act(() => api!.setItem("x", "2"));
    expect(seen.x).toBe("2");
    expect(renders.getter).toBe(2);
  });

  it("follows what the last render read", async () => {
    await mount(createElement(Conditional, { key: 1, readB: false }));
    await act(() => api!.bumpB());
    expect(renders.cond).toBe(1);
    await act(() => root.render(createElement(Provider, null, createElement(Conditional, { key: 1, readB: true }))));
    expect(renders.cond).toBe(2);
    await act(() => api!.bumpA());
    expect(renders.cond).toBe(2);
    await act(() => api!.bumpB());
    expect(renders.cond).toBe(3);
    expect(seen.cond).toBe(2);
  });
});
