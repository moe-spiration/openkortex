import { t } from "@/i18n";
import type { ItemStatus, KnowledgeItemType } from "@kortex/db";
import { ApiError, badRequest, json, notFound } from "../api-error";
import { enforceLimits } from "../limits";
import { getItem, getUserSettings } from "../repo";
import { preflight, readJson, route, type DepsProvider } from "../route";
import {
  IngestRequestSchema,
  isSupportedUpload,
  uploadContentType,
  MAX_UPLOAD_BYTES,
  type FileIngestRequest,
  type IngestStatusResponse,
} from "./contract";
import { assertConnectorEnabled } from "../settings/connectors";
import { acceptIngest } from "./service";
import { placementDecision, placementOf, thresholdOf } from "@/lib/placement";

const str = (v: FormDataEntryValue | null) =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

async function parseMultipart(request: Request): Promise<FileIngestRequest> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 1024 * 1024) {
    throw new ApiError("invalid_request", t("File is larger than 50 MB"), { status: 413 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw badRequest(t("multipart/form-data could not be read"));
  }
  const file = form.get("file");
  if (!file || typeof file === "string") throw badRequest(t("file: file is missing"));
  if (file.size > MAX_UPLOAD_BYTES)
    throw new ApiError("invalid_request", t("File is larger than 50 MB"), { status: 413 });
  if (!isSupportedUpload(file.name, file.type)) {
    throw badRequest(t("file: file type not supported ({type})", { type: file.type || file.name }));
  }
  const tags = form
    .getAll("tags")
    .flatMap((t) => (typeof t === "string" ? t.split(",") : []))
    .map((t) => t.trim().replace(/^#/, ""))
    .filter(Boolean);
  return {
    kind: "file",
    file: {
      name: file.name,
      // Stored and served with an allowlisted type (review N5 #23), never the raw client type.
      type: uploadContentType(file.name, file.type),
      bytes: new Uint8Array(await file.arrayBuffer()),
    },
    folder_path: str(form.get("folder_path")) ?? null,
    tags,
    title: str(form.get("title")),
    note: str(form.get("note")),
  };
}

export function createIngestHandlers(getDeps: DepsProvider) {
  return {
    /** Connection test (extension "Verbindung testen") and status poll with `?item_id=`. */
    GET: route(getDeps, async ({ request, auth }) => {
      const itemId = new URL(request.url).searchParams.get("item_id");
      const body: IngestStatusResponse = {
        ok: true,
        user_id: auth.userId,
        ...(auth.token ? { token_name: auth.token.name } : {}),
      };
      if (itemId) {
        if (!/^[0-9a-f-]{36}$/i.test(itemId)) throw badRequest(t("item_id: invalid UUID"));
        const item = await getItem(auth.client, auth.userId, itemId, [
          "id",
          "status",
          "type",
          "title",
          "folder_path",
          "metadata",
          "is_manual_placement",
        ]);
        if (!item) throw notFound(t("Entry not found"));
        const ingest = (item.metadata as { ingest?: { error?: string } } | null)?.ingest;
        let placement: NonNullable<IngestStatusResponse["item"]>["placement"];
        if (item.status === "processed") {
          const settings = await getUserSettings(auth.client, auth.userId);
          const p = placementOf(item.metadata);
          placement = {
            confidence: p?.confidence ?? null,
            decision: placementDecision(
              p,
              item.is_manual_placement ?? false,
              thresholdOf(settings?.auto_place_threshold),
            ),
          };
        }
        body.item = {
          item_id: item.id,
          status: item.status as ItemStatus,
          type: item.type as KnowledgeItemType,
          title: item.title,
          folder_path: item.folder_path,
          ...(ingest?.error ? { error: ingest.error } : {}),
          ...(placement ? { placement } : {}),
        };
      }
      return json(body);
    }),

    POST: route(getDeps, async ({ request, auth, deps }) => {
      // S2a: allowlist, per-user rate limit and the daily AI budget (ingest spends AI money).
      await enforceLimits({ auth, deps }, "ingest");
      const type = request.headers.get("content-type") ?? "";
      const req = type.startsWith("multipart/form-data")
        ? await parseMultipart(request)
        : IngestRequestSchema.parse(await readJson(request));
      await assertConnectorEnabled(auth, req); // user_settings.enabled_connectors (WP-K)
      return json(await acceptIngest(deps, auth, req));
    }),

    OPTIONS: preflight(getDeps),
  };
}
