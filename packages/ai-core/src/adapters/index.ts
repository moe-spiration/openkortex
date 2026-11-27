import type { SpeakerNames } from "../audio/meeting-transcript";
import type { AudioTranscriber } from "../audio/transcriber";
import type { UrlTranscriber } from "../audio/url-transcriber";
import type { PodcastIndexClient } from "../podcast/podcast-index";
import type { DocumentParser } from "../providers/edenai";
import type { FetchLike } from "../http";
import { IngestionRegistry } from "../router/ingestion-registry";
import type { ModelRouter } from "../router/model-router";
import type { StorageGateway } from "../storage";
import { createEmailAdapter } from "./email.adapter";
import { createPinterestAdapter } from "./future/pinterest.adapter";
import { createWorkspaceImportAdapter } from "./future/workspace-import";
import { createXTwitterAdapter } from "./future/x-twitter.adapter";
import { createAiChatAdapter } from "./ai-chat.adapter";
import { createEpubBookAdapter } from "./epub-book.adapter";
import { createMeetingAdapter } from "./meeting.adapter";
import { createClientMediaAdapter } from "./client-media.adapter";
import { createPodcastAdapter, type PodcastAdapterOptions } from "./podcast.adapter";
import { createSocialShortAdapter, type SocialMediaDownloader } from "./social-short.adapter";
import { createPdfDocumentAdapter } from "./pdf-document.adapter";
import { createMovieAdapter } from "./movie.adapter";
import { withEnrichment, type EnrichOptions } from "../typed/enrich-media";
import { modelFor } from "../router/model-router";
import { createRecipeAdapter } from "./recipe.adapter";
import { createTextNoteAdapter } from "./text-note.adapter";
import { createTypedCaptureAdapter } from "./typed-capture.adapter";
import { createVoiceMemoAdapter } from "./voice-memo.adapter";
import { createVisionOcrAdapter } from "./vision-ocr.adapter";
import { createWebArticleAdapter } from "./web-article.adapter";
import {
  createYouTubeAdapter,
  type YouTubeAudioSource,
  type YouTubeDataSource,
} from "./youtube.adapter";

/** Priorities of the default registry (higher runs first). */
export const ADAPTER_PRIORITY = {
  youtube: 90,
  podcast: 85,
  // Other video/audio pages whose transcript the client sent (before recipe/article).
  "client-media": 82,
  // IMDb titles (films, series): before recipe/article so the page is read as a film.
  movie: 81,
  recipe: 80,
  // Typed capture (typeHint movie/book/product/place/receipt/snippet/inspiration) beats the
  // generic pages; voice memos beat the plain note.
  "typed-capture": 79,
  "voice-memo": 55,
  "social-short": 75,
  "x-twitter": 70,
  pinterest: 70,
  "pdf-document": 60,
  "epub-book": 60,
  "vision-ocr": 60,
  email: 60,
  "workspace-import": 60,
  // Meeting transcripts (typeHint "meeting" or a recognised transcript JSON) beat chat/notes.
  meeting: 65,
  "ai-chat": 20,
  "web-article": 10,
  "text-note": 0,
} as const;

export interface DefaultRegistryDeps {
  storage: StorageGateway;
  models: ModelRouter;
  fetch?: FetchLike;
  jinaApiKey?: string;
  firecrawlApiKey?: string;
  /** Keyless Jina Reader as the last try for blocked pages (default on, see WebArticleAdapterOptions). */
  keylessReader?: boolean;
  /** OMDB_API_KEY (optional): film enrichment by IMDb id. Without it a routed LLM proposes metadata. */
  omdbApiKey?: string;
  youtube?: {
    dataSource?: YouTubeDataSource;
    whisperFallback?: { audioSource: YouTubeAudioSource; transcriber: AudioTranscriber };
  };
  /** Byte-based speech-to-text (Groq Whisper) for Reels/TikTok audio. */
  audioTranscriber?: AudioTranscriber;
  /** Text for scanned PDFs (routed document_parsing). */
  documentParser?: DocumentParser;
  /** Downloads Reels/TikToks (audio + keyframes + caption). Default: not implemented. */
  socialMedia?: SocialMediaDownloader;
  podcast?: {
    podcastIndex?: PodcastIndexClient;
    transcriber?: UrlTranscriber;
    language?: string;
    beforeTranscribe?: PodcastAdapterOptions["beforeTranscribe"];
  };
  meeting?: { speakerNames?: SpeakerNames };
  /** KORTEX_INBOUND_MAIL_DOMAIN: the email adapter hides the user's private address. */
  inboundMailDomain?: string;
}

export function createDefaultRegistry(deps: DefaultRegistryDeps): IngestionRegistry {
  const r = new IngestionRegistry();
  const p = ADAPTER_PRIORITY;
  r.register(
    createYouTubeAdapter({
      fetch: deps.fetch,
      dataSource: deps.youtube?.dataSource,
      whisperFallback: deps.youtube?.whisperFallback,
      models: deps.models,
    }),
    { priority: p.youtube },
  );
  r.register(
    createPodcastAdapter({
      fetch: deps.fetch,
      models: deps.models,
      podcastIndex: deps.podcast?.podcastIndex,
      transcriber: deps.podcast?.transcriber,
      language: deps.podcast?.language,
      beforeTranscribe: deps.podcast?.beforeTranscribe,
    }),
    { priority: p.podcast },
  );
  r.register(createClientMediaAdapter({ models: deps.models }), { priority: p["client-media"] });
  r.register(
    createSocialShortAdapter({
      downloader: deps.socialMedia,
      fetch: deps.fetch,
      transcriber: deps.audioTranscriber,
      models: deps.models,
      storage: deps.storage,
    }),
    { priority: p["social-short"] },
  );
  r.register(
    createMeetingAdapter({ models: deps.models, speakerNames: deps.meeting?.speakerNames }),
    {
      priority: p.meeting,
    },
  );
  r.register(createAiChatAdapter({ models: deps.models }), { priority: p["ai-chat"] });
  // Optional enrichment (S16) for films and books; never fails the ingest.
  const enrich: EnrichOptions = {
    fetch: deps.fetch,
    omdbApiKey: deps.omdbApiKey,
    model: () => modelFor(deps.models, "auto_organize"),
  };
  r.register(
    withEnrichment(createTypedCaptureAdapter({ models: deps.models, storage: deps.storage }), enrich),
    { priority: p["typed-capture"] },
  );
  r.register(createVoiceMemoAdapter({ models: deps.models }), { priority: p["voice-memo"] });
  r.register(withEnrichment(createMovieAdapter({ fetch: deps.fetch }), enrich), {
    priority: p.movie,
  });
  r.register(createRecipeAdapter({ fetch: deps.fetch, models: deps.models }), {
    priority: p.recipe,
  });
  r.register(createXTwitterAdapter(), { priority: p["x-twitter"] });
  r.register(createPinterestAdapter(), { priority: p.pinterest });
  const pdfAdapter = createPdfDocumentAdapter({
    storage: deps.storage,
    documentParser: deps.documentParser,
    models: deps.models,
  });
  r.register(pdfAdapter, { priority: p["pdf-document"] });
  r.register(createEpubBookAdapter({ storage: deps.storage }), { priority: p["epub-book"] });
  r.register(createVisionOcrAdapter({ storage: deps.storage, models: deps.models }), {
    priority: p["vision-ocr"],
  });
  r.register(createEmailAdapter({ storage: deps.storage, inboundDomain: deps.inboundMailDomain }), { priority: p.email });
  r.register(createWorkspaceImportAdapter(), { priority: p["workspace-import"] });
  r.register(
    createWebArticleAdapter({
      fetch: deps.fetch,
      jinaApiKey: deps.jinaApiKey,
      firecrawlApiKey: deps.firecrawlApiKey,
      keylessReader: deps.keylessReader,
      documentAdapter: pdfAdapter,
      models: deps.models,
    }),
    { priority: p["web-article"] },
  );
  r.register(createTextNoteAdapter(), { priority: p["text-note"] });
  return r;
}

export * from "./base-adapter";
export * from "./web-article.adapter";
export * from "./youtube.adapter";
export * from "./pdf-document.adapter";
export * from "./epub-book.adapter";
export * from "./recipe.adapter";
export * from "./movie.adapter";
export * from "./typed-capture.adapter";
export * from "./voice-memo.adapter";
export * from "./vision-ocr.adapter";
export * from "./text-note.adapter";
export * from "./meeting.adapter";
export * from "./ai-chat.adapter";
export * from "./social-short.adapter";
export * from "./social-short.downloader";
export * from "./podcast.adapter";
export * from "./client-media.adapter";
export * from "./future/x-twitter.adapter";
export * from "./future/pinterest.adapter";
export * from "./email.adapter";
export * from "./future/workspace-import";
