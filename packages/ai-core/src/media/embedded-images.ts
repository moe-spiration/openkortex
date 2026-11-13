import { ph } from "../i18n";
import { deflateSync } from "node:zlib";
import { errorMessage } from "../errors";
import type { ModelRouter } from "../router/model-router";
import { analyzeImage, type VisionResult } from "../adapters/vision-ocr.adapter";

/*
 * Vision for images embedded in a clip or PDF (G5). Same model route and prompt as an image
 * upload (`vision_ocr`, see adapters/vision-ocr.adapter.ts), but capped: at most N images per item
 * (constant / env, not per-user config) so one illustrated article cannot burn the daily budget.
 * Calls go through the routed model, so the usual metering and the daily AI budget gate apply; the
 * first budget error ends the run. A failure never fails the ingest: it becomes a warning.
 */

export const DEFAULT_MAX_EMBEDDED_IMAGES = 5;
const HARD_MAX = 10;

/** N from KORTEX_MAX_EMBEDDED_IMAGES (0 = off), default 5, never above 10. */
export function maxEmbeddedImages(env: Record<string, string | undefined> = process.env): number {
  const raw = env.KORTEX_MAX_EMBEDDED_IMAGES?.trim();
  if (!raw) return DEFAULT_MAX_EMBEDDED_IMAGES;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) ? Math.min(HARD_MAX, Math.max(0, n)) : DEFAULT_MAX_EMBEDDED_IMAGES;
}

export interface ImageCandidate {
  /** "Seite 3", "Bild im Artikel": shown above the description. */
  label: string;
  /** Bigger first (PDF: pixel area); equal weight keeps the document order. */
  weight: number;
  /** Bytes + type, or null when the image can't be used (download failed, too small). */
  load: () => Promise<{ bytes: Uint8Array; mimeType: string } | null>;
}

export interface EmbeddedImagesResult {
  /** "## Bilder" section, or "" when nothing was described. */
  md: string;
  described: number;
  /** Candidates that were not described (cap, unusable, failed). */
  skipped: number;
  warnings: string[];
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

function renderImage(label: string, i: number, r: VisionResult): string {
  const out = [`### ${ph("image")} ${i} (${label})`, ""];
  if (r.description_md.trim()) out.push(clip(r.description_md.trim(), 1500), "");
  if (r.ocr_text.trim()) out.push("```text", clip(r.ocr_text.trim(), 1000), "```", "");
  return out.join("\n");
}

const isBudgetError = (err: unknown) =>
  /budget_exceeded|budget/i.test(`${(err as { code?: string })?.code ?? ""} ${errorMessage(err)}`);

/** Describes the best `max` candidates, one after the other. Never throws. */
export async function describeEmbeddedImages(
  models: ModelRouter,
  candidates: readonly ImageCandidate[],
  max = maxEmbeddedImages(),
): Promise<EmbeddedImagesResult> {
  const warnings: string[] = [];
  if (max <= 0 || candidates.length === 0)
    return { md: "", described: 0, skipped: candidates.length, warnings };
  const ordered = candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.weight - a.c.weight || a.i - b.i)
    .map((x) => x.c);
  const parts: string[] = [];
  let attempts = 0;
  for (const cand of ordered) {
    if (parts.length >= max || attempts >= max * 3) break;
    attempts++;
    let img: Awaited<ReturnType<ImageCandidate["load"]>>;
    try {
      img = await cand.load();
    } catch {
      img = null;
    }
    if (!img) continue;
    try {
      const result = await analyzeImage(models, img.bytes, img.mimeType);
      if (!result.description_md.trim() && !result.ocr_text.trim()) continue;
      parts.push(renderImage(cand.label, parts.length + 1, result));
    } catch (err) {
      warnings.push(`image vision (${cand.label}): ${errorMessage(err)}`);
      if (isBudgetError(err)) break; // the daily budget is used up: no more paid calls
    }
  }
  return {
    md: parts.length ? `## ${ph("images")}\n\n${parts.join("\n")}`.trimEnd() : "",
    described: parts.length,
    skipped: candidates.length - parts.length,
    warnings,
  };
}

// --- Raw pixels (pdf.js) -> PNG ----------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** 8-bit gray (1), RGB (3) or RGBA (4) pixels as a PNG. */
export function encodePng(
  width: number,
  height: number,
  channels: 1 | 3 | 4,
  data: Uint8Array | Uint8ClampedArray,
): Uint8Array {
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height); // filter byte 0 per row
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = channels === 1 ? 0 : channels === 3 ? 2 : 6;
  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
