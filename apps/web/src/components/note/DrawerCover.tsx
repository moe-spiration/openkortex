"use client";

import { t } from "@/i18n";
import type { ItemType } from "@/lib/workspace-data";
import { NIco, TypeIcon } from "./icons";
import { CoverImg } from "./PageLook";

/*
 * Full-width cover of the Smart Property Header (Tactile Craft v2, decision 13): the item's image (or theme-pack
 * cover) with a soft fade into the panel, or the monochrome placeholder (dot grid with the type glyph, no brand
 * colours). 168 px in the drawer, 232 px full screen (CSS). "Cover ändern" appears on hover and focus.
 */
export function DrawerCover({ src, type, onChange }: { src: string | null; type: ItemType; onChange?: () => void }) {
  return (
    <div className={"kx-dr-cover" + (src ? "" : " is-ph")}>
      {src ? (
        <CoverImg src={src} />
      ) : (
        <NotePlaceholder type={type} size={44} icon={20} />
      )}
      {onChange && (
        <span className="kx-dr-cover-act">
          <button type="button" className="kx-dr-chip is-btn tc-glass" onClick={onChange}>
            <NIco name="image" size={12} />
            {t("Change cover")}
          </button>
        </span>
      )}
    </div>
  );
}

/** Monochrome placeholder: dot grid with the type glyph in a small raised tile. */
export function NotePlaceholder({ type, size = 30, icon = 15 }: { type: ItemType; size?: number; icon?: number }) {
  return (
    <span className="kx-ph" aria-hidden>
      <span className="kx-ph-g" style={{ width: size, height: size }}>
        <TypeIcon type={type} size={icon} />
      </span>
    </span>
  );
}
