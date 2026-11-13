import { parseAddress } from "./address";

/*
 * Builds a minimal RFC 822 message from structured fields (Resend's received-email JSON) when the
 * raw .eml is not available. The result goes through the same parser as every other mail, so a
 * note looks the same either way. Attachments are not embedded: they become their own items.
 */

export interface StructuredEmail {
  from: string;
  to?: readonly string[];
  cc?: readonly string[];
  subject?: string | null;
  /** Any format `Date` understands; written as RFC 2822 (UTC). */
  date?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  html?: string | null;
  text?: string | null;
}

const enc = new TextEncoder();
const b64 = (s: string): string => {
  const bytes = enc.encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const wrap76 = (s: string) => s.replace(/.{1,76}/g, "$&\r\n").trimEnd();

/** RFC 2047 encoded word for non-ASCII header values; header injection (CR/LF) is removed. */
export const encodeHeader = (value: string): string => {
  const flat = value.replace(/[\r\n]+/g, " ").trim();
  return /^[\x20-\x7e]*$/.test(flat) ? flat : `=?UTF-8?B?${b64(flat)}?=`;
};

/** Address header: only the display name is encoded, the address stays readable. */
export const encodeAddresses = (list: readonly string[]): string =>
  list
    .map((raw) => {
      const a = parseAddress(raw.replace(/[\r\n]+/g, " "));
      if (!a) return null;
      return a.name ? `${encodeHeader(a.name.replace(/["\\]/g, ""))} <${a.address}>` : a.address;
    })
    .filter(Boolean)
    .join(", ");

const angle = (id: string) => `<${id.replace(/^<+|>+$/g, "").replace(/[\r\n\s<>]/g, "")}>`;

export function buildEml(e: StructuredEmail): Uint8Array {
  const headers: string[] = [`From: ${encodeAddresses([e.from])}`];
  if (e.to?.length) headers.push(`To: ${encodeAddresses(e.to)}`);
  if (e.cc?.length) headers.push(`Cc: ${encodeAddresses(e.cc)}`);
  if (e.subject) headers.push(`Subject: ${encodeHeader(e.subject)}`);
  const date = e.date ? new Date(e.date) : null;
  if (date && !Number.isNaN(date.getTime())) headers.push(`Date: ${date.toUTCString()}`);
  if (e.messageId) headers.push(`Message-ID: ${angle(e.messageId)}`);
  if (e.inReplyTo) headers.push(`In-Reply-To: ${angle(e.inReplyTo)}`);
  headers.push("MIME-Version: 1.0");

  const part = (type: string, body: string) =>
    `Content-Type: ${type}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(body))}`;
  const html = e.html?.trim() ? e.html : null;
  const text = e.text?.trim() ? e.text : null;
  let body: string;
  if (html && text) {
    const boundary = `kortex-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = `--${boundary}\r\n${part("text/plain", text)}\r\n--${boundary}\r\n${part("text/html", html)}\r\n--${boundary}--\r\n`;
  } else {
    const [type, content] = html ? ["text/html", html] : ["text/plain", text ?? ""];
    headers.push(`Content-Type: ${type}; charset=utf-8`, "Content-Transfer-Encoding: base64");
    body = `${wrap76(b64(content))}\r\n`;
  }
  return enc.encode(`${headers.join("\r\n")}\r\n\r\n${body}`);
}
