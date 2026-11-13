import { addressParser, type Address } from "postal-mime";

export interface MailAddress {
  name: string | null;
  address: string;
}

export const mailbox = (a: Address | undefined): MailAddress[] => {
  if (!a) return [];
  if (a.group) return a.group.flatMap((m) => mailbox(m));
  const address = (a.address ?? "").trim().toLowerCase();
  if (!address) return [];
  return [{ name: a.name?.trim() || null, address }];
};

export const mailboxes = (list: Address[] | undefined) => (list ?? []).flatMap((a) => mailbox(a));

/** First address in a free-text header value ("Anna <a@x>", "Anna [mailto:a@x]", "a@x"). */
export function parseAddress(value: string | null | undefined): MailAddress | null {
  const raw = (value ?? "")
    .replace(/\[mailto:([^\]]+)\]/gi, "<$1>")
    .replace(/\((mailto:)?[^)\s]+@[^)\s]+\)/gi, (m) => `<${m.slice(1, -1).replace(/^mailto:/i, "")}>`)
    .trim();
  if (!raw) return null;
  try {
    const parsed = mailbox(addressParser(raw)[0]);
    if (parsed[0]) return parsed[0];
  } catch {
    /* fall through to the regex */
  }
  const m = raw.match(/[\w.+'-]+@[\w-]+(\.[\w-]+)+/);
  if (!m) return null;
  const name = raw.slice(0, m.index).replace(/[<"'\s]+$/g, "").replace(/^["'\s]+/, "").trim();
  return { name: name || null, address: m[0].toLowerCase() };
}

export const formatAddress = (a: MailAddress): string =>
  a.name && a.name !== a.address ? `${a.name} <${a.address}>` : `<${a.address}>`;

