"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { BellRing, Check, ExternalLink, Sparkles, Trash2, X } from "lucide-react";
import { ContextMenu, isContextMenuKey, menuFor, useContextMenu, type ActionId } from "@kortex/ui";
import { Ico } from "@/components/shell/icons";
import { Pictogram } from "@/components/motion/Pictogram";
import { TypeIcon } from "@/components/note/icons";
import { INBOX_ACTIVE, INBOX_TARGET_FOLDERS, MOCK_TODAY, NOTES, OBJECT_ITEMS, isLiveData, type ItemType, type KnowledgeItem, type NoteSummary } from "@/lib/workspace-data";
import type { InboxKind, InboxTarget } from "@/lib/mock/views";
import { deleteItems, setArchived } from "@/lib/api/actions";
import { todayIso } from "@/lib/date/today";
import { useNotes } from "@/lib/notes/store";
import { isDueOn } from "@/lib/reminders";
import { useShell } from "@/lib/shell/store";
import { useCapture } from "@/lib/shell/capture";
import { monogram } from "@/lib/data/collections";
import { linkedObjects, whenLabel, type EntryObject } from "./entries";
import { acceptsDrop, takeInboxData } from "./inboxDrop";
import { useInbox, type InboxRow, type ReviewItem } from "./useInbox";
import { UNDO_MS } from "./useItemActions";
import { LazyItems } from "./useIncremental";
import { NoAiKeyNotice } from "@/components/settings/NoAiKeyNotice";
import { useLook } from "@/components/theme/look";
import { InboxRuhe } from "./InboxRuhe";
import { t, tn, tx } from "@/i18n";

/*
 * Inbox (Feinschliff Live, dummy "INBOX"): "Inbox" with the line "Alles landet hier …", then two tiles.
 * "In Bearbeitung": the running ingest jobs (captures of this visit and the server's processing items) with their step
 * and a progress bar; a job that has an item can be opened or deleted (undo). "Einsortiert, bitte kurz prüfen": every
 * item the Gardener placed, with its folder (mono) and tags; "Passt" accepts the placement for real (manual
 * placement + tags, useInbox) and the row turns into "Abgelegt" with an undo; "Ändern" opens the proposal in place:
 * Ziel, Tags, Objekt, and Verwerfen / Archivieren / Übernehmen. Kept from the triage: keys J/K (next/previous),
 * Enter (accept), E (Ziel), T (Tags), O (Objekt), X (archive), Backspace (discard) on the open proposal, the context
 * menu, drop / paste anywhere (useCapture).
 */

/** Review target by folder path (live: the vault folders, mock: the prototype list). */
const inboxTarget = (path: string): InboxTarget | undefined => INBOX_TARGET_FOLDERS.find((t) => t.path === path);

const KIND_TYPE: Record<InboxKind, ItemType> = { video: "video", ai: "ai", image: "note" };

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

/** The knowledge item behind a proposal (live), for its confidence, time and links. */
const itemOf = (r: ReviewItem): (NoteSummary & Partial<KnowledgeItem>) | undefined => (r.itemId ? (NOTES.find((n) => n.id === r.itemId) as (NoteSummary & Partial<KnowledgeItem>) | undefined) : undefined);

/** Organizer confidence in percent (metadata.placement.confidence); undefined when the item has none. */
const confidenceOf = (r: ReviewItem): number | undefined => {
  const c = itemOf(r)?.placement?.confidence;
  return typeof c === "number" ? Math.round(c * 100) : undefined;
};

/** Object the proposal relates to: an object linked to the item, else a linked note title that is an object. */
function objectOf(r: ReviewItem): EntryObject | undefined {
  const it = itemOf(r);
  if (it) {
    const o = linkedObjects(it.id, it.links ?? [])[0];
    if (o) return o;
  }
  const byTitle = OBJECT_ITEMS.find((o) => r.links.includes(o.title));
  return byTitle ? { id: byTitle.id, title: byTitle.title, kind: byTitle.type as EntryObject["kind"], mono: monogram(byTitle.title) } : undefined;
}

export function InboxView() {
  const { captures, showToast, openNote } = useShell();
  const inbox = useInbox();
  const inboxRef = useRef(inbox);
  inboxRef.current = inbox;
  const ruhe = useLook() === "ruhe";
  /** Ruhe: the proposal whose editor ("Ändern") is open in the side pane. */
  const [changingId, setChangingId] = useState<string | null>(null);
  const { items } = useNotes();
  const today = todayIso();
  /** The proposal opened with "Ändern" (keys act on it). */
  const [editing, setEditing] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const targetRef = useRef<HTMLSelectElement>(null);
  const tagRef = useRef<HTMLInputElement>(null);
  const cm = useContextMenu<string>();

  const { review, rows } = inbox;
  // Items deleted from "In Bearbeitung" (hidden at once, deleted after the undo window).
  const [goneJobs, setGoneJobs] = useState<ReadonlySet<string>>(new Set());
  const working = useMemo(
    () => [...captures, ...INBOX_ACTIVE.filter((a) => !captures.some((c) => c.itemId && c.itemId === a.itemId))].filter((a) => !(a.itemId && goneJobs.has(a.itemId))),
    [captures, goneJobs],
  );
  /** A job (a meeting handed over by the Windows app, a stuck capture): delete with undo. */
  const deleteJob = useCallback(
    (itemId: string, title: string) => {
      setGoneJobs((s) => new Set(s).add(itemId));
      const restore = () => setGoneJobs((s) => new Set([...s].filter((x) => x !== itemId)));
      const timer = isLiveData()
        ? setTimeout(
            () =>
              void deleteItems([itemId]).then((r) => {
                if (!r.ok) {
                  restore();
                  showToast(t("{what} not saved: {error}", { what: t("Delete"), error: r.error }));
                }
              }),
            UNDO_MS + 400,
          )
        : undefined;
      showToast(t("“{title}” deleted", { title }), {
        label: t("Undo"),
        run: () => {
          if (timer) clearTimeout(timer);
          restore();
        },
      });
    },
    [showToast],
  );

  const current: ReviewItem | undefined = review.find((r) => r.id === editing);

  // Ruhe shows the chosen capture in a side pane, so one is always chosen while the queue has any.
  useEffect(() => {
    if (ruhe && !current && review.length) setEditing(review[0]!.id);
  }, [ruhe, current, review]);

  const neighbour = useCallback(
    (item: ReviewItem) => {
      const idx = review.findIndex((r) => r.id === item.id);
      return review[idx + 1] ?? review[idx - 1];
    },
    [review],
  );

  /** "Passt" / "Übernehmen": the placement is written (useInbox), the row shows "Abgelegt" with an undo. */
  const accept = useCallback(
    (item: ReviewItem) => {
      const wasOpen = editing === item.id;
      const next = neighbour(item);
      inbox.accept(item);
      if (wasOpen) setEditing(next?.id ?? null);
    },
    [editing, neighbour, inbox],
  );

  /** X archives, Backspace / "Verwerfen" (W2) deletes after the undo window; both leave the list at once. */
  const dismiss = useCallback(
    (item: ReviewItem, how: "archive" | "delete") => {
      const next = neighbour(item);
      inbox.setGone(item.id, true);
      if (editing === item.id) setEditing(next?.id ?? null);
      const live = isLiveData() && !!item.itemId;
      if (how === "archive") {
        if (live) void setArchived([item.itemId!], true).then((r) => !r.ok && showToast(t("{what} not saved: {error}", { what: tx("verb", "Archive"), error: r.error })));
        showToast(t("“{title}” archived", { title: item.title }), {
          label: t("Undo"),
          run: () => {
            inbox.setGone(item.id, false);
            if (live) void setArchived([item.itemId!], false);
          },
        });
        return;
      }
      const timer = live ? setTimeout(() => void deleteItems([item.itemId!]).then((r) => !r.ok && showToast(t("{what} not saved: {error}", { what: t("Delete"), error: r.error }))), UNDO_MS + 400) : undefined;
      showToast(t("“{title}” discarded", { title: item.title }), {
        label: t("Undo"),
        run: () => {
          if (timer) clearTimeout(timer);
          inbox.setGone(item.id, false);
        },
      });
    },
    [neighbour, inbox, showToast, editing],
  );

  // Keys on the open proposal: J / K / Enter / E / X / Backspace / T / O.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || !review.length) return;
      const k = e.key.toLowerCase();
      if (k === "j" || k === "k") {
        const idx = current ? review.findIndex((r) => r.id === current.id) : -1;
        const to = k === "j" ? Math.min(review.length - 1, idx + 1) : Math.max(0, idx - 1);
        setEditing(review[to]?.id ?? null);
        e.preventDefault();
        return;
      }
      if (!current) return;
      // Enter on a focused button is that button's click.
      if (k === "enter" && (e.target as HTMLElement | null)?.closest?.("button, a")) return;
      if (k === "enter") accept(current);
      else if (k === "e") {
        if (ruhe) {
          setChangingId(current.id);
          requestAnimationFrame(() => targetRef.current?.focus());
        } else targetRef.current?.focus();
      }
      else if (k === "x") dismiss(current, "archive");
      else if (k === "backspace" || k === "delete") dismiss(current, "delete");
      else if (k === "t") tagRef.current?.focus();
      else if (k === "o") {
        const o = objectOf(current);
        if (o) openNote(o.id);
        else showToast(t("No object detected"));
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [review, current, accept, dismiss, openNote, showToast, ruhe]);

  /** Ruhe "Alle Vorschläge übernehmen": every clear proposal at once, one toast with an undo for all. */
  const acceptAll = useCallback(
    (list: ReviewItem[]) => {
      if (!list.length) return;
      for (const r of list) inbox.accept(r);
      showToast(tn(list.length, "{n} suggestion accepted", "{n} suggestions accepted"), {
        label: t("Undo"),
        run: () => {
          for (const r of list) inboxRef.current.undo(r.id);
        },
      });
    },
    [inbox, showToast],
  );

  // Drop or paste anywhere on the page goes through the shell's capture hook: an optimistic job in
  // "In Bearbeitung" right away, then /api/ingest with status polling (live) or the local row (mock).
  const { captureData } = useCapture();
  const takeData = useCallback((dt: DataTransfer | null) => void takeInboxData(dt, captureData, showToast), [captureData, showToast]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      takeData(e.clipboardData);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [takeData]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    takeData(e.dataTransfer);
  };

  return (
    <div
      className={(ruhe ? "rz-ib" : "fs-ib") + (dragging ? " is-drag" : "")}
      data-collection="inbox"
      onDragOver={(e) => {
        if (!acceptsDrop(e.dataTransfer.types)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {ruhe ? (
        <>
          {dragging && (
            <div className="fs-ib-drop" aria-hidden>
              {t("Drop it: Kortex puts it in the Inbox")}
            </div>
          )}
          <InboxRuhe
            rows={rows}
            working={working}
            current={current}
            changing={!!current && changingId === current.id}
            typeOf={(r) => (r.itemId ? items[r.itemId]?.type : undefined) ?? KIND_TYPE[r.kind] ?? "note"}
            dueOf={(r) => !!r.itemId && isDueOn(items[r.itemId]?.remindAt, today)}
            confidenceOf={confidenceOf}
            objectOf={objectOf}
            whenOf={(r) => {
              const it = itemOf(r);
              return it ? whenLabel(it.date, it.time, MOCK_TODAY) : "";
            }}
            notice={<NoAiKeyNotice where="inbox" />}
            editor={
              current && (
                <ProposalEditor
                  item={current}
                  targetRef={targetRef}
                  tagRef={tagRef}
                  onTarget={(path) => inbox.setTarget(current.id, path)}
                  onTags={(tags) => inbox.setTags(current.id, tags)}
                  onAccept={() => accept(current)}
                  onDiscard={() => dismiss(current, "delete")}
                  onArchive={() => dismiss(current, "archive")}
                  onObject={(id) => openNote(id)}
                />
              )
            }
            onPick={(id) => setEditing(id)}
            onChange={(id) => setChangingId(id)}
            onAccept={accept}
            onAcceptAll={acceptAll}
            onUndo={(id) => inbox.undo(id)}
            onArchive={(r) => dismiss(r, "archive")}
            onDiscard={(r) => dismiss(r, "delete")}
            onOpen={(id) => openNote(id)}
            onDeleteJob={deleteJob}
            onContextMenu={(r, e) => cm.bind(r.id).onContextMenu(e)}
          />
        </>
      ) : (
      <>
      <header>
        <h1 className="fs-ib-h1">Inbox</h1>
        <p className="fs-ib-sub">{t("Everything lands here. The AI Gardener sorts, you only confirm if you want to.")}</p>
      </header>

      <NoAiKeyNotice where="inbox" />

      {dragging && (
        <div className="fs-ib-drop" aria-hidden>
          {t("Drop it: Kortex puts it in the Inbox")}
        </div>
      )}

      <section className="fs-tile" aria-label={t("In progress")}>
        <div className="fs-lbl">{t("In progress")}</div>
        {working.length === 0 && <p className="fs-ib-empty">{t("Nothing is running right now. Links, files and thoughts land here, also by dragging or Ctrl+V.")}</p>}
        {working.map((a, i) => (
          <div key={`${a.itemId ?? a.title}-${i}`} className="fs-ib-job">
            <span className="fs-glyph fs-glyph--plain" aria-hidden>
              <Ico name={a.icon} />
            </span>
            <span className="fs-ib-txt">
              <span className="fs-ttl">{a.title}</span>
              <span className="fs-sub">{a.step}</span>
            </span>
            <span className="fs-bar" role="progressbar" aria-label={`${a.title}: ${a.pct} %`} aria-valuenow={a.pct} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${a.pct}%` }} />
            </span>
            {a.itemId ? (
              <span className="fs-ib-jobacts">
                <button type="button" className="tc-ibtn tc-ibtn--sm" aria-label={t("Open “{title}”", { title: a.title })} title={tx("verb", "Open")} onClick={() => openNote(a.itemId!)}>
                  <ExternalLink aria-hidden className="kx-ico" />
                </button>
                <button type="button" className="tc-ibtn tc-ibtn--sm" aria-label={t("Delete “{title}”", { title: a.title })} title={t("Delete")} onClick={() => deleteJob(a.itemId!, a.title)}>
                  <Trash2 aria-hidden className="kx-ico" />
                </button>
              </span>
            ) : (
              <span />
            )}
          </div>
        ))}
      </section>

      <section className="fs-tile" aria-label={t("Sorted, please check briefly")}>
        <div className="fs-lbl">{t("Sorted, please check briefly")}</div>
        {rows.length === 0 && <Pictogram kind="inbox" className="kx-art-ruhe" />}
        {rows.length === 0 && <p className="fs-ib-empty">{t("All checked. New captures appear here with the Gardener's suggestion.")}</p>}
        <LazyItems
          items={rows}
          resetKey="review"
          render={(r) => (
            <ReviewRow
            key={r.id}
            row={r}
            type={(r.itemId ? items[r.itemId]?.type : undefined) ?? KIND_TYPE[r.kind] ?? "note"}
            due={!!r.itemId && isDueOn(items[r.itemId]?.remindAt, today)}
            open={editing === r.id && !r.decision}
            targetRef={targetRef}
            tagRef={tagRef}
            onToggle={() => setEditing((v) => (v === r.id ? null : r.id))}
            onAccept={() => accept(r)}
            onUndo={() => inbox.undo(r.id)}
            onDiscard={() => dismiss(r, "delete")}
            onArchive={() => dismiss(r, "archive")}
            onTarget={(path) => inbox.setTarget(r.id, path)}
            onTags={(tags) => inbox.setTags(r.id, tags)}
            onObject={(id) => openNote(id)}
            onContextMenu={(e) => {
              if (r.decision) return;
              cm.bind(r.id).onContextMenu(e);
            }}
            onMenuKey={(e) => {
              if (!r.decision && isContextMenuKey(e)) cm.bind(r.id).onKeyDown(e);
            }}
          />
          )}
        />
      </section>
      </>
      )}

      <ContextMenu
        at={cm.menu?.at ?? null}
        label={tx("noun", "Capture")}
        sections={menuFor({ kind: "inbox" })}
        folders={INBOX_TARGET_FOLDERS.map((t) => t.path)}
        onAction={(id: ActionId, arg?: string) => {
          const item = review.find((r) => r.id === cm.menu?.target);
          if (!item) return;
          if (id === "accept") accept(item);
          else if (id === "delete") dismiss(item, "delete");
          else if (id === "open") setEditing(item.id);
          else if (id === "move" && arg) {
            inbox.setTarget(item.id, arg);
            showToast(t("Target: {target}", { target: inboxTarget(arg)?.label ?? arg }));
          }
        }}
        onClose={cm.close}
      />
    </div>
  );
}

function ReviewRow({
  row,
  type,
  due,
  open,
  targetRef,
  tagRef,
  onToggle,
  onAccept,
  onUndo,
  onDiscard,
  onArchive,
  onTarget,
  onTags,
  onObject,
  onContextMenu,
  onMenuKey,
}: {
  row: InboxRow;
  type: ItemType;
  due: boolean;
  open: boolean;
  targetRef: RefObject<HTMLSelectElement | null>;
  tagRef: RefObject<HTMLInputElement | null>;
  onToggle: () => void;
  onAccept: () => void;
  onUndo: () => void;
  onDiscard: () => void;
  onArchive: () => void;
  onTarget: (path: string) => void;
  onTags: (tags: string[]) => void;
  onObject: (id: string) => void;
  onContextMenu: (e: ReactMouseEvent) => void;
  onMenuKey: (e: ReactKeyboardEvent) => void;
}) {
  const conf = confidenceOf(row);
  const done = !!row.decision;
  return (
    <div className={"fs-ib-row fs-gc" + (open ? " is-open" : "") + (done ? " is-done" : "")} data-type={type} onContextMenu={onContextMenu} onKeyDown={onMenuKey}>
      <div className="fs-ib-line">
        <span className="fs-glyph" aria-hidden>
          <TypeIcon type={type} size={14} />
        </span>
        <span className="fs-ib-txt">
          <span className="fs-ttl">{row.title}</span>
          <span className="fs-sug">
            <Sparkles aria-hidden size={12} strokeWidth={1.5} className="fs-sug-ic" />
            <span className="fs-mono">{row.chosenTarget}</span>
            {row.chosenTags.length > 0 && <span>· {row.chosenTags.join(" ")}</span>}
            {!row.chosenTags.length && row.hint && <span>· {row.hint}</span>}
            {conf !== undefined && !done && <span className={"fs-conf" + (conf < 80 ? " is-low" : "")}>{conf} %</span>}
            {due && (
              <span className="fs-due">
                <BellRing aria-hidden size={12} strokeWidth={1.5} />
                {t("due")}
              </span>
            )}
          </span>
        </span>
        {done ? (
          <span className="fs-ib-ok">
            <span className="fs-ib-ok-l">
              <Check aria-hidden size={14} strokeWidth={2} />
              {t("Moved")}
            </span>
            <button type="button" className="fs-linkbtn" onClick={onUndo}>
              {t("Undo")}
            </button>
          </span>
        ) : (
          <span className="fs-ib-acts">
            <button type="button" className="fs-btn" aria-expanded={open} onClick={onToggle}>
              {t("Change")}
            </button>
            <button type="button" className="fs-btn is-acc" onClick={onAccept}>
              {t("Fits")}
            </button>
          </span>
        )}
      </div>
      {open && !done && (
        <ProposalEditor
          item={row}
          targetRef={targetRef}
          tagRef={tagRef}
          onTarget={onTarget}
          onTags={onTags}
          onAccept={onAccept}
          onDiscard={onDiscard}
          onArchive={onArchive}
          onObject={onObject}
        />
      )}
    </div>
  );
}

function ProposalEditor({
  item,
  targetRef,
  tagRef,
  onTarget,
  onTags,
  onAccept,
  onDiscard,
  onArchive,
  onObject,
}: {
  item: ReviewItem;
  targetRef: RefObject<HTMLSelectElement | null>;
  tagRef: RefObject<HTMLInputElement | null>;
  onTarget: (path: string) => void;
  onTags: (tags: string[]) => void;
  onAccept: () => void;
  /** W2: drop the capture (deleted after the undo window, like Backspace). */
  onDiscard: () => void;
  onArchive: () => void;
  onObject: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const target = inboxTarget(item.chosenTarget);
  const obj = objectOf(item);
  const it = itemOf(item);
  const addTag = () => {
    const t = draft.trim().replace(/^#?/, "#");
    if (t.length > 1 && !item.chosenTags.includes(t)) onTags([...item.chosenTags, t]);
    setDraft("");
  };

  return (
    <section className="fs-ib-edit" aria-label={t("Check suggestion")}>
      <div className="fs-ib-meta">
        {item.source}
        {it && <span className="kx-num"> · {whenLabel(it.date, it.time, MOCK_TODAY)}</span>}
      </div>
      {item.summary && <p className="fs-ib-take">{item.summary}</p>}
      <label className="fs-ib-field">
        <span>{t("Target")}</span>
        <select ref={targetRef} value={item.chosenTarget} onChange={(e) => onTarget(e.target.value)} aria-label={t("Target")}>
          {!target && <option value={item.chosenTarget}>{item.chosenTarget}</option>}
          {INBOX_TARGET_FOLDERS.map((t) => (
            <option key={t.path} value={t.path}>
              {t.label} · {t.path}
            </option>
          ))}
        </select>
      </label>
      <div className="fs-ib-field">
        <span>Tags</span>
        <span className="fs-ib-tags">
          {item.chosenTags.map((tag) => (
            <span key={tag} className="fs-pill">
              {tag}
              <button type="button" className="fs-pill-x" aria-label={t("Remove {tag}", { tag })} onClick={() => onTags(item.chosenTags.filter((x) => x !== tag))}>
                <X aria-hidden size={11} />
              </button>
            </span>
          ))}
          <input
            ref={tagRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              } else if (e.key === "Escape") (e.target as HTMLInputElement).blur();
            }}
            onBlur={addTag}
            placeholder="+ Tag"
            aria-label={t("Add tag")}
          />
        </span>
      </div>
      <div className="fs-ib-field">
        <span>{t("Object")}</span>
        <span>
          {obj ? (
            <button type="button" className="fs-pill" onClick={() => onObject(obj.id)}>
              <span className="fs-avs" aria-hidden>
                <span>{obj.mono}</span>
              </span>
              {obj.title}
            </button>
          ) : (
            <span className="fs-ib-meta">{t("None detected")}</span>
          )}
        </span>
      </div>
      {item.links.length > 0 && <div className="fs-ib-meta">{t("Linked with {titles}", { titles: item.links.join(" · ") })}</div>}
      <div className="fs-ib-edit-acts">
        <span className="fs-ib-keys">{t("J/K next · Enter accept · E target · T tags · X archive")}</span>
        <button type="button" className="fs-btn" onClick={onArchive}>
          {tx("verb", "Archive")}
        </button>
        <button type="button" className="fs-btn" onClick={onDiscard}>
          {t("Discard")}
        </button>
        <button type="button" className="fs-btn is-acc" onClick={onAccept}>
          {t("Accept")}
        </button>
      </div>
    </section>
  );
}
