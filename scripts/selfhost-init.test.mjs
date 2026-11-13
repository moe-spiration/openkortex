// selfhost/init.mjs: the address plan, the generated keys, and that the compose file only asks for
// variables the script writes (or that carry a default).
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildEnv, parseArgs, plan, signApiKey } from "../selfhost/init.mjs";

const selfhost = join(dirname(fileURLToPath(import.meta.url)), "..", "selfhost");
const parseEnv = (text) =>
  Object.fromEntries(
    text
      .split("\n")
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );

test("localhost: plain http on the port, MCP on, no loopback host", () => {
  const p = plan({ url: "http://localhost:8000" });
  assert.deepEqual(p, {
    origin: "http://localhost:8000",
    siteAddress: ":8000",
    httpPort: 8000,
    bind: "0.0.0.0",
    composeFiles: ["docker-compose.yml"],
    mcp: true,
  });
});

test("https domain: Caddy serves the domain on 80/443 and the web server resolves it locally", () => {
  const p = plan({ url: "https://kortex.example.com/" });
  assert.equal(p.siteAddress, "kortex.example.com");
  assert.equal(p.httpPort, 80);
  assert.deepEqual(p.composeFiles, ["docker-compose.yml", "docker-compose.https.yml"]);
  assert.equal(p.mcp, true);
});

test("behind another proxy: loopback port only, no local resolution", () => {
  const p = plan({ url: "https://kortex.example.com", behindProxy: true, port: "9000" });
  assert.equal(p.siteAddress, ":9000");
  assert.equal(p.bind, "127.0.0.1");
  assert.deepEqual(p.composeFiles, ["docker-compose.yml"]);
});

test("LAN address over http: works, MCP stays off", () => {
  const p = plan({ url: "http://192.168.1.20:8000" });
  assert.equal(p.mcp, false);
});

test("bad addresses are refused with a reason", () => {
  assert.throws(() => plan({ url: "kortex.example.com" }), /full address/);
  assert.throws(() => plan({ url: "ftp://kortex.example.com" }), /http:\/\/ or https:\/\//);
  assert.throws(() => plan({ url: "http://localhost:8000/app" }), /without a path/);
  assert.throws(() => plan({ url: "https://localhost" }), /domain name/);
  assert.throws(() => plan({ url: "https://192.168.1.20" }), /domain name/);
  assert.throws(() => plan({ url: "https://kortex.example.com:8443" }), /default port/);
  assert.throws(
    () => plan({ url: "https://kortex.example.com", behindProxy: true, port: "x" }),
    /port number/,
  );
});

test("API keys are HS256 JWTs with the role, signed with the JWT secret", () => {
  const key = signApiKey("service_role", "s3cret", 1_800_000_000);
  const [head, body, sig] = key.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(head, "base64url").toString()), {
    alg: "HS256",
    typ: "JWT",
  });
  const claims = JSON.parse(Buffer.from(body, "base64url").toString());
  assert.equal(claims.role, "service_role");
  assert.equal(claims.exp - claims.iat, 10 * 365 * 24 * 3600);
  assert.equal(sig, createHmac("sha256", "s3cret").update(`${head}.${body}`).digest("base64url"));
});

test("buildEnv: owner, generated password, secrets differ per run", () => {
  const a = buildEnv({ url: "http://localhost:8000", email: " Owner@Example.com " });
  const b = buildEnv({ url: "http://localhost:8000", email: "owner@example.com" });
  const ea = parseEnv(a.text);
  const eb = parseEnv(b.text);
  assert.equal(ea.KORTEX_OWNER_EMAIL, "owner@example.com");
  assert.equal(a.generatedPassword, true);
  assert.ok(ea.KORTEX_OWNER_PASSWORD.length >= 16);
  assert.match(ea.KORTEX_USER_ID, /^[0-9a-f-]{36}$/);
  for (const name of [
    "POSTGRES_PASSWORD",
    "JWT_SECRET",
    "ANON_KEY",
    "SERVICE_ROLE_KEY",
    "KORTEX_CRON_SECRET",
    "MCP_OAUTH_SECRET",
    "KORTEX_USER_ID",
  ]) {
    assert.notEqual(ea[name], eb[name], name);
  }
  assert.ok(ea.JWT_SECRET.length >= 40);
  assert.ok(ea.MCP_OAUTH_SECRET.length >= 32);
  assert.throws(() => buildEnv({ url: "http://localhost:8000", email: "nobody" }), /--email/);
  assert.throws(
    () => buildEnv({ url: "http://localhost:8000", email: "a@b.c", password: "short" }),
    /8 characters/,
  );
  assert.equal(
    buildEnv({ url: "http://localhost:8000", email: "a@b.c", password: "long enough" })
      .generatedPassword,
    false,
  );
});

test("parseArgs: flags with and without a value", () => {
  assert.deepEqual(
    parseArgs(["--url", "http://x", "--behind-proxy", "--port", "9000", "--force"]),
    {
      url: "http://x",
      "behind-proxy": true,
      port: "9000",
      force: true,
    },
  );
  assert.throws(() => parseArgs(["oops"]), /Unexpected argument/);
});

test("compose files only use variables that init writes or that have a default", () => {
  const written = new Set(
    Object.keys(parseEnv(buildEnv({ url: "http://localhost:8000", email: "a@b.c" }).text)),
  );
  const documented = new Set(
    Object.keys(parseEnv(readFileSync(join(selfhost, ".env.example"), "utf8"))),
  );
  for (const file of ["docker-compose.yml", "docker-compose.https.yml"]) {
    const text = readFileSync(join(selfhost, file), "utf8");
    for (const [, name, fallback] of text.matchAll(/\$\{([A-Z0-9_]+)(:-[^}]*)?\}/g)) {
      assert.ok(
        written.has(name) || fallback !== undefined,
        `${file}: \${${name}} is neither written by init.mjs nor has a default`,
      );
    }
  }
  // every variable init writes is explained in .env.example, and the other way round
  assert.deepEqual([...written].sort(), [...documented].sort());
});

test("no fixed address or account in the self-hosting files", () => {
  for (const file of [
    "docker-compose.yml",
    "docker-compose.https.yml",
    "Caddyfile",
    "setup-owner.mjs",
    "cron.mjs",
    "migrate.sh",
  ]) {
    const text = readFileSync(join(selfhost, file), "utf8");
    assert.doesNotMatch(
      text,
      /https?:\/\/(?!localhost|web:|auth:|rest:|storage:|realtime:|mcp:|127\.0\.0\.1|:)[a-z0-9.-]+\.[a-z]{2,}/i,
      file,
    );
  }
});

test("the web app has no page under a path the gateway hands to another service", async () => {
  const { readdirSync, statSync } = await import("node:fs");
  const app = join(selfhost, "..", "apps", "web", "src", "app");
  const taken = new Set(["rest", "realtime", "storage", "mcp", "oauth", ".well-known"]);
  const topLevel = [];
  // route groups "(name)" do not add a path segment: look one level into them
  for (const entry of readdirSync(app)) {
    const full = join(app, entry);
    if (!statSync(full).isDirectory()) continue;
    if (entry.startsWith("(")) topLevel.push(...readdirSync(full));
    else topLevel.push(entry);
  }
  for (const segment of topLevel)
    assert.ok(
      !taken.has(segment),
      `apps/web has a route "/${segment}", which the self-hosting gateway sends elsewhere`,
    );
  // /auth is shared: the gateway only takes /auth/v1
  const authDirs = topLevel.includes("auth") ? readdirSync(join(app, "(auth)", "auth")) : [];
  assert.ok(
    !authDirs.includes("v1"),
    'apps/web has a route "/auth/v1", which belongs to Supabase Auth',
  );
});
