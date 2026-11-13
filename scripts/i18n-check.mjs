#!/usr/bin/env node
// Translation check: every English source text used in code has a German catalog entry.
//
//   node scripts/i18n-check.mjs                    all workspaces that have src/i18n/de/
//   node scripts/i18n-check.mjs apps/web           one workspace
//   node scripts/i18n-check.mjs apps/web --leftovers [sub/dir]
//                                                  also list code lines that still look German
//
// Sources are the string literals in t("…"), tx("ctx", "…"), tn(n, "…", "…"), tFor(l, "…") and
// msg("…") (see packages/i18n). Catalogs are the JSON files in <workspace>/src/i18n/de/. The check
// fails on a source without an entry, an entry no code uses, and one source with two different
// translations. `--leftovers` is a work list, not a gate: it guesses by umlauts and common words.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CODE = /\.(?:ts|tsx|mts|js|jsx|mjs)$/;
const SKIP_DIR = new Set(["node_modules", "i18n", "__tests__", "dist", ".next", ".output", ".wxt", "target", "gen"]);
const STR = String.raw`"((?:[^"\\\n]|\\.)*)"`;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIR.has(name)) walk(full, out);
    } else if (CODE.test(name) && !/\.(?:test|spec)\.|\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

const unquote = (raw) => JSON.parse(`"${raw}"`);

/** Catalog keys a piece of source code uses. */
export function extractSources(code) {
  const keys = new Set();
  const each = (re, fn) => {
    for (const m of code.matchAll(re)) fn(m);
  };
  each(new RegExp(String.raw`(?<![\w.$])(?:t|msg)\(\s*${STR}`, "g"), (m) => keys.add(unquote(m[1])));
  each(new RegExp(String.raw`(?<![\w.$])tFor\(\s*[^,()]+,\s*${STR}`, "g"), (m) => keys.add(unquote(m[1])));
  each(new RegExp(String.raw`(?<![\w.$])tx\(\s*${STR}\s*,\s*${STR}`, "g"), (m) => keys.add(`${unquote(m[1])}::${unquote(m[2])}`));
  each(new RegExp(String.raw`(?<![\w.$])tn\(\s*(?:[^,()]|\([^()]*\))+,\s*${STR}\s*,\s*${STR}`, "g"), (m) => {
    keys.add(unquote(m[1]));
    keys.add(unquote(m[2]));
  });
  return keys;
}

const GERMAN_WORD =
  /(?<![\w-])(?:und|oder|nicht|keine?n?|wird|wurde|werden|für|mit|von|aus|bei|nach|über|unter|noch|schon|heute|gestern|morgen|bitte|Fehler|Einstellungen|Speichern|Abbrechen|Löschen|Öffnen|Schließen|Suche|Suchen|Hinzufügen|Bearbeiten|Entfernen|Zurück|Weiter|Fertig|Neu|Neue|Neuer|Neues|Alle|Kein|Keine|Eintrag|Einträge|Ordner|Aufgabe|Aufgaben|Notiz|Notizen|Datei|Dateien|Verbindung|Konto|Sprache|Erstellt|Geändert|Zuletzt|Mehr|Weniger|Anzeigen|Ausblenden|Wähle|Wählen|Lädt|Laden|Kopieren|Kopiert|Einfügen|Hochladen|Herunterladen|Abmelden|Anmelden|Uhr)(?![\w-])/;

/** Lines whose string literals or JSX text still look German. */
export function findLeftovers(code) {
  const hits = [];
  let inBlock = false;
  code.split("\n").forEach((raw, i) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end < 0) return;
      line = line.slice(end + 2);
      inBlock = false;
    }
    line = line.replace(/\/\*.*?\*\//g, "");
    const open = line.indexOf("/*");
    if (open >= 0) {
      inBlock = true;
      line = line.slice(0, open);
    }
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
    line = line.replace(/(^|[^:"'`\\])\/\/.*$/, "$1");
    const texts = [...line.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`|>([^<>{}]+)</g)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4] ?? "");
    if (texts.some((s) => /[äöüÄÖÜß]/.test(s) || (/[A-Za-z]{3}/.test(s) && /\s/.test(s.trim()) && GERMAN_WORD.test(s)))) hits.push({ line: i + 1, text: trimmed.slice(0, 160) });
  });
  return hits;
}

function loadCatalog(dir) {
  const entries = new Map();
  const problems = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    const data = JSON.parse(readFileSync(join(dir, name), "utf8"));
    for (const [key, value] of Object.entries(data)) {
      if (typeof value !== "string" || !value.trim()) problems.push(`${name}: empty translation for ${JSON.stringify(key)}`);
      else if (entries.has(key) && entries.get(key).value !== value) problems.push(`${JSON.stringify(key)} is translated differently in ${entries.get(key).file} and ${name}`);
      else entries.set(key, { value, file: name });
    }
  }
  return { entries, problems };
}

export function checkWorkspace(root, ws) {
  const src = join(root, ws, "src");
  const catalogDir = join(src, "i18n", "de");
  const used = new Map();
  for (const file of walk(src)) {
    for (const key of extractSources(readFileSync(file, "utf8"))) if (!used.has(key)) used.set(key, relative(root, file));
  }
  if (!existsSync(catalogDir)) return { ws, used: used.size, problems: used.size ? [`no catalog directory ${relative(root, catalogDir)}`] : [] };
  const { entries, problems } = loadCatalog(catalogDir);
  for (const [key, file] of used) if (!entries.has(key)) problems.push(`missing German entry for ${JSON.stringify(key)} (${file})`);
  for (const [key, e] of entries) if (!used.has(key)) problems.push(`${e.file}: unused entry ${JSON.stringify(key)}`);
  return { ws, used: used.size, problems };
}

function workspaces(root) {
  const out = [];
  for (const group of ["apps", "packages"]) {
    for (const name of readdirSync(join(root, group))) if (existsSync(join(root, group, name, "src", "i18n", "de"))) out.push(`${group}/${name}`);
  }
  return out;
}

export function main(argv = process.argv.slice(2), root = repoRoot, log = console) {
  const at = argv.indexOf("--leftovers");
  const leftovers = at >= 0;
  const sub = leftovers && argv[at + 1] && !argv[at + 1].startsWith("-") ? argv[at + 1] : "";
  const list = argv.filter((a, i) => !a.startsWith("-") && !(leftovers && sub && i === at + 1));
  const targets = list.length ? list : workspaces(root);
  let failed = 0;
  for (const ws of targets) {
    const res = checkWorkspace(root, ws.replace(/\/+$/, ""));
    if (res.problems.length) {
      failed += res.problems.length;
      log.error(`i18n ${ws}: ${res.problems.length} problem(s)`);
      for (const p of res.problems.slice(0, 200)) log.error(`  ${p}`);
      if (res.problems.length > 200) log.error(`  … and ${res.problems.length - 200} more`);
    } else log.log(`i18n ${ws}: ok (${res.used} texts)`);
    if (leftovers) {
      const base = join(root, ws, "src", sub);
      let n = 0;
      for (const file of walk(base)) {
        for (const h of findLeftovers(readFileSync(file, "utf8"))) {
          n += 1;
          log.log(`  ${relative(root, file)}:${h.line}: ${h.text}`);
        }
      }
      log.log(`leftovers ${ws}${sub ? `/src/${sub}` : ""}: ${n} line(s) still look German`);
    }
  }
  return failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main());
