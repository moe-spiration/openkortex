import type { ImageSourcePropType } from "react-native";
import { coverTopicForType, type TileTopic } from "@kortex/theme-packs";

/*
 * Cover of an entry on Android: an own or extracted image ({ uri } / bundled asset), or a marker for the type tile
 * of the active theme pack. The marker is resolved when the image is drawn (Photo in ui/primitives.tsx), because the
 * pack is a per-user setting that can change while the data stays loaded. Pure, no React.
 */

export interface PackCover {
  /** Theme-pack topic whose tile is shown. */
  pack: TileTopic;
}

export type CoverSource = ImageSourcePropType | PackCover;

export const isPackCover = (s: CoverSource): s is PackCover =>
  typeof s === "object" && s !== null && !Array.isArray(s) && "pack" in s;

/** Cover rule (spec 4) for an item without own cover and without extracted medium: the type tile. */
export const packCoverFor = (type: string | null | undefined): PackCover => ({ pack: coverTopicForType(type) });
