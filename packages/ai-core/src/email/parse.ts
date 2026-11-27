import { getLocale, headingRe, ph, phAlt } from "../i18n";
import { renderTaskSection } from "@kortex/db";
import PostalMime, { type Attachment, type Email } from "postal-mime";
import { formatAddress, mailbox, mailboxes, type MailAddress } from "./address";
import { NodeHtmlMarkdown } from "node-html-markdown";
import { detectForward, type ForwardInfo } from "./forwarded";
import { plainLine, splitEmailBody, type EmailBodyParts } from "./structure";

/*
 * Inbound e-mail (Mail an Kortex, .eml uploads): MIME → clean Markdown plus flat metadata.
 * Pure: no network, no storage. The email adapter and the web webhook both build on this.
 */

export interface EmailAttachmentInfo {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Inline part (signature logo, embedded image) rather than a real attachment. */
  inline: boolean;
  contentId: string | null;
}

export interface ParsedEmail {
  /** Subject as sent (with Re:/Fwd: prefixes). */
  subject: string | null;
  /** Subject without reply/forward prefixes; fallback "E-Mail von …". */
  title: string;
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  /** ISO timestamp of the Date header, if it parses. */
  date: string | null;
  /** Message-ID without angle brackets. */
  messageId: string | null;
  inReplyTo: string | null;
  /** Whole body as Markdown (HTML part preferred, text part as fallback). */
  bodyMd: string;
  /** The body split for the note: forwarder's note, message, signature, quoted history. */
  parts: EmailBodyParts;
  forwarded: ForwardInfo | null;
  attachments: EmailAttachmentInfo[];
}

const REPLY_PREFIX = /^\s*((re|aw|antw|sv|vs|fwd?|wg|tr|wtr)\s*(\[\d+\])?\s*:\s*)+/i;
const FORWARD_PREFIX = /^\s*((re|aw|antw|sv|vs)\s*:\s*)*(fwd?|wg|tr|wtr)\s*(\[\d+\])?\s*:/i;

/** "Fwd: AW: Angebot" → "Angebot". */
export const cleanSubject = (subject: string | null | undefined): string =>
  (subject ?? "").replace(REPLY_PREFIX, "").replace(/\s+/g, " ").trim();

export const isForwardSubject = (subject: string | null | undefined): boolean =>
  FORWARD_PREFIX.test(subject ?? "");

/** `<abc@x>` → `abc@x`. */
export const normalizeMessageId = (id: string | null | undefined): string | null => {
  const s = (id ?? "").trim().replace(/^<+/, "").replace(/>+$/, "").trim();
  return s && s.length <= 998 ? s : null;
};

const toIso = (date: string | null | undefined): string | null => {
  if (!date) return null;
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const byteLength = (c: Attachment["content"]): number =>
  typeof c === "string" ? new TextEncoder().encode(c).byteLength : c.byteLength;

// --- HTML → Markdown ------------------------------------------------------------------------

const nhm = new NodeHtmlMarkdown({ bulletMarker: "-", codeBlockStyle: "fenced", maxConsecutiveNewlines: 2 });

/** Image URLs of open-tracking pixels and beacons (mail tools, newsletters). */
const TRACKING_SRC = /src\s*=\s*["']?[^"'\s>]*(\/(open|track|pixel|beacon|wf\/open|o\.gif)\b|[?&](open|track)=|\/e\/o\/|pixel\.gif|spacer\.gif)/i;

/** Removes what never belongs in a note: head/style/script, hidden preheaders, inline/tracking images. */
export function cleanEmailHtml(html: string): string {
  return (
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, "")
      // Preheader text and other hidden blocks.
      .replace(/<(span|div|p)\b[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
      // Embedded (data:, cid:), 1x1 and known tracking images.
      .replace(/<img\b[^>]*>/gi, (tag) =>
        /src\s*=\s*["']?\s*(data:|cid:)/i.test(tag) ||
        /\b(width|height)\s*=\s*["']?[01]["'\s/>]/i.test(tag) ||
        /\b(width|height)\s*:\s*[01]px/i.test(tag) ||
        TRACKING_SRC.test(tag)
          ? ""
          : tag,
      )
  );
}

export function emailHtmlToMarkdown(html: string): string {
  return tidyMarkdown(nhm.translate(cleanEmailHtml(html)));
}

/** "30\. Okt" → "30. Okt" (the escape only matters for "1." at the start of a line). */
const unescapeDots = (md: string) =>
  md.replace(/(\d)\\\./g, (m, d: string, off: number, all: string) => {
    const lineStart = all.lastIndexOf("\n", off) + 1;
    return /^[ \t>]*\d*$/.test(all.slice(lineStart, off)) ? m : `${d}.`;
  });

const tidyMarkdown = (md: string): string =>
  unescapeDots(
    md
      .replace(/\r\n?/g, "\n")
      .replace(/\xa0/g, " ")
      .replace(/^[ \t]+$/gm, "")
      // <br> comes out as two trailing spaces, which any trim loses: make it an explicit
      // CommonMark hard break so address blocks and signatures keep their lines.
      .replace(/[ \t]{2,}\n(?=[ \t]*[^\s>#|-])/g, "\\\n")
      .replace(/[ \t]+$/gm, "")
      // "<[a@x](mailto:a@x)\>" and "[a@x](mailto:a@x)" → "<a@x>"; "[https://x](https://x)" → "<https://x>".
      .replace(/<?\[([^\]\s]+@[^\]\s]+)\]\(mailto:\1\)(\\?>)?/g, "<$1>")
      .replace(/\[(https?:\/\/[^\]\s]+)\]\(\1\)/g, "<$1>")
      // The converter percent-encodes "_" in link targets (utm%5Fsource); keep the URL as sent.
      .replace(/\]\([^)\s]*%5F[^)\s]*\)/gi, (m) => m.replace(/%5F/gi, "_"))
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .replace(/\\(?=\n\n|$)/g, ""),
  );

const LIST_OR_BLOCK = /^(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|```|\|)/;
const quoteDepth = (l: string) => /^(\s*>)*/.exec(l)![0].replace(/\s/g, "").length;
const unquote = (l: string) => l.replace(/^(\s*>)*\s?/, "");

/**
 * Plain text part → Markdown. Hard-wrapped paragraphs (every line long) stay soft-wrapped; short
 * lines (addresses, signatures, lists typed by hand) keep their line breaks as hard breaks.
 */
export function emailTextToMarkdown(text: string): string {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .replace(/\xa0/g, " ")
    .replace(/[ \t]+$/gm, "")
    .split(/\n{2,}/);
  return tidyMarkdown(
    paragraphs
      .map((p) => {
        const ls = p.split("\n");
        if (ls.length < 2 || ls.slice(0, -1).every((l) => unquote(l).length >= 60)) return p;
        return ls
          .map((l, i) => {
            const next = ls[i + 1];
            const breaks =
              next !== undefined &&
              unquote(l).trim() &&
              unquote(next).trim() &&
              !LIST_OR_BLOCK.test(unquote(next)) &&
              quoteDepth(l) === quoteDepth(next);
            return breaks ? `${l}\\` : l;
          })
          .join("\n");
      })
      .join("\n\n"),
  );
}

// --- Parse ----------------------------------------------------------------------------------

function bodyOf(email: Pick<Email, "html" | "text">): string {
  if (email.html?.trim()) {
    const md = emailHtmlToMarkdown(email.html);
    if (md) return md;
  }
  return email.text?.trim() ? emailTextToMarkdown(email.text) : "";
}

const isRfc822 = (a: Attachment) => /^message\/rfc822$/i.test(a.mimeType);
const plainText = (md: string) => md.split("\n").map(plainLine).join("\n");

/** Parses a raw RFC 822 message (.eml). */
export async function parseEmail(raw: Uint8Array | string): Promise<ParsedEmail> {
  const email = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer" });
  const subject = email.subject?.trim() || null;
  const from = mailbox(email.from)[0] ?? null;
  let bodyMd = bodyOf(email);
  let parts: EmailBodyParts;

  // Forwarding: as an attached message/rfc822 (Outlook "als Anlage") or inline (marker + header block).
  let forwarded: ForwardInfo | null = null;
  const nested = email.attachments.find(isRfc822);
  if (nested && (isForwardSubject(subject) || bodyMd.length < 400)) {
    const inner = await PostalMime.parse(
      typeof nested.content === "string" ? nested.content : new Uint8Array(nested.content),
    );
    const innerFrom = mailbox(inner.from)[0] ?? null;
    forwarded = {
      from: innerFrom,
      date: toIso(inner.date),
      subject: inner.subject?.trim() || null,
      to: mailboxes(inner.to),
      via: "attachment",
    };
    const innerBody = bodyOf(inner);
    // The outer text is the forwarder's note, the attached message is the message.
    const note = splitEmailBody(bodyMd).message || null;
    parts = { ...splitEmailBody(innerBody), note };
    bodyMd = [bodyMd, innerBody].filter(Boolean).join("\n\n---\n\n");
  } else {
    // The text part has the cleanest header lines; the Markdown body is the fallback.
    forwarded = detectForward(email.text ?? "") ?? detectForward(plainText(bodyMd));
    parts = splitEmailBody(bodyMd, { forwarded: !!forwarded || isForwardSubject(subject) });
    // A forward header block without a marker line (new Outlook: rule + "Von:/Gesendet:").
    if (!forwarded && parts.forwardHeader) {
      forwarded = detectForward(`-----Original Message-----\n${parts.forwardHeader.join("\n")}`);
    }
  }

  const attachments: EmailAttachmentInfo[] = email.attachments
    .filter((a) => !(nested && a === nested && forwarded?.via === "attachment"))
    .map((a) => ({
      filename: a.filename?.trim() || (a.contentId ? `inline-${a.contentId.replace(/[<>]/g, "")}` : ph("mailAttachmentName")),
      mimeType: (a.mimeType || "application/octet-stream").toLowerCase(),
      sizeBytes: byteLength(a.content),
      inline: a.disposition === "inline" || (!a.filename && !!a.contentId) || !!a.related,
      contentId: a.contentId?.replace(/[<>]/g, "") || null,
    }));

  const cleaned = cleanSubject(subject) || cleanSubject(forwarded?.subject);
  const sender = forwarded?.from ?? from;
  return {
    subject,
    title: cleaned || (sender ? `${ph("emailFrom")} ${sender.name ?? sender.address}` : ph("email")),
    from,
    to: mailboxes(email.to),
    cc: mailboxes(email.cc),
    date: toIso(email.date),
    messageId: normalizeMessageId(email.messageId),
    inReplyTo: normalizeMessageId(email.inReplyTo),
    bodyMd,
    parts,
    forwarded,
    attachments,
  };
}

// --- Markdown + metadata --------------------------------------------------------------------

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const when = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;
/** Header values are inline text: Markdown syntax in a subject must not format the line. */
const inline = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .trim()
    .replace(/([\\`*[\]<>])/g, "\\$1")
    // "_" only emphasises at a word boundary ("Rechnung_4711.pdf" stays as is).
    .replace(/(^|\s)_|_(?=\s|$)/g, (m) => m.replace("_", "\\_"));
/** The message sits under "## Nachricht": its own headings move below that level. */
const demoteHeadings = (md: string) =>
  md.replace(/^(#{1,6})(?=\s)/gm, (h) => "#".repeat(Math.min(6, h.length + 2)));
const quote = (md: string) =>
  md
    .split("\n")
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n");

/**
 * Note body, always in this order (sections without content are left out):
 * header list (Von, An, Cc, Datum, Betreff, Weitergeleitet von) · forwarder's note ·
 * `## Nachricht` (+ `### Signatur`) · `## Zitierter Verlauf` · `## Anhänge`.
 * In English: From, To, Cc, Date, Subject, Forwarded by · `## Message` (+ `### Signature`) ·
 * `## Quoted thread` · `## Attachments` (the pairs live in i18n/content.ts).
 * For a forwarded mail the header shows the original message; `ingest()` adds TL;DR and action
 * items after the header (`withEmailDigest`). Valid, portable Markdown.
 */
export function emailToMarkdown(e: ParsedEmail): string {
  const f = e.forwarded;
  const head: string[] = [];
  const from = f?.from ?? e.from;
  if (from) head.push(`- **${ph("mailFrom")}:** ${formatAddress(from)}`);
  const to = f ? f.to : e.to;
  if (to.length) head.push(`- **${ph("mailTo")}:** ${to.map(formatAddress).join(", ")}`);
  if (!f && e.cc.length) head.push(`- **${ph("mailCc")}:** ${e.cc.map(formatAddress).join(", ")}`);
  const date = f ? f.date : e.date;
  if (date) head.push(`- **${ph("date")}:** ${when(date)}`);
  const subject = f ? (f.subject ?? cleanSubject(e.subject)) : e.subject;
  if (subject?.trim()) head.push(`- **${ph("mailSubject")}:** ${inline(subject)}`);
  if (f && e.from) {
    head.push(`- **${ph("mailForwardedBy")}:** ${formatAddress(e.from)}${e.date ? `, ${when(e.date)}` : ""}`);
  }

  const sections: string[] = [];
  if (head.length) sections.push(head.join("\n"));
  if (e.parts.note) sections.push(quote(`**${ph("mailForwardNote")}:** ${e.parts.note}`));
  sections.push(`## ${ph("mailMessage")}\n\n${demoteHeadings(e.parts.message) || ph("mailNoText")}`);
  if (e.parts.signature) sections.push(`### ${ph("mailSignature")}\n\n${e.parts.signature}`);
  if (e.parts.quoted) sections.push(`## ${ph("mailQuotedThread")}\n\n${quote(e.parts.quoted)}`);
  const files = e.attachments.filter((a) => !a.inline);
  if (files.length) {
    sections.push(
      `## ${ph("mailAttachments")}\n\n${files.map((a) => `- ${inline(a.filename)} (${a.mimeType}, ${kb(a.sizeBytes)})`).join("\n")}`,
    );
  }
  return sections.join("\n\n");
}

export interface EmailDigest {
  /** The organizer's summary (routed `auto_organize`, no extra model call). */
  summary: string | null;
  actionItems: readonly { title: string; due_date?: string | null }[];
}

/**
 * Puts the AI TL;DR and the action items right under the header list of an email note. Idempotent
 * (a note that already has a TL;DR is returned as is).
 */
export function withEmailDigest(contentMd: string, digest: EmailDigest): string {
  if (headingRe("tldr").test(contentMd)) return contentMd;
  const blocks: string[] = [];
  if (digest.summary?.trim()) blocks.push(`## ${ph("tldr")}\n\n${digest.summary.trim()}`);
  // The one task section every entry type uses (@kortex/db task-section.ts).
  const tasks = renderTaskSection(
    digest.actionItems.map((a) => ({ title: a.title, due_date: a.due_date ?? null, timeframe: null, context: null })),
    getLocale(),
  );
  if (tasks) blocks.push(tasks);
  if (!blocks.length) return contentMd;
  // The forwarder's note in either language (notes written before a language switch stay valid).
  const at = contentMd.search(new RegExp(`^(> \\*\\*${phAlt("mailForwardNote")}|## )`, "m"));
  if (at < 0) return `${contentMd.trimEnd()}\n\n${blocks.join("\n\n")}`;
  return `${contentMd.slice(0, at)}${blocks.join("\n\n")}\n\n${contentMd.slice(at)}`;
}

/** Flat, frontmatter-friendly metadata (`message_id` is the external id for dedup). */
export function emailMetadata(e: ParsedEmail): Record<string, unknown> {
  const sender = e.forwarded?.from ?? e.from;
  return {
    message_id: e.messageId,
    subject: e.subject,
    from: e.from?.address ?? null,
    from_name: e.from?.name ?? null,
    to: e.to.map((a) => a.address),
    ...(e.cc.length ? { cc: e.cc.map((a) => a.address) } : {}),
    date: e.date,
    ...(e.inReplyTo ? { in_reply_to: e.inReplyTo } : {}),
    // The person the content is from: the original sender of a forwarded mail, else From.
    sender: sender?.address ?? null,
    sender_name: sender?.name ?? null,
    forwarded: !!e.forwarded,
    ...(e.forwarded
      ? {
          original_from: e.forwarded.from?.address ?? null,
          original_from_name: e.forwarded.from?.name ?? null,
          original_date: e.forwarded.date,
          original_subject: e.forwarded.subject,
        }
      : {}),
    attachments: e.attachments
      .filter((a) => !a.inline)
      .map((a) => ({ filename: a.filename, mime_type: a.mimeType, size_bytes: a.sizeBytes })),
  };
}

/** Drops recipients (e.g. the private Kortex inbound address) from To/Cc before rendering. */
export function withoutRecipients(e: ParsedEmail, hide: (address: string) => boolean): ParsedEmail {
  return { ...e, to: e.to.filter((a) => !hide(a.address)), cc: e.cc.filter((a) => !hide(a.address)) };
}

/** True for addresses at the inbound mail domain (`KORTEX_INBOUND_MAIL_DOMAIN`). */
export const atDomain =
  (domain: string | null | undefined) =>
  (address: string): boolean => {
    const d = domain?.trim().toLowerCase();
    return !!d && address.toLowerCase().endsWith(`@${d}`);
  };
