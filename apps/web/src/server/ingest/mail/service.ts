import { runAsUser } from "../../locale";
import { t } from "@/i18n";
import { createHash } from "node:crypto";
import {
  buildEml,
  cleanSubject,
  emailHtmlToMarkdown,
  normalizeMessageId,
  normalizeTag,
  slugify,
  type FetchLike,
} from "@kortex/ai-core";
import { insertOrMerge, type KortexClient } from "@kortex/db";
import { ApiError } from "../../api-error";
import type { AuthContext } from "../../auth";
import type { ServerDeps } from "../../deps";
import { enforceLimits, isAllowed } from "../../limits";
import { getItem, listFolders, mergeJson, updateItem } from "../../repo";
import { INBOX_FOLDER, MAX_UPLOAD_BYTES, isSupportedUpload, uploadContentType } from "../contract";
import { acceptIngest } from "../service";
import { findInboundRecipient, inboundMailConfig, type InboundRecipient } from "./address";
import { createResendClient, type ResendAttachment, type ResendClient } from "./resend";

/*
 * Mail an Kortex, after the signature check: map the recipient token to a user, fetch the mail
 * from Resend, write one `email` item (idempotent per Message-ID) and queue it through the normal
 * ingest pipeline (email adapter → organizer → chunks/embeddings/action items). Attachments that
 * the pipeline can read (PDF, EPUB, images) become their own items, linked as sub-pages
 * (parent_item_id) of the mail.
 */

/** Raw .eml above this is not downloaded; the mail is rebuilt from Resend's JSON instead. */
export const MAX_RAW_EML_BYTES = 25 * 1024 * 1024;
/** Attachments per mail that become items (the rest is listed in the note only). */
export const MAX_ATTACHMENT_ITEMS = 10;
/** Inline images below this are signature logos and spacers, not content. */
const MIN_INLINE_IMAGE_BYTES = 50 * 1024;

export type MailOutcome =
  | { status: "accepted"; itemId: string; attachments: number }
  | { status: "duplicate"; itemId: string }
  | { status: "ignored"; reason: string };

export interface ReceivedEvent {
  type?: unknown;
  data?: {
    email_id?: unknown;
    message_id?: unknown;
    subject?: unknown;
    from?: unknown;
    to?: unknown;
    cc?: unknown;
    bcc?: unknown;
    received_for?: unknown;
  };
}

export interface MailServiceOptions {
  fetch?: FetchLike;
  resend?: ResendClient;
}

/**
 * Stable item id per (user, Message-ID): a retried or doubled webhook hits the primary key instead
 * of creating a second item, even when two deliveries race.
 */
export function mailItemId(userId: string, messageKey: string): string {
  const h = createHash("sha256").update(`kortex-mail:${userId}:${messageKey}`).digest("hex");
  // Shape of a UUID (version nibble 5: name-based), so it fits the uuid column.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function userForToken(service: KortexClient, token: string): Promise<string | null> {
  const { data, error } = await service
    .from("user_settings")
    .select("user_id")
    .eq("inbound_mail_token", token)
    .maybeSingle();
  if (error) throw new ApiError("server_error", `inbound token lookup: ${error.message}`);
  return (data as { user_id: string } | null)?.user_id ?? null;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const isUniqueViolation = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "23505" || /duplicate key|unique/i.test(e.message ?? ""));

/** Fetches the mail as .eml: Resend's raw download when it is small enough, else rebuilt from JSON. */
async function loadEml(resend: ResendClient, emailId: string) {
  const email = await resend.getReceivedEmail(emailId);
  let eml: Uint8Array | null = null;
  if (email.raw?.download_url) {
    eml = await resend.download(email.raw.download_url, MAX_RAW_EML_BYTES).catch(() => null);
  }
  eml ??= buildEml({
    from: email.headers?.from ?? email.from,
    to: email.to,
    cc: email.cc,
    subject: email.subject,
    date: email.headers?.date ?? email.created_at,
    messageId: email.message_id,
    inReplyTo: email.headers?.["in-reply-to"],
    html: email.html,
    text: email.text,
  });
  return { email, eml };
}

const wantsAttachment = (a: ResendAttachment) => {
  const name = a.filename?.trim() || "";
  const type = (a.content_type ?? "").toLowerCase();
  if (!name || !isSupportedUpload(name, type)) return false;
  if ((a.size ?? 0) > MAX_UPLOAD_BYTES) return false;
  const inline = a.content_disposition === "inline" || !!a.content_id;
  return !(inline && type.startsWith("image/") && (a.size ?? 0) < MIN_INLINE_IMAGE_BYTES);
};

/** Background: attachments as items of their own (sub-pages of the mail). Never throws. */
async function ingestAttachments(
  deps: ServerDeps,
  ctx: AuthContext,
  resend: ResendClient,
  emailId: string,
  parentId: string,
  subject: string,
  tags: string[],
): Promise<number> {
  let done = 0;
  try {
    const list = (await resend.listAttachments(emailId))
      .filter(wantsAttachment)
      .slice(0, MAX_ATTACHMENT_ITEMS);
    for (const a of list) {
      try {
        if (!a.download_url) continue;
        const bytes = await resend.download(a.download_url, MAX_UPLOAD_BYTES);
        if (!bytes) continue;
        const name = a.filename!.trim();
        const res = await acceptIngest(deps, ctx, {
          kind: "file",
          file: { name, type: uploadContentType(name, a.content_type ?? ""), bytes },
          folder_path: null,
          tags,
          note: t("Attachment of the email “{subject}”.", { subject }),
        });
        await updateItem(ctx.client, ctx.userId, res.item_id, { parent_item_id: parentId });
        done++;
      } catch (err) {
        deps.log.error("mail attachment failed", { emailId, file: a.filename, err });
      }
    }
  } catch (err) {
    deps.log.error("mail attachments: list failed", { emailId, err });
  }
  return done;
}

export async function handleReceivedMail(
  deps: ServerDeps,
  event: ReceivedEvent,
  options: MailServiceOptions = {},
): Promise<MailOutcome> {
  const config = inboundMailConfig(deps.env.raw);
  if (!config.enabled || !config.domain || !config.apiKey)
    throw new ApiError("not_configured", t("Mail to Kortex is not set up"));
  if (event.type !== "email.received") return { status: "ignored", reason: "event type" };

  const data = event.data ?? {};
  const emailId = str(data.email_id);
  if (!emailId) return { status: "ignored", reason: "no email_id" };
  const recipient: InboundRecipient | null = findInboundRecipient(data, config.domain);
  if (!recipient) return { status: "ignored", reason: "no kortex recipient" };

  const service = deps.clients.service();
  const userId = await userForToken(service, recipient.token);
  if (!userId) return { status: "ignored", reason: "unknown token" };
  const ctx: AuthContext = { userId, mode: "api_token", client: service };
  if (!(await isAllowed(ctx, deps))) return { status: "ignored", reason: "not allowed" };
  // The webhook has no user session: everything written for the recipient is in their account language.
  return runAsUser(service, userId, () => acceptMail(deps, ctx, { data, emailId, recipient, config, options }));
}

async function acceptMail(
  deps: ServerDeps,
  ctx: AuthContext,
  m: {
    data: NonNullable<ReceivedEvent["data"]>;
    emailId: string;
    recipient: InboundRecipient;
    config: ReturnType<typeof inboundMailConfig>;
    options: MailServiceOptions;
  },
): Promise<MailOutcome> {
  const { data, emailId, recipient, config, options } = m;
  const { userId, client: service } = ctx;

  // Idempotency: Message-ID (Resend's email id when a mail has none) → fixed item id.
  const messageId = normalizeMessageId(str(data.message_id));
  const itemId = mailItemId(userId, messageId ?? `resend:${emailId}`);
  if (await getItem(service, userId, itemId, ["id"])) return { status: "duplicate", itemId };

  // Rate limit and AI budget like /api/ingest: 429/402 make Resend retry later.
  await enforceLimits({ auth: ctx, deps }, "ingest");

  const resend = options.resend ?? createResendClient(config.apiKey ?? "", options.fetch);
  // Fetched before anything is written: a Resend failure (5xx) is retried with nothing left over.
  const { email, eml } = await loadEml(resend, emailId);

  const subject = cleanSubject(email.subject ?? str(data.subject));
  const title = subject || t("Email");
  const tags = recipient.tag ? [normalizeTag(recipient.tag)].filter(Boolean) : [];
  const inbox = (await listFolders(service, userId)).find((f) => f.folder_path === INBOX_FOLDER);
  // Dedup (@kortex/db): same Message-ID (external_id) or the same text (content_hash) as an
  // existing item is merged into it instead of becoming a second mail.
  let dup: Awaited<ReturnType<typeof insertOrMerge>>["duplicate"] = null;
  try {
    ({ duplicate: dup } = await insertOrMerge(
      service,
      userId,
      {
        id: itemId,
        user_id: userId,
        type: "email",
        source_platform: "email",
        title,
        slug: slugify(title) || itemId,
        content_md: "",
        folder_path: INBOX_FOLDER,
        folder_id: inbox?.id ?? null,
        is_manual_placement: false,
        tags,
        status: "inbox",
        icon: "mail",
        file_mime_type: "message/rfc822",
        file_size_bytes: eml.byteLength,
        metadata: mergeJson(null, {
          message_id: messageId,
          resend_email_id: emailId,
          subject: email.subject ?? null,
          from: email.from ?? null,
          received_at: email.created_at ?? deps.now().toISOString(),
          ingest: { state: "queued" },
        }),
      },
      {
        type: "email",
        title,
        tags,
        platform: "email",
        metadata: { message_id: messageId },
        contentMd: email.text ?? (email.html ? emailHtmlToMarkdown(email.html) : null),
        appendContent: false,
      },
    ));
  } catch (err) {
    // Two deliveries racing on the fixed item id: the second one is the duplicate.
    if (isUniqueViolation(err as { code?: string; message?: string }))
      return { status: "duplicate", itemId };
    throw new ApiError(
      "server_error",
      `insert mail item: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (dup) return { status: "duplicate", itemId: dup.item.id };

  try {
    await deps.queue.enqueue(ctx, {
      itemId,
      kind: "email",
      input: {
        fileBuffer: eml,
        fileName: `${(slugify(title) || "mail").slice(0, 60)}.eml`,
        mimeType: "message/rfc822",
        typeHint: "email",
        manualTags: tags,
      },
      // Subject is the title; without one the organizer names it.
      options: { keepTitle: !!subject, sourcePlatform: "email" },
    });
  } catch (err) {
    // Not queued: drop the row so Resend's retry starts clean instead of hitting the duplicate.
    await service.from("knowledge_items").delete().eq("user_id", userId).eq("id", itemId);
    throw err;
  }

  // Attachments run after the response (signed URLs stay valid for an hour).
  const expected = (email.attachments ?? []).length;
  if (expected > 0) {
    deps.defer(
      ingestAttachments(deps, ctx, resend, emailId, itemId, title, tags).then((n) =>
        deps.log.info("mail attachments", { itemId, listed: expected, items: n }),
      ),
    );
  }
  return { status: "accepted", itemId, attachments: expected };
}
