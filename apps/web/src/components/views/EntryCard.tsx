"use client";

import type { CSSProperties, HTMLAttributes } from "react";
import { Check } from "lucide-react";
import { Avatars, Glyph, StatusPill, TagDot, ownImage } from "./EntryParts";
import type { ViewEntry } from "./entries";
import { t } from "@/i18n";

/*
 * Card of the grid (Feinschliff Live, prototype `.card`): a cover strip only when the entry has its own image (fading
 * into the card), a soft glow in the type colour, the head row with tinted type glyph, type and capture time, the
 * title, the AI takeaway (three lines) and a foot with the first tag, task count and object avatars. Every part only
 * shows when the entry carries the data.
 */

export interface EntryCardProps extends Omit<HTMLAttributes<HTMLButtonElement>, "children"> {
  entry: ViewEntry;
  /** Open in the drawer right now (accent ring). */
  active?: boolean;
  /** Part of the multi-selection. */
  selected?: boolean;
  /** Capture label of the head row ("Heute 09:05"). */
  when?: string;
}

export function EntryCard({ entry: it, active, selected, when, className, style, ...rest }: EntryCardProps) {
  const img = ownImage(it.cover);
  const length = it.length;
  const take = it.tldr || it.facts?.line;
  return (
    <button
      type="button"
      data-entry={it.id}
      className={"kc-card" + (img ? " has-cover" : "") + (active ? " is-on" : "") + (className ? " " + className : "")}
      aria-pressed={selected || undefined}
      aria-current={active || undefined}
      style={{ "--gc": it.tone.dot, ...style } as CSSProperties}
      {...rest}
    >
      {img && (
        <span className="kc-cover is-img">
          {/* eslint-disable-next-line @next/next/no-img-element -- user covers come from arbitrary hosts */}
          <img src={img} alt="" loading="lazy" decoding="async" />
          {length?.clock && <span className="kc-dur">{length.label}</span>}
          {it.progress !== undefined && <span className="kc-prog" style={{ width: `${Math.round(it.progress * 100)}%` }} aria-hidden />}
        </span>
      )}
      {selected && (
        <span className="kc-card-x" aria-hidden>
          <Check />
        </span>
      )}
      <span className="kc-card-b">
        <span className="kc-src">
          <Glyph entry={it} />
          <span className="kc-clamp1">{it.domain ?? it.typeLabel}</span>
          {length && !(img && length.clock) && <span className="kc-num kc-t3">{length.label}</span>}
          <StatusPill status={it.status?.tone === "ok" ? undefined : it.status} />
          {when && <span className="kc-when kc-num">{when}</span>}
        </span>
        <span className="kc-card-t kc-clamp2">{it.title}</span>
        {take && <span className="kc-take kc-clamp3">{take}</span>}
        {(it.tags.length > 0 || it.tasks || it.objects?.length) && (
          <span className="kc-card-f">
            {it.tags[0] && <TagDot tag={it.tags[0].label} />}
            {it.tags.length > 1 && <span className="kc-count">+{it.tags.length - 1}</span>}
            <span className="kc-end">
              <Avatars objects={it.objects} />
              {it.tasks && (
                <span className="kc-tasks" title={t("Tasks done / total")}>
                  {it.tasks[0]}/{it.tasks[1]}
                </span>
              )}
            </span>
          </span>
        )}
      </span>
    </button>
  );
}
