import { getLocale, msg, t, tn, tx } from "@/i18n";
import {
  detectIntent,
  orbitHint,
  orbitRecordingHint,
  type OrbitMode,
  type OrbitState,
} from "@kortex/db/orbit";

/*
 * Orbit-Bar routing (W9, Tactile Craft decision 9) on top of the shared state machine in
 * @kortex/db/orbit: where a capture goes (Ziel-Chip), where a voice transcript goes (by intent),
 * slash commands, @Objekte / #Tags, the link chip, the Suchbereich of Fragen, the focus quick
 * actions and the bar's texts. Pure, so all of it is tested without the UI.
 */

// --- Ziel-Chip (Festhalten) ---------------------------------------------------------------------

/**
 * Ziel-Chip in Festhalten (decision 9, K6). `auto` is the default and reads "Inbox": Kortex files
 * it itself. `inbox` pins it to 00_Inbox, `space` to the current folder or single-type space.
 * "Neue Notiz" is no target but an action (opens the editor), see TARGET_NEW_NOTE.
 */
export type CaptureTarget = "auto" | "inbox" | "journal" | "task" | "space";

export type TargetIcon = "orbit-inbox" | "lock" | "orbit-sun" | "orbit-todo" | "orbit-zap";

export const CAPTURE_TARGETS: {
  id: CaptureTarget;
  label: string;
  help: string;
  icon: TargetIcon;
}[] = [
  { id: "auto", label: "Inbox", get help() { return t("AI files it automatically"); }, icon: "orbit-inbox" },
  { id: "inbox", get label() { return t("Inbox only"); }, get help() { return t("Stays in 00_Inbox, without filing"); }, icon: "lock" },
  { id: "journal", get label() { return tx("target", "Daily note"); }, get help() { return t("As Mind Dump into today's daily note"); }, icon: "orbit-sun" },
  { id: "task", get label() { return t("Task"); }, get help() { return t("Create as an open task"); }, icon: "orbit-todo" },
  { id: "space", get label() { return t("Current space"); }, get help() { return t("Open a folder or space"); }, icon: "orbit-zap" },
];

/** The chip menu's last row: not a target, it hands the text to the editor (openNewNote). */
export const TARGET_NEW_NOTE: { readonly label: string; readonly help: string } = {
  get label() {
    return t("New note");
  },
  get help() {
    return t("Opens the editor");
  },
};

export const INBOX_FOLDER = "00_Inbox";

/**
 * Where "Aktueller Space" puts a capture: a vault folder (manual placement) or the item type of a
 * single-type space (e.g. Rezepte → recipe). Null: the current view has no such context.
 */
export interface SpaceContext {
  label: string;
  folderPath?: string;
  typeHint?: string;
}

/** Item types a note capture may carry as type_hint (subset of KNOWLEDGE_ITEM_TYPES). */
const SPACE_TYPE_HINTS = new Set(["note", "article", "meeting", "book", "video", "podcast", "recipe", "ai_chat"]);

/** Space context of a route (pure): vault folder views and spaces with one type (or an explicit hint). */
export function spaceContext(
  info: { view: string; doc: boolean; rest: string[] },
  spaces: readonly { key: string; label: string; types: readonly string[] | null; hint?: string }[],
): SpaceContext | null {
  if (info.view === "vault" && !info.doc && info.rest.length)
    return { label: info.rest[info.rest.length - 1]!, folderPath: info.rest.join("/") };
  if (info.view === "spaces") {
    const space = spaces.find((s) => s.key === info.rest[0]) ?? spaces[0];
    const type = space?.hint ?? (space?.types?.length === 1 ? space.types[0]! : null);
    if (space && type && SPACE_TYPE_HINTS.has(type)) return { label: space.label, typeHint: type };
  }
  return null;
}

export type CapturePlan =
  /** POST /api/ingest (note or web clip). `folderPath` pins it (manual placement). */
  | { to: "ingest"; text: string; folderPath?: string; typeHint?: string; tags?: string[] }
  /** A line in today's daily note under "Mind Dump". */
  | { to: "journal"; text: string }
  /** createActionItem. */
  | { to: "task"; title: string };

/**
 * Where a Festhalten capture goes, by the chip's target. `space` without a space context falls
 * back to Auto. "@Objekt" of a known object becomes "[[Objekt]]"; #tags also travel as structured
 * tags (the text keeps them, so the Markdown stays portable).
 */
export function planCapture(
  text: string,
  target: CaptureTarget,
  opts: { space?: SpaceContext | null; objects?: readonly string[] } = {},
): CapturePlan | null {
  const t = linkObjectMentions(text.trim(), opts.objects ?? []);
  if (!t) return null;
  if (target === "journal") return { to: "journal", text: t.replace(/\s+/g, " ") };
  if (target === "task") return { to: "task", title: t.replace(/\s+/g, " ").slice(0, 500) };
  const plan: { to: "ingest"; text: string; folderPath?: string; typeHint?: string; tags?: string[] } = {
    to: "ingest",
    text: t,
  };
  const tags = extractTags(t);
  if (tags.length) plan.tags = tags;
  if (target === "inbox") plan.folderPath = INBOX_FOLDER;
  else if (target === "space" && opts.space) {
    if (opts.space.folderPath) plan.folderPath = opts.space.folderPath;
    if (opts.space.typeHint) plan.typeHint = opts.space.typeHint;
  }
  return plan;
}

// --- Slash commands -----------------------------------------------------------------------------

export type CommandId =
  | "notiz"
  | "aufgabe"
  | "meeting"
  | "link"
  | "status"
  | "objekt"
  | "frage"
  | "briefing"
  | "recherche"
  | "aufraeumen"
  | "entwurf"
  | "woche"
  | "akte";

/** Slash commands that hand the request to an agent skill (POST /api/chat with `skill`). */
export const COMMAND_SKILL: Partial<Record<CommandId, "briefing" | "research" | "tidy" | "draft" | "week" | "dossier">> = {
  briefing: "briefing",
  recherche: "research",
  aufraeumen: "tidy",
  entwurf: "draft",
  woche: "week",
  akte: "dossier",
};

export interface OrbitCommand {
  id: CommandId;
  /** What is typed, with the slash, in the current language ("/note" / "/notiz"). */
  cmd: string;
  /** The command words of both languages: a typed "/notiz" works in English too, "/note" in German. */
  words: readonly string[];
  label: string;
  icon: "file-plus" | "orbit-todo" | "orbit-mic" | "link" | "check" | "boxes" | "orbit-sparkles";
  /** Keycap at the right: the shortcut that does the same. */
  keys?: string;
  /** Takes an argument: without one, picking it inserts "/cmd " into the field. */
  arg?: boolean;
  /** Not wired in this app: listed, dimmed, not runnable (the reason is the tooltip). */
  disabled?: string;
}

/** A command with its word per language; `cmd` and the texts answer in the language of the moment they are read. */
function command(
  id: CommandId,
  word: { en: string; de: string },
  label: () => string,
  rest: Omit<OrbitCommand, "id" | "cmd" | "words" | "label" | "disabled"> & { disabled?: () => string },
): OrbitCommand {
  const { disabled, ...fixed } = rest;
  const out = {
    id,
    get cmd() {
      return "/" + word[getLocale()];
    },
    words: [...new Set(["/" + word.de, "/" + word.en])],
    get label() {
      return label();
    },
    ...fixed,
  } as OrbitCommand;
  if (disabled) Object.defineProperty(out, "disabled", { get: disabled, enumerable: true });
  return out;
}

export const ORBIT_COMMANDS: readonly OrbitCommand[] = [
  command("notiz", { en: "note", de: "notiz" }, () => t("Open new note in the editor"), { icon: "file-plus", keys: "⇧↵" }),
  command("aufgabe", { en: "task", de: "aufgabe" }, () => t("Create task"), { icon: "orbit-todo", arg: true }),
  command("meeting", { en: "meeting", de: "meeting" }, () => t("Record meeting (voice memo)"), { icon: "orbit-mic" }),
  command("link", { en: "link", de: "link" }, () => t("Save and summarize link"), { icon: "link", arg: true }),
  // Copilot status action (POST /api/chat/action "status"): finds the entry and sets status, rating, feedback.
  command("status", { en: "status", de: "status" }, () => t("Set status, e.g. “Watched Dune, 9/10”"), { icon: "check", arg: true }),
  command("objekt", { en: "object", de: "objekt" }, () => t("Create object: person, project, goal …"), {
    icon: "boxes",
    disabled: () => t("Not available yet: objects are created via “Turn into object”"),
  }),
  command("frage", { en: "ask", de: "frage" }, () => t("Switch to “Ask”"), { icon: "orbit-sparkles", keys: "Tab" }),
  // Agent skills: the copilot works in steps and proposes or makes changes (see server/chat/agent.ts).
  command("briefing", { en: "briefing", de: "briefing" }, () => t("Agent: briefing for a person, company or project"), { icon: "orbit-sparkles", arg: true }),
  command("recherche", { en: "research", de: "recherche" }, () => t("Agent: research a topic across your vault"), { icon: "orbit-sparkles", arg: true }),
  command("aufraeumen", { en: "tidy", de: "aufräumen" }, () => t("Agent: sort the inbox and find duplicates"), { icon: "orbit-sparkles" }),
  command("entwurf", { en: "draft", de: "entwurf" }, () => t("Agent: draft a mail or text in your tone"), { icon: "orbit-sparkles", arg: true }),
  command("woche", { en: "week", de: "woche" }, () => t("Agent: weekly review with open loops"), { icon: "orbit-sparkles" }),
  command("akte", { en: "dossier", de: "akte" }, () => t("Agent: bring a dossier up to date"), { icon: "orbit-sparkles", arg: true }),
];

const isCommandWord = (c: OrbitCommand, typed: string) => c.words.includes(typed);

/** The typed command word (without "/") while the field is in command mode, else null. */
export function commandQuery(text: string): string | null {
  const m = /^\/(\S*)(\s[\s\S]*)?$/.exec(text);
  if (!m) return null;
  // "/notiz Titel" stays a command while the word is a known command; "/foo bar" is plain text.
  if (m[2] !== undefined && !ORBIT_COMMANDS.some((c) => isCommandWord(c, "/" + m[1]!.toLowerCase()))) return null;
  return m[1]!.toLowerCase();
}

/** Commands matching the typed word (all for a bare "/"; a complete command with argument: just it). */
export function filterCommands(text: string): OrbitCommand[] {
  const q = commandQuery(text);
  if (q === null) return [];
  // The current language by prefix, the other language once its word is typed in full.
  return ORBIT_COMMANDS.filter((c) => c.cmd.slice(1).startsWith(q) || (q !== "" && isCommandWord(c, "/" + q)));
}

/** "/aufgabe Steuer machen" → the command and its argument; null if the text is no known command. */
export function parseCommand(text: string): { command: OrbitCommand; arg: string } | null {
  const m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  const found = ORBIT_COMMANDS.find((c) => isCommandWord(c, "/" + m[1]!.toLowerCase()));
  return found ? { command: found, arg: (m[2] ?? "").trim() } : null;
}

/** Index of the next enabled row (arrow keys), wrapping; -1 when none is enabled. */
export function nextEnabled<T extends { disabled?: unknown }>(list: readonly T[], from: number, dir: 1 | -1): number {
  const n = list.length;
  for (let i = 1; i <= n; i++) {
    const at = (((from + dir * i) % n) + n) % n;
    if (!list[at]!.disabled) return at;
  }
  return -1;
}

// --- @Objekte and #Tags -------------------------------------------------------------------------

export interface Mention {
  sig: "@" | "#";
  query: string;
  /** Index of the sigil in the text. */
  start: number;
  /** End of the token (the caret). */
  end: number;
}

const MENTION = /(^|\s)([@#])([\p{L}\p{N}_/-]*)$/u;

/** The @ or # token right before the caret (default: end of the text), else null. */
export function detectMention(text: string, caret = text.length): Mention | null {
  if (text.startsWith("/")) return null;
  const before = text.slice(0, caret);
  const m = MENTION.exec(before);
  if (!m) return null;
  const start = before.length - m[3]!.length - 1;
  return { sig: m[2] as "@" | "#", query: m[3]!.toLowerCase(), start, end: caret };
}

/** Replaces the token with the pick ("@Lea Hoffmann", "#pricing") plus one space; returns the new caret. */
export function applyMention(text: string, mention: Mention, insert: string): { text: string; caret: number } {
  const head = text.slice(0, mention.start) + insert + " ";
  const tail = text.slice(mention.end).replace(/^\s+/, "");
  return { text: head + tail, caret: head.length };
}

/** Objects whose title contains the query (prefix matches first), at most `max`. */
export function matchObjects<T extends { title: string }>(objects: readonly T[], query: string, max = 6): T[] {
  const q = query.toLowerCase();
  const hits = objects.filter((o) => o.title.toLowerCase().includes(q));
  hits.sort((a, b) => Number(!a.title.toLowerCase().startsWith(q)) - Number(!b.title.toLowerCase().startsWith(q)));
  return hits.slice(0, max);
}

/** Known hashtags (one entry per use, with or without "#") containing the query, most used first, at most `max`. */
export function matchTags(tags: readonly string[], query: string, max = 6): string[] {
  const q = query.toLowerCase();
  const count = new Map<string, number>();
  for (const raw of tags) {
    const t = raw.replace(/^#+/, "").trim(); // vault tags may carry their "#"
    if (t) count.set(t, (count.get(t) ?? 0) + 1);
  }
  return [...count.entries()]
    .filter(([t]) => t.toLowerCase().includes(q))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([t]) => t);
}

/** #tags in a text (hierarchical a/b allowed), without "#", unique, in order. "#12" is no tag. */
export function extractTags(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu)) {
    const tag = m[2]!.replace(/[/-]+$/, "");
    if (tag && !/^\d+$/.test(tag) && !out.includes(tag)) out.push(tag);
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "@Lea Hoffmann" of a known object becomes the wiki link "[[Lea Hoffmann]]" (portable Markdown). */
export function linkObjectMentions(text: string, names: readonly string[]): string {
  let out = text;
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    if (!name.trim()) continue;
    out = out.replace(new RegExp(`(^|\\s)@${escapeRe(name)}(?=$|[\\s.,;:!?)])`, "gu"), `$1[[${name}]]`);
  }
  return out;
}

// --- Link chip ----------------------------------------------------------------------------------

/** A field that starts with an http(s) URL: the URL becomes a chip, the rest is the note to it. */
export function splitLink(text: string): { url: string; rest: string } | null {
  const m = /^\s*(https?:\/\/\S+)(?:\s+([\s\S]*))?$/i.exec(text);
  if (!m) return null;
  try {
    new URL(m[1]!);
  } catch {
    return null;
  }
  return { url: m[1]!, rest: m[2] ?? "" };
}

/** "https://www.inkandswitch.com/local-first/" → "inkandswitch.com". */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\/(www\.)?/i, "").split(/[/?#]/)[0] ?? url;
  }
}

/** Clipboard text that is one URL (for the focus quick action), else null. */
export function clipboardUrl(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  return /^https?:\/\/\S+$/i.test(t) && t.length <= 2000 ? t : null;
}

// --- Keys ---------------------------------------------------------------------------------------

/** Enter sends (Festhalten or Fragen); Shift/Ctrl/Cmd+Enter hands the text to the editor. */
export function enterAction(e: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey?: boolean;
}): "send" | "editor" | null {
  if (e.key !== "Enter" || e.altKey) return null;
  return e.shiftKey || e.ctrlKey || e.metaKey ? "editor" : "send";
}

/** Editor prefill from the bar: a short single line is the title, several lines are title + body, else body. */
export function editorPrefill(text: string): { title?: string; body?: string } {
  const t = text.trim();
  if (!t) return {};
  const [first, ...rest] = t.split(/\r?\n/);
  if (rest.length && first!.trim().length <= 120) return { title: first!.trim(), body: rest.join("\n").trim() };
  if (t.length <= 80 && !/[.!?]$/.test(t)) return { title: t };
  return { body: t };
}

// --- Suchbereich (Fragen) -----------------------------------------------------------------------

export type SearchScope = "all" | "space" | "note" | "objects";

export const OBJECTS_FOLDER = "70_Objects";

export const SEARCH_SCOPES: {
  id: SearchScope;
  label: string;
  help: string;
  icon: "layers" | "orbit-zap" | "file-text" | "boxes";
}[] = [
  { id: "all", get label() { return t("Everything"); }, get help() { return t("Notes, objects, memories"); }, icon: "layers" },
  { id: "space", get label() { return t("This space"); }, get help() { return t("Folder of the view or the note"); }, icon: "orbit-zap" },
  { id: "note", get label() { return t("Opened note"); }, get help() { return t("Only the open note"); }, icon: "file-text" },
  { id: "objects", get label() { return t("Objects only"); }, get help() { return t("People, projects, goals"); }, icon: "boxes" },
];

export type ChatScopeBody =
  | { mode: "brain" }
  | { mode: "note"; item_id: string }
  | { mode: "folder"; folder_path: string };

export interface ScopeContext {
  itemId: string | null;
  folderPath: string | null;
}

/** /api/chat request part of a scope; a scope without its context falls back to the whole brain. */
export function scopeBody(scope: SearchScope, ctx: ScopeContext): ChatScopeBody {
  if (scope === "note" && ctx.itemId) return { mode: "note", item_id: ctx.itemId };
  if (scope === "space" && ctx.folderPath) return { mode: "folder", folder_path: ctx.folderPath };
  if (scope === "objects") return { mode: "folder", folder_path: OBJECTS_FOLDER };
  return { mode: "brain" };
}

/** Scopes the current view offers (Alles and Nur Objekte always). */
export function availableScopes(ctx: ScopeContext): SearchScope[] {
  return SEARCH_SCOPES.map((s) => s.id).filter((id) =>
    id === "note" ? !!ctx.itemId : id === "space" ? !!ctx.folderPath : true,
  );
}

/** The scope in effect: the user's pick if the view offers it, else the view's default. */
export function effectiveScope(picked: SearchScope | null, ctx: ScopeContext, fallback: SearchScope): SearchScope {
  const can = availableScopes(ctx);
  if (picked && can.includes(picked)) return picked;
  return can.includes(fallback) ? fallback : "all";
}

export const scopeLabel = (scope: SearchScope) => SEARCH_SCOPES.find((s) => s.id === scope)?.label ?? t("Everything");

// --- Fokus-Schnellaktionen ----------------------------------------------------------------------

export type Suggestion =
  | { kind: "clipboard"; label: string; url: string }
  | { kind: "continue"; label: string; id: string }
  | { kind: "ask"; label: string };

/** Quick actions on focus with an empty field: clipboard link, last opened, question about the view. */
export function focusSuggestions(ctx: {
  clipboard: string | null;
  recent: { id: string; title: string } | null;
}): Suggestion[] {
  const out: Suggestion[] = [];
  const url = clipboardUrl(ctx.clipboard);
  if (url) {
    let path = "";
    try {
      const first = new URL(url).pathname.split("/").filter(Boolean)[0];
      if (first) path = "/" + first;
    } catch {
      /* clipboardUrl already checked the shape */
    }
    out.push({ kind: "clipboard", label: t("From clipboard: {source}", { source: domainOf(url) + path }), url });
  }
  if (ctx.recent) out.push({ kind: "continue", label: t("Continue with {title}", { title: ctx.recent.title }), id: ctx.recent.id });
  out.push({ kind: "ask", label: t("Question about this view") });
  return out;
}

// --- Voice --------------------------------------------------------------------------------------

/** What the recording was started for: the mode at the moment the orb was tapped. */
export type RecPurpose = "dictation" | "voiceQuestion";
export const purposeFor = (mode: OrbitMode): RecPurpose =>
  mode === "ask" ? "voiceQuestion" : "dictation";

export type TranscriptPlan =
  /** Dictation: saved like a typed capture (chip target applies). */
  | { to: "capture"; text: string }
  /** Into the field (the user reviews and sends); `mode` / `auto` as after typing it. */
  | { to: "field"; text: string; mode: OrbitMode; auto: boolean }
  /** "Sprachfragen sofort senden": asked right away. */
  | { to: "ask"; text: string };

/**
 * Voice goes by intent, not always into the inbox as a note:
 * - Diktat (Festhalten): saved, unless the bar isn't pinned and the transcript is a question, then
 *   it lands in the field as a question (mode Fragen, "Auto → Antwort").
 * - Sprachfrage (Fragen): into the field (detection runs when not pinned), or sent at once with
 *   the setting "Sprachfragen sofort senden".
 */
export function routeTranscript(
  text: string,
  ctx: { purpose: RecPurpose; pinned: boolean; mode: OrbitMode; sendVoiceImmediately: boolean },
): TranscriptPlan | null {
  const t = text.trim();
  if (!t) return null;
  const hit = detectIntent(t);
  if (ctx.purpose === "voiceQuestion") {
    if (ctx.sendVoiceImmediately) return { to: "ask", text: t };
    const mode = ctx.pinned ? ctx.mode : (hit?.mode ?? "ask");
    return { to: "field", text: t, mode, auto: !ctx.pinned && mode !== ctx.mode };
  }
  if (!ctx.pinned && hit?.mode === "ask") return { to: "field", text: t, mode: "ask", auto: true };
  return { to: "capture", text: t };
}

// --- Texts --------------------------------------------------------------------------------------

const TARGET_DEST: Record<CaptureTarget, string> = {
  auto: "→ Inbox",
  inbox: "→ Inbox",
  journal: msg("→ Daily note"),
  task: msg("→ Task"),
  space: "→ Space",
};

/**
 * Where the input goes (send button tooltip and aria-live): "Auto → Inbox", "Link → Inbox",
 * "Auto → Antwort"; pinned: just the destination. A chip target other than Auto names its destination.
 */
export function barHint(state: OrbitState, target: CaptureTarget): string | null {
  const base = orbitHint(state);
  if (!base || state.mode === "ask" || target === "auto") return base;
  return base.replace("→ Inbox", t(TARGET_DEST[target]));
}

/** Recording hint (K9): "Kortex hört zu · Orb tippen speichert / übernimmt / sendet"; push-to-talk: "Loslassen …". */
export function recordingHint(state: OrbitState, pushToTalk: boolean): string {
  const tap = orbitRecordingHint(state);
  // The shared hint says "tap the orb to save" ("Orb tippen speichert"); push-to-talk releases instead.
  return pushToTalk ? tap.replace(t("tap the orb to"), t("release to")) : tap;
}

/** Chip label: the target in Festhalten ("Aktueller Space" shows the space's name when there is one). */
export const targetLabel = (target: CaptureTarget, space?: SpaceContext | null) =>
  target === "space" && space ? space.label : (CAPTURE_TARGETS.find((c) => c.id === target)?.label ?? "Inbox");

/** Drop text after "Loslassen zum Festhalten · ": dropped files always land in the inbox. */
export function dropLabel(files: number): string {
  return files >= 1 ? tn(files, "{n} file → Inbox", "{n} files → Inbox") : "→ Inbox";
}
