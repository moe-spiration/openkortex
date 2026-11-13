import { t } from "@/i18n";
import type { KortexClient } from "@kortex/db";
import { generateInboundToken, inboundAddress, inboundMailConfig } from "./address";

/*
 * The user's side of Mail an Kortex: read, create/rotate and switch off the private address.
 * Runs as the signed-in user (RLS on user_settings) and filters by user_id as well.
 */

export interface InboundMailInfo {
  /** Server has RESEND_API_KEY, RESEND_WEBHOOK_SECRET and KORTEX_INBOUND_MAIL_DOMAIN. */
  configured: boolean;
  domain: string | null;
  /** `<token>@<domain>`, null while the user has no address. */
  address: string | null;
  rotatedAt: string | null;
}

const COLUMNS = "inbound_mail_token,inbound_mail_rotated_at";
type Row = { inbound_mail_token: string | null; inbound_mail_rotated_at: string | null };

const info = (env: Record<string, string | undefined>, row: Row | null): InboundMailInfo => {
  const cfg = inboundMailConfig(env);
  const token = row?.inbound_mail_token ?? null;
  return {
    configured: cfg.enabled,
    domain: cfg.domain,
    address: token && cfg.domain ? inboundAddress(token, cfg.domain) : null,
    rotatedAt: token ? (row?.inbound_mail_rotated_at ?? null) : null,
  };
};

export async function readInboundMail(
  client: KortexClient,
  userId: string,
  env: Record<string, string | undefined>,
): Promise<InboundMailInfo> {
  const { data, error } = await client.from("user_settings").select(COLUMNS).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(t("Reading the mail address: {error}", { error: error.message }));
  return info(env, data as Row | null);
}

/** New random address; the previous one stops working at once. */
export async function rotateInboundMail(
  client: KortexClient,
  userId: string,
  env: Record<string, string | undefined>,
  now: Date = new Date(),
): Promise<InboundMailInfo> {
  if (!inboundMailConfig(env).enabled) throw new Error(t("Mail to Kortex is not set up on the server"));
  for (let attempt = 0; attempt < 3; attempt++) {
    const patch = { inbound_mail_token: generateInboundToken(), inbound_mail_rotated_at: now.toISOString() };
    const { data, error } = await client
      .from("user_settings")
      .update(patch)
      .eq("user_id", userId)
      .select(COLUMNS)
      .maybeSingle();
    // A token collision (unique) is astronomically rare: just draw again.
    if (error && (error.code === "23505" || /unique|duplicate/i.test(error.message))) continue;
    if (error) throw new Error(t("Creating the mail address: {error}", { error: error.message }));
    if (!data) throw new Error(t("No settings found"));
    return info(env, data as Row);
  }
  throw new Error(t("Creating the mail address: please try again"));
}

/** Switches the address off: mails to it are dropped from now on. */
export async function disableInboundMail(
  client: KortexClient,
  userId: string,
  env: Record<string, string | undefined>,
): Promise<InboundMailInfo> {
  const { error } = await client
    .from("user_settings")
    .update({ inbound_mail_token: null, inbound_mail_rotated_at: null })
    .eq("user_id", userId);
  if (error) throw new Error(t("Switching off the mail address: {error}", { error: error.message }));
  return info(env, null);
}
