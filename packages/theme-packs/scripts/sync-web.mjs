// Copies media/ (only the files the manifest lists, plus the manifest) to apps/web/public/theme-packs.
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "..", "..", "apps", "web", "public", "theme-packs");
const m = JSON.parse(readFileSync(join(root, "media", "manifest.json"), "utf8"));
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
let n = 0;
const walk = (o) => {
  if (o && typeof o === "object") {
    if (typeof o.file === "string" && typeof o.sha === "string") {
      const to = join(dest, o.file);
      mkdirSync(dirname(to), { recursive: true });
      cpSync(join(root, "media", o.file), to);
      n++;
    } else Object.values(o).forEach(walk);
  }
};
walk(m.packs);
console.log(`theme-packs: ${n} files -> apps/web/public/theme-packs`);
