import { externalIdTokens, type KortexClient } from "@kortex/db";

// In-memory stand-in for the parts of supabase-js the API routes use:
// from().select/insert/update/upsert/delete + eq/neq/in/not/gte/lte/order/limit/single/maybeSingle,
// rpc(), storage.from().upload() and auth.getUser(). Every query is logged for assertions.

type Row = Record<string, unknown>;
type Op = "select" | "insert" | "update" | "upsert" | "delete";

export interface Filter {
  col: string;
  op:
    | "eq"
    | "ilike"
    | "neq"
    | "in"
    | "not_in"
    | "gte"
    | "lte"
    | "gt"
    | "lt"
    | "is"
    | "not_is"
    | "like"
    | "cs";
  value: unknown;
}

export interface QueryLog {
  table: string;
  op: Op;
  filters: Filter[];
  payload?: unknown;
}

const UNIQUE: Record<string, string[]> = {
  knowledge_items: ["id"],
  folders: ["user_id", "folder_path"],
  tags: ["user_id", "name"],
  cron_runs: ["user_id", "job", "period"],
};

let seq = 0;
const fakeId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

const cmp = (a: unknown, b: unknown) =>
  String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;

/** `metadata->>isbn` style PostgREST JSON path (text value). */
function cell(row: Row, col: string): unknown {
  // Generated column knowledge_items.external_ids (migration 20261101210000_external_ids.sql).
  if (col === "external_ids" && !("external_ids" in row)) return externalIdTokens(row.metadata);
  const at = col.indexOf("->>");
  if (at < 0) return row[col];
  // `metadata->watch->>enabled`: every `->` step walks into the JSON, `->>` reads the text value.
  const [base, ...path] = col.slice(0, at).split("->");
  let obj: unknown = row[base!];
  for (const key of path) obj = (obj as Row | null | undefined)?.[key];
  const inner = (obj as Row | null | undefined)?.[col.slice(at + 3)];
  return inner === undefined || inner === null ? null : String(inner);
}

function matches(row: Row, f: Filter): boolean {
  const v = cell(row, f.col);
  switch (f.op) {
    case "eq":
      return v === f.value;
    case "ilike": {
      // SQL ILIKE: % = any run, _ = one character, case-insensitive.
      const re = String(f.value)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/%/g, ".*")
        .replace(/_/g, ".");
      return typeof v === "string" && new RegExp(`^${re}$`, "is").test(v);
    }
    case "like":
      return typeof v === "string" && v.startsWith(String(f.value).replace(/%$/, ""));
    case "neq":
      return v !== f.value;
    case "in":
      return (f.value as unknown[]).includes(v);
    case "not_in":
      return !(f.value as unknown[]).includes(v);
    case "gte":
      return v !== null && v !== undefined && cmp(v, f.value) >= 0;
    case "lte":
      return v !== null && v !== undefined && cmp(v, f.value) <= 0;
    case "gt":
      return v !== null && v !== undefined && cmp(v, f.value) > 0;
    case "lt":
      return v !== null && v !== undefined && cmp(v, f.value) < 0;
    case "cs": {
      // Array containment with a Postgres array literal: {"a","b"}.
      const want = [...String(f.value).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) =>
        m[1]!.replace(/\\(.)/g, "$1"),
      );
      return Array.isArray(v) && want.every((w) => v.includes(w));
    }
    case "is":
      return (v ?? null) === f.value;
    case "not_is":
      return (v ?? null) !== f.value;
  }
}

export class FakeSupabase {
  tables: Record<string, Row[]> = {};
  log: QueryLog[] = [];
  rpcCalls: Array<{ name: string; args: unknown; userJwt: boolean }> = [];
  rpcHandlers: Record<string, (args: Record<string, unknown>) => unknown> = {};
  storage = new Map<string, { data: Uint8Array; contentType?: string }>();
  authUser: { id: string } | null = null;
  failures: Array<{ table: string; op: Op; message: string }> = [];
  now = () => "2026-10-23T08:00:00.000Z";
  /** Runs before every query (tests use it to simulate a concurrent writer). */
  onQuery?: (q: QueryLog) => void;
  /** Columns a filter may not use (simulates a migration that is not applied yet: error 42703). */
  missingColumns = new Set<string>();

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [t, rows] of Object.entries(seed)) this.tables[t] = rows.map((r) => ({ ...r }));
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  /** Make the next `op` on `table` fail with `message`. */
  failNext(table: string, op: Op, message = "boom") {
    this.failures.push({ table, op, message });
  }

  get client(): KortexClient {
    return {
      from: (table: string) => new FakeQuery(this, table),
      rpc: async (name: string, args: Record<string, unknown> = {}) => {
        this.rpcCalls.push({ name, args, userJwt: true });
        const handler = this.rpcHandlers[name];
        return { data: handler ? handler(args) : null, error: null };
      },
      storage: {
        from: (bucket: string) => ({
          upload: async (path: string, data: Uint8Array, opts?: { contentType?: string }) => {
            this.storage.set(`${bucket}/${path}`, { data, contentType: opts?.contentType });
            return { data: { path }, error: null };
          },
        }),
      },
      auth: {
        getUser: async () =>
          this.authUser
            ? { data: { user: this.authUser }, error: null }
            : { data: { user: null }, error: { message: "Auth session missing" } },
      },
    } as unknown as KortexClient;
  }
}

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private op: Op = "select";
  private payload: unknown;
  private filters: Filter[] = [];
  private orderBy: Array<{ col: string; asc: boolean }> = [];
  private lim?: number;
  private from_?: number;
  private mode: "many" | "single" | "maybe" = "many";
  private returning = false;
  private conflict?: string[];

  constructor(
    private db: FakeSupabase,
    private table: string,
  ) {}

  select() {
    if (this.op !== "select") this.returning = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  upsert(rows: Row | Row[], opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.conflict = opts?.onConflict?.split(",").map((s) => s.trim());
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  private f(col: string, op: Filter["op"], value: unknown) {
    this.filters.push({ col, op, value });
    return this;
  }
  eq(c: string, v: unknown) {
    return this.f(c, "eq", v);
  }
  filter(c: string, op: string, v: unknown) {
    if (op !== "ilike" && op !== "eq" && op !== "cs")
      throw new Error(`fake: filter.${op} unsupported`);
    return this.f(c, op, v);
  }
  ilike(c: string, v: string) {
    return this.f(c, "ilike", v);
  }
  like(c: string, v: string) {
    return this.f(c, "like", v);
  }
  neq(c: string, v: unknown) {
    return this.f(c, "neq", v);
  }
  in(c: string, v: unknown[]) {
    return this.f(c, "in", v);
  }
  gte(c: string, v: unknown) {
    return this.f(c, "gte", v);
  }
  lte(c: string, v: unknown) {
    return this.f(c, "lte", v);
  }
  gt(c: string, v: unknown) {
    return this.f(c, "gt", v);
  }
  lt(c: string, v: unknown) {
    return this.f(c, "lt", v);
  }
  is(c: string, v: unknown) {
    return this.f(c, "is", v);
  }
  not(c: string, op: string, v: unknown) {
    if (op === "is") return this.f(c, "not_is", v);
    if (op !== "in") throw new Error(`fake: not.${op} unsupported`);
    const list = String(v)
      .replace(/^\(|\)$/g, "")
      .split(",")
      .map((s) => s.trim());
    return this.f(c, "not_in", list);
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orderBy.push({ col, asc: opts.ascending ?? true });
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  range(from: number, to: number) {
    this.from_ = from;
    this.lim = to - from + 1;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  then<A = { data: unknown; error: unknown }, B = never>(
    resolve?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null,
    reject?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.exec())
      .then(resolve, reject);
  }

  private exec(): { data: unknown; error: unknown } {
    const db = this.db;
    db.log.push({
      table: this.table,
      op: this.op,
      filters: [...this.filters],
      payload: this.payload,
    });
    db.onQuery?.(db.log[db.log.length - 1] as QueryLog);
    const failIdx = db.failures.findIndex((x) => x.table === this.table && x.op === this.op);
    if (failIdx >= 0) {
      const [failure] = db.failures.splice(failIdx, 1);
      return { data: null, error: { message: failure?.message } };
    }
    const missing = this.filters.find((f) => db.missingColumns.has(f.col));
    if (missing)
      return {
        data: null,
        error: { code: "42703", message: `column ${this.table}.${missing.col} does not exist` },
      };
    const rows = db.rows(this.table);
    const hit = (r: Row) => this.filters.every((f) => matches(r, f));
    let result: Row[] = [];

    switch (this.op) {
      case "select":
        result = rows.filter(hit);
        break;
      case "insert":
      case "upsert": {
        for (const input of this.payload as Row[]) {
          // uq_items_user_source_url_norm: partial unique (user_id, source_url_norm) where not null
          if (
            this.table === "knowledge_items" &&
            input.source_url_norm &&
            rows.some(
              (r) => r.user_id === input.user_id && r.source_url_norm === input.source_url_norm,
            )
          )
            return {
              data: null,
              error: {
                message:
                  'duplicate key value violates unique constraint "uq_items_user_source_url_norm"',
                code: "23505",
              },
            };
          const keys = this.conflict ?? UNIQUE[this.table];
          const existing = keys
            ? rows.find((r) => keys.every((k) => r[k] === input[k]))
            : undefined;
          if (existing && this.op === "insert" && UNIQUE[this.table]) {
            return {
              data: null,
              error: { message: "duplicate key value violates unique constraint", code: "23505" },
            };
          }
          if (existing && this.op === "upsert") {
            Object.assign(existing, input);
            result.push(existing);
            continue;
          }
          const row: Row = { id: fakeId(), created_at: db.now(), updated_at: db.now(), ...input };
          rows.push(row);
          result.push(row);
        }
        break;
      }
      case "update":
        result = rows.filter(hit);
        for (const r of result) Object.assign(r, this.payload as Row, { updated_at: db.now() });
        break;
      case "delete":
        result = rows.filter(hit);
        db.tables[this.table] = rows.filter((r) => !hit(r));
        break;
    }

    if (this.op !== "select" && !this.returning) return { data: null, error: null };
    for (const o of [...this.orderBy].reverse()) {
      result = [...result].sort((a, b) => (o.asc ? 1 : -1) * cmp(a[o.col], b[o.col]));
    }
    if (this.from_ !== undefined) result = result.slice(this.from_);
    if (this.lim !== undefined) result = result.slice(0, this.lim);
    const copy = result.map((r) => ({ ...r }));
    if (this.mode === "single") {
      return copy.length === 1
        ? { data: copy[0], error: null }
        : { data: null, error: { message: `expected 1 row, got ${copy.length}` } };
    }
    if (this.mode === "maybe") return { data: copy[0] ?? null, error: null };
    return { data: copy, error: null };
  }
}
