import { byLocale, t } from "../i18n";
import { generateText, type LanguageModel } from "ai";
import type { AudioInput, AudioTranscriber, TranscriptSegment } from "../audio/transcriber";
import type { UrlTranscriber } from "../audio/url-transcriber";
import { ExtractionError } from "../errors";
import type { DocumentInput, DocumentParser } from "./edenai";

// document_parsing / audio_transcription served by a multimodal LLM (Anthropic PDF input,
// OpenRouter models with file or audio input) when the user routes those tasks away from Eden AI.

const docPrompt = (): string =>
  byLocale({
    en: "Reproduce the complete text of this document verbatim as Markdown, page by page. Separate pages with a line '---'. No comments, no summary.",
    de: "Gib den vollständigen Text dieses Dokuments wortgetreu als Markdown wieder, Seite für Seite. Trenne Seiten mit einer Zeile '---'. Keine Kommentare, keine Zusammenfassung.",
  });

export function createLlmDocumentParser(model: LanguageModel, id: string): DocumentParser {
  return {
    id,
    async parse(input: DocumentInput) {
      const data = "url" in input ? new URL(input.url) : input.data;
      const mediaType = "url" in input ? "application/pdf" : input.mimeType;
      const { text } = await generateText({
        model,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: docPrompt() },
              { type: "file", data, mediaType },
            ],
          },
        ],
      });
      const pages = text
        .split(/\n-{3,}\n/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (!pages.length) throw new ExtractionError(id, t("Document without text"));
      return { text: pages.join("\n\n"), pages };
    },
  };
}

const audioPrompt = (): string =>
  byLocale({
    en: "Transcribe this audio file verbatim in the spoken language. Return only the transcript.",
    de: "Transkribiere diese Audiodatei wortgetreu in der gesprochenen Sprache. Gib nur das Transkript zurück.",
  });

/** LLM transcription has no timestamps: one segment starting at 0. */
export function createLlmTranscriber(
  model: LanguageModel,
  id: string,
): AudioTranscriber & UrlTranscriber {
  const run = async (data: Uint8Array | URL, mediaType: string): Promise<TranscriptSegment[]> => {
    const { text } = await generateText({
      model,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: audioPrompt() },
            { type: "file", data, mediaType },
          ],
        },
      ],
    });
    const spoken = text.trim();
    if (!spoken) throw new ExtractionError(id, t("Empty transcription"));
    return [{ startSec: 0, text: spoken }];
  };
  return {
    id,
    transcribe: (audio: AudioInput) => run(audio.data, audio.mimeType),
    transcribeUrl: (url: string) => run(new URL(url), "audio/mpeg"),
  };
}
