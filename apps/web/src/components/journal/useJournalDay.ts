"use client";

import { t } from "@/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchCheckin,
  saveCheckin,
  seedCheckin,
  setFields,
  toDailyMarkdown,
  type DailyCheckin,
} from "@/components/home/daily";
import { saveDailyCheckin } from "@/lib/api/actions";
import { DAILY_NOTES, isLiveData } from "@/lib/workspace-data";

/*
 * Today's journal state (Tagebuch, tab Tag): the entry text (the daily note's Mind Dump, one thought per line), the
 * energy of the check-in. Everything lives in `10_Notes/Daily/<date>.md` (metadata.checkin + body),
 * the same file the Home check-in writes. Changes are saved automatically: at once to the local copy, debounced to
 * the note; the save reads the note's current check-in first and only sets the fields changed here, so edits made on
 * Home or through the Orbit-Bar meanwhile survive.
 */

export type SaveState = "loading" | "idle" | "dirty" | "saving" | "saved" | "error";

const SAVE_DELAY = 700;

const toLines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export function useJournalDay(date: string) {
  const live = isLiveData();
  const [checkin, setCheckin] = useState<DailyCheckin>(() => seedCheckin(date, live));
  const [text, setText] = useState("");
  const [state, setState] = useState<SaveState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [noteId, setNoteId] = useState<string | null>(() => DAILY_NOTES.find((d) => d.date === date)?.id ?? null);

  const latest = useRef<DailyCheckin>(checkin);
  const fields = useRef(new Set<keyof DailyCheckin>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const textEdited = useRef(false);

  useEffect(() => {
    let alive = true;
    const ac = new AbortController();
    fetchCheckin(date, ac.signal)
      .then((c) => {
        if (!alive) return;
        latest.current = c;
        setCheckin(c);
        if (!textEdited.current) setText(c.mindDump.join("\n"));
        setState("idle");
      })
      .catch(() => {
        if (alive) setState("idle");
      });
    return () => {
      alive = false;
      ac.abort();
    };
  }, [date]);

  const flush = useCallback(() => {
    timer.current = null;
    const changed = [...fields.current];
    fields.current.clear();
    if (!changed.length) return chain.current;
    const next = latest.current;
    const run = async () => {
      if (!live) {
        setState("saved");
        return;
      }
      setState("saving");
      try {
        // The note's current state, with only the fields this page changed set on top.
        const remote = await fetchCheckin(date).catch(() => null);
        const merged = setFields(next, changed)(remote ?? next);
        saveCheckin(merged);
        const res = await saveDailyCheckin({ date, markdown: toDailyMarkdown(merged), checkin: { ...merged } });
        if (res.ok) {
          setNoteId(res.data.id);
          setState((s) => (s === "dirty" ? s : "saved"));
        } else {
          setError(res.error);
          setState("error");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : t("Saving failed"));
        setState("error");
      }
    };
    chain.current = chain.current.then(run);
    return chain.current;
  }, [date, live]);

  // Leaving the page with a pending change writes it right away.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void flush();
      }
    },
    [flush],
  );

  const change = useCallback(
    (fn: (c: DailyCheckin) => DailyCheckin, keys: (keyof DailyCheckin)[]) => {
      const next = fn(latest.current);
      if (next === latest.current) return;
      latest.current = next;
      setCheckin(next);
      saveCheckin(next);
      keys.forEach((k) => fields.current.add(k));
      setState("dirty");
      setError(null);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY);
    },
    [flush],
  );

  const changeText = useCallback(
    (value: string) => {
      textEdited.current = true;
      setText(value);
      change((c) => ({ ...c, mindDump: toLines(value) }), ["mindDump"]);
    },
    [change],
  );

  /** Writes a pending change now (e.g. before the note opens in the editor). */
  const saveNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    return flush();
  }, [flush]);

  return { checkin, text, changeText, change, state, error, live, noteId, saveNow };
}
