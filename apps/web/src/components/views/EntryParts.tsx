import type { CSSProperties } from "react";
import {
  AudioLines,
  BookOpen,
  Building2,
  ChefHat,
  FileText,
  Globe,
  Landmark,
  Lightbulb,
  Mic,
  Play,
  Rocket,
  Sparkles,
  Target,
  User,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { HashtagPill, OBJECT_TYPES } from "@kortex/ui";
import { Ico } from "@/components/shell/icons";
import { tagTone } from "@/lib/workspace-data";
import { registryIcon } from "@/lib/shell/registry-icons";
import type { DomainType } from "@/lib/mock/views";
import { visualOf, type EntryStatus } from "@/lib/data/collections";
import { OBJECT_TYPE_LABEL, type EntryFacts, type EntryObject, type ViewEntry } from "./entries";
import { t } from "@/i18n";

/*
 * Small building blocks of the collection views (Tactile Craft v2, Paket D). EntryVisual / EntryPlaceholder are the
 * monochrome placeholder of decision 13 (thin type icon on a dot raster, no brand colours); Paket E can import them
 * for the Home "Weiterlesen" strip: `import { EntryVisual, EntryPlaceholder } from "@/components/views/EntryParts"`.
 */

const GLYPHS: Record<string, LucideIcon> = {
  "file-text": FileText,
  mic: Mic,
  globe: Globe,
  "book-open": BookOpen,
  play: Play,
  "audio-lines": AudioLines,
  sparkles: Sparkles,
  "chef-hat": ChefHat,
  user: User,
  rocket: Rocket,
  "building-2": Building2,
  lightbulb: Lightbulb,
  wrench: Wrench,
  landmark: Landmark,
  target: Target,
};

/** Monochrome placeholder: the entry type's thin glyph in a raised tile on a dot raster. Fills its parent. */
export function EntryPlaceholder({ kind, size = 30 }: { kind: string; size?: number }) {
  const v = visualOf(null, kind);
  const Icon = (v.kind === "placeholder" && GLYPHS[v.glyph]) || FileText;
  return (
    <span className="kc-ph" aria-hidden>
      <span className="kc-ph-g" style={size !== 30 ? { width: size, height: size } : undefined}>
        <Icon />
      </span>
    </span>
  );
}

/** Own image of an entry, or the monochrome placeholder (never a pack tile, favicon or brand colour). */
export function EntryVisual({ cover, kind, size }: { cover: string | null | undefined; kind: string; size?: number }) {
  const v = visualOf(cover, kind);
  // eslint-disable-next-line @next/next/no-img-element -- user covers come from arbitrary hosts
  if (v.kind === "image") return <img src={v.src} alt="" loading="lazy" decoding="async" />;
  return <EntryPlaceholder kind={kind} size={size} />;
}

/** Small thumbnail (list, timeline, queue). */
export function Thumb({ entry, w = 34, h = 34 }: { entry: Pick<ViewEntry, "cover" | "kind">; w?: number; h?: number }) {
  return (
    <span className="kc-thumb" style={{ width: w, height: h }}>
      <EntryVisual cover={entry.cover} kind={entry.kind} size={Math.min(w, h) - 10} />
    </span>
  );
}

/** Object avatar: round monogram for people, rounded square for every other object type. */
export function Avatar({ obj }: { obj: EntryObject }) {
  return (
    <span className={"kc-av" + (obj.kind === "person" ? "" : " is-sq")} title={`${OBJECT_TYPE_LABEL[obj.kind] ? t(OBJECT_TYPE_LABEL[obj.kind]) : t("Object")}: ${obj.title}`}>
      {obj.mono}
    </span>
  );
}

export function Avatars({ objects, max = 3 }: { objects?: EntryObject[]; max?: number }) {
  if (!objects?.length) return null;
  return (
    <span className="kc-avs" aria-label={t("Linked: {titles}", { titles: objects.map((o) => o.title).join(", ") })}>
      {objects.slice(0, max).map((o) => (
        <Avatar key={o.id} obj={o} />
      ))}
    </span>
  );
}

export function StatusPill({ status }: { status?: EntryStatus }) {
  if (!status) return null;
  return <span className={`kc-pill kc-pill--${status.tone}`}>{status.label}</span>;
}

/** Type glyph: prototype line icon for notes, the ObjectBadge glyph for domain objects. */
export function TypeGlyph({ entry, style, size }: { entry: ViewEntry; style?: CSSProperties; size?: "sm" | "md" | "lg" }) {
  const cls = ["kx-ico", size === "sm" && "kx-ico--sm", size === "lg" && "kx-ico--lg"].filter(Boolean).join(" ");
  if (entry.lucide) {
    const Registry = registryIcon(entry.lucide);
    return <Registry aria-hidden className={cls} style={style} />;
  }
  if (entry.icon) return <Ico name={entry.icon} size={size} style={style} />;
  const Icon = OBJECT_TYPES[entry.kind as DomainType].Icon;
  return <Icon aria-hidden className={cls} style={style} />;
}

/** Compact contexts show tags as a coloured dot only; the name is the tooltip (V2-10b). */
export function TagPills({ entry }: { entry: ViewEntry }) {
  return (
    <>
      {entry.tags.map((tag) => (
        <HashtagPill key={tag.label} tag={tag.label} variant="dot" />
      ))}
    </>
  );
}

/** Quiet tag chip of the Tactile Craft cards ("#" in --t4). */
export function TagChip({ tag, style }: { tag: string; style?: CSSProperties }) {
  return (
    <span className="kc-tag" style={style} title={tag}>
      {tag.replace(/^#/, "")}
    </span>
  );
}

/* ---------------------------------------------------------------- Feinschliff Live (fs-collections.css) */

/** Type glyph in a tile tinted with the entry's type colour (prototype `.glyph`). */
export function Glyph({ entry, className }: { entry: ViewEntry; className?: string }) {
  return (
    <span className={"kc-glyph" + (className ? " " + className : "")} style={{ "--gc": entry.tone.dot } as CSSProperties} aria-hidden>
      <TypeGlyph entry={entry} size="sm" />
    </span>
  );
}

/** Hashtag pill with a dot in the tag's colour (prototype `.pill`). */
export function TagDot({ tag }: { tag: string }) {
  return (
    <span className="kc-tpill" title={tag}>
      <i aria-hidden style={{ background: `var(--tag-${tagTone(tag)}-dot)` }} />
      {tag.startsWith("#") ? tag : "#" + tag}
    </span>
  );
}

/** Own image of an entry (no placeholder, no pack tile, no svg); null when the entry has none. */
export function ownImage(cover: string | null | undefined): string | null {
  const v = visualOf(cover, "note");
  return v.kind === "image" && !/\.svg(\?|$)/i.test(v.src) ? v.src : null;
}

/** Key metadata of a domain object: status chip, one-line facts and a progress bar. */
export function Facts({ facts, compact }: { facts: EntryFacts; compact?: boolean }) {
  return (
    <span style={{ display: "grid", gap: 6 }}>
      <span className="kxh-row" style={{ gap: 8, flexWrap: "wrap" }}>
        {facts.status && (
          <span className={`kx-status ${facts.status.cls}`} style={{ height: 20 }}>
            {facts.status.label}
          </span>
        )}
        <span style={{ fontSize: compact ? 12 : 13, lineHeight: 1.5, fontWeight: 400, color: "var(--text-secondary)" }}>{facts.line}</span>
      </span>
      {facts.progress !== undefined && (
        <span className="kx-progress" role="progressbar" aria-valuenow={facts.progress} aria-valuemin={0} aria-valuemax={100} style={{ height: 4 }}>
          <i style={{ width: `${facts.progress}%` }} />
        </span>
      )}
    </span>
  );
}
