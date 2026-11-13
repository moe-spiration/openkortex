import { parseAddress, type MailAddress } from "./address";

/*
 * Forwarded mail: who originally wrote it. Mail clients put a marker line and a small header block
 * above the original message (Gmail, Apple Mail, Outlook, Thunderbird; German and English). The
 * block is read from the text part (or the Markdown body when there is no text part).
 */

export interface ForwardInfo {
  from: MailAddress | null;
  date: string | null;
  subject: string | null;
  to: MailAddress[];
  /** inline: marker + header block in the body; attachment: attached message/rfc822. */
  via: "inline" | "attachment";
}

const MARKERS = [
  /^[ \t>]*-{2,}\s*(forwarded message|weitergeleitete nachricht|original message|urspr(ü|ue)ngliche nachricht|message transf(é|e)r(é|e)|mensaje reenviado)\s*-{2,}[ \t]*$/im,
  /^[ \t>]*(begin forwarded message|anfang der weitergeleiteten nachricht|d(é|e)but du message r(é|e)exp(é|e)di(é|e))\s*:[ \t]*$/im,
  // Outlook: a line of underscores right before "From:"/"Von:".
  /^[ \t>]*_{10,}[ \t]*$(?=\s*^[ \t>]*\**(from|von|de)\**\s*:)/im,
];

const KEYS: Record<string, "from" | "date" | "subject" | "to" | "cc"> = {
  from: "from",
  von: "from",
  de: "from",
  date: "date",
  sent: "date",
  datum: "date",
  gesendet: "date",
  "envoyé": "date",
  subject: "subject",
  betreff: "subject",
  objet: "subject",
  to: "to",
  an: "to",
  "à": "to",
  cc: "cc",
};

/** "**Von:** Anna <[a@x](mailto:a@x)>" → "Von: Anna <a@x>". */
const plainLine = (line: string) =>
  line
    .replace(/^[ \t>]+/, "")
    .replace(/\[([^\]]*)\]\(mailto:[^)]*\)/gi, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_\\]/g, "")
    .trim();

/** German/English/French date words are not all parseable; keep what Date understands. */
function parseDate(value: string): string | null {
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  // "Freitag, 31. Oktober 2026 14:02" / "31.10.2026 14:02"
  const MONTHS = ["jan", "feb", "m(ä|ae)r", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "dez"];
  const dotted = value.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[^\d]+(\d{1,2}):(\d{2}))?/);
  const named = value.match(/(\d{1,2})\.?\s+([a-zä]+)\.?\s+(\d{4})(?:[^\d]+(\d{1,2}):(\d{2}))?/i);
  let parts: [number, number, number, number, number] | null = null;
  if (dotted) parts = [+dotted[3]!, +dotted[2]! - 1, +dotted[1]!, +(dotted[4] ?? 0), +(dotted[5] ?? 0)];
  else if (named) {
    const month = MONTHS.findIndex((m) => new RegExp(`^${m}`, "i").test(named[2]!));
    if (month >= 0) parts = [+named[3]!, month, +named[1]!, +(named[4] ?? 0), +(named[5] ?? 0)];
  }
  if (!parts) return null;
  const d = new Date(Date.UTC(...parts));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function detectForward(body: string): ForwardInfo | null {
  if (!body) return null;
  const text = body.replace(/\r\n?/g, "\n");
  let start = -1;
  for (const re of MARKERS) {
    const m = re.exec(text);
    if (m && (start < 0 || m.index < start)) start = m.index + m[0].length;
  }
  if (start < 0) return null;

  const lines = text.slice(start).split("\n");
  const fields: Partial<Record<"from" | "date" | "subject" | "to" | "cc", string>> = {};
  let last: keyof typeof fields | null = null;
  let seen = 0;
  for (const raw of lines.slice(0, 30)) {
    const line = plainLine(raw);
    if (!line) {
      if (seen > 0) break; // header block ends at the first blank line
      continue;
    }
    const m = line.match(/^([A-Za-zÀ-ÿ]+)\s*:\s*(.*)$/);
    const key = m ? KEYS[m[1]!.toLowerCase()] : undefined;
    if (key) {
      fields[key] = m![2]!.trim();
      last = key;
      seen++;
    } else if (seen > 0 && last && /^\s/.test(raw)) {
      fields[last] = `${fields[last]} ${line}`; // folded header line
    } else if (seen > 0) break;
    else return null; // marker without a header block (a quoted reply, not a forward)
  }
  if (!fields.from) return null;
  return {
    from: parseAddress(fields.from),
    date: fields.date ? parseDate(fields.date) : null,
    subject: fields.subject?.trim() || null,
    to: (fields.to ?? "")
      .split(/[,;]/)
      .map((s) => parseAddress(s))
      .filter((a): a is MailAddress => !!a),
    via: "inline",
  };
}
