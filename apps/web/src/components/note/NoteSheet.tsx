"use client";

import { t } from "@/i18n";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { DomainObjectType } from "@kortex/db/domain";
import { isDossierType } from "@/lib/dossier";
import { useDrawerContract } from "@/lib/notes/drawer-contract";
import { isDomainObjectType } from "@/lib/objects/schema";
import { DW_HALF, toggleHalf } from "@/lib/notes/drawer-width";
import { useFavorites } from "@/lib/shell/favorites";
import { initialsOf, keyFacts, peopleLabel, whenLine } from "@/lib/notes/facts";
import { linkedObjects, placementHint, sourceLine, statusPill, suggestTags, takeawaysOf, taskProgress } from "@/lib/notes/properties";
import { useNote, useNotes } from "@/lib/notes/store";
import { useRefreshWhenMissing } from "@/lib/notes/recover";
import { useItemMeta, useSameArray } from "@/lib/notes/stable-item";
import type { BacklinkGroups } from "@/lib/notes/backlinks";
import type { AiActionId } from "@/lib/shell/ai-actions";
import { noteHrefById, readerHref, spaceHref } from "@/lib/shell/routes";
import { useShell } from "@/lib/shell/store";
import { useCloseTab } from "@/lib/shell/useCloseTab";
import { useCoverOf } from "@/lib/theme/pack";
import { isDueOn, remindLabel } from "@/lib/reminders";
import { todayIso } from "@/lib/date/today";
import { MOCK_TODAY, OBJECT_HUBS, isLiveData, tagTone, type KnowledgeItem } from "@/lib/workspace-data";
import { deleteItems, setArchived } from "@/lib/api/actions";
import { UNDO_MS } from "@/components/views/useItemActions";
import { useChip } from "@/components/shell/useAsk";
import { AiProposalCard, NoteSummary, useNoteAi } from "./AiPanel";
import { ActionItems } from "./ActionItems";
import { Backlinks, useBacklinkGroups } from "./Backlinks";
import { noteCrumbs } from "./crumbs";
import { DossierPanel } from "./DossierPanel";
import { DrawerCover } from "./DrawerCover";
import { NIco, TypeIcon } from "./icons";
import { MarkdownSource } from "./MarkdownSource";
import { NoteBody } from "./NoteBody";
import { ObjectTypeMenu } from "./ObjectTypeMenu";
import { PropertyPills } from "./PropertyPills";
import { PromptPanel, SessionPanel, TypedProperties } from "./TypedPanels";
import { ReminderRadar } from "./ReminderRadar";
import { SheetMenu } from "./SheetMenu";
import { isTextAction } from "@/lib/shell/ai-actions";
import { CoverDialog, PageIconGlyph } from "./PageLook";

/*
 * Note sheet (Feinschliff Live, dummy "Editor") in two modes: the drawer beside the view (flush, a hairline to the
 * list, no floating card) and the full tab (/notes/<id>, "Vollbild": centred reading column of 780 px).
 *
 * Head bar: mono path, then Favorit (amber star), Vollbild, Link kopieren, KI (shows or hides the KI box), Mehr
 * (half width, Markdown-Quelle, cover, Verschieben, Archivieren, Löschen) and Schließen. Body: a soft glow tinted by
 * the type colour (or the item's own cover), type glyph + type + date line, the big title, one row of pills (tags with
 * their colour dot, key facts, people, "Erinnern", "Eigenschaft"), the KI-Zusammenfassung box (TL;DR, Tasks
 * extrahieren, Karteikarten), the text (BlockNote; H1/TL;DR hidden in the view only, decision 4), the note's Action
 * Items and the backlinks as small cards.
 */

type Mode = "drawer" | "full";

interface SheetProps {
  mode: Mode;
  /** Drawer width in percent (drawer mode). */
  width?: number;
  setWidth?: (w: number) => void;
}

export function NoteSheet({ id, mode, width, setWidth }: SheetProps & { id: string }) {
  const item = useNote(id);
  // A note the store does not know yet (e.g. just captured): load a fresh snapshot before giving up.
  const looking = useRefreshWhenMissing(id, !item);
  // The full tab owns data-drawer="full"; in drawer mode NoteDrawer owns the contract.
  useDrawerContract(mode === "full" ? "full" : null, 0);

  const body = item ? (
    <Sheet item={item} mode={mode} width={width} setWidth={setWidth} />
  ) : (
    <div style={{ padding: 32 }} className="kx-help" role="status" aria-busy={looking}>
      {looking ? t("Loading note…") : t("Note not found.")}
    </div>
  );
  if (mode === "drawer") return body;
  return (
    <section className="kx-drawer fs-ed" data-size="full" aria-label={t("Editor")}>
      {body}
    </section>
  );
}

type Act = ReturnType<typeof useSheetActions>;

// The sheet is split into memo parts that get the note without its live text (lib/notes/stable-item.ts) and stable
// actions, so a keystroke in the editor re-renders the body only (fx2-perf: about 100 of 113 components per keystroke
// were the header and its icons). Prompt and session panels show the text itself: they get the live item.
const Reminder = memo(ReminderRadar);
const Summary = memo(NoteSummary);
const Proposal = memo(AiProposalCard);

function Sheet({ item: liveItem, mode, width, setWidth }: SheetProps & { item: KnowledgeItem }) {
  const notes = useNotes();
  const item = useItemMeta(liveItem);
  // Bumped when an AI proposal replaces the text, so the editor reloads the new Markdown.
  const [rev, setRev] = useState(0);
  const [src, setSrc] = useState(false);
  const [more, setMore] = useState(!!item.folderSuggestion);
  const [aiOpen, setAiOpen] = useState(true);
  const [remind, setRemind] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const ai = useNoteAi(liveItem);

  // Another note: back to the reading view with the extra properties folded.
  useEffect(() => {
    setSrc(false);
    setMore(false);
    setRemind(false);
    setCoverOpen(false);
  }, [item.id]);
  // A folder suggestion is actionable: open the section that holds it.
  useEffect(() => {
    if (item.folderSuggestion) setMore(true);
  }, [item.folderSuggestion]);

  const full = mode === "full";
  const objects = useSameArray(linkedObjects(item, notes.items));
  const groups = useBacklinkGroups(item, notes.items);
  // People of the note: linked person objects in both directions (a meeting's participants link to it).
  const people = useSameArray([...new Map([...objects, ...groups.mentions].filter((o) => o.type === "person").map((o) => [o.id, o] as const)).values()]);
  const summary = ai.summary ?? item.tldr;
  const takeaways = useMemo(() => takeawaysOf(item), [item]);
  const knownTags = useMemo(() => [...new Set(Object.values(notes.items).flatMap((i) => i.tags))], [notes.items]);
  // The tag idea reads the text; deferred, so it never holds up a keystroke.
  const text = useDeferredValue(liveItem.contentMd);
  const tagIdea = useMemo(
    () => suggestTags(`${item.title}\n${text}`, knownTags, item.tags, 1)[0] ?? null,
    [item.title, text, item.tags, knownTags],
  );
  const act = useSheetActions({ item, full, width, setWidth, setSrc, setMore, setAiOpen, setRemind, setCoverOpen, ai, setRev });

  return (
    <>
      <SheetToolbar item={item} full={full} half={full ? null : width === DW_HALF} src={src} aiOpen={aiOpen} act={act} />

      <div className="kx-dr-body kx-scroll fs-ed-scroll fs-gc" data-note-content data-type={item.type}>
        {src ? (
          <MarkdownSource item={liveItem} />
        ) : (
          <>
            <SheetCover item={item} open={coverOpen} act={act} />
            <div className="kx-dr-in fs-ed-in">
              <SheetHead item={item} full={full} more={more} remind={remind} tagIdea={tagIdea} objects={objects} people={people} act={act} />
              {isDossierType(item.type) && <DossierPanel title={item.title} md={text} groups={groups} />}
              {item.dbType === "prompt" && <PromptPanel item={liveItem} />}
              {item.dbType === "session" && <SessionPanel item={liveItem} />}

              {aiOpen && (
                <Summary
                  text={summary}
                  pending={ai.pending === "summarize"}
                  takeaways={takeaways}
                  busy={ai.pending !== null}
                  dbType={item.dbType}
                  onAi={act.runAi}
                  onChip={act.chip}
                />
              )}
              <Proposal
                proposal={ai.proposal}
                pending={ai.pending && isTextAction(ai.pending) ? ai.pending : null}
                onApply={act.applyProposal}
                onDiscard={act.discardProposal}
              />

              <div className="kx-dr-read fs-ed-read">
                <NoteBody key={`${item.id}:${rev}`} item={liveItem} />
              </div>

              <ActionItems id={item.id} items={item.actionItems} />
              <SheetFooter item={item} groups={groups} act={act} />
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** The sheet's handlers as stable functions that always run the latest closure, so the memo parts keep their props. */
function useSheetActions(s: {
  item: KnowledgeItem;
  full: boolean;
  width?: number;
  setWidth?: (w: number) => void;
  setSrc: Dispatch<SetStateAction<boolean>>;
  setMore: Dispatch<SetStateAction<boolean>>;
  setAiOpen: Dispatch<SetStateAction<boolean>>;
  setRemind: Dispatch<SetStateAction<boolean>>;
  setCoverOpen: Dispatch<SetStateAction<boolean>>;
  ai: ReturnType<typeof useNoteAi>;
  setRev: Dispatch<SetStateAction<number>>;
}) {
  const router = useRouter();
  const { acceptFolder, dismissFolder, setContent, addTag, setLook, setTitle, moveTo } = useNotes();
  const { closeDrawer, openNote, showToast } = useShell();
  const closeTab = useCloseTab();
  const runChip = useChip();
  const { item, full, width, setWidth, setSrc, setMore, setAiOpen, setRemind, setCoverOpen, ai, setRev } = s;

  const close = () => (full ? closeTab() : closeDrawer());
  // Vollbild → back beside the view: the tab closes and the note opens in the drawer there.
  const toSide = () => {
    closeTab();
    openNote(item.id);
  };
  const openFull = () => {
    closeDrawer();
    router.push(noteHrefById(item.id));
  };
  const fns = {
    close,
    toggleWidth: () => (full ? toSide() : setWidth?.(toggleHalf(width ?? 0))),
    toggleFull: () => (full ? toSide() : openFull()),
    /** A link inside the drawer leaves the drawer behind. */
    leave: () => {
      if (!full) closeDrawer();
    },
    toggleSrc: () => setSrc((v) => !v),
    showSrc: () => setSrc(true),
    toggleMore: () => setMore((v) => !v),
    toggleAi: () => setAiOpen((v) => !v),
    toggleRemind: () => setRemind((v) => !v),
    toggleCover: () => setCoverOpen((v) => !v),
    closeCover: () => setCoverOpen(false),
    runAi: (a: AiActionId) => void ai.run(a),
    // "Tasks extrahieren" / "Karteikarten": the copilot's chip actions on this note (live: saved action items / cards).
    chip: (c: "tasks" | "cards") => runChip(c),
    applyProposal: () => {
      if (!ai.proposal) return;
      setContent(item.id, ai.proposal.md);
      setRev((r) => r + 1);
      ai.clearProposal();
      showToast(t("Text applied"));
    },
    discardProposal: () => ai.clearProposal(),
    // Device test 0.6.0: a note (e.g. a meeting handed over by the Windows app) could only be deleted from a list.
    // Delete from the note itself: it closes at once, the delete reaches the server after the undo window (or when
    // the page is left), then the server snapshot is reloaded.
    remove: () => {
      const { id, title } = item;
      close();
      let settled = false;
      const run = () => {
        if (settled) return;
        settled = true;
        window.removeEventListener("pagehide", run);
        if (!isLiveData()) return;
        void deleteItems([id]).then((r) => (r.ok ? router.refresh() : showToast(t("Not deleted: {error}", { error: r.error }))));
      };
      const timer = setTimeout(run, UNDO_MS);
      window.addEventListener("pagehide", run);
      showToast(t("“{title}” deleted", { title }), {
        label: t("Undo"),
        run: () => {
          settled = true;
          clearTimeout(timer);
          window.removeEventListener("pagehide", run);
          openNote(id);
        },
      });
    },
    // Archivieren (knowledge_items.status = archived, like the list's context menu): the note closes, undo brings it back.
    archive: () => {
      const { id, title } = item;
      if (!isLiveData()) {
        showToast(t("Archiving needs an account (not available in demo mode)"));
        return;
      }
      close();
      void setArchived([id], true).then((r) => {
        if (!r.ok) {
          showToast(t("Not archived: {error}", { error: r.error }));
          return;
        }
        router.refresh();
        showToast(t("“{title}” archived", { title }), {
          label: t("Undo"),
          run: () =>
            void setArchived([id], false).then((u) => {
              if (!u.ok) showToast(t("Undo not saved: {error}", { error: u.error }));
              router.refresh();
              openNote(id);
            }),
        });
      });
    },
    move: (folder: string) => {
      moveTo(item.id, folder);
      showToast(t("Moved to {folder}", { folder }));
    },
    // K5: "Teilen" is "Link kopieren": the note's deep link (/notes/<id>) to the clipboard.
    copyLink: async () => {
      const url = new URL(noteHrefById(item.id), window.location.origin).toString();
      try {
        await navigator.clipboard.writeText(url);
        showToast(t("Link copied"));
      } catch {
        showToast(t("Could not copy the link"));
      }
    },
    filterTag: (t: string) => router.push(spaceHref("all", t)),
    addTagIdea: (tag: string) => {
      addTag(item.id, tag);
      showToast(t("{tag} added", { tag }));
    },
    acceptFolder: () => {
      acceptFolder(item.id);
      showToast(t("Moved to {folder}", { folder: item.folderSuggestion ?? "" }));
    },
    dismissFolder: () => dismissFolder(item.id),
    openObject: (id: string) => openNote(id),
    hintLink: () => showToast(t("Link in the text with [[Name]]")),
    setCover: (url: string | null) => setLook(item.id, { cover: url }),
    toast: (m: string) => showToast(m),
    setTitle: (t: string) => setTitle(item.id, t),
  };
  const latest = useRef(fns);
  latest.current = fns;
  const [stable] = useState(() => {
    const call = latest as { current: Record<string, (...a: unknown[]) => unknown> };
    const out: Record<string, (...a: unknown[]) => unknown> = {};
    for (const k of Object.keys(fns)) out[k] = (...a) => call.current[k]!(...a);
    return out as unknown as typeof fns;
  });
  return stable;
}

/** A2: star in the editor head, pins the note to the sidebar favourites (knowledge_items.is_favorite); amber when on. */
function FavStar({ item }: { item: KnowledgeItem }) {
  const { list, loading, pin, unpin } = useFavorites();
  const on = loading ? item.favorite === true : list.some((f) => f.id === item.id);
  const tip = on ? t("Remove from favorites") : t("Add to favorites");
  return (
    <button
      type="button"
      className={"tc-ibtn tc-fav-star" + (on ? " is-fav" : "")}
      aria-pressed={on}
      aria-label={tip}
      data-tip={tip}
      onClick={() => void (on ? unpin(item.id) : pin(item.id))}
    >
      <Star size={15} strokeWidth={1.75} fill={on ? "currentColor" : "none"} aria-hidden />
    </button>
  );
}

const SheetToolbar = memo(function SheetToolbar({
  item,
  full,
  half,
  src,
  aiOpen,
  act,
}: {
  item: KnowledgeItem;
  full: boolean;
  /** null in the full tab (no 50/50 there). */
  half: boolean | null;
  src: boolean;
  aiOpen: boolean;
  act: Act;
}) {
  const crumbs = noteCrumbs(item.path, OBJECT_HUBS);
  const fullTip = full ? t("Back to side view") : t("Full screen");
  return (
    <div className="kx-dr-head fs-ed-bar">
      <nav className="kx-dr-path" aria-label={t("Path")} title={item.path}>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={i}>
              {i > 0 && "/"}
              {last ? (
                <b aria-current="page">{c.label}</b>
              ) : c.href ? (
                <Link href={c.href} title={t("Open {name}", { name: c.label })} onClick={act.leave}>
                  {c.label}
                </Link>
              ) : (
                c.label
              )}
            </span>
          );
        })}
      </nav>
      <FavStar item={item} />
      <button type="button" className="tc-ibtn" aria-pressed={full} aria-label={fullTip} data-tip={fullTip} onClick={act.toggleFull}>
        <NIco name={full ? "minimize-2" : "maximize-2"} size={15} />
      </button>
      <button type="button" className="tc-ibtn" aria-label={t("Copy link")} data-tip={t("Copy link")} onClick={() => void act.copyLink()}>
        <NIco name="link" size={15} />
      </button>
      <button
        type="button"
        className={"tc-ibtn" + (aiOpen ? " is-on" : "")}
        aria-pressed={aiOpen}
        aria-label={t("AI actions")}
        data-tip={t("AI: TL;DR, tasks, flashcards")}
        onClick={act.toggleAi}
      >
        <NIco name="sparkles" size={15} />
      </button>
      <SheetMenu
        half={half}
        src={src}
        hasCover={!!item.cover}
        currentFolder={item.path.split("/").slice(0, -1).join("/")}
        onHalf={act.toggleWidth}
        onSrc={act.toggleSrc}
        onCover={act.toggleCover}
        onMove={act.move}
        onArchive={act.archive}
        onDelete={act.remove}
      />
      <button type="button" className="tc-ibtn" aria-label={t("Close")} title={t("Close (Esc)")} onClick={act.close}>
        <NIco name="x" size={15} />
      </button>
    </div>
  );
});

/** The item's own cover (with "Cover ändern"), else the soft glow in the type colour; the cover dialog opens from "Mehr". */
const SheetCover = memo(function SheetCover({ item, open, act }: { item: KnowledgeItem; open: boolean; act: Act }) {
  const coverOf = useCoverOf();
  const own = !!item.cover;
  return (
    <div className={"kx-look-anchor" + (own ? " kx-dr-cover-wrap" : " fs-ed-cover-anchor")}>
      {own ? <DrawerCover src={coverOf({ cover: item.cover, kind: item.type }).src} type={item.type} onChange={act.toggleCover} /> : <div className="fs-ed-glow" aria-hidden />}
      {open && <CoverDialog value={item.cover} onPick={act.setCover} onClose={act.closeCover} onError={act.toast} />}
    </div>
  );
});

/** Type line, title, the pill row (tags, facts, people, Erinnern, Eigenschaft) and the folded property panel. */
const SheetHead = memo(function SheetHead({
  item,
  full,
  more,
  remind,
  tagIdea,
  objects,
  people,
  act,
}: {
  item: KnowledgeItem;
  full: boolean;
  more: boolean;
  remind: boolean;
  tagIdea: string | null;
  objects: KnowledgeItem[];
  people: KnowledgeItem[];
  act: Act;
}) {
  const folder = item.path.split("/").slice(0, -1).join("/");
  const isObject = isDomainObjectType(item.type);
  const source = sourceLine(item);
  const status = statusPill(item);
  const tasks = taskProgress(item);
  const facts = keyFacts(item);
  const allObjects = [...new Map([...objects, ...people].map((o) => [o.id, o] as const)).values()];
  const day = todayIso();
  const due = isDueOn(item.remindAt, day);
  const watching = !!item.watch?.enabled;
  const moveParts = t("Move to {folder}", { folder: "\u0001" }).split("\u0001");
  return (
    <>
      <div className="fs-ed-type">
        <span className="fs-glyph" aria-hidden>
          <TypeIcon type={item.type} size={14} />
        </span>
        <ObjectTypeMenu item={item} bare />
        <span aria-hidden>·</span>
        <span className="kx-num">{whenLine(item.date, item.time, MOCK_TODAY)}</span>
        {source.href && (
          <>
            <span aria-hidden>·</span>
            <a href={source.href} target="_blank" rel="noopener noreferrer" className="kx-truncate fs-ed-src">
              {source.label}
              <NIco name="arrow-up-right" size={12} />
            </a>
          </>
        )}
        {status && status.tone !== "ok" && (
          <span className={`kx-dr-pill is-${status.tone}`} style={{ marginLeft: "auto" }}>
            {status.label}
          </span>
        )}
      </div>

      <h1 className={"kx-dr-title fs-ed-title" + (full ? " is-full" : "")} data-testid="note-title">
        {item.icon && <PageIconGlyph name={item.icon} size={full ? 30 : 26} className="kx-dr-title-icon" />}
        {/* W-05: the title is edited in place (Enter or leaving saves, Esc cancels); the vault file follows. */}
        <span
          key={`${item.id}:${item.title}`}
          className="kx-dr-title-edit"
          role="textbox"
          aria-label={t("Title")}
          contentEditable="plaintext-only"
          suppressContentEditableWarning
          spellCheck={false}
          style={{ outline: "none", cursor: "text" }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              e.currentTarget.textContent = item.title;
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => {
            const next = (e.currentTarget.textContent ?? "").replace(/\s+/g, " ").trim();
            if (!next) e.currentTarget.textContent = item.title;
            else if (next !== item.title) act.setTitle(next);
          }}
        >
          {item.title}
        </span>
      </h1>

      <div className="fs-prop" role="group" aria-label={t("Attributes")}>
        {item.tags.map((tag) => (
          <button key={tag} type="button" className="fs-pill" title={t("Filter by {tag}", { tag })} onClick={() => act.filterTag(tag)}>
            <span className="fs-dot" style={{ background: `var(--tag-${tagTone(tag)}-dot, var(--accent))` } as CSSProperties} aria-hidden />
            {tag.startsWith("#") ? tag : `#${tag}`}
          </button>
        ))}
        {tagIdea && (
          <button type="button" className="fs-pill is-ai" title={t("Accept AI suggestion")} onClick={() => act.addTagIdea(tagIdea)}>
            <NIco name="sparkles" size={12} />
            {tagIdea.startsWith("#") ? tagIdea : `#${tagIdea}`}
          </button>
        )}
        {facts.map((f) => (
          <span key={f.key} className="fs-pill" title={f.label}>
            <span className="fs-pill-k">{f.label}</span>
            {f.value}
          </span>
        ))}
        {people.length > 0 && (
          <button
            type="button"
            className="fs-pill"
            title={people.map((p) => p.title).join(", ")}
            onClick={() => act.openObject(people[0]!.id)}
          >
            <span className="fs-avs" aria-hidden>
              {people.slice(0, 3).map((p) => (
                <span key={p.id}>{initialsOf(p.title)}</span>
              ))}
            </span>
            {peopleLabel(people.map((p) => p.title))}
          </button>
        )}
        <button
          type="button"
          className={"fs-pill is-quiet" + (due ? " is-due" : "") + (item.remindAt ? " is-set" : "")}
          aria-expanded={remind}
          onClick={act.toggleRemind}
          title={watching ? t("Reminder and watching") : t("Set reminder")}
        >
          <NIco name="bell" size={12} />
          {item.remindAt ? remindLabel(item.remindAt, day) : t("Remind")}
        </button>
        <button type="button" className="fs-pill is-quiet" aria-expanded={more} onClick={act.toggleMore} title={t("Folder, objects and properties")}>
          <NIco name={more ? "chevron-up" : "plus"} size={12} />
          {t("Property")}
        </button>
      </div>

      {isObject && (
        <div className="kx-dr-objprops">
          <PropertyPills key={item.type} item={item} type={item.type as DomainObjectType} />
        </div>
      )}

      {(remind || watching) && (
        <div className="fs-ed-panel">
          <Reminder item={item} />
        </div>
      )}

      {more && (
        <div className="fs-ed-panel">
          <dl className="kx-props">
            <Prop icon={<NIco name="folder" />} label={t("Folder")}>
              <span className="kx-mono kx-dr-folder">{folder || "/"}</span>
              <span className="kx-meta">{placementHint(item)}</span>
              {item.folderSuggestion && (
                <span className="kx-dr-chip is-ai" style={{ paddingRight: 4 }}>
                  <NIco name="sparkles" size={11} />
                  <button
                    type="button"
                    className="kxb"
                    title={item.manualPlacement ? t("Placed manually: Kortex moves nothing without you") : t("Accept suggestion")}
                    onClick={act.acceptFolder}
                  >
                    {moveParts[0]}<span className="kx-mono">{item.folderSuggestion}</span>{moveParts[1]}
                  </button>
                  <button type="button" className="kxb kx-dr-chip-x" aria-label={t("Dismiss suggestion")} onClick={act.dismissFolder}>
                    <NIco name="x" size={12} />
                  </button>
                </span>
              )}
            </Prop>
            <Prop icon={<NIco name="boxes" />} label={t("Objects")}>
              {allObjects.length ? (
                allObjects.map((o) => (
                  <button key={o.id} type="button" className="kx-dr-chip is-btn is-obj" onClick={() => act.openObject(o.id)} title={o.title}>
                    <span className={"kx-av" + (o.type === "person" ? "" : " is-sq")}>{initialsOf(o.title)}</span>
                    {o.title}
                  </button>
                ))
              ) : (
                <span className="kx-meta">{t("None")}</span>
              )}
              <button type="button" className="kx-dr-chip is-btn" aria-label={t("Link object")} title={t("Link object")} onClick={act.hintLink}>
                <NIco name="plus" size={12} />
              </button>
            </Prop>
            {tasks && (
              <Prop icon={<NIco name="square-check" />} label={t("Tasks")}>
                <span className="kx-num">
                  {t("{done} of {total} done", { done: tasks.done, total: tasks.total })}
                </span>
                <span className="kx-pbar" style={{ width: 80 }}>
                  <i style={{ width: `${(tasks.done / tasks.total) * 100}%` }} />
                </span>
              </Prop>
            )}
          </dl>
          {!isObject && <TypedProperties key={item.id} item={item} bare />}
        </div>
      )}
    </>
  );
});

/** Reader link, backlinks and the note on the Markdown source. */
const SheetFooter = memo(function SheetFooter({ item, groups, act }: { item: KnowledgeItem; groups: BacklinkGroups; act: Act }) {
  const file = item.path.split("/").pop() ?? item.path;
  const fileParts = t("Title and summary are fully in {file}; they are just not shown twice here.", { file: "\u0001" }).split("\u0001");
  return (
    <>
      {item.reader && (
        <div>
          <Link className="kx-btn kx-btn--secondary" href={readerHref(item.id)} onClick={act.leave}>
            <NIco name="book-open" />
            {t("Open in split reader")}
          </Link>
        </div>
      )}

      <Backlinks groups={groups} />

      <p className="kx-md-note">
        <NIco name="file-text" size={12} />
        <span>
          {fileParts[0]}<span className="kx-mono">{file}</span>{fileParts[1]}
          <button type="button" className="kx-linkbtn" onClick={act.showSrc}>
            {t("Show Markdown source")}
          </button>
        </span>
      </p>
    </>
  );
});

function Prop({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <>
      <dt>
        {icon}
        {label}
      </dt>
      <dd>{children}</dd>
    </>
  );
}
