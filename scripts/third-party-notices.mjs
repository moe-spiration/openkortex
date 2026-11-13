#!/usr/bin/env node
// Third-party notices: the license texts of every package the apps ship (npm production dependencies
// of all workspaces, the Rust crates of the Windows app, the Node.js runtime the Windows app bundles).
// MIT, BSD, Apache, ISC and OFL all ask that their notice travels with copies of the software, so the
// release workflow writes this file next to the downloads and into the Windows installer.
//
//   node scripts/third-party-notices.mjs --out THIRD-PARTY-NOTICES.md [--no-cargo]
//
// Needs installed dependencies (`pnpm install`); `cargo` only for the Rust part (skipped with a note
// when it is missing or with --no-cargo). Identical license texts are printed once, with every
// package that carries them.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LICENSE_FILE = /^(licen[cs]e|copying|notice|ofl)([-._].*)?(\.(md|txt|markdown))?$/i;

/** The license and notice files at the top of a package folder, sorted by name. */
export function licenseFiles(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => LICENSE_FILE.test(name))
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort();
}

/** One package: `{ name, version, license, homepage, ecosystem, text }` (text = its license files). */
export function packageEntry({ name, version, license, homepage, ecosystem, dir }) {
  const text = licenseFiles(dir)
    .map((f) => readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n").trim())
    .filter(Boolean)
    .join("\n\n");
  return {
    name,
    version,
    license: license || "unknown",
    homepage: homepage || "",
    ecosystem,
    text,
  };
}

/** npm: production dependencies of every workspace, as `pnpm licenses list` resolves them. */
export function npmEntries(root = repoRoot) {
  const res = spawnSync("pnpm", ["-r", "licenses", "list", "--prod", "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (res.status !== 0) throw new Error(`pnpm licenses list failed: ${res.stderr || res.stdout}`);
  const byLicense = JSON.parse(res.stdout);
  const out = [];
  for (const [license, pkgs] of Object.entries(byLicense)) {
    for (const p of pkgs) {
      p.versions.forEach((version, i) =>
        out.push(
          packageEntry({
            name: p.name,
            version,
            license,
            homepage: p.homepage,
            ecosystem: "npm",
            dir: p.paths?.[i] ?? p.paths?.[0],
          }),
        ),
      );
    }
  }
  return out;
}

/** Rust: every crate of the Windows app (registry and git sources; the app itself is left out). */
export function cargoEntries(root = repoRoot) {
  const manifest = join(root, "apps", "desktop", "src-tauri", "Cargo.toml");
  const res = spawnSync(
    "cargo",
    [
      "metadata",
      "--format-version",
      "1",
      "--manifest-path",
      manifest,
      "--filter-platform",
      "x86_64-pc-windows-msvc",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (res.error || res.status !== 0) return null;
  const meta = JSON.parse(res.stdout);
  return meta.packages
    .filter((p) => p.source)
    .map((p) =>
      packageEntry({
        name: p.name,
        version: p.version,
        license: p.license ?? (p.license_file ? `see ${p.license_file}` : ""),
        homepage: p.repository ?? p.homepage ?? "",
        ecosystem: "cargo",
        dir: dirname(p.manifest_path),
      }),
    );
}

/** The Node.js runtime the Windows app ships as its sync sidecar (scripts/build-sidecar.mjs copies this node). */
export function nodeRuntimeEntry() {
  const dir = dirname(process.execPath);
  const candidates = [dir, join(dir, "..")];
  const found = candidates.find((d) => existsSync(join(d, "LICENSE")));
  return {
    name: "Node.js runtime (node.exe of the Windows app)",
    version: process.version.replace(/^v/, ""),
    license: "MIT, plus the licenses of its bundled components",
    homepage: `https://github.com/nodejs/node/blob/${process.version}/LICENSE`,
    ecosystem: "runtime",
    text: found ? readFileSync(join(found, "LICENSE"), "utf8").replace(/\r\n/g, "\n").trim() : "",
  };
}

const fence = (text) => {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const f = "`".repeat(longest + 1);
  return `${f}text\n${text}\n${f}`;
};

/** The Markdown file: a table of every package, then each distinct license text once. */
export function renderNotices(entries, { product = "OpenKortex", notes = [] } = {}) {
  const sorted = [...entries].sort(
    (a, b) =>
      a.ecosystem.localeCompare(b.ecosystem) ||
      a.name.localeCompare(b.name) ||
      a.version.localeCompare(b.version, undefined, { numeric: true }),
  );
  const groups = new Map();
  for (const e of sorted) {
    const key = e.text ? createHash("sha256").update(e.text).digest("hex").slice(0, 12) : "";
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { text: e.text, pkgs: [] });
    groups.get(key).pkgs.push(e);
  }
  const ref = new Map([...groups.entries()].map(([k], i) => [k, `T${i + 1}`]));
  const keyOf = (e) =>
    e.text ? createHash("sha256").update(e.text).digest("hex").slice(0, 12) : "";
  const cell = (s) => String(s).replace(/\|/g, "\\|");
  const lines = [
    "# Third-party notices",
    "",
    `${product} is licensed under the GNU Affero General Public License v3.0 (see LICENSE). It ships the`,
    "third-party software listed below, each under its own license. The license texts follow the table;",
    "packages with an identical text share one entry.",
    "",
    ...notes.map((n) => `> ${n}\n`),
    "| Package | Version | Ecosystem | License | Text |",
    "| --- | --- | --- | --- | --- |",
    ...sorted.map((e) => {
      const k = keyOf(e);
      return `| ${cell(e.homepage ? `[${e.name}](${e.homepage})` : e.name)} | ${cell(e.version)} | ${e.ecosystem} | ${cell(e.license)} | ${k ? ref.get(k) : "no license file in the package"} |`;
    }),
    "",
    "## License texts",
    "",
  ];
  for (const [k, g] of groups) {
    lines.push(
      `### ${ref.get(k)}`,
      "",
      g.pkgs.map((p) => `${p.name}@${p.version}`).join(", "),
      "",
      fence(g.text),
      "",
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function productName(root) {
  try {
    return (
      JSON.parse(readFileSync(join(root, "packages", "i18n", "product.json"), "utf8")).name ||
      "OpenKortex"
    );
  } catch {
    return "OpenKortex";
  }
}

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--out");
  const out = i >= 0 ? args[i + 1] : undefined;
  if (!out) {
    console.error("Usage: node scripts/third-party-notices.mjs --out <file.md> [--no-cargo]");
    process.exit(2);
  }
  const entries = npmEntries();
  const notes = [];
  const cargo = args.includes("--no-cargo") ? null : cargoEntries();
  if (cargo) entries.push(...cargo, nodeRuntimeEntry());
  else
    notes.push(
      "The Rust crates of the Windows app are not listed in this file (generated without cargo).",
    );
  writeFileSync(out, renderNotices(entries, { product: productName(repoRoot), notes }));
  console.log(`third-party-notices: ${entries.length} packages → ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
