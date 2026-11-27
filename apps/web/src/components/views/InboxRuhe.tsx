"use client";

import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { BellRing, Check, ExternalLink, ListFilter, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { BarButton, KbdHints, LocationBar, ViewBar } from "@/components/shell/Bars";
import { DropMenu, MenuItem, MenuLabel, MenuSep } from "@/components/ui/primitives";
import { vaultHref } from "@/lib/shell/routes";
import { NOTE_TYPES } from "@/lib/workspace-data";
import { Pictogram } from "@/components/motion/Pictogram";
import { Ico } from "@/components/shell/icons";
import { TypeIcon } from "@/components/note/icons";
import type { ItemType } from "@/lib/workspace-data";
import type { InboxJob } from "@/lib/mock/types";
import { t, tx } from "@/i18n";
import type { EntryObject } from "./entries";
import { folderLabel, lensOf, UNCLEAR_BELOW, type InboxLens } from "./inboxLens";
import type { InboxRow, ReviewItem } from "./useInbox";

/*
 * Inbox in the Ruhe look (artifact "Kortex Ruhe-Iteration", screen 11): location bar "Inbox" with "Alle Vorschläge
 * übernehmen", a view bar (Alle / Mit Vorschlag / Unklar), on the left one calm row per capture with its filing
 * suggestion as a chip and a check to accept it, on the right the chosen capture: "Kurz gesagt" and the agent's
 * proposal (Ordner, Tags, Warum) with Übernehmen ↵ / Ändern E. InboxView owns state, keys and the drop zone; the
 * proposal editor ("Ändern") is InboxView's own. Styles: packages/ui/src/styles/ruhe-agent.css.
 */

export interface InboxRuheProps {
  rows: readonly InboxRow[];
  working: readonly InboxJob[];
  current: ReviewItem | undefined;
  changing: boolean;
  typeOf: (r: InboxRow) => ItemType;
  dueOf: (r: InboxRow) => boolean;
  confidenceOf: (r: ReviewItem) => number | undefined;
  objectOf: (r: ReviewItem) => EntryObject | undefined;
  whenOf: (r: ReviewItem) => string;
  editor: ReactNode;
  notice: ReactNode;
  onPick: (id: string) => void;
  onChange: (id: string) => void;
  onAccept: (r: ReviewItem) => void;
  onAcceptAll: (rows: ReviewItem[]) => void;
  onUndo: (id: string) => void;
  onArchive: (r: ReviewItem) => void;
  onDiscard: (r: ReviewItem) => void;
  onOpen: (itemId: string) => void;
  onDeleteJob: (itemId: string, title: string) => void;
  onContextMenu: (r: InboxRow, e: MouseEvent) => void;
}

export function InboxRuhe(p: InboxRuheProps) {
  const [lens, setLens] = useState<InboxLens>("all");
  // "Filter" in the view bar: one content type (Artikel, Meeting …) of the captures, or all.
  const [kind, setKind] = useState<ItemType | null>(null);
  const router = useRouter();
  const kinds = [...new Set(p.rows.map((r) => p.typeOf(r)))];
  const all = kind ? p.rows.filter((r) => p.typeOf(r) === kind) : p.rows;
  const open = all.filter((r) => !r.decision);
  const lensMap = useMemo(() => new Map(p.rows.map((r) => [r.id, lensOf(r, p.confidenceOf(r))])), [p]);
  const count = (l: InboxLens) => (l === "all" ? open.length : open.filter((r) => lensMap.get(r.id) === l).length);
  const shown = lens === "all" ? all : all.filter((r) => !r.decision && lensMap.get(r.id) === lens);
  const acceptable = open.filter((r) => lensMap.get(r.id) === "suggested");
  const LENSES: { id: InboxLens; label: string }[] = [
    { id: "all", label: t("All") },
    { id: "suggested", label: t("With suggestion") },
    { id: "unclear", label: t("Unclear") },
  ];

  return (
    <>
      <LocationBar
        icon="inbox"
        crumbs={[{ label: "Inbox" }]}
        actions={
          <BarButton icon={<Check aria-hidden size={14} strokeWidth={1.75} />} disabled={!acceptable.length} onClick={() => p.onAcceptAll(acceptable)}>
            {t("Accept all suggestions")}
          </BarButton>
        }
        more={
          <>
            <MenuItem onSelect={() => router.push(vaultHref("00_Inbox"))}>{t("Show in vault")}</MenuItem>
            {kind && <MenuItem onSelect={() => setKind(null)}>{t("Show all types")}</MenuItem>}
          </>
        }
      />
      <ViewBar
        tabs={LENSES.map((l) => ({ id: l.id, label: l.label, count: count(l.id) }))}
        value={lens}
        onChange={setLens}
        right={
          kinds.length > 1 ? (
            <DropMenu
              align="end"
              label={t("Filter")}
              trigger={
                <BarButton icon={<ListFilter aria-hidden size={14} strokeWidth={1.5} />} active={!!kind}>
                  {kind ? NOTE_TYPES[kind]?.label : t("Filter")}
                </BarButton>
              }
            >
              <MenuLabel>{t("Type")}</MenuLabel>
              <MenuItem onSelect={() => setKind(null)}>{t("All types")}</MenuItem>
              <MenuSep />
              {kinds.map((k) => (
                <MenuItem key={k} onSelect={() => setKind(k)}>
                  <TypeIcon type={k} size={14} />
                  {NOTE_TYPES[k]?.label ?? k}
                </MenuItem>
              ))}
            </DropMenu>
          ) : undefined
        }
      />
      {p.notice}

      <div className="rz-ib-body">
        <div className="rz-ib-list">
          {p.working.length > 0 && (
            <section className="rz-ag-group" aria-label={t("In progress")}>
              <h2 className="rz-ag-group-h">
                {t("In progress")}
                <span className="rz-ag-count">{p.working.length}</span>
              </h2>
              {p.working.map((a, i) => (
                <div key={`${a.itemId ?? a.title}-${i}`} className="rz-ib-row rz-ib-job">
                  <span className="rz-ib-ic">
                    <Ico name={a.icon} size={15} />
                  </span>
                  <span className="rz-ib-t">
                    <span className="rz-ib-title">{a.title}</span>
                    <span className="rz-ib-sub">{a.step}</span>
                  </span>
                  <span
                    className="rz-ib-bar"
                    role="progressbar"
                    aria-label={`${a.title}: ${a.pct} %`}
                    aria-valuenow={a.pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <i style={{ width: `${a.pct}%` }} />
                  </span>
                  {a.itemId && (
                    <span className="rz-ib-jobacts">
                      <button
                        type="button"
                        className="rz-icon"
                        aria-label={t("Open “{title}”", { title: a.title })}
                        title={tx("verb", "Open")}
                        onClick={() => p.onOpen(a.itemId!)}
                      >
                        <ExternalLink aria-hidden size={13} />
                      </button>
                      <button
                        type="button"
                        className="rz-icon"
                        aria-label={t("Delete “{title}”", { title: a.title })}
                        title={t("Delete")}
                        onClick={() => p.onDeleteJob(a.itemId!, a.title)}
                      >
                        <Trash2 aria-hidden size={13} />
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </section>
          )}

          <section className="rz-ag-group" aria-label={t("Sorted, please check briefly")}>
            <h2 className="rz-ag-group-h">
              {t("To check")}
              <span className="rz-ag-count">{shown.filter((r) => !r.decision).length}</span>
            </h2>
            {shown.length === 0 && (
              <div className="rz-empty">
                {!open.length && <Pictogram kind="inbox" className="kx-art-ruhe" />}
                <p className="rz-ag-note">
                  {open.length ? t("Nothing in this view.") : t("All checked. New captures appear here with the Gardener's suggestion.")}
                </p>
              </div>
            )}
            {shown.map((r) => {
              const done = !!r.decision;
              const on = p.current?.id === r.id;
              const sub = [r.source, r.hint].filter(Boolean).join(" · ");
              return (
                <div
                  key={r.id}
                  className={"rz-ib-row" + (on ? " is-on" : "") + (done ? " is-done" : "")}
                  data-lens={lensMap.get(r.id)}
                  onContextMenu={(e) => !done && p.onContextMenu(r, e)}
                >
                  <button type="button" className="rz-ib-main" aria-current={on || undefined} disabled={done} onClick={() => p.onPick(r.id)}>
                    <span className="rz-ib-ic">
                      <TypeIcon type={p.typeOf(r)} size={15} />
                    </span>
                    <span className="rz-ib-t">
                      <span className="rz-ib-title">{r.title}</span>
                      {sub && <span className="rz-ib-sub">{sub}</span>}
                    </span>
                    {p.dueOf(r) && (
                      <span className="rz-ib-due" title={t("due")}>
                        <BellRing aria-hidden size={12} strokeWidth={1.5} />
                      </span>
                    )}
                  </button>
                  {done ? (
                    <span className="rz-ib-ok">
                      <span>{t("Moved")}</span>
                      <button type="button" className="rz-link" onClick={() => p.onUndo(r.id)}>
                        {t("Undo")}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="rz-chip"
                      title={r.chosenTarget}
                      onClick={() => {
                        p.onPick(r.id);
                        p.onChange(r.id);
                      }}
                    >
                      <Ico name="folder" size={13} />
                      {r.chosenTarget ? folderLabel(r.chosenTarget) : t("Unclear")}
                    </button>
                  )}
                  <button
                    type="button"
                    className={"rz-ib-check" + (done ? " is-done" : "")}
                    aria-label={done ? t("Moved") : t("Accept: {title}", { title: r.title })}
                    title={done ? t("Moved") : t("Accept")}
                    disabled={done || !r.chosenTarget}
                    onClick={() => p.onAccept(r)}
                  >
                    <Check aria-hidden size={14} strokeWidth={2} />
                  </button>
                </div>
              );
            })}
          </section>

          {open.length > 0 && (
            <KbdHints
              className="rz-ib-keys"
              items={[
                { keys: ["↵"], label: t("accept") },
                { keys: ["E"], label: t("change") },
                { keys: ["X"], label: t("archive") },
                { keys: ["J", "K"], label: t("next") },
              ]}
            />
          )}
        </div>

        <aside className="rz-ib-pane" aria-label={t("Check suggestion")}>
          {p.current ? <Pane p={p} item={p.current} /> : <p className="rz-ag-note">{t("Pick a capture to see the agent's suggestion.")}</p>}
        </aside>
      </div>
    </>
  );
}

function Pane({ p, item }: { p: InboxRuheProps; item: ReviewItem }) {
  const conf = p.confidenceOf(item);
  const obj = p.objectOf(item);
  const when = p.whenOf(item);
  const why = item.hint || (item.links.length ? t("Linked with {titles}", { titles: item.links.join(" · ") }) : "");
  return (
    <article className="rz-ib-detail" key={item.id}>
      {item.coverUrl && (
        <div className="rz-ib-hero" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element -- user cover from storage, any host */}
          <img src={item.coverUrl} alt="" />
        </div>
      )}
      <div className="rz-ib-meta">
        {item.source}
        {when && <span className="kx-num"> · {when}</span>}
      </div>
      <h1 className="rz-ag-title">
        {item.itemId ? (
          <button type="button" className="rz-title-link" onClick={() => p.onOpen(item.itemId!)}>
            {item.title}
          </button>
        ) : (
          item.title
        )}
      </h1>
      {item.summary && (
        <div className="rz-tldr">
          <div className="rz-tldr-h">
            <Ico name="sparkles" size={13} />
            {t("In short")}
          </div>
          <p>{item.summary}</p>
        </div>
      )}

      {p.changing ? (
        <div className="rz-ib-change">{p.editor}</div>
      ) : (
        <section className="rz-prop">
          <div className="rz-prop-h">
            <Ico name="sparkles" size={14} />
            {t("The agent suggests")}
            {conf !== undefined && <span className={"rz-prop-conf" + (conf < UNCLEAR_BELOW ? " is-low" : "")}>{conf} %</span>}
          </div>
          <dl className="rz-prop-dl">
            <dt>{t("Folder")}</dt>
            <dd className="rz-mono">{item.chosenTarget || t("Unclear")}</dd>
            {item.chosenTags.length > 0 && (
              <>
                <dt>Tags</dt>
                <dd className="rz-prop-tags">
                  {item.chosenTags.map((tag) => (
                    <span key={tag} className="rz-tag">
                      {tag.replace(/^#/, "")}
                    </span>
                  ))}
                </dd>
              </>
            )}
            {obj && (
              <>
                <dt>{t("Object")}</dt>
                <dd>
                  <button type="button" className="rz-link" onClick={() => p.onOpen(obj.id)}>
                    {obj.title}
                  </button>
                </dd>
              </>
            )}
            {why && (
              <>
                <dt>{t("Why")}</dt>
                <dd>{why}</dd>
              </>
            )}
          </dl>
          <div className="rz-prop-acts">
            <button type="button" className="rz-btn rz-btn--acc" disabled={!item.chosenTarget} onClick={() => p.onAccept(item)}>
              {t("Accept")}
              <kbd className="rz-kbd">↵</kbd>
            </button>
            <button type="button" className="rz-btn" onClick={() => p.onChange(item.id)}>
              {t("Change")}
              <kbd className="rz-kbd">E</kbd>
            </button>
            <span className="rz-grow" />
            <button type="button" className="rz-btn rz-btn--ghost" onClick={() => p.onArchive(item)}>
              {tx("verb", "Archive")}
            </button>
            <button type="button" className="rz-btn rz-btn--ghost" onClick={() => p.onDiscard(item)}>
              {t("Discard")}
            </button>
          </div>
        </section>
      )}
    </article>
  );
}
