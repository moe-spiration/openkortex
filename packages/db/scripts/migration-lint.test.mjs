import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyOverride, lintMigration, maskSql, parseOverride, RULES } from "./migration-lint.mjs";

const NAME = "20261101000000_example.sql";
const rules = (sql, name = NAME, ctx) => lintMigration(name, sql, ctx).map((f) => f.rule);

const gate = (t) =>
  `create policy "kortex: allowlisted users only" on kortex.${t} as restrictive for all to authenticated using (kortex.is_allowed()) with check (kortex.is_allowed());`;

describe("blocking rules", () => {
  it.each([
    ["drop table kortex.tags;", "drop-table"],
    ["drop table if exists kortex.tags cascade;", "drop-table"],
    ["alter table kortex.tags drop column color;", "drop-column"],
    ["alter table kortex.tags drop column if exists color;", "drop-column"],
    ["drop schema kortex cascade;", "drop-schema"],
    ["truncate kortex.tags;", "truncate"],
    ["truncate table kortex.tags restart identity;", "truncate"],
    ["delete from kortex.tags;", "delete-without-where"],
    ["DELETE FROM kortex.tags", "delete-without-where"],
    ["alter table kortex.tags alter column color type varchar(7);", "alter-column-type"],
    ["alter table kortex.tags alter column color set data type text;", "alter-column-type"],
    ["alter table kortex.tags alter color type text;", "alter-column-type"],
    ["begin;\nselect 1;\ncommit;", "transaction-control"],
    ["start transaction;", "transaction-control"],
    ["select 1;\nrollback;", "transaction-control"],
  ])("%s → %s", (sql, rule) => {
    expect(rules(sql)).toContain(rule);
  });

  it("flags a new kortex table without the allow-list gate", () => {
    const sql = "create table if not exists kortex.notes2 (id uuid primary key);";
    const [f] = lintMigration(NAME, sql);
    expect(f?.rule).toBe("missing-allowlist-policy");
    expect(f?.message).toContain("kortex.notes2");
  });

  it("accepts a new kortex table with the gate", () => {
    const sql = `create table kortex.notes2 (id uuid primary key);\nalter table kortex.notes2 enable row level security;\n${gate("notes2")}`;
    expect(rules(sql)).toEqual([]);
  });

  it("requires the gate for every new table, not just one", () => {
    const sql = `create table kortex.a (id int);\ncreate table kortex.b (id int);\n${gate("a")}`;
    const found = lintMigration(NAME, sql);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("kortex.b");
  });

  it("flags a version older than the newest applied one", () => {
    expect(rules("select 1;", "20261031000000_late.sql", { latestApplied: "20261031200000" })).toEqual([
      "stale-timestamp",
    ]);
    expect(rules("select 1;", "20261101000000_new.sql", { latestApplied: "20261031200000" })).toEqual([]);
  });

  it("flags bad file names", () => {
    expect(rules("select 1;", "2026_new.sql")).toContain("bad-filename");
    expect(rules("select 1;", "20261101000000_New-Name.sql")).toContain("bad-filename");
  });

  it("reports the line of the statement", () => {
    const [f] = lintMigration(NAME, "select 1;\n\n  drop table kortex.tags;");
    expect(f).toMatchObject({ rule: "drop-table", line: 3 });
  });
});

describe("no false positives", () => {
  it.each([
    "alter table kortex.user_settings drop constraint if exists x_check;",
    'drop policy if exists "Users read own" on kortex.tags;',
    "drop function if exists kortex.f(text);",
    "drop index if exists kortex.idx_x;",
    "drop trigger if exists t on kortex.tags;",
    "revoke insert, update, delete, truncate on kortex.ai_model_catalog from authenticated;",
    "delete from kortex.tags where user_id = auth.uid();",
    "-- drop table kortex.tags;\nselect 1;",
    "/* truncate kortex.tags; */ select 1;",
    "comment on table kortex.tags is 'never drop table here; delete from x';",
    "alter table kortex.tags add column note text;",
    "alter table kortex.tags alter column note set default 'x';",
    "alter type kortex.mood add value 'calm';",
    // plpgsql bodies have begin … end, which is not transaction control
    `create or replace function kortex.f() returns void language plpgsql as $$
begin
  delete from kortex.tags t where t.usage_count = 0;
end;
$$;`,
    `do $body$ begin perform 1; end $body$;`,
  ])("%s", (sql) => {
    expect(rules(sql)).toEqual([]);
  });

  it("still sees a destructive statement inside a function body", () => {
    const sql = `create function kortex.f() returns void language plpgsql as $$ begin delete from kortex.tags; end; $$;`;
    expect(rules(sql)).toEqual(["delete-without-where"]);
  });
});

describe("real migrations", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  it("every migration since the ingest_jobs gate fix passes", () => {
    for (const f of files.filter((f) => f >= "20261028020000")) {
      expect({ f, findings: lintMigration(f, readFileSync(join(dir, f), "utf8")) }).toEqual({ f, findings: [] });
    }
  });

  it("would have caught the ingest_jobs table without its allow-list gate", () => {
    const f = files.find((x) => x.startsWith("20261028010000"));
    expect(f).toBeDefined();
    const found = lintMigration(f ?? "", readFileSync(join(dir, f ?? ""), "utf8"));
    expect(found.map((x) => x.message)).toContain(`${RULES["missing-allowlist-policy"]}: kortex.ingest_jobs`);
  });
});

describe("override", () => {
  it("needs a reason of at least 10 characters", () => {
    expect(parseOverride(["--allow", "drop-column"]).error).toMatch(/--reason/);
    expect(parseOverride(["--allow", "drop-column", "--reason", "short"]).error).toMatch(/--reason/);
    expect(parseOverride(["--allow", "drop-column", "--reason", "column was never used by any client"]).error).toBeNull();
  });

  it("rejects unknown rules", () => {
    expect(parseOverride(["--allow", "drop-everything", "--reason", "because I said so"]).error).toMatch(/unknown/);
  });

  it("only lets the named rules through", () => {
    const findings = lintMigration(NAME, "alter table kortex.tags drop column color;\ntruncate kortex.tags;");
    const { allowed } = parseOverride(["--allow", "drop-column", "--reason", "column replaced by color_hex"]);
    const { blocking, overridden } = applyOverride(findings, allowed);
    expect(overridden.map((f) => f.rule)).toEqual(["drop-column"]);
    expect(blocking.map((f) => f.rule)).toEqual(["truncate"]);
  });

  it("without --allow nothing is overridden", () => {
    expect(parseOverride([]).allowed.size).toBe(0);
    expect(parseOverride([]).error).toBeNull();
  });
});

describe("maskSql", () => {
  it("keeps offsets so line numbers stay right", () => {
    const sql = "-- c\nselect 'a;b';\n/* x\ny */ select 1;";
    expect(maskSql(sql)).toHaveLength(sql.length);
    expect(maskSql(sql).split("\n")).toHaveLength(sql.split("\n").length);
  });
});
