import { msg, t } from "@/i18n";
import { DOMAIN_OBJECT_TYPES, matchKnowledgeHybrid, type KortexClient } from "@kortex/db";
import { readerFormatOf } from "@/components/reader/liveDoc";
import { localDateTime } from "@/lib/supabase/dates";
import type {
  HomeArchiveItem,
  HomeBackInItem,
  HomeData,
  HomeFitsToday,
  HomeFlashDeck,
  HomeMeeting,
  HomeMix,
} from "./types";

/*
 * Live data of the Home dashboard. Every query runs as the signed-in user (RLS) and filters by
 * user_id as well. No model calls here except the optional query embedding of "Passt zu heute".
 */

export interface HomeCtx {
  client: KortexClient;
  userId: string;
}

export interface HomeClock {
  /** The user's local day, YYYY-MM-DD. */
  today: string;
  timeZone: string;
  now: Date;
}

/** Embeds the rediscover query; null = full-text only (no vectors yet, or the call failed). */
export type EmbedQuery = (text: string) => Promise<{ embedding: number[]; modelKey: string } | null>;

/** Daily notes, digests and domain objects are not "content" for Home's carousels. */
export const HOME_EXCLUDED_TYPES = ["daily_note", "digest", ...DOMAIN_OBJECT_TYPES] as const;
const EXCLUDED = `(${HOME_EXCLUDED_TYPES.join(",")})`;
const HIDDEN_STATUS = "(error,archived)";

const DAY_MS = 86_400_000;
const BACK_IN_LIMIT = 8;
const ARCHIVE_MIN_AGE_DAYS = 30;
const FITS_MIN_AGE_DAYS = 14;
const FITS_SEED_DAYS = 3;
const MIX_LIMIT = 6;

const TYPE_LABEL: Record<string, string> = {
  note: msg("Note"),
  article: msg("Article"),
  meeting: "Meeting",
  video: "Video",
  podcast: "Podcast",
  recipe: msg("Recipe"),
  ai_chat: msg("AI chat"),
  image: msg("Image"),
  voice: msg("Voice memo"),
  pdf: "PDF",
  epub: msg("Book"),
  social: "Reel",
  email: msg("Email"),
  bookmark: msg("Bookmark"),
};

// --- pure helpers -----------------------------------------------------------------------------------

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** "heute", "gestern", "vor 3 Tagen", "12.09." for a timestamp, seen from `clock.today`. */
export function relativeDay(iso: string, clock: Pick<HomeClock, "today" | "timeZone">): string {
  const day = localDateTime(iso, clock.timeZone).date;
  const n = daysBetween(day, clock.today);
  if (n <= 0) return t("today");
  if (n === 1) return t("yesterday");
  if (n < 7) return t("{n} days ago", { n });
  const [, m = "", d = ""] = day.split("-");
  return t("{month}/{day}", { month: m, day: d });
}

/** Plain text of a Markdown body, cut at a word boundary. */
export function plainExcerpt(md: string | null | undefined, max: number): string {
  const s = (md ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a: string, b?: string) => b ?? a)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/gm, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

const isReaderItem = (r: { type: string; file_storage_path?: string | null; file_mime_type?: string | null }) =>
  (r.type === "pdf" || r.type === "epub") && !!r.file_storage_path && !!readerFormatOf(r.file_mime_type, r.file_storage_path);

interface BackInRow {
  id: string;
  type: string;
  title: string;
  cover_image_url: string | null;
  reading_state: unknown;
  file_storage_path: string | null;
  file_mime_type: string | null;
  updated_at: string;
}

export function toBackIn(r: BackInRow, clock: Pick<HomeClock, "today" | "timeZone">): HomeBackInItem {
  const rel = relativeDay(r.updated_at, clock);
  const label = TYPE_LABEL[r.type] !== undefined ? t(TYPE_LABEL[r.type]!) : t("Entry");
  const reader = isReaderItem(r);
  const state = rec(r.reading_state);
  const progress = num(state.progress);
  const page = num(state.page);
  const hasState = (r.type === "pdf" || r.type === "epub") && (progress !== null || page !== null);
  let meta: string;
  if (hasState && r.type === "pdf" && page !== null && page > 1) meta = t("Continue reading from p. {page}", { page: Math.floor(page) });
  else if (hasState && progress !== null && progress > 0) meta = t("Continue reading · {pct} %", { pct: Math.round(progress * 100) });
  else if (r.type === "note") meta = t("Last edited · {when}", { when: rel });
  else meta = `${label} · ${rel}`;
  return {
    id: r.id,
    type: r.type,
    title: r.title || t("Untitled"),
    meta,
    img: str(r.cover_image_url),
    pct: hasState && progress !== null ? Math.min(100, Math.max(0, Math.round(progress * 100))) : null,
    reader,
  };
}

/** Flashcards jsonb ([{question, answer}] or [[q, a]]) → card tuples. */
export function parseFlashcards(raw: unknown): [string, string][] {
  if (!Array.isArray(raw)) return [];
  const out: [string, string][] = [];
  for (const c of raw) {
    const q = Array.isArray(c) ? str(c[0]) : str(rec(c).question);
    const a = Array.isArray(c) ? str(c[1]) : str(rec(c).answer);
    if (q && a) out.push([q, a]);
  }
  return out;
}

const STOP = new Set(
  "aber alle also auch dass dein deine diese dieser dieses doch eine einer eines fuer für haben heute ihre mehr mein meine nach nicht noch oder ohne sein sich sind ueber über und unter vom von warum was weil wenn wie wird with your from that this what have about into notiz notes note journal daily".split(
    " ",
  ),
);

/** Distinct search terms of the recent titles, tags and focus lines (websearch `or` query). */
export function rediscoverTerms(texts: readonly string[], max = 10): string[] {
  const seen = new Set<string>();
  for (const t of texts)
    for (const w of t.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (w.length < 4 || /^\d+$/.test(w) || STOP.has(w)) continue;
      seen.add(w);
      if (seen.size >= max) return [...seen];
    }
  return [...seen];
}

const overlap = (terms: readonly string[], text: string) => {
  const hay = text.toLowerCase();
  return terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
};

/** Stable pick per day, so the archive card doesn't change on every reload. */
const dayIndex = (day: string, len: number) =>
  len ? [...day].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % len : 0;

// --- loaders ----------------------------------------------------------------------------------------

export async function loadBackIn({ client, userId }: HomeCtx, clock: HomeClock): Promise<HomeBackInItem[]> {
  const { data, error } = await client
    .from("knowledge_items")
    .select("id,type,title,cover_image_url,reading_state,file_storage_path,file_mime_type,updated_at")
    .eq("user_id", userId)
    .not("type", "in", EXCLUDED)
    .not("status", "in", HIDDEN_STATUS)
    .order("updated_at", { ascending: false })
    .limit(BACK_IN_LIMIT);
  if (error) throw new Error(`home back-in: ${error.message}`);
  return ((data ?? []) as BackInRow[]).map((r) => toBackIn(r, clock));
}

interface ArchiveRow {
  id: string;
  title: string;
  summary: string | null;
  content_md: string;
  created_at: string;
}

export async function loadArchive({ client, userId }: HomeCtx, clock: HomeClock): Promise<HomeArchiveItem | null> {
  const cols = "id,title,summary,content_md,created_at";
  const yearAgo = addDays(clock.today, -365);
  const near = await client
    .from("knowledge_items")
    .select(cols)
    .eq("user_id", userId)
    .not("type", "in", EXCLUDED)
    .not("status", "in", HIDDEN_STATUS)
    .gte("created_at", `${addDays(yearAgo, -3)}T00:00:00Z`)
    .lt("created_at", `${addDays(yearAgo, 4)}T00:00:00Z`)
    .order("created_at", { ascending: true })
    .limit(20);
  if (near.error) throw new Error(`home archive: ${near.error.message}`);
  const nearRows = (near.data ?? []) as ArchiveRow[];
  const target = Date.parse(`${yearAgo}T12:00:00Z`);
  let pick = nearRows.sort((a, b) => Math.abs(Date.parse(a.created_at) - target) - Math.abs(Date.parse(b.created_at) - target))[0];
  const exact = !!pick;
  if (!pick) {
    const old = await client
      .from("knowledge_items")
      .select(cols)
      .eq("user_id", userId)
      .not("type", "in", EXCLUDED)
      .not("status", "in", HIDDEN_STATUS)
      .lt("created_at", `${addDays(clock.today, -ARCHIVE_MIN_AGE_DAYS)}T00:00:00Z`)
      .order("created_at", { ascending: true })
      .limit(60);
    if (old.error) throw new Error(`home archive: ${old.error.message}`);
    const rows = (old.data ?? []) as ArchiveRow[];
    pick = rows[dayIndex(clock.today, rows.length)];
  }
  if (!pick) return null;
  const since = await client
    .from("knowledge_items")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .not("type", "in", EXCLUDED)
    .gt("created_at", pick.created_at);
  return {
    id: pick.id,
    title: pick.title || t("Untitled"),
    quote: plainExcerpt(pick.summary || pick.content_md, 220),
    createdAt: pick.created_at,
    yearAgo: exact,
    since: since.error ? null : (since.count ?? null),
  };
}

export async function loadFlashcards({ client, userId }: HomeCtx): Promise<HomeFlashDeck | null> {
  const { data, error } = await client
    .from("knowledge_items")
    .select("id,title,flashcards")
    .eq("user_id", userId)
    .not("flashcards", "is", null)
    .not("status", "in", HIDDEN_STATUS)
    .order("updated_at", { ascending: false })
    .limit(5);
  if (error) throw new Error(`home flashcards: ${error.message}`);
  for (const r of (data ?? []) as { id: string; title: string; flashcards: unknown }[]) {
    const cards = parseFlashcards(r.flashcards);
    if (cards.length) return { itemId: r.id, deck: r.title || "Flashcards", cards: cards.slice(0, 10) };
  }
  return null;
}

interface SeedRow {
  id: string;
  title: string;
  tags: string[] | null;
}

/** Recent items (and today's focus lines) the rediscover search starts from. */
async function loadSeeds({ client, userId }: HomeCtx, clock: HomeClock): Promise<{ ids: Set<string>; labels: string[]; texts: string[] }> {
  const since = new Date(clock.now.getTime() - FITS_SEED_DAYS * DAY_MS).toISOString();
  const [recent, daily] = await Promise.all([
    client
      .from("knowledge_items")
      .select("id,title,tags")
      .eq("user_id", userId)
      .not("type", "in", EXCLUDED)
      .not("status", "in", HIDDEN_STATUS)
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(8),
    client.from("knowledge_items").select("metadata").eq("user_id", userId).eq("type", "daily_note").eq("slug", clock.today).maybeSingle(),
  ]);
  if (recent.error) throw new Error(`home seeds: ${recent.error.message}`);
  const rows = (recent.data ?? []) as SeedRow[];
  const focus = Array.isArray(rec(rec(daily.data?.metadata).checkin).focus) ? (rec(rec(daily.data?.metadata).checkin).focus as unknown[]) : [];
  const focusTexts = focus.map((f) => str(rec(f).text)).filter((t): t is string => !!t);
  return {
    ids: new Set(rows.map((r) => r.id)),
    labels: [...focusTexts, ...rows.map((r) => r.title)],
    texts: [...focusTexts, ...rows.flatMap((r) => [r.title, ...(r.tags ?? []).map((t) => t.replace(/[#/_-]+/g, " "))])],
  };
}

/** Best "Passt zu heute" candidates, most relevant first (up to 3). */
export async function loadFitsToday(ctx: HomeCtx, clock: HomeClock, embedQuery?: EmbedQuery): Promise<HomeFitsToday[]> {
  const seeds = await loadSeeds(ctx, clock);
  const terms = rediscoverTerms(seeds.texts);
  if (!terms.length) return [];
  const queryText = terms.join(" or ");
  const vec = embedQuery ? await embedQuery(seeds.texts.slice(0, 12).join("\n")) : null;
  const hits = await matchKnowledgeHybrid(ctx.client, {
    queryText,
    queryEmbedding: vec?.embedding ?? null,
    filterEmbeddingModel: vec?.modelKey ?? null,
    matchCount: 24,
  });
  const excluded = new Set<string>(HOME_EXCLUDED_TYPES);
  const candidates: string[] = [];
  for (const h of hits) if (!seeds.ids.has(h.item_id) && !excluded.has(h.type) && !candidates.includes(h.item_id)) candidates.push(h.item_id);
  if (!candidates.length) return [];

  // Only items nobody touched lately count as "rediscovered".
  const { data, error } = await ctx.client
    .from("knowledge_items")
    .select("id,type,title,summary,content_md,cover_image_url,file_storage_path,file_mime_type,updated_at,status")
    .eq("user_id", ctx.userId)
    .in("id", candidates.slice(0, 12))
    .lt("updated_at", new Date(clock.now.getTime() - FITS_MIN_AGE_DAYS * DAY_MS).toISOString());
  if (error) throw new Error(`home fits: ${error.message}`);
  type Row = BackInRow & { summary: string | null; content_md: string; status: string };
  const byId = new Map(((data ?? []) as Row[]).filter((r) => r.status !== "error" && r.status !== "archived").map((r) => [r.id, r]));
  return candidates
    .filter((c) => byId.has(c))
    .slice(0, 3)
    .map((id) => {
      const row = byId.get(id)!;
      const hit = hits.find((h) => h.item_id === id);
      const text = plainExcerpt(row.summary || hit?.chunk_text || row.content_md, 200);
      const hay = `${row.title} ${text}`;
      const seed =
        seeds.labels
          .map((l) => ({ l, n: overlap(rediscoverTerms([l]), hay) }))
          .sort((a, b) => b.n - a.n)[0]?.l ?? seeds.labels[0] ?? "";
      return { id, type: row.type, title: row.title || t("Untitled"), text, img: str(row.cover_image_url), seed, reader: isReaderItem(row) };
    });
}

export async function loadMeeting({ client, userId }: HomeCtx, clock: HomeClock): Promise<HomeMeeting | null> {
  const { data, error } = await client
    .from("knowledge_items")
    .select("id,title,summary,metadata,status,created_at")
    .eq("user_id", userId)
    .eq("type", "meeting")
    .neq("status", "error")
    .gte("created_at", new Date(clock.now.getTime() - DAY_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`home meeting: ${error.message}`);
  const r = (data ?? [])[0] as { id: string; title: string; summary: string | null; metadata: unknown; status: string; created_at: string } | undefined;
  if (!r) return null;
  const m = rec(r.metadata);
  const people = (Array.isArray(m.participants) ? m.participants : [])
    .map((p) => str(p) ?? str(rec(p).name))
    .filter((p): p is string => !!p)
    .slice(0, 6);
  const decision = Array.isArray(m.decisions) ? m.decisions.map(str).find(Boolean) : null;
  return {
    id: r.id,
    title: r.title || "Meeting",
    startedAt: str(m.started_at) ?? r.created_at,
    durationSec: num(m.duration_sec),
    people,
    coaching: decision ?? (r.summary ? plainExcerpt(r.summary, 200) : null),
    status: r.status,
  };
}

export async function loadMixes({ client, userId }: HomeCtx): Promise<HomeMix[]> {
  const { data, error } = await client
    .from("knowledge_items")
    .select("tags,cluster_name,cover_image_url")
    .eq("user_id", userId)
    .not("type", "in", EXCLUDED)
    .not("status", "in", HIDDEN_STATUS)
    .order("updated_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`home mixes: ${error.message}`);
  const byTag = new Map<string, { count: number; clusters: Map<string, number>; img: string | null }>();
  for (const r of (data ?? []) as { tags: string[] | null; cluster_name: string | null; cover_image_url: string | null }[]) {
    for (const raw of new Set((r.tags ?? []).map((t) => t.replace(/^#+/, "").trim()))) {
      if (!raw || raw === "daily") continue;
      let e = byTag.get(raw);
      if (!e) byTag.set(raw, (e = { count: 0, clusters: new Map(), img: null }));
      e.count++;
      if (r.cluster_name) e.clusters.set(r.cluster_name, (e.clusters.get(r.cluster_name) ?? 0) + 1);
      e.img ??= str(r.cover_image_url);
    }
  }
  return [...byTag.entries()]
    .filter(([, e]) => e.count >= 2)
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, MIX_LIMIT)
    .map(([tag, e]) => {
      const [cluster, n] = [...e.clusters.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
      return {
        tag,
        count: e.count,
        cluster: cluster && cluster !== "General" && n / e.count >= 0.5 ? cluster : null,
        img: e.img,
      };
    });
}

/** Everything Home shows besides the briefing. One failing part never blanks the others. */
export async function loadHomeData(ctx: HomeCtx, clock: HomeClock, embedQuery?: EmbedQuery, onError?: (part: string, err: unknown) => void): Promise<HomeData> {
  const safe = async <T>(part: string, p: Promise<T>, empty: T): Promise<T> => {
    try {
      return await p;
    } catch (err) {
      onError?.(part, err);
      return empty;
    }
  };
  const [backIn, archive, flashcards, fitsToday, meeting, mixes] = await Promise.all([
    safe("backIn", loadBackIn(ctx, clock), []),
    safe("archive", loadArchive(ctx, clock), null),
    safe("flashcards", loadFlashcards(ctx), null),
    safe("fitsToday", loadFitsToday(ctx, clock, embedQuery), []),
    safe("meeting", loadMeeting(ctx, clock), null),
    safe("mixes", loadMixes(ctx), []),
  ]);
  // Never the same item twice in "Wiederentdecken".
  return { backIn, archive, flashcards, fitsToday: fitsToday.find((f) => f.id !== archive?.id) ?? null, meeting, mixes };
}
