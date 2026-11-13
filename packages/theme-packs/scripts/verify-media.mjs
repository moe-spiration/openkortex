// Checks every file of media/manifest.json: exists, SHA-256 prefix and byte size match (acceptance Q8).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const media = join(dirname(fileURLToPath(import.meta.url)), "..", "media");
const m = JSON.parse(readFileSync(join(media, "manifest.json"), "utf8"));
const bad = [];
let n = 0;
const walk = (o) => {
  if (o && typeof o === "object") {
    if (typeof o.file === "string" && typeof o.sha === "string") {
      n++;
      const p = join(media, o.file);
      if (!existsSync(p)) return bad.push(`missing ${o.file}`);
      const b = readFileSync(p);
      const sha = createHash("sha256").update(b).digest("hex").slice(0, o.sha.length);
      if (sha !== o.sha) bad.push(`sha ${o.file}: ${sha} != ${o.sha}`);
      if (typeof o.bytes === "number" && b.length !== o.bytes) bad.push(`bytes ${o.file}: ${b.length} != ${o.bytes}`);
    } else Object.values(o).forEach(walk);
  }
};
walk(m.packs);
if (bad.length) {
  console.error(bad.slice(0, 20).join("\n"), `\n${bad.length} of ${n} files differ`);
  process.exit(1);
}
console.log(`media ok: ${n} files match the manifest`);
