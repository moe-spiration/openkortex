import { Ico, type IconId } from "@/components/shell/icons";
import { Img } from "./Img";

const TYPE_ICON: Record<string, IconId> = {
  note: "i-note",
  meeting: "i-meeting",
  article: "i-article",
  book: "i-book",
  video: "i-video",
  podcast: "i-video",
  ai: "i-ai",
  recipe: "i-recipe",
  person: "o-person",
  project: "o-project",
  organization: "o-organization",
  concept: "o-concept",
  tool: "o-tool",
  asset: "o-asset",
  goal: "o-goal",
};

/** Line icon of an item type (unknown types: the note icon). */
export const typeIcon = (type?: string | null): IconId => (type && TYPE_ICON[type]) || "i-note";

/**
 * Monochrome placeholder for entries without an image (Tactile Craft decision 13): the type icon on a
 * dot grid, no brand colours.
 */
export function TypePlaceholder({ type }: { type?: string | null }) {
  return (
    <span className="e-ph" aria-hidden>
      <span>
        <Ico name={typeIcon(type)} size="sm" />
      </span>
    </span>
  );
}

/** 34 px thumb: the entry's own image, else the monochrome placeholder. */
export function Thumb({ src, type }: { src?: string | null; type?: string | null }) {
  return <span className="e-thumb">{src ? <Img src={src} /> : <TypePlaceholder type={type} />}</span>;
}
