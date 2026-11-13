import { STORAGE_BUCKETS } from "@kortex/db";
import { atDomain, emailMetadata, emailToMarkdown, parseEmail, withoutRecipients } from "../email";
import { AdapterDeclinedError } from "../errors";
import { itemStoragePath, type StorageGateway } from "../storage";
import {
  fileExtension,
  type IngestionAdapter,
  type RawIngestInput,
  type StoredFile,
} from "./base-adapter";

export interface EmailAdapterOptions {
  /** Keeps the original .eml in kortex-documents (`{user}/{item}.eml`). Off without a gateway. */
  storage?: StorageGateway;
  /**
   * Inbound mail domain (KORTEX_INBOUND_MAIL_DOMAIN). Recipients there are the user's private
   * Kortex address: kept out of the note and its metadata.
   */
  inboundDomain?: string;
}

const isEmailInput = (input: RawIngestInput) =>
  !!input.fileBuffer &&
  (input.mimeType?.toLowerCase() === "message/rfc822" ||
    fileExtension(input) === "eml" ||
    input.typeHint === "email");

/**
 * Inbound e-mail (.eml / message/rfc822): Mail an Kortex (Resend webhook) and .eml uploads.
 * Subject → title, sender/date/Message-ID → metadata, HTML/text → clean Markdown, forwarded
 * mails keep their original sender. Attachments are listed here; the webhook ingests them as
 * items of their own (PDF, images) through the normal pipeline. Action items come from the
 * organizer like for every other note.
 */
export function createEmailAdapter(options: EmailAdapterOptions = {}): IngestionAdapter {
  const id = "email";
  return {
    id,
    canHandle: isEmailInput,
    async extract(input) {
      const raw = input.fileBuffer!;
      const parsed = await parseEmail(raw).catch((err: unknown) => {
        throw new AdapterDeclinedError(
          id,
          `not a readable e-mail: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
      const email = withoutRecipients(parsed, atDomain(options.inboundDomain));
      if (!email.from && !email.subject && !email.bodyMd) {
        throw new AdapterDeclinedError(id, "no From, Subject or body: not an e-mail");
      }

      let file: StoredFile | undefined;
      if (options.storage && input.itemId) {
        const path = itemStoragePath(input.userId, input.itemId, "eml");
        await options.storage.upload({
          bucket: STORAGE_BUCKETS.documents,
          path,
          data: raw,
          contentType: "message/rfc822",
        });
        file = {
          bucket: STORAGE_BUCKETS.documents,
          path,
          mimeType: "message/rfc822",
          sizeBytes: raw.byteLength,
        };
      }

      return {
        type: "email",
        sourcePlatform: "email",
        titleHint: email.title,
        contentMd: emailToMarkdown(email),
        metadata: emailMetadata(email),
        ...(file ? { file } : {}),
      };
    },
  };
}
