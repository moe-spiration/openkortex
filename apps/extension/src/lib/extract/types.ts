import type { PageMeta } from "../page-meta";

/** Everything an extractor may look at. `fetchText` is injectable so tests never touch the network. */
export interface ExtractContext {
  doc: Document;
  /** The page address (the tab's URL, not the canonical one). */
  url: string;
  fetchText: (url: string) => Promise<string>;
}

/** What a site extractor adds on top of the generic metadata; first cover candidates win. */
export type Extracted = Partial<
  Pick<PageMeta, "title" | "description" | "site_name" | "media" | "transcript" | "keywords" | "reading_minutes">
> & {
  /** Best first. Relative URLs are resolved against the page; non-http(s) ones are dropped. */
  images?: string[];
  notes?: string[];
};

export interface Extractor {
  id: string;
  matches(url: URL): boolean;
  extract(ctx: ExtractContext): Promise<Extracted> | Extracted;
}
