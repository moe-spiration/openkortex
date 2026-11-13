// Renders the Kortex "Second Half" mark (same geometry as @kortex/ui AppMark) to PNG icons.
// No dependencies: SDF-style supersampling + a minimal PNG encoder. Run: node scripts/gen-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icon");
const SIZES = [16, 32, 48, 128];
const SS = 4; // supersampling per axis

const ACCENT = [0x4f, 0x46, 0xe5];
const WHITE = [255, 255, 255];
const ARC = [0xc7, 0xd2, 0xfe];

// geometry in the 64x64 viewBox of the AppMark SVG
const inRoundRect = (x, y) => {
  const r = 64 * 0.26;
  const cx = Math.min(Math.max(x, r), 64 - r);
  const cy = Math.min(Math.max(y, r), 64 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const inHalfDisc = (x, y) => x <= 30 && (x - 30) ** 2 + (y - 32) ** 2 <= 18 ** 2;
const onArc = (x, y) => {
  const d = Math.hypot(x - 36, y - 32);
  if (x >= 36 && Math.abs(d - 15.6) <= 2.5) return true;
  return Math.hypot(x - 36, y - 16.4) <= 2.5 || Math.hypot(x - 36, y - 47.6) <= 2.5;
};

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sj = 0; sj < SS; sj++) {
        for (let si = 0; si < SS; si++) {
          const x = ((i + (si + 0.5) / SS) / size) * 64;
          const y = ((j + (sj + 0.5) / SS) / size) * 64;
          if (!inRoundRect(x, y)) continue;
          const c = inHalfDisc(x, y) ? WHITE : onArc(x, y) ? ARC : ACCENT;
          r += c[0]; g += c[1]; b += c[2]; a += 1;
        }
      }
      const o = (j * size + i) * 4;
      if (a > 0) {
        px[o] = Math.round(r / a); px[o + 1] = Math.round(g / a); px[o + 2] = Math.round(b / a);
      }
      px[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size) {
  const rgba = render(size);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const s of SIZES) writeFileSync(join(OUT, `${s}.png`), png(s));
console.log(`wrote ${SIZES.length} icons to ${OUT}`);
