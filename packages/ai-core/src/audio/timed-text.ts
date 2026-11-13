import type { TranscriptSegment } from "./transcriber";

// Publisher transcripts from `<podcast:transcript>`: WebVTT, SRT and Podcasting 2.0 JSON.

const CUE_TIME = /(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function cueSeconds(ts: string): number {
  const m = ts.match(CUE_TIME);
  if (!m) return 0;
  return (
    Number(m[1]?.slice(0, -1) ?? 0) * 3600 +
    Number(m[2]) * 60 +
    Number(m[3]) +
    Number((m[4] ?? "0").padEnd(3, "0")) / 1000
  );
}

/** WebVTT or SRT cues → segments. `<v Name>` voice tags become the speaker. */
export function parseCues(text: string): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  const blocks = text
    .replace(/\r\n/g, "\n")
    .replace(/^WEBVTT[^\n]*\n/, "")
    .split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim());
    const timeIdx = lines.findIndex((l) => l.includes("-->"));
    if (timeIdx < 0) continue;
    const [from, to] = (lines[timeIdx] as string).split("-->").map((s) => s.trim());
    let body = lines.slice(timeIdx + 1).join(" ");
    let speaker: string | undefined;
    const voice = body.match(/^<v(?:\.[\w.]+)?\s+([^>]+)>/);
    if (voice?.[1]) {
      speaker = voice[1].trim();
      body = body.slice(voice[0].length);
    } else {
      const named = body.match(/^([A-ZÄÖÜ][\wÄÖÜäöüß .'-]{1,30}):\s+(.*)$/);
      if (named?.[1] && named[2]) {
        speaker = named[1].trim();
        body = named[2];
      }
    }
    const clean = body
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) continue;
    out.push({
      startSec: cueSeconds(from ?? ""),
      endSec: cueSeconds(to ?? ""),
      text: clean,
      ...(speaker ? { speaker } : {}),
    });
  }
  return out;
}

/** Podcasting 2.0 JSON transcript: `{ segments: [{ startTime, endTime, speaker?, body }] }`. */
export function parsePodcastJson(text: string): TranscriptSegment[] {
  const data = JSON.parse(text) as {
    segments?: Array<{ startTime?: number; endTime?: number; speaker?: string; body?: string }>;
  };
  return (data.segments ?? [])
    .filter((s) => s.body?.trim())
    .map((s) => ({
      startSec: s.startTime ?? 0,
      endSec: s.endTime,
      text: (s.body as string).trim(),
      ...(s.speaker ? { speaker: s.speaker } : {}),
    }));
}

/** Parses a transcript by MIME type (falls back to sniffing). Returns [] for unsupported formats (e.g. HTML). */
export function parseTimedText(text: string, type = ""): TranscriptSegment[] {
  const t = type.toLowerCase();
  if (t.includes("json") || text.trimStart().startsWith("{")) return parsePodcastJson(text);
  if (t.includes("vtt") || t.includes("srt") || t.includes("subrip") || text.includes("-->"))
    return parseCues(text);
  return [];
}

/** Joins tiny caption cues into readable ~30 s lines (keeps speaker changes). */
export function mergeShortSegments(
  segments: readonly TranscriptSegment[],
  maxSec = 30,
): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const s of segments) {
    const prev = out.at(-1);
    if (prev && prev.speaker === s.speaker && s.startSec - prev.startSec < maxSec) {
      prev.text = `${prev.text} ${s.text}`;
      prev.endSec = s.endSec ?? prev.endSec;
    } else {
      out.push({ ...s });
    }
  }
  return out;
}
