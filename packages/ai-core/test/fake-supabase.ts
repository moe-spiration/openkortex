import type { KortexClient } from "@kortex/db";

// Minimal in-memory stand-in for the supabase-js query builder: the chains the routing helpers use
// (select / update / upsert with eq, is, order, range, maybeSingle). Not a general fake.

type Row = Record<string, unknown>;

export function fakeKortexClient(tables: Record<string, Row[]>) {
  const calls: Array<{ table: string; op: string; patch?: unknown }> = [];

  const builder = (table: string) => {
    let op: "select" | "update" | "upsert" = "select";
    let patch: Row | Row[] | undefined;
    let single = false;
    let range: [number, number] | undefined;
    const filters: Array<(r: Row) => boolean> = [];
    const rows = () => (tables[table] ??= []);

    const run = () => {
      calls.push({ table, op, ...(patch ? { patch } : {}) });
      if (op === "upsert") {
        for (const p of patch as Row[]) {
          const i = rows().findIndex((r) => r.id === p.id);
          if (i >= 0) rows()[i] = { ...rows()[i], ...p };
          else rows().push({ ...p });
        }
        return { data: null, error: null };
      }
      let hit = rows().filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        hit.forEach((r) => Object.assign(r, structuredClone(patch)));
        hit = hit.map((r) => ({ ...r }));
      }
      if (range) hit = hit.slice(range[0], range[1] + 1);
      const data = hit.map((r) => structuredClone(r));
      return { data: single ? (data[0] ?? null) : data, error: null };
    };

    const q = {
      select: () => q,
      update: (p: Row) => ((op = "update"), (patch = p), q),
      upsert: (p: Row[]) => ((op = "upsert"), (patch = p), q),
      eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), q),
      is: (col: string, v: unknown) => (filters.push((r) => (r[col] ?? null) === v), q),
      order: () => q,
      range: (a: number, b: number) => ((range = [a, b]), q),
      maybeSingle: () => ((single = true), q),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
        Promise.resolve().then(run).then(ok, bad),
    };
    return q;
  };

  const client = { from: (table: string) => builder(table) } as unknown as KortexClient;
  return { client, tables, calls };
}
