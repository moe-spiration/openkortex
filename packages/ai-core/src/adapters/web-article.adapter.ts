import { ph } from "../i18n";
import { ExtractionError, errorMessage } from "../errors";
import { defaultFetch, requestJson, type FetchLike } from "../http";
import {
  describeEmbeddedImages,
  maxEmbeddedImages,
  type ImageCandidate,
} from "../media/embedded-images";
import { createSafeFetch, readBodyLimited } from "../net/safe-fetch";
import type { ModelRouter } from "../router/model-router";
import { readDirect, type DirectReadResult } from "./web/direct-reader";
import { linkTextRatio } from "./web/listing";
import { tidyClipMarkdown } from "./web/tidy";
import {
  isHttpUrl,
  type ExtractedPayload,
  type IngestionAdapter,
  type RawIngestInput,
} from "./base-adapter";

export const JINA_READER_URL = "https://r.jina.ai/";
export const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape";

/** Below this many characters an extraction is treated as failed (paywall, consent wall). */
const MIN_CONTENT_CHARS = 200;

export interface WebArticleAdapterOptions {
  fetch?: FetchLike;
  /** Jina Reader is only used with a key (keyless calls now answer 401). */
  jinaApiKey?: string;
  /** Firecrawl is only used with a key. */
  firecrawlApiKey?: string;
  timeoutMs?: number;
  /** Size cap for the keyless direct fetch. Default 5 MB. */
  directMaxBytes?: number;
  /** Vision (routed vision_ocr) for content images of the article. Without it: text only. */
  models?: ModelRouter;
  /** Cap for described images per clip (default: KORTEX_MAX_EMBEDDED_IMAGES, 5). */
  maxImages?: number;
}

const IMAGE_MIME = /^image\/(png|jpe?g|webp|gif)\b/i;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Smaller files are icons, tracking pixels and spacers. */
const MIN_IMAGE_BYTES = 8 * 1024;

/** Content images of a Markdown article: absolute http(s), no SVG, no duplicates, in reading order. */
export function contentImageUrls(markdown: string, exclude?: string): string[] {
  const out: string[] = [];
  for (const m of markdown.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const src = m[1]!;
    if (/\.svg(\?|$)/i.test(src) || src === exclude || out.includes(src)) continue;
    out.push(src);
  }
  return out;
}

interface JinaResponse {
  code?: number;
  data?: {
    title?: string;
    description?: string;
    url?: string;
    content?: string;
    publishedTime?: string;
    images?: Record<string, string>;
    metadata?: Record<string, string>;
  };
}

interface FirecrawlResponse {
  success?: boolean;
  error?: string;
  data?: {
    markdown?: string;
    metadata?: {
      title?: string;
      description?: string;
      ogImage?: string;
      sourceURL?: string;
      url?: string;
      publishedTime?: string;
      siteName?: string;
      ogSiteName?: string;
      language?: string;
      author?: string;
    };
  };
}

interface ArticleResult {
  extractor: "jina" | "firecrawl" | "direct" | "metadata" | "client" | "import";
  title?: string;
  description?: string;
  markdown: string;
  canonicalUrl?: string;
  coverImageUrl?: string;
  publishedTime?: string;
  siteName?: string;
  language?: string;
  author?: string;
}

/** Words per minute for the reading-time estimate (Doc 01 A2: "Lesezeit"). */
const WORDS_PER_MINUTE = 220;

export function readingMinutes(markdown: string): number {
  const words = markdown
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, " ")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** First content image (absolute http(s), no SVG) as the hero-cover fallback. */
export function firstImage(markdown: string): string | undefined {
  for (const m of markdown.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const src = m[1]!;
    if (!/\.svg(\?|$)/i.test(src)) return src;
  }
  return undefined;
}

export function createWebArticleAdapter(options: WebArticleAdapterOptions = {}): IngestionAdapter {
  const id = "web-article";
  const fetchFn = options.fetch ?? defaultFetch;
  const timeoutMs = options.timeoutMs ?? 45_000;

  async function viaJina(url: string): Promise<ArticleResult> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Return-Format": "markdown",
      "X-With-Generated-Alt": "true",
    };
    if (options.jinaApiKey) headers.Authorization = `Bearer ${options.jinaApiKey}`;
    const res = await requestJson<JinaResponse>(fetchFn, id, `${JINA_READER_URL}${url}`, {
      headers,
      timeoutMs,
    });
    const data = res.data ?? {};
    return {
      extractor: "jina",
      title: data.title,
      description: data.description,
      markdown: data.content ?? "",
      canonicalUrl: data.url,
      coverImageUrl: data.metadata?.["og:image"],
      publishedTime: data.publishedTime,
      siteName: data.metadata?.["og:site_name"],
      language: data.metadata?.lang,
      author: data.metadata?.author ?? data.metadata?.["article:author"],
    };
  }

  async function viaFirecrawl(url: string, apiKey: string): Promise<ArticleResult> {
    const res = await requestJson<FirecrawlResponse>(fetchFn, id, FIRECRAWL_SCRAPE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      timeoutMs,
    });
    if (res.success === false) throw new ExtractionError(id, `firecrawl: ${res.error ?? "failed"}`);
    const meta = res.data?.metadata ?? {};
    return {
      extractor: "firecrawl",
      title: meta.title,
      description: meta.description,
      markdown: res.data?.markdown ?? "",
      canonicalUrl: meta.url ?? meta.sourceURL,
      coverImageUrl: meta.ogImage,
      publishedTime: meta.publishedTime,
      siteName: meta.ogSiteName ?? meta.siteName,
      language: meta.language,
      author: meta.author,
    };
  }

  return {
    id,
    canHandle: (input: RawIngestInput) => isHttpUrl(input.url) && !input.fileBuffer,

    async extract(input: RawIngestInput): Promise<ExtractedPayload> {
      const url = input.url as string;
      const search = googleSearchQuery(url);
      if (search !== undefined) return googleSearchNote(url, search);
      const failures: string[] = [];
      /** Keeps only real content: bot, consent and error pages count as failures. */
      const usable = (r: { title?: string; markdown: string }, name: string): boolean => {
        const reason = blockedPageReason(r.title, r.markdown);
        if (reason) failures.push(`${name}: ${reason}`);
        return !reason;
      };
      let article: ArticleResult | undefined;
      let directMethod: string | undefined;
      let listingItems: number | undefined;
      let shortDirect: DirectReadResult | undefined;

      // Text the caller already has (import from another tool): no fetch at all.
      const given = input.pageContent;
      if (given && given.markdown.trim().length >= MIN_CONTENT_CHARS) {
        article = {
          extractor: "import",
          title: given.title?.trim() || undefined,
          markdown: given.markdown,
        };
      }

      // Order: Jina (with key) → Firecrawl (with key) → direct fetch + Readability (always).
      if (!article && options.jinaApiKey) {
        try {
          const r = await viaJina(url);
          if (!usable(r, "jina")) {
            // blocked: reason recorded
          } else if (r.markdown.trim().length >= MIN_CONTENT_CHARS) article = r;
          else failures.push("jina: content too short");
        } catch (err) {
          failures.push(errorMessage(err));
        }
      }

      if (!article && options.firecrawlApiKey) {
        try {
          const r = await viaFirecrawl(url, options.firecrawlApiKey);
          if (!usable(r, "firecrawl")) {
            // blocked: reason recorded
          } else if (r.markdown.trim().length > 0) article = r;
          else failures.push("firecrawl: empty content");
        } catch (err) {
          failures.push(errorMessage(err));
        }
      }

      // Jina/Firecrawl turn listing pages (front, category, index pages) into link soup. The direct
      // reader recognises the cards; when it says "listing", its clean list wins.
      if (article && article.extractor !== "import" && linkTextRatio(article.markdown) > 0.5) {
        try {
          const r = await readDirect(fetchFn, url, {
            timeoutMs: Math.min(timeoutMs, 20_000),
            maxBytes: options.directMaxBytes,
          });
          if (r.method === "listing" && !blockedPageReason(r.title, r.markdown)) {
            article = {
              ...r,
              author: r.byline,
              extractor: "direct",
              title: article.title ?? r.title,
              coverImageUrl: article.coverImageUrl ?? r.coverImageUrl,
            };
            directMethod = r.method;
            listingItems = r.listingItems;
          }
        } catch (err) {
          failures.push(`direct (listing check): ${errorMessage(err)}`);
        }
      }

      if (!article) {
        try {
          const r = await readDirect(fetchFn, url, {
            timeoutMs: Math.min(timeoutMs, 20_000),
            maxBytes: options.directMaxBytes,
          });
          if (!usable(r, "direct")) {
            // blocked: its metadata is the block page's, not the article's
          } else if (r.markdown.trim().length >= MIN_CONTENT_CHARS) {
            article = { ...r, author: r.byline, extractor: "direct" };
            directMethod = r.method;
            listingItems = r.listingItems;
            if (r.truncated) failures.push("direct: page larger than size cap, truncated");
          } else {
            failures.push("direct: content too short");
            shortDirect = r;
          }
        } catch (err) {
          failures.push(errorMessage(err));
        }
      }

      // Bot walls and app-like pages (IMDb, single-page sites): keep the page's own metadata
      // (OpenGraph + JSON-LD) as a short, usable item instead of failing.
      if (!article && shortDirect) {
        const md = metadataMarkdown(shortDirect);
        if (md) {
          article = { ...shortDirect, markdown: md, extractor: "metadata" };
          directMethod = "metadata";
        }
      }

      // Blocked (403, bot/consent wall): save what the client sent as a bookmark.
      if (!article) {
        const md = clientBookmarkMarkdown(url, input.clientHint);
        if (md) {
          const hint = input.clientHint ?? {};
          article = {
            extractor: "client",
            title: hint.title?.trim(),
            description: hint.description?.trim() || undefined,
            markdown: md,
            coverImageUrl: hint.imageUrl ?? undefined,
            siteName: hint.siteName ?? undefined,
          };
        }
      }

      if (!article) {
        throw new ExtractionError(id, `could not extract ${url} (${failures.join("; ")})`);
      }

      const host = new URL(url).hostname.replace(/^www\./, "");
      let contentMd = tidyClipMarkdown(cleanMarkdown(article.markdown));
      const isListingPage = directMethod === "listing";

      // Pictures that carry content (diagrams, charts, screenshots): a few go through vision.
      let imagesDescribed = 0;
      const imageWarnings: string[] = [];
      const maxImages = options.maxImages ?? maxEmbeddedImages();
      // Not for listing pages: their pictures are thumbnails of other articles.
      // Not for imports either: the imported text has no live images to describe.
      if (
        options.models &&
        maxImages > 0 &&
        article.extractor !== "client" &&
        article.extractor !== "import" &&
        !isListingPage
      ) {
        try {
          const safe = createSafeFetch({ fetch: fetchFn, timeoutMs: 10_000 });
          const urls = contentImageUrls(contentMd, article.coverImageUrl);
          const candidates: ImageCandidate[] = urls.map((src) => ({
            label: ph("imageInArticle"),
            weight: 0, // reading order
            load: async () => {
              const res = await safe(src, { headers: { Accept: "image/*" } });
              const mimeType = res.headers.get("content-type") ?? "";
              if (!res.ok || !IMAGE_MIME.test(mimeType)) return null;
              const bytes = await readBodyLimited(res, MAX_IMAGE_BYTES);
              return bytes && bytes.byteLength >= MIN_IMAGE_BYTES
                ? { bytes, mimeType: mimeType.split(";")[0]!.trim().toLowerCase() }
                : null;
            },
          }));
          const described = await describeEmbeddedImages(options.models, candidates, maxImages);
          imageWarnings.push(...described.warnings);
          imagesDescribed = described.described;
          if (described.md) contentMd = `${contentMd}\n\n${described.md}`;
        } catch (err) {
          imageWarnings.push(`images: ${errorMessage(err)}`);
        }
      }
      return {
        type: "article",
        sourcePlatform: "web",
        titleHint: article.title?.trim() || undefined,
        contentMd,
        // og:image first, else the article's first content image (Doc 01 A2: hero cover).
        coverImageUrl: article.coverImageUrl ?? firstImage(contentMd),
        sourceUrl: article.canonicalUrl ?? url,
        metadata: {
          site: article.siteName ?? host,
          domain: host,
          description: article.description ?? null,
          published_time: article.publishedTime ?? null,
          author: article.author?.trim() || null,
          reading_minutes: readingMinutes(contentMd),
          language: article.language ?? null,
          extractor: article.extractor,
          ...(directMethod ? { direct_method: directMethod } : {}),
          ...(isListingPage ? { page_kind: "listing", listing_items: listingItems ?? null } : {}),
          extraction_fallback_reasons: failures.length > 0 ? failures : undefined,
          ...(imagesDescribed ? { images_described: imagesDescribed } : {}),
          ...(imageWarnings.length ? { warnings: imageWarnings } : {}),
        },
      };
    },
  };
}

const BLOCK_TITLE =
  /access denied|zugriff verweigert|zugriffsfehler|zugriffsproblem|forbidden|attention required|just a moment|are you a robot|bist du ein mensch|captcha|unusual traffic|ungewöhnliche[rn]? (?:datenverkehr|zugriffe)|bevor sie zu google|before you continue|request blocked|error 40[13]|^40[13]\b|too many requests/i;
const BLOCK_BODY =
  /unusual traffic from your computer|ungewöhnlichen datenverkehr|consent\.google\.|consent\.youtube\.|g-recaptcha|hcaptcha|cf-chl-|enable javascript and cookies to continue|zustimmungs-dialog|cookies zustimmen|consent dialog could not|you don't have permission to access|reference #\d+\.[0-9a-f]+/i;

/** Why a fetched page is a bot, consent or error page instead of content; undefined if it looks real. */
export function blockedPageReason(title: string | undefined, body: string): string | undefined {
  if (title && BLOCK_TITLE.test(title)) return `blocked page ("${title.slice(0, 80)}")`;
  // Long real articles may quote these phrases; only short pages count by body.
  if (body.length < 5_000 && BLOCK_BODY.test(body)) return "blocked page (bot/consent wall)";
  return undefined;
}

/** `q` of a Google web search URL (google.de/search?q=…), else undefined. */
export function googleSearchQuery(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (!/(^|\.)google\.[a-z.]{2,6}$/i.test(u.hostname) || u.pathname !== "/search")
      return undefined;
    const q = u.searchParams.get("q")?.trim();
    return q || undefined;
  } catch {
    return undefined;
  }
}

function googleSearchNote(url: string, q: string): ExtractedPayload {
  return {
    type: "note",
    sourcePlatform: "web",
    titleHint: `${ph("googleSearch")}: ${q}`.slice(0, 200),
    contentMd: `# ${ph("googleSearch")}: ${q}\n\n[${q.replace(/[[\]]/g, "")}](${url})`,
    sourceUrl: url,
    metadata: { site: "Google", domain: "google.com", search_query: q, extractor: "google_search" },
  };
}

/** Bookmark from the client's share data; undefined without a usable title. */
export function clientBookmarkMarkdown(
  url: string,
  hint: RawIngestInput["clientHint"],
): string | undefined {
  const title = hint?.title?.trim();
  if (!title || title === url || blockedPageReason(title, "")) return undefined;
  const md = [`# ${title}`, ""];
  if (hint?.imageUrl) md.push(`![${title.replace(/[[\]]/g, "")}](${hint.imageUrl})`, "");
  const description = hint?.description?.trim();
  if (description) md.push(`> ${description}`, "");
  md.push(`[${hint?.siteName?.trim() || new URL(url).hostname.replace(/^www\./, "")}](${url})`);
  return md.join("\n");
}

/** Markdown from page metadata alone; undefined when there is not even a title and a description. */
export function metadataMarkdown(r: DirectReadResult): string | undefined {
  const title = r.title?.trim();
  const description = r.description?.trim();
  const facts = r.structured?.facts ?? [];
  if (!title || (!description && facts.length === 0)) return undefined;
  const md = [`# ${title}`, ""];
  if (r.coverImageUrl) md.push(`![${title.replace(/[[\]]/g, "")}](${r.coverImageUrl})`, "");
  if (description) md.push(description, "");
  if (facts.length) md.push(...facts.map((f) => `- **${f.label}:** ${f.value}`), "");
  const body = r.markdown.replace(/^#\s.*\n*/, "").trim();
  if (body && !description?.includes(body)) md.push(body, "");
  return md.join("\n");
}

/** Trim and collapse runs of blank lines; readers sometimes return 5+ in a row. */
export const cleanMarkdown = (md: string): string =>
  md
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
