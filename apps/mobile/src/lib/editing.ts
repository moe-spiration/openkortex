/*
 * Markdown editing on a plain TextInput: the toolbar actions as pure functions of
 * (text, selection) → (text, selection), so they are tested without React Native.
 */

export interface Sel {
  start: number;
  end: number;
}
export interface Edit {
  text: string;
  sel: Sel;
}

export type ToolId = "h2" | "h3" | "bold" | "italic" | "bullet" | "check" | "number" | "quote" | "link" | "wiki" | "rule";

const lineStart = (text: string, pos: number) => text.lastIndexOf("\n", pos - 1) + 1;
const lineEnd = (text: string, pos: number) => {
  const i = text.indexOf("\n", pos);
  return i < 0 ? text.length : i;
};

/** Wraps the selection (or inserts an empty pair with the cursor inside). */
function wrap(text: string, sel: Sel, left: string, right = left): Edit {
  const inner = text.slice(sel.start, sel.end);
  // Toggle off when the selection is already wrapped.
  if (text.slice(sel.start - left.length, sel.start) === left && text.slice(sel.end, sel.end + right.length) === right) {
    const t = text.slice(0, sel.start - left.length) + inner + text.slice(sel.end + right.length);
    return { text: t, sel: { start: sel.start - left.length, end: sel.end - left.length } };
  }
  const t = text.slice(0, sel.start) + left + inner + right + text.slice(sel.end);
  return { text: t, sel: { start: sel.start + left.length, end: sel.end + left.length } };
}

/** Sets (or toggles) a line prefix on every line touched by the selection. */
function prefix(text: string, sel: Sel, mark: string | ((i: number) => string), strip: RegExp): Edit {
  const a = lineStart(text, sel.start);
  const b = lineEnd(text, sel.end);
  const lines = text.slice(a, b).split("\n");
  const first = typeof mark === "string" ? mark : mark(0);
  const allHave = lines.every((l) => l.startsWith(first.trimEnd()) || (typeof mark !== "string" && strip.test(l)));
  const next = lines.map((l, i) => {
    const bare = l.replace(strip, "");
    return allHave ? bare : (typeof mark === "string" ? mark : mark(i)) + bare;
  });
  const block = next.join("\n");
  const t = text.slice(0, a) + block + text.slice(b);
  const delta = block.length - (b - a);
  return { text: t, sel: { start: Math.max(a, sel.start + (next[0]!.length - lines[0]!.length)), end: sel.end + delta } };
}

const LIST = /^(\s*)([-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?|#{1,6}\s+)/;

export function applyTool(tool: ToolId, text: string, sel: Sel): Edit {
  switch (tool) {
    case "bold":
      return wrap(text, sel, "**");
    case "italic":
      return wrap(text, sel, "_");
    case "wiki":
      return wrap(text, sel, "[[", "]]");
    case "link": {
      const label = text.slice(sel.start, sel.end) || "Link";
      const t = text.slice(0, sel.start) + `[${label}](https://)` + text.slice(sel.end);
      const urlAt = sel.start + label.length + 3;
      return { text: t, sel: { start: urlAt, end: urlAt + 8 } };
    }
    case "h2":
      return prefix(text, sel, "## ", LIST);
    case "h3":
      return prefix(text, sel, "### ", LIST);
    case "bullet":
      return prefix(text, sel, "- ", LIST);
    case "check":
      return prefix(text, sel, "- [ ] ", LIST);
    case "number":
      return prefix(text, sel, (i) => `${i + 1}. `, LIST);
    case "quote":
      return prefix(text, sel, "> ", LIST);
    case "rule": {
      const at = lineEnd(text, sel.end);
      const ins = (at > 0 && text[at - 1] !== "\n" ? "\n" : "") + "\n---\n";
      const t = text.slice(0, at) + ins + text.slice(at);
      return { text: t, sel: { start: at + ins.length, end: at + ins.length } };
    }
  }
}

/**
 * Enter inside a list continues it ("- ", "- [ ] ", "3. "); Enter on an empty item ends the
 * list. Called with the text after the change and the cursor right after the new "\n".
 */
export function continueList(prev: string, next: string, cursor: number): Edit | null {
  if (next.length !== prev.length + 1 || next[cursor - 1] !== "\n") return null;
  const a = lineStart(next, cursor - 1);
  const line = next.slice(a, cursor - 1);
  const m = /^(\s*)([-*+]\s+(?:\[[ xX]\]\s+)?|(\d+)[.)]\s+)(.*)$/.exec(line);
  if (!m) return null;
  if (!m[4]!.trim()) {
    // Empty item: remove its marker and the new line.
    const t = next.slice(0, a) + next.slice(cursor);
    return { text: t, sel: { start: a, end: a } };
  }
  const marker = m[3] ? `${Number(m[3]) + 1}. ` : m[2]!.replace(/\[[xX]\]/, "[ ]");
  const ins = m[1]! + marker;
  const t = next.slice(0, cursor) + ins + next.slice(cursor);
  return { text: t, sel: { start: cursor + ins.length, end: cursor + ins.length } };
}

/** Words and reading time of the body. */
export function stats(md: string): { words: number; minutes: number } {
  const words = md.replace(/[#*_>`[\]()-]/g, " ").split(/\s+/).filter(Boolean).length;
  return { words, minutes: Math.max(1, Math.round(words / 220)) };
}
