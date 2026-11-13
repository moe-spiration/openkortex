/*
 * Link safety in the editor (review N5 #24). A link may point to http(s), mailto, or a relative /
 * internal target (`/notes/…`, `#anchor`, `./file.md`). Everything else (`javascript:`, `data:`,
 * `vbscript:`, `file:`, …) is refused: in Markdown it stays visible source text, links created in the
 * editor are turned back into plain text. Browsers ignore control characters and whitespace inside a
 * scheme ("java\tscript:"), so those are removed before the scheme is read.
 */

const ALLOWED = new Set(["http", "https", "mailto"]);

/** The href when it is safe to render as a link, else null. */
export function safeHref(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const href = raw.trim();
  if (!href) return null;
  // eslint-disable-next-line no-control-regex -- control characters are what we strip here
  const probe = href.replace(/[\u0000- \u007f-\u009f]/g, "").toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(probe)?.[1];
  if (!scheme) return probe.startsWith("//") ? null : href; // relative / internal; no protocol-relative hosts
  return ALLOWED.has(scheme) ? href : null;
}

export const isSafeHref = (raw: string | null | undefined) => safeHref(raw) !== null;
