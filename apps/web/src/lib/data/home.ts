"use client";

import { intlLocale, t, tn } from "@/i18n";
import { useCallback, useEffect, useState } from "react";
import { setActionItemDone, type ActionResult } from "@/lib/api/actions";
import {
  BRIEFING,
  HOME_IMG,
  JUMP_BACK_IN,
  REDISCOVER,
  SMART_MIXES,
  type BackInCard,
  type BriefingItem,
  type HomeTarget,
  type SmartMix,
} from "@/lib/mock/home";
import type { LiveMeeting, MeetingPerson } from "@/lib/mock/types";
import { isLiveData, LIVE_MEETING, NOTES, tagTone } from "@/lib/workspace-data";
import { getHomeMeeting, getHomeMixes } from "@/server/home/actions";
import { isAbort, readApi } from "@/lib/api/read";
import type { BriefingSummary, HomeBriefing, HomeData, HomeMeeting, HomeMix } from "@/server/home/types";

/*
 * Data seam of the Home dashboard. Mock mode serves lib/mock/home.ts unchanged; live mode calls
 * the server actions in server/home/actions.ts and maps their payloads onto the same view shapes,
 * so the components render both. The last live payload is kept per day in localStorage for an
 * instant first paint (stale while revalidating); the briefing sentence is kept per day too and
 * handed back to the server, so it is generated once per day even across server restarts.
 */

// --- view shapes ------------------------------------------------------------------------------------

export interface BriefingView {
  title: string;
  /** Null while the first briefing of the day is being written. */
  summary: string | null;
  items: BriefingItem[];
  noteId: string | null;
  noteLabel: string;
}

export interface ArchiveView {
  title: string;
  quote: string;
  /** "Seitdem: …" line behind "Was daraus wurde"; null hides the toggle. */
  since: string | null;
  /** Created about a year ago today (else: an older entry from the archive). */
  yearAgo: boolean;
  /** Day it was created; null = one year before today (mock). */
  date: Date | null;
  target: HomeTarget | null;
}

export interface FlashcardsView {
  deck: string;
  cards: [question: string, answer: string][];
  doneHint: string;
  target: HomeTarget | null;
}

export interface FitsTodayView {
  eyebrow: string;
  title: string;
  text: string;
  /** Own or extracted cover; null = the type tile of the active theme pack (resolved on the client). */
  img: string | null;
  /** Knowledge item type, for the pack tile fallback. */
  type?: string;
  target: HomeTarget;
}

export interface HomeView {
  backIn: BackInCard[];
  archive: ArchiveView | null;
  flashcards: FlashcardsView | null;
  fitsToday: FitsTodayView | null;
}

// --- mapping ----------------------------------------------------------------------------------------

/** Cover of an item: its own or extracted image, else null (the view shows the type tile of the active theme pack). */
export const coverOrNull = (cover?: string | null): string | null => (cover && cover.trim() ? cover : null);

/** Cover art per tag colour domain (Smart Mixes). */
const TONE_IMG: Record<SmartMix["tone"], string> = {
  ai: HOME_IMG.car,
  auto: HOME_IMG.car,
  health: HOME_IMG.hyrox,
  food: HOME_IMG.salmon,
  strategy: HOME_IMG.skyline,
  finance: HOME_IMG.facade,
};

const targetOf = (id: string, reader: boolean): HomeTarget => (reader ? { kind: "reader", id } : { kind: "note", id });

/** "low-carb" → "Low-Carb", "ai/mcp" → "MCP" for short all-letter tags up to 3 chars. */
export function mixShort(tag: string): string {
  const last = tag.split("/").pop() ?? tag;
  if (last.length <= 3 && /^[a-z]+$/i.test(last)) return last.toUpperCase();
  return last
    .split(/([-_ ])/)
    .map((p) => (p === "_" ? " " : p.charAt(0).toUpperCase() + p.slice(1)))
    .join("");
}

export function toMix(m: HomeMix): SmartMix {
  const tag = `#${m.tag}`;
  const tone = tagTone(tag);
  const short = mixShort(m.tag);
  return { title: m.cluster ?? t("Everything about {topic}", { topic: short }), short, tag, tone, img: m.img || TONE_IMG[tone], count: m.count };
}

const SPARE_IMG = [HOME_IMG.skyline, HOME_IMG.facade, HOME_IMG.ribbons, HOME_IMG.desk, HOME_IMG.podcast, HOME_IMG.journal];

/** Mixes of the same colour domain get different artwork (no two identical covers in a row). */
export function withDistinctCovers(mixes: SmartMix[]): SmartMix[] {
  const used = new Set<string>();
  return mixes.map((m) => {
    const img = used.has(m.img) ? (SPARE_IMG.find((i) => !used.has(i)) ?? m.img) : m.img;
    used.add(img);
    return img === m.img ? m : { ...m, img };
  });
}

export function toHomeView(d: HomeData): HomeView {
  return {
    backIn: d.backIn.map((b) => ({ title: b.title, meta: b.meta, img: coverOrNull(b.img), type: b.type, pct: b.pct, target: targetOf(b.id, b.reader) })),
    archive: d.archive && {
      title: d.archive.title,
      quote: d.archive.quote,
      since: d.archive.since !== null ? tn(d.archive.since, "Since then: {n} new entry in your Second Brain.", "Since then: {n} new entries in your Second Brain.") : null,
      yearAgo: d.archive.yearAgo,
      date: new Date(d.archive.createdAt),
      target: { kind: "note", id: d.archive.id },
    },
    flashcards: d.flashcards && {
      deck: d.flashcards.deck,
      cards: d.flashcards.cards,
      doneHint: t("You create new cards in the copilot of a note."),
      target: { kind: "note", id: d.flashcards.itemId },
    },
    fitsToday: d.fitsToday && {
      eyebrow: d.fitsToday.seed ? t("Fits today · {seed}", { seed: d.fitsToday.seed }) : t("Fits today"),
      title: d.fitsToday.title,
      text: d.fitsToday.text,
      img: coverOrNull(d.fitsToday.img),
      type: d.fitsToday.type,
      target: targetOf(d.fitsToday.id, d.fitsToday.reader),
    },
  };
}

const MOCK_VIEW: HomeView = {
  backIn: JUMP_BACK_IN,
  archive: { title: REDISCOVER.yearAgo.title, quote: REDISCOVER.yearAgo.quote, since: REDISCOVER.yearAgo.since, yearAgo: true, date: null, target: null },
  flashcards: { deck: REDISCOVER.flashcards.deck, cards: REDISCOVER.flashcards.cards, doneHint: REDISCOVER.flashcards.doneHint, target: null },
  fitsToday: REDISCOVER.fitsToday,
};

const mockBriefing = (): BriefingView => ({
  title: BRIEFING.title,
  summary: BRIEFING.summary,
  items: BRIEFING.items,
  noteId: BRIEFING.meetingNoteId,
  noteLabel: t("Open meeting note"),
});

/** Entries per hashtag in the mock notes (the prototype's `counts` prop). */
const mockMixes = (): SmartMix[] => {
  const counts = NOTES.reduce<Record<string, number>>((m, n) => {
    for (const t of n.tags) m[t] = (m[t] ?? 0) + 1;
    return m;
  }, {});
  return SMART_MIXES.map((m) => ({ ...m, count: counts[m.tag] ?? 3 }));
};

export function toBriefingView(b: HomeBriefing): BriefingView {
  return {
    title: "Morning Briefing",
    summary: b.summary,
    items: b.tasks.map((task) => ({ key: task.id, id: task.id, text: task.text, ts: task.ts, due: task.due })),
    noteId: b.noteId,
    noteLabel: b.noteIsMeeting ? t("Open meeting note") : t("Open source"),
  };
}

const initialOf = (name: string) => (name.trim().charAt(0) || "?").toUpperCase();
const PERSON_TONES: MeetingPerson["tone"][] = [undefined, "strategy", "auto", "health", "food", "finance"];

const clockOf = (m: HomeMeeting) => {
  if (m.durationSec !== null) {
    const s = Math.max(0, Math.round(m.durationSec));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }
  return m.startedAt ? new Date(m.startedAt).toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" }) : "";
};

/** Meeting item → the shell's LiveMeeting card shape. */
export function toLiveMeeting(m: HomeMeeting): LiveMeeting {
  return {
    title: m.title,
    clock: clockOf(m),
    people: m.people.map((name, i) => ({ name, initial: initialOf(name), tone: PERSON_TONES[i % PERSON_TONES.length] })),
    coaching: m.coaching ?? t("The minutes appear as soon as the recording is processed."),
    noteId: m.id,
  };
}

// --- local cache ------------------------------------------------------------------------------------

const DATA_KEY = "kortex.home.data.v1";
const BRIEFING_KEY = (day: string) => `kortex.briefing.v1:${day}`;

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, v: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage blocked or full */
  }
}

const timeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

// --- hooks ------------------------------------------------------------------------------------------

/**
 * "Weiter, wo Du warst" + "Wiederentdecken". `day` is the local YYYY-MM-DD (null before mount).
 * `view` is null only while a live account loads for the first time.
 */
export function useHomeData(day: string | null): { view: HomeView | null; live: boolean } {
  const live = isLiveData();
  const [view, setView] = useState<HomeView | null>(live ? null : MOCK_VIEW);

  useEffect(() => {
    if (!live || !day) return;
    let alive = true;
    // GET /api/read/home (P7-5): parallel to other reads, aborted when Home unmounts (navigation).
    const ac = new AbortController();
    const cached = readJson<{ day: string; data: HomeData }>(DATA_KEY);
    if (cached?.data) setView(toHomeView(cached.data));
    readApi<ActionResult<HomeData>>("home", { date: day, tz: timeZone() }, ac.signal)
      .then((r) => {
        if (!alive) return;
        if (r.ok) {
          setView(toHomeView(r.data));
          writeJson(DATA_KEY, { day, data: r.data });
        } else if (!cached?.data) {
          setView({ backIn: [], archive: null, flashcards: null, fitsToday: null });
        }
      })
      .catch((err: unknown) => {
        if (!isAbort(err)) console.warn("[kortex] home data not loaded:", err);
      });
    return () => {
      alive = false;
      ac.abort();
    };
  }, [live, day]);

  return { view, live };
}

/** Morning Briefing with tickable tasks (live: completes the action item, optimistic). */
export function useHomeBriefing(day: string | null, onError?: (message: string) => void) {
  const live = isLiveData();
  const [briefing, setBriefing] = useState<BriefingView | null>(live ? null : mockBriefing);
  const [done, setDone] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!live || !day) return;
    let alive = true;
    // GET /api/read/briefing (P7-5): parallel, aborted when Home unmounts.
    const ac = new AbortController();
    const cached = readJson<BriefingSummary>(BRIEFING_KEY(day));
    if (cached?.summary) setBriefing({ ...mockBriefing(), summary: cached.summary, items: [], noteId: null });
    readApi<ActionResult<HomeBriefing>>("briefing", { date: day, tz: timeZone(), cached: cached ? JSON.stringify(cached) : null }, ac.signal)
      .then((r) => {
        if (!alive) return;
        if (r.ok) {
          setBriefing(toBriefingView(r.data));
          const { date, summary, taskIds, kind, model, generatedAt } = r.data;
          if (kind === "ai") writeJson(BRIEFING_KEY(day), { date, summary, taskIds, kind, model, generatedAt } satisfies BriefingSummary);
        } else {
          setBriefing((b) => b ?? { ...mockBriefing(), summary: t("The briefing is not available right now."), items: [], noteId: null });
        }
      })
      .catch((err: unknown) => {
        if (!isAbort(err)) console.warn("[kortex] briefing not loaded:", err);
      });
    return () => {
      alive = false;
      ac.abort();
    };
  }, [live, day]);

  const toggle = useCallback(
    (item: BriefingItem) => {
      const next = !done[item.key];
      setDone((m) => ({ ...m, [item.key]: next }));
      if (!live || !item.id) return;
      void setActionItemDone(item.id, next).then((r) => {
        if (r.ok) return;
        setDone((m) => ({ ...m, [item.key]: !next }));
        onError?.(t("Task could not be saved"));
      });
    },
    [done, live, onError],
  );

  return { briefing, done, toggle };
}

/** Smart Knowledge Mixes (Spaces). Live: tags at least two entries share. */
export function useSmartMixes(): SmartMix[] | null {
  const live = isLiveData();
  const [mixes, setMixes] = useState<SmartMix[] | null>(live ? null : mockMixes);
  useEffect(() => {
    if (!live) return;
    let alive = true;
    void getHomeMixes().then((r) => {
      if (alive) setMixes(r.ok ? withDistinctCovers(r.data.map(toMix)) : []);
    });
    return () => {
      alive = false;
    };
  }, [live]);
  return mixes;
}

/**
 * Meeting card data for the shell (Footbar / MeetingCard): mock = the prototype's LIVE_MEETING;
 * live = the latest meeting item of the last 24 hours, null when there is none.
 */
export function useLiveMeeting(day: string | null): LiveMeeting | null {
  const live = isLiveData();
  const [meeting, setMeeting] = useState<LiveMeeting | null>(live ? null : LIVE_MEETING);
  useEffect(() => {
    if (!live || !day) return;
    let alive = true;
    void getHomeMeeting({ date: day, timeZone: timeZone() }).then((r) => {
      if (alive) setMeeting(r.ok && r.data ? toLiveMeeting(r.data) : null);
    });
    return () => {
      alive = false;
    };
  }, [live, day]);
  return meeting;
}
