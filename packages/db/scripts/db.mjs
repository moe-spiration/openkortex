#!/usr/bin/env node
// Kortex DB helper for the self-hosted Supabase (Coolify). See ../README.md.
//
//   node scripts/db.mjs tunnel        open an SSH tunnel to the supabase-db container
//   node scripts/db.mjs push [args]   apply pending migrations (Supabase CLI, via SUPABASE_DB_URL)
//   node scripts/db.mjs types         generate src/types.gen.ts via the server's postgres-meta
//   node scripts/db.mjs types:cli     same via `supabase gen types --db-url` (needs local Docker)
//   node scripts/db.mjs reload        ask PostgREST to reload its schema cache (apply does it too)
//   node scripts/db.mjs lint          lint pending migrations (--offline <files>: without SSH)
//   node scripts/db.mjs apply         lint + mandatory rolled-back dry run + apply (--dry-run stops before applying)
//   node scripts/db.mjs verify        RLS/bootstrap test in a rolled-back transaction (--with-migrations pre-apply)
//
// Config comes from the repo root .env.local / .env (never committed).
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadInstance } from "../../../scripts/lib/instance.mjs";
import { applyOverride, lintMigration, parseOverride, RULES } from "./migration-lint.mjs";

const SUPABASE_CLI = "supabase@2.121.0";
const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(pkgDir, "../..");
const typesFile = join(pkgDir, "src", "types.gen.ts");

for (const file of [".env.local", ".env"]) {
  const p = join(rootDir, file);
  if (existsSync(p)) process.loadEnvFile(p);
}

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (!value) {
    console.error(`Missing ${name}. Set it in the repo root .env.local (see .env.example).`);
    process.exit(1);
  }
  return value;
};

// Coolify names the containers `supabase-db-<service uuid>`; the uuid comes from the environment or
// from the private overlay file (kortex.instance.json), never from this file.
const serviceUuid = () => env("KORTEX_SUPABASE_SERVICE_UUID", loadInstance(rootDir).supabaseServiceUuid);

const sshArgs = () => {
  const args = ["-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes"];
  if (process.env.KORTEX_SSH_KEY) args.push("-i", process.env.KORTEX_SSH_KEY);
  return [...args, env("KORTEX_SSH_HOST")];
};

const containerIp = (container) =>
  execFileSync(
    "ssh",
    [
      ...sshArgs(),
      `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' ${container}`,
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split(/\s+/)[0];

// Run the Supabase CLI through npm's npx without a shell (keeps the DB URL unmangled on Windows).
const runSupabase = (args, options = {}) => {
  const nodeDir = dirname(process.execPath);
  const npxCli = [
    join(nodeDir, "node_modules/npm/bin/npx-cli.js"),
    join(nodeDir, "../lib/node_modules/npm/bin/npx-cli.js"),
  ].find(existsSync);
  if (!npxCli) throw new Error("Could not locate npx-cli.js next to the node binary.");
  return spawn(process.execPath, [npxCli, "-y", SUPABASE_CLI, ...args], {
    cwd: pkgDir,
    stdio: "inherit",
    ...options,
  });
};

// Format generated types with the repo's Prettier config (keeps diffs small).
const formatTypes = () => {
  const prettier = createRequire(import.meta.url).resolve("prettier/bin/prettier.cjs");
  execFileSync(process.execPath, [prettier, "--write", typesFile], { stdio: "ignore" });
};

/** Tells PostgREST to reload its schema cache (new tables/columns become visible to the API). */
function reloadSchema() {
  execFileSync(
    "ssh",
    [...sshArgs(), `docker exec -i supabase-db-${serviceUuid()} psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q`],
    { input: "notify pgrst, 'reload schema';\n", stdio: ["pipe", "inherit", "inherit"] },
  );
  console.log("PostgREST schema cache reload requested.");
}

/** Migration versions already applied on the server (read-only query). */
const appliedVersions = () =>
  new Set(
    execFileSync(
      "ssh",
      [
        ...sshArgs(),
        `docker exec -i supabase-db-${serviceUuid()} psql -U postgres -d postgres -At -c "select version from supabase_migrations.schema_migrations"`,
      ],
      { encoding: "utf8" },
    )
      .split(/\s+/)
      .filter(Boolean),
  );

const exitWith = (child) => child.on("exit", (code) => process.exit(code ?? 1));

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const migrationsDir = join(pkgDir, "supabase", "migrations");

/** Migration files whose version is not recorded on the server, in filename order. */
const pendingMigrations = (applied) =>
  readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql") && !applied.has(f.split("_")[0]))
    .sort();

const latestVersion = (applied) => [...applied].sort().at(-1) ?? null;

/** Runs SQL through psql in the supabase-db container; output goes to the terminal, throws on error. */
const runPsql = (sql) =>
  execFileSync(
    "ssh",
    [...sshArgs(), `docker exec -i supabase-db-${serviceUuid()} psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q`],
    { input: sql, stdio: ["pipe", "inherit", "inherit"] },
  );

/** Lints files and prints the findings. True when nothing blocks. */
function guardMigrations(paths, latestApplied, allowed, reason) {
  let ok = true;
  for (const path of paths) {
    const name = basename(path);
    const findings = lintMigration(name, readFileSync(path, "utf8"), { latestApplied });
    const { blocking, overridden } = applyOverride(findings, allowed);
    if (!findings.length) console.log(`lint ok   ${name}`);
    for (const f of blocking) console.error(`BLOCKED   ${name}:${f.line}  [${f.rule}] ${f.message}`);
    for (const f of overridden) console.warn(`OVERRIDE  ${name}:${f.line}  [${f.rule}] ${f.message} — reason: ${reason}`);
    if (blocking.length) ok = false;
  }
  if (!ok) {
    console.error(
      `\nFix the migration, or override a rule only with good reason:\n  --allow <${Object.keys(RULES).join("|")}>[,…] --reason "<why>"`,
    );
  }
  return ok;
}

const [command, ...rest] = process.argv.slice(2).filter((a) => a !== "--");

switch (command) {
  case "tunnel": {
    const ip = containerIp(`supabase-db-${serviceUuid()}`);
    const localPort = new URL(env("SUPABASE_DB_URL")).port || "54322";
    console.log(`Tunnel 127.0.0.1:${localPort} -> supabase-db (${ip}:5432). Ctrl+C to close.`);
    exitWith(
      spawn("ssh", ["-N", "-L", `127.0.0.1:${localPort}:${ip}:5432`, ...sshArgs()], {
        stdio: "inherit",
      }),
    );
    break;
  }
  case "push": {
    exitWith(runSupabase(["db", "push", "--db-url", env("SUPABASE_DB_URL"), ...rest]));
    break;
  }
  case "types": {
    const container = `supabase-meta-${serviceUuid()}`;
    const ts = execFileSync(
      "ssh",
      [
        ...sshArgs(),
        `IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${container}); ` +
          `curl -sf "http://$IP:8080/generators/typescript?included_schemas=kortex&detect_one_to_one_relationships=true"`,
      ],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    if (!ts.includes("export type Database")) throw new Error("Unexpected generator output.");
    writeFileSync(typesFile, ts);
    formatTypes();
    console.log(`Wrote ${typesFile}`);
    break;
  }
  case "types:cli": {
    const child = runSupabase(
      ["gen", "types", "typescript", "--db-url", env("SUPABASE_DB_URL"), "--schema", "kortex"],
      { stdio: ["inherit", "pipe", "inherit"] },
    );
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("exit", (code) => {
      if (code === 0) {
        writeFileSync(typesFile, out);
        formatTypes();
      }
      process.exit(code ?? 1);
    });
    break;
  }
  case "verify": {
    // Runs supabase/tests/verify_rls.sql inside ONE transaction that is always
    // rolled back. With --with-migrations, all migrations run first (pre-apply check on an empty
    // schema); with --pending, only those not yet recorded in supabase_migrations.schema_migrations
    // (pre-apply check of a new migration against the live DB).
    const parts = ["begin;"];
    const all = rest.includes("--with-migrations");
    const pending = rest.includes("--pending");
    if (all || pending) {
      const applied = pending ? appliedVersions() : new Set();
      const dir = join(pkgDir, "supabase", "migrations");
      for (const f of readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort()) {
        if (applied.has(f.split("_")[0])) continue;
        console.log(`(rolled back) ${f}`);
        parts.push(readFileSync(join(dir, f), "utf8"));
      }
    }
    parts.push(readFileSync(join(pkgDir, "supabase", "tests", "verify_rls.sql"), "utf8"));
    parts.push(readFileSync(join(pkgDir, "supabase", "tests", "verify_access.sql"), "utf8"));
    parts.push("rollback;");
    const child = spawn(
      "ssh",
      [
        ...sshArgs(),
        `docker exec -i supabase-db-${serviceUuid()} psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q`,
      ],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    child.stdin.end(parts.join("\n"));
    exitWith(child);
    break;
  }
  case "lint": {
    // Lints the pending migrations against the live history (SSH), or the given files offline
    // (`lint -- --offline supabase/migrations/2026…_x.sql`, no stale-timestamp check).
    const offline = rest.includes("--offline");
    const files = offline
      ? rest.filter((a) => a.endsWith(".sql")).map((p) => resolve(p))
      : pendingMigrations(appliedVersions()).map((f) => join(migrationsDir, f));
    const latest = offline ? null : latestVersion(appliedVersions());
    const { allowed, reason, error } = parseOverride(rest);
    if (error) fail(error);
    const ok = guardMigrations(files, latest, allowed, reason);
    process.exit(ok ? 0 : 1);
    break;
  }
  case "apply": {
    // Prod guard, then apply. Every run does, in this order, and stops at the first failure:
    //   1. lint every pending file (migration-lint.mjs); override only with
    //      `--allow <rule>[,<rule>] --reason "<why>"`
    //   2. mandatory dry run: all pending files + the RLS/access tests in ONE transaction that is
    //      rolled back, output shown
    //   3. apply: each file in ONE transaction together with its schema_migrations row
    // `--dry-run` stops after step 2.
    const applied = appliedVersions();
    const todo = pendingMigrations(applied);
    if (!todo.length) {
      console.log("Nothing to apply.");
      break;
    }
    const { allowed, reason, error } = parseOverride(rest);
    if (error) fail(error);
    if (!guardMigrations(todo.map((f) => join(migrationsDir, f)), latestVersion(applied), allowed, reason)) {
      fail("Lint failed, nothing applied.");
    }
    console.log(`\nDry run (rolled back): ${todo.join(", ")}`);
    try {
      runPsql(
        [
          "begin;",
          ...todo.map((f) => readFileSync(join(migrationsDir, f), "utf8")),
          readFileSync(join(pkgDir, "supabase", "tests", "verify_rls.sql"), "utf8"),
          readFileSync(join(pkgDir, "supabase", "tests", "verify_access.sql"), "utf8"),
          "rollback;",
        ].join("\n"),
      );
    } catch {
      fail("Dry run failed (rolled back), nothing applied.");
    }
    console.log("Dry run passed.");
    if (rest.includes("--dry-run")) break;
    const dir = migrationsDir;
    for (const f of todo) {
      const [version, ...nameParts] = f.replace(/\.sql$/, "").split("_");
      const sql = [
        "begin;",
        readFileSync(join(dir, f), "utf8"),
        `insert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${nameParts.join("_")}');`,
        "commit;",
      ].join("\n");
      execFileSync(
        "ssh",
        [...sshArgs(), `docker exec -i supabase-db-${serviceUuid()} psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q`],
        { input: sql, stdio: ["pipe", "inherit", "inherit"] },
      );
      console.log(`Applied ${f}`);
    }
    reloadSchema();
    break;
  }
  case "reload": {
    // PostgREST keeps a schema cache: after DDL outside a migration (or one without the notify),
    // new tables/columns stay invisible to the API until it reloads.
    reloadSchema();
    break;
  }
  case "allow": {
    // Kortex allowlist (S2a): `allow <user_id|email> [--role owner|admin|member] [--remove]`.
    // An email without an account becomes a pending invite (claimed on signup, same as
    // Settings → Zugang). Values are checked before they reach SQL.
    const [who, ...flags] = rest.filter((a) => a !== "--");
    const role = flags.includes("--role") ? flags[flags.indexOf("--role") + 1] : "member";
    const remove = flags.includes("--remove");
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(who ?? "");
    const isEmail = /^[^\s'@]+@[^\s'@]+\.[^\s'@]+$/.test(who ?? "");
    if ((!isUuid && !isEmail) || !["owner", "admin", "member"].includes(role)) {
      console.error("Usage: node scripts/db.mjs allow <user_id|email> [--role owner|admin|member] [--remove]");
      process.exit(1);
    }
    const match = isUuid ? `u.id = '${who}'` : `lower(u.email) = lower('${who}')`;
    const invite = isEmail ? `lower('${who}')` : "null";
    const sql = remove
      ? `with m as (delete from kortex.allowed_users a using auth.users u where a.user_id = u.id and ${match} returning a.role),
         i as (delete from kortex.allowlist_invites where email = ${invite} returning role)
         select role from m union all select role from i;`
      : `insert into kortex.allowed_users (user_id, email, role) select u.id, u.email, '${role}' from auth.users u where ${match}
         on conflict (user_id) do update set role = excluded.role, email = excluded.email returning role;`;
    const psql = (input) =>
      execFileSync(
        "ssh",
        [...sshArgs(), `docker exec -i supabase-db-${serviceUuid()} psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At`],
        { input, encoding: "utf8" },
      ).trim();
    const out = psql(sql);
    if (!out && !remove && isEmail) {
      psql(`insert into kortex.allowlist_invites (email, role) values (${invite}, '${role}')
        on conflict (email) do update set role = excluded.role, invited_at = now();`);
      console.log(`No account yet: invite saved as ${role}; it applies when ${who} signs up.`);
      break;
    }
    if (!out) {
      console.error(remove ? "Not on the allowlist." : "No such account in auth.users (sign up first).");
      process.exit(1);
    }
    console.log(remove ? "Removed from the Kortex allowlist." : `On the Kortex allowlist as ${role}.`);
    break;
  }
  default:
    console.error("Usage: node scripts/db.mjs <tunnel|push|apply|reload|types|types:cli|verify|allow> [args]");
    process.exit(1);
}
