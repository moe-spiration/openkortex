import { mindDumpOf } from "@/lib/daily/journal";
import { NOTE_CONTENT } from "@/lib/workspace-data";

/** The written entry of a daily note: its Mind Dump lines joined, "" when the note has none (or is not loaded). */
export function dailyText(id: string): string {
  return mindDumpOf(NOTE_CONTENT[id]?.contentMd).join(" ");
}
