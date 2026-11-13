/*
 * Splits a mail body (already Markdown) into what a reader wants to see first and what is noise:
 *
 *   note      what the forwarder wrote above the forwarded message ("Bitte ablegen.")
 *   message   the actual message (forward header block removed: it goes into the note's header)
 *   signature "-- " signature of the message
 *   quoted    the quoted reply chain (Gmail/Apple "Am … schrieb …:", Outlook "Von:/Gesendet:"
 *             blocks, "-----Original Message-----", trailing "> " blocks)
 *
 * Works on lines, so it covers HTML (after node-html-markdown) and plain-text mails alike. Pure.
 */

export interface EmailBodyParts {
  note: string | null;
  message: string;
  signature: string | null;
  quoted: string | null;
  /** Lines of the stripped forward header block (plain text), for the sender fallback. */
  forwardHeader: string[] | null;
}

/** A Markdown line as plain text: no escapes, emphasis, link syntax or hard-break marker. */
export const plainLine = (line: string): string =>
  line
    .replace(/\\$/, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!<>|~])/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__/g, "")
    .trim();

const FORWARD_MARKER =
  /^-{2,}\s*(forwarded message|weitergeleitete nachricht|message transf[ée]r[ée]|mensaje reenviado)\s*-{2,}$|^(begin forwarded message|anfang der weitergeleiteten nachricht|d[ée]but du message r[ée]exp[ée]di[ée])\s*:$/i;
const ORIGINAL_MARKER = /^-{2,}\s*(original message|urspr(ü|ue)ngliche nachricht|message d'origine)\s*-{2,}$/i;
/** Outlook puts a rule (underscores, or an <hr> → "---") above its header block. */
const SEPARATOR = /^(_{10,}|-{3,}|\*{3,})$/;
const HEADER_FROM = /^(von|from|de)\s*:\s*\S/i;
const HEADER_DATE = /^(gesendet|sent|date|datum|envoy[ée]|enviado)\s*:/i;
const HEADER_LINE = /^[A-Za-zÀ-ÿ-]{1,20}\s*:\s*/;
const ATTRIBUTION = /^(am|on|le|el)\b.{3,300}\b(schrieb|wrote|a écrit|escribió)\b[^:]{0,120}:$/i;
const MOBILE_FOOTER =
  /^(von meinem .{1,40} gesendet|gesendet von meinem .{1,40}|sent from my .{1,40}|get outlook for .{1,20}|outlook für .{1,20} (herunterladen|beziehen))\.?$/i;

type Boundary =
  | { kind: "forward" | "original"; at: number; header: number | null }
  | { kind: "header"; at: number; header: number }
  | { kind: "attribution"; at: number };

const nextFilled = (plain: readonly string[], from: number): number => {
  let i = from;
  while (i < plain.length && !plain[i]) i++;
  return i;
};

/** "Von: …" followed by a date line within a few lines: a mail header block. */
const isHeaderStart = (plain: readonly string[], i: number): boolean => {
  if (!HEADER_FROM.test(plain[i] ?? "")) return false;
  for (let j = i + 1; j < Math.min(plain.length, i + 6); j++) {
    if (HEADER_DATE.test(plain[j] ?? "")) return true;
    if (!plain[j]) return false;
  }
  return false;
};

/** Index after a header block (key: value lines up to the first blank line). */
const headerEnd = (plain: readonly string[], i: number): number => {
  let j = i;
  while (j < plain.length && plain[j]) {
    // A wrapped value ("To: a@x,\n b@y") continues; any other non-header line ends the block.
    if (j > i && !HEADER_LINE.test(plain[j]!) && !/[,;]$/.test(plain[j - 1]!)) break;
    j++;
  }
  return j;
};

function findBoundary(plain: readonly string[], from: number): Boundary | null {
  for (let i = from; i < plain.length; i++) {
    const p = plain[i]!;
    if (!p) continue;
    if (FORWARD_MARKER.test(p) || ORIGINAL_MARKER.test(p)) {
      const h = nextFilled(plain, i + 1);
      return {
        kind: FORWARD_MARKER.test(p) ? "forward" : "original",
        at: i,
        header: isHeaderStart(plain, h) ? h : null,
      };
    }
    if (SEPARATOR.test(p)) {
      const h = nextFilled(plain, i + 1);
      if (isHeaderStart(plain, h)) return { kind: "header", at: i, header: h };
      continue;
    }
    if (isHeaderStart(plain, i)) return { kind: "header", at: i, header: i };
    if (ATTRIBUTION.test(p) || (/^(am|on)\b/i.test(p) && ATTRIBUTION.test(`${p} ${plain[i + 1] ?? ""}`)))
      return { kind: "attribution", at: i };
  }
  return null;
}

const join = (lines: readonly string[]): string | null => {
  const text = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    // A hard break before a blank line or at the end means nothing.
    .replace(/\\(?=\n\n|$)/g, "");
  return text || null;
};

/** Splits off the "-- " signature and drops mobile "Sent from my iPhone" footers. */
function splitSignature(lines: string[]): { body: string[]; signature: string[] } {
  const plain = lines.map(plainLine);
  let end = plain.length;
  while (end > 0 && (!plain[end - 1] || MOBILE_FOOTER.test(plain[end - 1]!))) end--;
  const sig = plain.slice(0, end).findIndex((p, i) => (p === "--" || p === "—") && i > 0);
  if (sig < 0) return { body: lines.slice(0, end), signature: [] };
  return { body: lines.slice(0, sig), signature: lines.slice(sig + 1, end) };
}

/** Trailing block where every filled line is "> …": quoted history the client appended. */
function trailingQuote(lines: readonly string[]): number {
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!.trim();
    if (!l) continue;
    if (!l.startsWith(">")) break;
    start = i;
  }
  // Only when there is own text above it (a mail that is all quote stays the message).
  return start > 0 && lines.slice(0, start).some((l) => l.trim()) ? start : -1;
}

export function splitEmailBody(
  bodyMd: string,
  options: { forwarded?: boolean } = {},
): EmailBodyParts {
  const lines = bodyMd.replace(/\r\n?/g, "\n").split("\n");
  const plain = lines.map(plainLine);

  let note: string[] = [];
  let start = 0;
  let forwardHeader: string[] | null = null;
  let first = findBoundary(plain, 0);
  // The first header block of a forwarded mail is the forward header: its data goes into the
  // note's header, the lines themselves are noise. Everything above it is the forwarder's note.
  if (
    first &&
    first.kind !== "attribution" &&
    first.header !== null &&
    (first.kind === "forward" || options.forwarded)
  ) {
    note = lines.slice(0, first.at);
    const end = headerEnd(plain, first.header);
    forwardHeader = plain.slice(first.header, end);
    start = end;
    first = findBoundary(plain, start);
  }

  let message = lines.slice(start, first ? first.at : lines.length);
  let quoted = first ? lines.slice(first.at) : [];
  const tq = trailingQuote(message);
  if (tq >= 0) {
    quoted = [...message.slice(tq), ...(quoted.length ? ["", ...quoted] : [])];
    message = message.slice(0, tq);
  }
  const { body, signature } = splitSignature(message);
  const ownNote = splitSignature(note).body; // the forwarder's own signature is not content

  return {
    note: join(ownNote),
    message: join(body) ?? "",
    signature: join(signature),
    quoted: join(quoted),
    forwardHeader,
  };
}
