import { typeIconOf } from "../data/live";
import type { IconName } from "./Icon";

/*
 * Icon of a knowledge_items.type: the registry (@kortex/db) names a Lucide icon, the app draws its own
 * line set, so the Lucide names map onto it here. Unknown names fall back to the note icon.
 */
export const LUCIDE: Record<string, IconName> = {
  "notebook-pen": "note",
  "calendar-days": "time",
  newspaper: "note",
  mic: "mic",
  "circle-play": "play",
  podcast: "mic",
  "chef-hat": "flame",
  bot: "sparkles",
  image: "camera",
  "audio-lines": "mic",
  "file-text": "note",
  "book-open": "book",
  "share-2": "share",
  mail: "mail",
  bookmark: "link",
  user: "user",
  "folder-kanban": "folder",
  "building-2": "grid",
  lightbulb: "sparkles",
  wrench: "bolt",
  gem: "star",
  target: "target",
  clapperboard: "clapperboard",
  "book-marked": "book",
  "shopping-bag": "bag",
  "map-pin": "pin",
  code: "code",
  sparkles: "sparkles",
  receipt: "receipt",
  "message-square-code": "msg",
  "layout-list": "list",
};

export const typeIconName = (type: string): IconName => LUCIDE[typeIconOf(type)] ?? "note";
