import type { TopicId } from "@kortex/theme-packs";

/*
 * Frame backdrop "Theme-Pack" (Tactile Craft v2, decision 5 option; audit 2.14): one *-full motif of the active pack
 * sits blurred behind sidebar and titlebar.
 *
 * Feedback round 3, W3: the motif used to follow the current view (home, notes, review, ...), so every page switch
 * through the sidebar swapped the frame colours, also in the Windows app that loads this shell. The frame is chrome,
 * not content: it stays the same on every route. Only pack, theme mode and the user's choice change it.
 * Rendered by components/theme/ShellBackdrop.tsx.
 */

/** The single motif of the frame backdrop, independent of the route. */
export const FRAME_BACKDROP_TOPIC: TopicId = "home";

/** Topic of the frame backdrop. Takes no route on purpose: the frame must not change between pages (W3). */
export function backdropTopic(): TopicId {
  return FRAME_BACKDROP_TOPIC;
}
