import { randomBytes } from "node:crypto";
import { parseAddress } from "@kortex/ai-core";

/*
 * Mail an Kortex: each user's private inbound address is `<token>@<KORTEX_INBOUND_MAIL_DOMAIN>`.
 * The token is random (100 bits, lowercase base32 so the address survives case-folding mail
 * servers), stored in kortex.user_settings.inbound_mail_token (unique) and rotatable. An optional
 * `+tag` suffix (`<token>+rechnungen@…`) becomes a tag on the item.
 */

export const INBOUND_TOKEN_LENGTH = 20;
export const INBOUND_TOKEN = /^[a-z2-7]{20,64}$/;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** 20 chars of lowercase base32 (5 bits each, 100 bits of randomness). */
export function generateInboundToken(): string {
  const bytes = randomBytes(INBOUND_TOKEN_LENGTH);
  let out = "";
  for (const b of bytes) out += BASE32[b & 31];
  return out;
}

export interface InboundMailConfig {
  /** All three env values set: the webhook and the address are live. */
  enabled: boolean;
  domain: string | null;
  apiKey: string | null;
  webhookSecret: string | null;
}

const clean = (v: string | undefined) => {
  const s = v?.trim();
  return s && !/^<.*>$/.test(s) ? s : null;
};

export function inboundMailConfig(env: Record<string, string | undefined>): InboundMailConfig {
  const domain = clean(env.KORTEX_INBOUND_MAIL_DOMAIN)?.toLowerCase().replace(/^@/, "") ?? null;
  const apiKey = clean(env.RESEND_API_KEY);
  const webhookSecret = clean(env.RESEND_WEBHOOK_SECRET);
  return { enabled: !!(domain && apiKey && webhookSecret), domain, apiKey, webhookSecret };
}

export const inboundAddress = (token: string, domain: string) => `${token}@${domain}`;

export interface InboundRecipient {
  token: string;
  /** `+tag` part of the local part, if any (lowercase). */
  tag: string | null;
  address: string;
}

/** `<token>[+tag]@<domain>` → token and tag; anything else → null. */
export function parseInboundRecipient(raw: string, domain: string): InboundRecipient | null {
  const address = parseAddress(raw)?.address;
  if (!address) return null;
  const at = address.lastIndexOf("@");
  if (address.slice(at + 1) !== domain.toLowerCase()) return null;
  const [token, ...rest] = address.slice(0, at).split("+");
  if (!token || !INBOUND_TOKEN.test(token)) return null;
  const tag = rest.join("+").replace(/[^a-z0-9/_-]+/g, "-").replace(/^-+|-+$/g, "") || null;
  return { token, tag, address };
}

/**
 * The Kortex recipient of a received mail. `received_for` first: when a user auto-forwards from
 * another mailbox, `to` still holds their own address and only the envelope names ours.
 */
export function findInboundRecipient(
  data: { received_for?: unknown; to?: unknown; cc?: unknown; bcc?: unknown },
  domain: string,
): InboundRecipient | null {
  for (const list of [data.received_for, data.to, data.cc, data.bcc]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (typeof entry !== "string") continue;
      const r = parseInboundRecipient(entry, domain);
      if (r) return r;
    }
  }
  return null;
}
