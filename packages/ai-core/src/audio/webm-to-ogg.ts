// WebM/Opus → Ogg/Opus remux (container only, no re-encoding).
//
// Browsers record voice with MediaRecorder as `audio/webm;codecs=opus`. Eden AI's speech-to-text
// upload check rejects WebM ("File unrecognized or corrupted", HTTP 400) for every sub-provider,
// while Ogg/Opus, WAV and MP4 pass. Remuxing keeps the Opus packets as they are, so it is cheap
// and lossless and needs no ffmpeg. Handles MediaRecorder output: unknown-size Segment/Cluster,
// SimpleBlocks (or Blocks in BlockGroups) without lacing, one Opus track.

const ID = {
  ebml: 0x1a45dfa3,
  segment: 0x18538067,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackNumber: 0xd7,
  codecId: 0x86,
  codecPrivate: 0x63a2,
  audio: 0xe1,
  samplingFrequency: 0xb5,
  channels: 0x9f,
  cluster: 0x1f43b675,
  simpleBlock: 0xa3,
  blockGroup: 0xa0,
  block: 0xa1,
} as const;

/** Master elements we descend into (their payload is parsed as child elements). */
const MASTERS = new Set<number>([
  ID.segment,
  ID.tracks,
  ID.trackEntry,
  ID.audio,
  ID.cluster,
  ID.blockGroup,
]);

export class RemuxError extends Error {}

/** True when the bytes start with the EBML magic (WebM / Matroska). */
export const isWebm = (data: Uint8Array) =>
  data.length >= 4 && data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3;

interface Vint {
  value: number;
  length: number;
  unknown: boolean;
}

function readId(d: Uint8Array, pos: number): Vint {
  const first = d[pos];
  if (first === undefined) throw new RemuxError("unexpected end of WebM");
  let length = 1;
  while (length <= 4 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 4) throw new RemuxError("invalid EBML id");
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + (d[pos + i] ?? 0);
  return { value, length, unknown: false };
}

function readSize(d: Uint8Array, pos: number): Vint {
  const first = d[pos];
  if (first === undefined) throw new RemuxError("unexpected end of WebM");
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8) throw new RemuxError("invalid EBML size");
  let value = first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    const b = d[pos + i] ?? 0;
    value = value * 256 + b;
    if (b !== 0xff) allOnes = false;
  }
  return { value, length, unknown: allOnes };
}

const readUint = (d: Uint8Array, start: number, len: number) => {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + (d[start + i] ?? 0);
  return v;
};

function readFloat(d: Uint8Array, start: number, len: number): number {
  const view = new DataView(d.buffer, d.byteOffset + start, len);
  return len === 4 ? view.getFloat32(0) : len === 8 ? view.getFloat64(0) : 0;
}

interface OpusTrack {
  number: number;
  codec: string;
  head: Uint8Array | null;
  channels: number;
  rate: number;
}

/** Opus packets and the track header from a WebM file. */
export function demuxWebmOpus(d: Uint8Array): { track: OpusTrack; packets: Uint8Array[] } {
  if (!isWebm(d)) throw new RemuxError("not a WebM file");
  const tracks: OpusTrack[] = [];
  let cur: Partial<OpusTrack> = {};
  const blocks: { track: number; data: Uint8Array }[] = [];

  let pos = 0;
  while (pos < d.length) {
    const id = readId(d, pos);
    const size = readSize(d, pos + id.length);
    const start = pos + id.length + size.length;
    if (MASTERS.has(id.value)) {
      if (id.value === ID.trackEntry) {
        if (cur.codec !== undefined) tracks.push(finish(cur));
        cur = {};
      }
      pos = start; // descend (also for unknown sizes)
      continue;
    }
    if (size.unknown) throw new RemuxError("unknown size on a non-master element");
    const end = start + size.value;
    if (end > d.length) break; // truncated tail (recording cut off): keep what we have
    switch (id.value) {
      case ID.trackNumber:
        cur.number = readUint(d, start, size.value);
        break;
      case ID.codecId:
        cur.codec = new TextDecoder().decode(d.subarray(start, end));
        break;
      case ID.codecPrivate:
        cur.head = d.slice(start, end);
        break;
      case ID.channels:
        cur.channels = readUint(d, start, size.value);
        break;
      case ID.samplingFrequency:
        cur.rate = readFloat(d, start, size.value);
        break;
      case ID.simpleBlock:
      case ID.block: {
        const track = readSize(d, start); // track number is a vint without the marker bit
        const flags = d[start + track.length + 2] ?? 0;
        if (flags & 0x06) throw new RemuxError("laced WebM blocks are not supported");
        blocks.push({ track: track.value, data: d.slice(start + track.length + 3, end) });
        break;
      }
    }
    pos = end;
  }
  if (cur.codec !== undefined) tracks.push(finish(cur));

  const opus = tracks.find((t) => t.codec === "A_OPUS");
  if (!opus)
    throw new RemuxError(
      `no Opus track (found: ${tracks.map((t) => t.codec).join(", ") || "none"})`,
    );
  const packets = blocks.filter((b) => b.track === opus.number).map((b) => b.data);
  if (!packets.length) throw new RemuxError("WebM has no audio packets");
  return { track: opus, packets };

  function finish(t: Partial<OpusTrack>): OpusTrack {
    return {
      number: t.number ?? 1,
      head: t.head ?? null,
      channels: t.channels ?? 1,
      rate: t.rate ?? 48000,
      codec: t.codec ?? "",
    };
  }
}

/** Samples (at 48 kHz) in one Opus packet, from its TOC byte (RFC 6716 §3.1). */
export function opusPacketSamples(p: Uint8Array): number {
  const toc = p[0];
  if (toc === undefined) return 0;
  const config = toc >> 3;
  const frameMs =
    config < 12
      ? [10, 20, 40, 60][config % 4]!
      : config < 16
        ? [10, 20][config % 2]!
        : [2.5, 5, 10, 20][config % 4]!;
  const code = toc & 3;
  const frames = code === 0 ? 1 : code === 3 ? (p[1] ?? 0) & 0x3f : 2;
  return Math.round(frames * frameMs * 48);
}

// --- Ogg writer -------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let crc = 0;
  for (const b of data) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]!) >>> 0;
  return crc >>> 0;
}

function oggPage(
  packets: Uint8Array[],
  o: { granule: bigint; serial: number; seq: number; flags: number },
): Uint8Array {
  const lacing: number[] = [];
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) {
      lacing.push(255);
      n -= 255;
    }
    lacing.push(n);
  }
  if (lacing.length > 255) throw new RemuxError("Ogg page overflow");
  const body = packets.reduce((s, p) => s + p.length, 0);
  const page = new Uint8Array(27 + lacing.length + body);
  const v = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  page[4] = 0;
  page[5] = o.flags;
  v.setBigUint64(6, o.granule, true);
  v.setUint32(14, o.serial, true);
  v.setUint32(18, o.seq, true);
  page[26] = lacing.length;
  page.set(lacing, 27);
  let at = 27 + lacing.length;
  for (const p of packets) {
    page.set(p, at);
    at += p.length;
  }
  v.setUint32(22, crc32(page), true);
  return page;
}

function opusHead(channels: number, rate: number): Uint8Array {
  const h = new Uint8Array(19);
  const v = new DataView(h.buffer);
  h.set(new TextEncoder().encode("OpusHead"), 0);
  h[8] = 1;
  h[9] = channels;
  v.setUint16(10, 312, true); // pre-skip (libopus default)
  v.setUint32(12, Math.round(rate), true);
  return h;
}

function opusTags(): Uint8Array {
  const vendor = new TextEncoder().encode("kortex");
  const t = new Uint8Array(8 + 4 + vendor.length + 4);
  const v = new DataView(t.buffer);
  t.set(new TextEncoder().encode("OpusTags"), 0);
  v.setUint32(8, vendor.length, true);
  t.set(vendor, 12);
  v.setUint32(12 + vendor.length, 0, true);
  return t;
}

/** Remuxes MediaRecorder WebM/Opus into an Ogg/Opus file. Throws RemuxError for other WebM. */
export function webmOpusToOgg(webm: Uint8Array, serial = 0x4b6f7278 /* "Korx" */): Uint8Array {
  const { track, packets } = demuxWebmOpus(webm);
  const head =
    track.head && track.head.length >= 19 ? track.head : opusHead(track.channels, track.rate);
  const pages: Uint8Array[] = [
    oggPage([head], { granule: 0n, serial, seq: 0, flags: 0x02 }),
    oggPage([opusTags()], { granule: 0n, serial, seq: 1, flags: 0 }),
  ];
  let granule = 0n;
  let seq = 2;
  // Up to ~1 s of audio (50 × 20 ms) per page.
  for (let i = 0; i < packets.length; i += 50) {
    const chunk = packets.slice(i, i + 50);
    for (const p of chunk) granule += BigInt(opusPacketSamples(p));
    const last = i + 50 >= packets.length;
    pages.push(oggPage(chunk, { granule, serial, seq: seq++, flags: last ? 0x04 : 0 }));
  }
  const out = new Uint8Array(pages.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of pages) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
