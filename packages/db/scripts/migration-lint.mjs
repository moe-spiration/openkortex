// Migration linter for `db:apply` (prod guard). Pure functions, no I/O, so it is unit-tested.
//
// Blocks statements that can lose data or break the shared Supabase instance, and the mistakes
// that already happened once (see docs/handover/e1-db-final-handover.md, "Traps"):
//   drop-table, drop-column, drop-schema, truncate, delete-without-where, alter-column-type,
//   missing-allowlist-policy, stale-timestamp, transaction-control, bad-filename
// A finding can only be overridden with `--allow <rule>[,<rule>] --reason "<why>"` (see db.mjs).

export const RULES = {
  "drop-table": "DROP TABLE loses data",
  "drop-column": "DROP COLUMN loses data",
  "drop-schema": "DROP SCHEMA loses data (and dropping kortex makes PostgREST return 503 for every app)",
  truncate: "TRUNCATE loses data",
  "delete-without-where": "DELETE without WHERE removes every row",
  "alter-column-type": "ALTER COLUMN … TYPE rewrites the table and can fail or truncate values",
  "missing-allowlist-policy":
    'new kortex table without the restrictive policy "kortex: allowlisted users only"',
  "stale-timestamp": "version is older than the newest applied migration (it would run after newer ones)",
  "transaction-control": "BEGIN/COMMIT/ROLLBACK in the file (db:apply wraps every file in its own transaction)",
  "bad-filename": "file name must be <14-digit version>_<snake_case_name>.sql",
};

/** Replaces comments and quoted literals with spaces (keeps offsets), optionally dollar-quoted bodies too. */
export function maskSql(sql, { maskDollarBodies = false } = {}) {
  let out = "";
  let i = 0;
  const blank = (s) => s.replace(/[^\n]/g, " ");
  while (i < sql.length) {
    const rest = sql.slice(i);
    let m;
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      out += blank(sql.slice(i, stop));
      i = stop;
    } else if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += blank(sql.slice(i, stop));
      i = stop;
    } else if (rest[0] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      out += "'" + blank(sql.slice(i + 1, j)) + "'";
      i = j + 1;
    } else if (rest[0] === '"') {
      // quoted identifiers stay (policy names are matched on the raw text), only skip over them
      const end = sql.indexOf('"', i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop;
    } else if ((m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest))) {
      const tag = m[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      out += maskDollarBodies ? tag + blank(sql.slice(i + tag.length, stop - tag.length)) + tag : sql.slice(i, stop);
      i = stop;
    } else {
      out += sql[i];
      i++;
    }
  }
  return out;
}

const lineOf = (sql, index) => sql.slice(0, index).split("\n").length;

/** Splits masked SQL into statements with their start offset (splits inside function bodies too). */
function statements(masked) {
  const result = [];
  let start = 0;
  for (let i = 0; i <= masked.length; i++) {
    if (i === masked.length || masked[i] === ";") {
      const text = masked.slice(start, i);
      if (text.trim()) result.push({ text, index: start + (text.length - text.trimStart().length) });
      start = i + 1;
    }
  }
  return result;
}

/**
 * Lints one migration file.
 * @param {string} fileName e.g. "20261101000000_add_x.sql"
 * @param {string} sql file contents
 * @param {{ latestApplied?: string | null }} [context] newest version already applied on the server
 * @returns {{ rule: string, line: number, message: string }[]}
 */
export function lintMigration(fileName, sql, { latestApplied = null } = {}) {
  const findings = [];
  const add = (rule, index, detail) =>
    findings.push({ rule, line: index == null ? 0 : lineOf(sql, index), message: detail ?? RULES[rule] });

  const nameMatch = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(fileName);
  if (!nameMatch) add("bad-filename", null);
  const version = nameMatch?.[1] ?? fileName.split("_")[0];
  if (latestApplied && version < latestApplied) {
    add("stale-timestamp", null, `${RULES["stale-timestamp"]}: ${version} < ${latestApplied}`);
  }

  const masked = maskSql(sql).toLowerCase();
  for (const { text, index } of statements(masked)) {
    const s = text.trim();
    if (/\bdrop\s+table\b/.test(s)) add("drop-table", index);
    if (/\bdrop\s+column\b/.test(s)) add("drop-column", index);
    if (/\bdrop\s+schema\b/.test(s)) add("drop-schema", index);
    // `revoke/grant … truncate on …` is a privilege, not the statement
    if (/\btruncate\b/.test(s) && !/^(grant|revoke)\b/.test(s)) add("truncate", index);
    const del = /\bdelete\s+from\b/.exec(s);
    if (del && !/\bwhere\b/.test(s.slice(del.index))) add("delete-without-where", index);
    if (/\balter\s+column\s+[\w"]+\s+(set\s+data\s+)?type\b/.test(s)) add("alter-column-type", index);
    if (/^alter\s+table\b[\s\S]*\balter\s+(?!column\b)[\w"]+\s+(set\s+data\s+)?type\b/.test(s)) {
      add("alter-column-type", index);
    }
  }

  // Transaction control only counts at the top level, not inside plpgsql bodies (begin … end).
  const top = maskSql(sql, { maskDollarBodies: true }).toLowerCase();
  for (const { text, index } of statements(top)) {
    if (/^(begin|commit|rollback|end|start\s+transaction|abort)\b/.test(text.trim())) {
      add("transaction-control", index);
    }
  }

  // Every new kortex table needs the restrictive allow-list gate in the same file.
  const lower = maskSql(sql).toLowerCase();
  const created = [...lower.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?kortex\.("?)(\w+)\1/g)];
  for (const m of created) {
    const table = m[2];
    const gate = new RegExp(
      `create\\s+policy\\s+"kortex: allowlisted users only"\\s+on\\s+kortex\\."?${table}"?\\s+as\\s+restrictive\\b`,
    );
    if (!gate.test(lower)) {
      add("missing-allowlist-policy", m.index, `${RULES["missing-allowlist-policy"]}: kortex.${table}`);
    }
  }

  return findings.sort((a, b) => a.line - b.line);
}

/**
 * Parses `--allow rule1,rule2 --reason "…"`. The reason is required (at least 10 characters) and
 * every rule must exist.
 * @returns {{ allowed: Set<string>, reason: string | null, error: string | null }}
 */
export function parseOverride(args) {
  const allowed = new Set();
  let reason = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--allow") for (const r of (args[++i] ?? "").split(",").filter(Boolean)) allowed.add(r);
    else if (args[i] === "--reason") reason = (args[++i] ?? "").trim() || null;
  }
  const unknown = [...allowed].filter((r) => !(r in RULES));
  if (unknown.length) return { allowed, reason, error: `unknown rule(s): ${unknown.join(", ")}` };
  if (allowed.size && (!reason || reason.length < 10)) {
    return { allowed, reason, error: '--allow needs --reason "<why, at least 10 characters>"' };
  }
  return { allowed, reason, error: null };
}

/** Splits findings into blocking ones and the ones an override accepts. */
export function applyOverride(findings, allowed) {
  return {
    blocking: findings.filter((f) => !allowed.has(f.rule)),
    overridden: findings.filter((f) => allowed.has(f.rule)),
  };
}
