"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Boxes, Plus, X } from "lucide-react";
import { DensitySwitch, HScroll, OBJECT_TYPES } from "@kortex/ui";
import { Ico, type IconId } from "@/components/shell/icons";
import { MOCK_TODAY } from "@/lib/workspace-data";
import { useDensity } from "@/lib/settings/store";
import { useNotes } from "@/lib/notes/store";
import { useShell } from "@/lib/shell/store";
import { DOMAIN_OBJECT_FOLDERS, NEW_OBJECT_TITLE } from "@/lib/objects/schema";
import { objectHref } from "@/lib/shell/routes";
import { collectionScope, type DomainKind } from "@/lib/data/collections";
import { CollectionHead, rich } from "./CollectionHead";
import { StatusPill } from "./EntryParts";
import { lastLabel, type ObjectTable } from "./objectRows";
import { useCollection } from "./useCollection";
import { useIncremental } from "./useIncremental";
import { t } from "@/i18n";

/*
 * Objekte (Tactile Craft v2, dummy `Objects`): record table per object type with type tabs and counters, density
 * switch, monogram avatars, the frontmatter columns of the type, linked entries, related objects, Life area with its
 * coloured icon, last contact and status. Rows open in the drawer and keep the context menu and multi-select.
 */

export interface ObjectTab {
  type: DomainKind;
  label: string;
  count: number;
}

export function ObjectsView({
  type,
  tabs,
  table,
  total,
  folder,
  filter,
}: {
  type: DomainKind;
  tabs: ObjectTab[];
  table: ObjectTable;
  total: number;
  folder: string;
  filter?: { label: string; clearHref: string };
}) {
  const entries = useMemo(() => table.rows.map((r) => r.entry), [table.rows]);
  const c = useCollection(entries);
  const visible = useMemo(() => new Set(c.rows.map((r) => r.id)), [c.rows]);
  const rows = table.rows.filter((r) => visible.has(r.entry.id));
  // Long hubs (e.g. 100+ tools after an import) render in batches while scrolling.
  const lazy = useIncremental(rows.length, `${type}|${filter?.label ?? ""}`);
  const { density, setDensity } = useDensity(collectionScope("objects", type), { drawerOpen: c.drawerOpen });
  const today = MOCK_TODAY;
  const isPerson = type === "person";
  const notes = useNotes();
  const { openNote } = useShell();
  // Audit 0.6.1 W-25: an object can be created right in its hub (before: only by converting a note).
  const createObject = () => {
    const { item } = notes.createNote({ title: NEW_OBJECT_TITLE[type], contentMd: "", folder: DOMAIN_OBJECT_FOLDERS[type], objectType: type });
    openNote(item.id);
  };

  return (
    <div className="kc-page" data-density={density} data-collection={`objects:${type}`}>
      <CollectionHead
        icon={<Boxes aria-hidden />}
        crumbs={[{ label: t("Knowledge") }, { label: t("Objects") }]}
        title={t("Objects")}
        help={
          <>
            <span>{rich(t("{total} objects in {types} types"), { total: <b>{total}</b>, types: <b>{tabs.length}</b> })}</span>
            <span className="kc-dot" aria-hidden />
            <span className="kc-mono">70_Objects/{folder}/</span>
          </>
        }
        aside={
          <>
            <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" onClick={createObject}>
              <Plus aria-hidden />
              {NEW_OBJECT_TITLE[type]}
            </button>
            <DensitySwitch value={density} onChange={setDensity} />
          </>
        }
      />

      <nav className="kc-otabs" aria-label={t("Object types")}>
        {tabs.map((tab) => {
          const Icon = OBJECT_TYPES[tab.type].Icon;
          return (
            <Link key={tab.type} href={objectHref(tab.type)} className={"kc-chip" + (tab.type === type ? " is-on" : "")} aria-current={tab.type === type ? "page" : undefined}>
              <Icon aria-hidden />
              {tab.label}
              <span className="kc-count">{tab.count}</span>
            </Link>
          );
        })}
      </nav>

      {filter && (
        <div className="kc-activefilters">
          <span className="kc-meta">Filter:</span>
          <Link href={filter.clearHref} className="kc-chip is-on" aria-label={t("Remove filter {label}", { label: filter.label })}>
            {filter.label}
            <X aria-hidden />
          </Link>
        </div>
      )}

      {c.selectionBar}

      {rows.length === 0 ? (
        <div className="kc-section kc-empty-line">
          {filter
            ? t("There are no objects of this type for this hashtag yet.")
            : t("No objects of this type yet. Create “{title}” above or turn a note into an object.", { title: NEW_OBJECT_TITLE[type] })}
        </div>
      ) : (
        <HScroll className="kc-tbl-wrap">
          <table className="kc-tbl" data-view="objects">
            <thead>
              <tr>
                <th>Name</th>
                {table.columns.map((col) => (
                  <th key={col.key} className={col.numeric ? "is-r" : undefined}>
                    {col.label}
                  </th>
                ))}
                <th className="is-r">{t("Entries")}</th>
                {table.has.related && <th>{t("Linked with")}</th>}
                {table.has.life && <th>Life</th>}
                {table.has.last && <th>{isPerson ? t("Last contact") : t("Last mentioned")}</th>}
                {table.has.status && <th>Status</th>}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, lazy.shown).map((r) => {
                const rp = c.rowProps(r.entry);
                return (
                  <tr
                    key={r.entry.id}
                    tabIndex={0}
                    className={[c.isActive(r.entry) && "is-on", c.sel.selected.has(r.entry.id) && "is-sel"].filter(Boolean).join(" ") || undefined}
                    onClick={rp.onClick}
                    onContextMenu={rp.onContextMenu}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.altKey) {
                        e.preventDefault();
                        c.open(r.entry);
                        return;
                      }
                      rp.onKeyDown(e);
                    }}
                  >
                    <td style={{ maxWidth: 320 }}>
                      <div className="kc-tt">
                        <span className={"kc-mon" + (isPerson ? "" : " is-sq")} aria-hidden>
                          {r.mono}
                        </span>
                        <b className="kc-clamp1">{r.entry.title}</b>
                      </div>
                    </td>
                    {table.columns.map((col) => (
                      <td key={col.key} className={col.numeric ? "is-r kc-num" : undefined}>
                        {r.values[col.key] ?? <span className="kc-t3">–</span>}
                      </td>
                    ))}
                    <td className="is-r kc-num">{r.linked}</td>
                    {table.has.related && (
                      <td>
                        <span style={{ display: "flex", gap: 4 }}>
                          {r.related.slice(0, 2).map((o) => (
                            <span key={o.id} className="kc-objchip">
                              <span className={"kc-av" + (o.kind === "person" ? "" : " is-sq")} aria-hidden>
                                {o.mono}
                              </span>
                              {o.title}
                            </span>
                          ))}
                          {r.related.length > 2 && <span className="kc-count">+{r.related.length - 2}</span>}
                        </span>
                      </td>
                    )}
                    {table.has.life && (
                      <td>
                        {r.life ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--t2)" }}>
                            <span className="kc-lifeg" style={{ ["--lc" as string]: `var(--tag-${r.life.tone}-dot)` }} aria-hidden>
                              <Ico name={r.life.icon as IconId} />
                            </span>
                            {r.life.label}
                          </span>
                        ) : (
                          <span className="kc-t3">–</span>
                        )}
                      </td>
                    )}
                    {table.has.last && <td style={{ whiteSpace: "nowrap" }}>{r.last ? lastLabel(r.last, today) : <span className="kc-t3">–</span>}</td>}
                    {table.has.status && (
                      <td>
                        <StatusPill status={r.status} />
                      </td>
                    )}
                  </tr>
                );
              })}
              {lazy.more && (
                <tr ref={lazy.sentinel} data-load-more>
                  <td colSpan={99} className="kc-t3">
                    {t("{n} more …", { n: rows.length - lazy.shown })}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </HScroll>
      )}
      {c.menus}
    </div>
  );
}
