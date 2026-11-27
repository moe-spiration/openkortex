"use client";

import { t } from "@/i18n";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorAiRequest } from "@kortex/ui/editor";
import { joinDisplay, rebaseDisplay, type DisplaySplit } from "@/lib/notes/dedupe";
import { useNotes } from "@/lib/notes/store";
import { useShell } from "@/lib/shell/store";
import { DAILY_NOTES, MOCK_TODAY, type KnowledgeItem } from "@/lib/workspace-data";
import { dailyDateOf, ensureDailyNote } from "@/components/home/daily";
import { uniqueTitle } from "@/lib/notes/unique-title";
import { useWikiTargets } from "@/lib/notes/wiki-targets";
import { fetchAiAnswer } from "./AiPanel";
import { MarkdownStatic } from "./MarkdownStatic";

/*
 * Note body: the BlockNote editor (@kortex/ui/editor) over content_md. BlockNote is client-only,
 * so the server renders the same Markdown statically in the prototype's kx-ed-* classes and the
 * editor replaces it after hydration without a layout jump.
 *
 * Decision 4 (dedupe in the view only): a leading H1 equal to the title and a leading TL;DR paragraph are not shown
 * (the header has both). The editor edits the rest; every save puts the hidden head back in front, unchanged
 * (lib/notes/dedupe.ts), so content_md and the vault file keep title and summary.
 */

// memo: with stable callbacks and an unchanged markdown prop (the echo of a keystroke) the editor does not re-render
// while the user types (fx2-perf: about 20 components per keystroke).
const KortexEditor = memo(
  dynamic(() => import("@kortex/ui/editor").then((m) => m.KortexEditor), {
    ssr: false,
    loading: () => null,
  }),
);
const StaticMarkdown = memo(MarkdownStatic);

/**
 * Long entries open with folded chapters (books, or more text than this); the TOC stays open. Meetings, podcasts and
 * videos are left as they are: their bulk is the transcript, which already sits in a folded toggle.
 */
const FOLD_MIN_CHARS = 12_000;
const TRANSCRIPT_TYPES = new Set(["meeting", "podcast", "video"]);

/** Placeholder lines while the body of an older note loads (usually well under a second). */
export function BodyLoading() {
  return (
    <div className="kx-body-loading" role="status" aria-busy="true" aria-label={t("Loading note…")}>
      <span />
      <span />
      <span />
    </div>
  );
}

/**
 * Older notes arrive without their body (`bodyPending`, lib/supabase/snapshot.ts): load it first, and never mount the
 * editor on the empty placeholder (its first change would save "" over the real text).
 */
export function NoteBody({ item }: { item: KnowledgeItem }) {
  const { loadBody } = useNotes();
  const pending = item.bodyPending === true;
  useEffect(() => {
    if (pending) void loadBody(item.id);
  }, [pending, item.id, loadBody]);
  return pending ? <BodyLoading /> : <NoteBodyEditor item={item} />;
}

function NoteBodyEditor({ item }: { item: KnowledgeItem }) {
  const { items, setContent, createSubpage } = useNotes();
  const { openNote, showToast, setCmode, setCopilot, setPrompt } = useShell();
  const router = useRouter();
  const id = item.id;

  // [[ autocomplete: every other item in the vault (notes and objects); the same list while only this text changes.
  const wikiTargets = useWikiTargets(items, id);
  // Latest values for the editor callbacks: they stay stable (the editor is memo) and never read stale state.
  const live = useRef({ items, md: item.contentMd, tldr: item.tldr, title: item.title });
  live.current = { items, md: item.contentMd, tldr: item.tldr, title: item.title };

  // Hidden head (frontmatter, H1, TL;DR): stable while the user types, re-split when the stored text changes elsewhere.
  const splitRef = useRef<DisplaySplit | null>(null);
  const split = useMemo(
    () => rebaseDisplay(item.contentMd, splitRef.current, { title: item.title, summary: item.tldr }),
    [item.contentMd, item.title, item.tldr],
  );
  splitRef.current = split;
  // The body the editor emitted last. When the store echoes it back, the editor keeps its markdown prop, so a keystroke
  // does not re-render it; a change from elsewhere still reaches it as a new prop.
  const emitted = useRef<string | null>(null);
  const onChange = useCallback(
    (md: string) => {
      emitted.current = md;
      setContent(id, joinDisplay(splitRef.current!, md));
    },
    [id, setContent],
  );
  const editorMd = useRef(split.body);
  const remount = useRef(0);
  if (split.body !== emitted.current) {
    if (split.body !== editorMd.current) editorMd.current = split.body;
    else if (emitted.current !== null) {
      // Changed elsewhere back to exactly the prop the editor already has: the prop cannot change, so remount it.
      remount.current++;
      emitted.current = null;
    }
  }
  // The static Markdown is only the first paint before the editor chunk is there: frozen at mount, like the folding.
  const [staticMd] = useState(split.body);
  const onOpenWikiLink = useCallback(
    (link: { id?: string; title: string }) => {
      const { items } = live.current;
      const target = link.id ? items[link.id] : Object.values(items).find((i) => i.title === link.title);
      if (target) openNote(target.id);
      // A daily note created a moment ago (slash "Daily Note") is not loaded yet: the Journal shows the day.
      else if (dailyDateOf(link.title)) router.push("/journal");
      else showToast(t("“{title}” does not exist yet", { title: link.title }));
    },
    [openNote, showToast, router],
  );
  // KI in the editor (W8): the toolbar's KI menu, slash "Fortsetzen" and slash "KI-Zusammenfassung" call the
  // same actions as the Peek header's KI menu (lib/shell/ai-actions.ts via fetchAiAnswer). Live they go to
  // POST /api/chat/action; mock mode answers with the deterministic stand-in.
  const onAiSummary = useCallback(
    () => fetchAiAnswer("summarize", { itemId: id, contentMd: live.current.md, mockSummary: live.current.tldr }),
    [id],
  );
  const onAiAction = useCallback(
    async ({ action, markdown, instruction }: EditorAiRequest) => {
      try {
        return await fetchAiAnswer(action, { itemId: id, contentMd: markdown, instruction });
      } catch (err) {
        // The editor leaves the text as it was when the host throws.
        showToast(t("AI action failed. Please try again later."));
        throw err;
      }
    },
    [id, showToast],
  );
  // "Frage dazu stellen": the copilot in Ask mode with the selection quoted, the question is the user's.
  const onAiAsk = useCallback(
    (selection: string) => {
      const quote = selection.replace(/\s+/g, " ").trim();
      const short = quote.length > 280 ? `${quote.slice(0, 279)}…` : quote;
      setCmode("ask");
      setCopilot(true);
      setPrompt(t("About “{quote}” from “{title}”: ", { quote: short, title: live.current.title }));
    },
    [setCmode, setCopilot, setPrompt],
  );
  // Slash "Daily Note (heute)": links today's daily note, the same file as the Home check-in and the Journal.
  const onDailyNote = useCallback(async () => {
    try {
      const d = await ensureDailyNote(MOCK_TODAY, DAILY_NOTES);
      return { id: d.id ?? "", title: d.title };
    } catch (err) {
      showToast(t("Could not create the daily note"));
      throw err;
    }
  }, [showToast]);
  const onCreateSubpage = useCallback(
    (title: string) => {
      // W-06: every sub-page gets its own title, so its ![[embed]] resolves to it and not to the first one.
      const page = createSubpage(id, uniqueTitle(title, Object.values(live.current.items).map((i) => i.title)));
      showToast(t("Subpage “{title}” created", { title: page.title }));
      return { id: page.id, title: page.title, path: page.path };
    },
    [id, createSubpage, showToast],
  );

  return (
    <div className="kx-note-body" style={{ position: "relative" }}>
      <EditorOrStatic
        markdown={staticMd}
        editor={
          <KortexEditor
            key={remount.current}
            markdown={editorMd.current}
            onChange={onChange}
            wikiTargets={wikiTargets}
            onOpenWikiLink={onOpenWikiLink}
            onAiSummary={onAiSummary}
            onAiAction={onAiAction}
            onAiAsk={onAiAsk}
            onCreateSubpage={onCreateSubpage}
            onDailyNote={onDailyNote}
            foldSections={item.type === "book" || (staticMd.length > FOLD_MIN_CHARS && !TRANSCRIPT_TYPES.has(item.type))}
          />
        }
      />
    </div>
  );
}

/**
 * Shows the static Markdown until the editor chunk has rendered its first frame. The editor itself mounts one frame
 * after the sheet painted (snappiness): opening or switching an entry shows title and text at once, and the
 * BlockNote setup (the heavy part, ~70 % of the open time) runs right after instead of blocking that first paint.
 */
function EditorOrStatic({ markdown, editor }: { markdown: string; editor: React.ReactNode }) {
  const ready = useAfterFirstPaint();
  return (
    <>
      <div className="kx-note-static">
        <StaticMarkdown markdown={markdown} />
      </div>
      {ready && editor}
    </>
  );
}

function useAfterFirstPaint(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    // rAF fires before the next paint; the timeout after it lands behind that paint.
    const raf = requestAnimationFrame(() => {
      t = setTimeout(() => startTransition(() => setReady(true)), 0);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (t) clearTimeout(t);
    };
  }, []);
  return ready;
}
