"use client";

import { t } from "@/i18n";
import { Bell, Calendar, CircleDot, Folder, Globe, Hash, Info, Plus, Sparkles, Users } from "lucide-react";
import { memo, type CSSProperties, type ReactNode } from "react";
import type { DomainObjectType } from "@kortex/db/domain";
import { isDomainObjectType } from "@/lib/objects/schema";
import { keyFacts, whenLine } from "@/lib/notes/facts";
import { sourceLine, statusPill } from "@/lib/notes/properties";
import { isDueOn, remindLabel } from "@/lib/reminders";
import { todayIso } from "@/lib/date/today";
import { MOCK_TODAY, tagTone, type KnowledgeItem } from "@/lib/workspace-data";
import { TypeIcon } from "./icons";
import { ObjectTypeMenu } from "./ObjectTypeMenu";
import { PageIconGlyph } from "./PageLook";
import { PropertyTable } from "./PropertyPills";

/*
 * Head of an entry in the Ruhe look (artifact "Kortex Ruhe-Iteration", screen 03; gap web-b W2): the title, then the
 * properties as a quiet table (icon + label left, value right: type, date, source, people, tags, the typed facts),
 * instead of the type line and the pill row. Domain objects other than the Akte types add their fields as rows
 * (PropertyTable). "Erinnern" and "Eigenschaft" stay as two quiet buttons under the table; the folded panels
 * (reminder, folder/objects/tasks) are rendered by NoteSheet as before. Styles: ruhe-note.css.
 */

export interface NoteHeadActs {
  setTitle: (title: string) => void;
  filterTag: (tag: string) => void;
  addTagIdea: (tag: string) => void;
  openObject: (id: string) => void;
  toggleRemind: () => void;
  toggleMore: () => void;
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="rz-props-row">
      <dt>
        {icon}
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

const ICO = { size: 14, strokeWidth: 1.5, "aria-hidden": true } as const;

export const NoteHeadRuhe = memo(function NoteHeadRuhe({
  item,
  full,
  more,
  remind,
  tagIdea,
  people,
  act,
}: {
  item: KnowledgeItem;
  full: boolean;
  more: boolean;
  remind: boolean;
  tagIdea: string | null;
  people: KnowledgeItem[];
  act: NoteHeadActs;
}) {
  const isObject = isDomainObjectType(item.type);
  const source = sourceLine(item);
  const status = statusPill(item);
  const facts = keyFacts(item);
  const day = todayIso();
  const due = isDueOn(item.remindAt, day);
  const folder = item.path.split("/").slice(0, -1).join("/");
  return (
    <div className="rz-nh">
      <h1 className={"kx-dr-title fs-ed-title rz-nh-title" + (full ? " is-full" : "")} data-testid="note-title">
        {item.icon && <PageIconGlyph name={item.icon} size={full ? 28 : 24} className="kx-dr-title-icon" />}
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

      <dl className="rz-props" aria-label={t("Attributes")}>
        <Row icon={<TypeIcon type={item.type} size={14} />} label={t("Type")}>
          <ObjectTypeMenu item={item} bare />
          {[source.extra, status && status.tone !== "ok" ? status.label : null].filter(Boolean).map((x) => (
            <span key={x} className="rz-props-meta">
              · {x}
            </span>
          ))}
        </Row>
        <Row icon={<Calendar {...ICO} />} label={t("Date")}>
          <span className="kx-num">{whenLine(item.date, item.time, MOCK_TODAY)}</span>
        </Row>
        {source.href && (
          <Row icon={<Globe {...ICO} />} label={t("Source")}>
            <a href={source.href} target="_blank" rel="noopener noreferrer" className="rz-wl rz-props-src">
              {source.label}
            </a>
          </Row>
        )}
        {people.length > 0 && (
          <Row icon={<Users {...ICO} />} label={t("People")}>
            {people.map((p, i) => (
              <span key={p.id}>
                {i > 0 && <span className="rz-props-sep">, </span>}
                <button type="button" className="rz-wl" onClick={() => act.openObject(p.id)}>
                  {p.title}
                </button>
              </span>
            ))}
          </Row>
        )}
        <Row icon={<Hash {...ICO} />} label={t("Tags")}>
          {item.tags.map((tag) => (
            <button key={tag} type="button" className="rz-ntag" title={t("Filter by {tag}", { tag })} onClick={() => act.filterTag(tag)}>
              <i style={{ background: `var(--tag-${tagTone(tag)}-dot, var(--accent))` } as CSSProperties} aria-hidden />
              {tag.replace(/^#/, "")}
            </button>
          ))}
          {tagIdea && (
            <button type="button" className="rz-ntag is-ai" title={t("Accept AI suggestion")} onClick={() => act.addTagIdea(tagIdea)}>
              <Sparkles size={11} strokeWidth={1.75} aria-hidden />
              {tagIdea.replace(/^#/, "")}
            </button>
          )}
          {!item.tags.length && !tagIdea && <span className="rz-props-empty">{t("None")}</span>}
        </Row>
        {facts.map((f) => (
          <Row key={f.key} icon={<Info {...ICO} />} label={f.label}>
            {f.value}
          </Row>
        ))}
        {item.remindAt && (
          <Row icon={<Bell {...ICO} />} label={t("Reminder")}>
            <button type="button" className={"rz-props-v" + (due ? " is-due" : "")} aria-expanded={remind} onClick={act.toggleRemind}>
              {remindLabel(item.remindAt, day)}
            </button>
          </Row>
        )}
        {more && !isObject && (
          <Row icon={<Folder {...ICO} />} label={t("Folder")}>
            <span className="kx-mono rz-props-folder">{folder || "/"}</span>
          </Row>
        )}
      </dl>

      {isObject && (
        <div className="rz-nh-obj">
          <PropertyTable key={item.type} item={item} type={item.type as DomainObjectType} />
        </div>
      )}

      <div className="rz-nh-acts">
        {!item.remindAt && (
          <button type="button" className="rz-nh-act" aria-expanded={remind} onClick={act.toggleRemind}>
            <Bell size={13} strokeWidth={1.5} aria-hidden />
            {t("Remind")}
          </button>
        )}
        <button type="button" className="rz-nh-act" aria-expanded={more} onClick={act.toggleMore} title={t("Folder, objects and properties")}>
          {more ? <CircleDot size={13} strokeWidth={1.5} aria-hidden /> : <Plus size={13} strokeWidth={1.5} aria-hidden />}
          {t("Property")}
        </button>
      </div>
    </div>
  );
});
