// Maps ingest failures to UI states: what to say and which action to offer.
import { msg, t } from "../i18n";
import type { IngestFailure } from "./api";

export interface FailureView {
  title: string;
  message: string;
  /** `options` = send the user to the options page, `back` = return to the form and try again. */
  action: "options" | "back";
}

const FIELD_LABEL: Record<string, string> = {
  url: msg("The address"),
  title: msg("The title"),
  page_title: msg("The page title"),
  description: msg("The description"),
  note: msg("The note"),
  note_text: msg("The note"),
  quote_text: msg("The selection"),
  content_md: msg("The chat content"),
  image_url: msg("The preview image"),
  folder_path: msg("The folder"),
  tags: msg("The hashtags"),
  idempotency_key: msg("The request ID"),
  locator: msg("The text position"),
};

/** First offending field of a zod-style `details` array (`[{ path: ["title"], … }]`). */
export function failingField(details: unknown): string | null {
  if (!Array.isArray(details)) return null;
  const first = details[0] as { path?: unknown } | undefined;
  const head = Array.isArray(first?.path) ? first.path[0] : undefined;
  return typeof head === "string" ? head : null;
}

export function describeFailure(f: IngestFailure): FailureView {
  const { code, message, details } = f.error;
  switch (code) {
    case "setup_required":
      return { title: t("Not connected yet"), message: t("Kortex URL and API token are missing in the options."), action: "options" };
    case "unauthorized":
      return {
        title: t("Sign-in rejected"),
        message: message
          ? t("{message}. Please enter a valid token in the options.", { message })
          : t("The API token was not accepted. Please enter a valid token in the options."),
        action: "options",
      };
    case "invalid_request": {
      const field = failingField(details);
      const label = field ? FIELD_LABEL[field] : undefined;
      return {
        title: t("Not saved"),
        message: label ? t("{field} is rejected by the server ({message}).", { field: t(label), message }) : message,
        action: "back",
      };
    }
    case "not_configured":
      return { title: t("Kortex is not set up yet"), message: t("The server is missing configuration. The capture will be retried later."), action: "back" };
    case "rate_limited":
      return { title: t("Too many requests"), message: t("The capture will be retried in a moment."), action: "back" };
    case "network":
      return { title: t("Kortex unreachable"), message: message || t("No connection."), action: "back" };
    default:
      return { title: t("Not saved"), message, action: "back" };
  }
}
