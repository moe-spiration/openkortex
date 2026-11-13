import { generateText, Output } from "ai";
import { z } from "zod";
import { ExtractionError, KortexAiError } from "../errors";
import { ph } from "../i18n";
import { visionOcrPrompt } from "../prompts/vision-ocr";
import type { ModelRouter } from "../router/model-router";
import { STORAGE_BUCKETS, imageExtension, itemStoragePath, type StorageGateway } from "../storage";
import type { ExtractedPayload, IngestionAdapter, RawIngestInput } from "./base-adapter";
import { modelFor, modelIdFor } from "../router/model-router";

const ID = "vision-ocr";

export interface VisionOcrAdapterOptions {
  storage: StorageGateway;
  models: ModelRouter;
}

export const VisionResultSchema = z.object({
  title_hint: z.string(),
  image_kind: z.enum(["screenshot", "whiteboard", "diagram", "photo", "document", "other"]),
  ocr_text: z.string(),
  description_md: z.string(),
  todos: z.array(z.string()),
  /** Distinct things visible (max. ~12 short nouns); older answers without it default to none. */
  objects: z.array(z.string()).default([]),
  /** One short sentence: where/what situation is shown ("Whiteboard im Büro, Sprint-Planung"). */
  scene: z.string().default(""),
});
export type VisionResult = z.infer<typeof VisionResultSchema>;

const MAX_DETECTED_TEXT = 2000;
const cleanList = (v: readonly string[], max: number): string[] =>
  [...new Set(v.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, max);

/** One routed `vision_ocr` call: OCR, description and to-dos of a single image. */
export async function analyzeImage(
  models: ModelRouter,
  bytes: Uint8Array,
  mimeType: string,
): Promise<VisionResult> {
  const { output } = await generateText({
    model: modelFor(models, "vision_ocr"),
    output: Output.object({ schema: VisionResultSchema, name: "vision_ocr" }),
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: visionOcrPrompt() },
          { type: "file", data: bytes, mediaType: mimeType },
        ],
      },
    ],
  });
  return output;
}

export function renderVisionMarkdown(r: VisionResult): string {
  const md: string[] = [`# ${r.title_hint.trim() || ph("image")}`, ""];
  if (r.description_md.trim()) md.push(`## ${ph("description")}`, "", r.description_md.trim(), "");
  if (r.ocr_text.trim()) {
    // Fenced so OCR line breaks and symbols survive as-is.
    md.push(`## ${ph("recognizedText")}`, "", "```text", r.ocr_text.trim(), "```", "");
  }
  if (r.todos.length > 0) {
    md.push(`## ${ph("todos")}`, "", ...r.todos.map((t) => `- [ ] ${t.trim()}`), "");
  }
  return md.join("\n").trim();
}

export function createVisionOcrAdapter(options: VisionOcrAdapterOptions): IngestionAdapter {
  return {
    id: ID,
    canHandle: (input: RawIngestInput) =>
      !!input.fileBuffer && !!input.mimeType?.toLowerCase().startsWith("image/"),

    async extract(input: RawIngestInput): Promise<ExtractedPayload> {
      if (!input.itemId) throw new KortexAiError(`${ID}: itemId is required to store the file`);
      const bytes = input.fileBuffer as Uint8Array;
      const mimeType = (input.mimeType as string).toLowerCase();

      const path = itemStoragePath(input.userId, input.itemId, imageExtension(mimeType));
      await options.storage.upload({
        bucket: STORAGE_BUCKETS.media,
        path,
        data: bytes,
        contentType: mimeType,
      });

      let result: VisionResult;
      try {
        result = await analyzeImage(options.models, bytes, mimeType);
      } catch (cause) {
        throw new ExtractionError(ID, "vision model failed", { cause });
      }

      return {
        type: "image",
        sourcePlatform: "upload",
        titleHint: result.title_hint.trim() || undefined,
        contentMd: renderVisionMarkdown(result),
        file: { bucket: STORAGE_BUCKETS.media, path, mimeType, sizeBytes: bytes.byteLength },
        metadata: {
          image_kind: result.image_kind,
          has_text: result.ocr_text.trim().length > 0,
          detected_todos: result.todos,
          objects: cleanList(result.objects, 12),
          scene: result.scene.trim().slice(0, 300) || null,
          detected_text: result.ocr_text.trim().slice(0, MAX_DETECTED_TEXT) || null,
          vision_model: modelIdFor(options.models, "vision_ocr"),
          original_file_name: input.fileName ?? null,
        },
      };
    },
  };
}
