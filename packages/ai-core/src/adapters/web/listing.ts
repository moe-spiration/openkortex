// Listing pages (news front pages, category/tag pages, blog indexes, link aggregators) are a set of
// cards: title link + teaser. Readability treats them as one article and either keeps only the
// intro, glues title and teaser into one link, or keeps the layout table. Here we read the cards
// themselves and write them as a clean Markdown list.

/** The slice of the DOM this module uses (linkedom's own types are too loose to check against). */
interface DomNode {
  nodeType: number;
  textContent: string | null;
}
interface El extends DomNode {
  childNodes: ArrayLike<DomNode>;
  parentElement: El | null;
  getAttribute(name: string): string | null;
  matches(selector: string): boolean;
  closest(selector: string): El | null;
  querySelector(selector: string): El | null;
  querySelectorAll(selector: string): ArrayLike<El>;
  remove(): void;
}
export interface ListingDoc {
  body: El | null;
  querySelector(selector: string): El | null;
}

export interface ListingItem {
  title: string;
  url: string;
  teaser?: string;
}

/** Fewer cards than this is a page with some links, not a listing. */
export const MIN_LISTING_ITEMS = 6;
const MAX_ITEMS = 120;
const MAX_TEASER = 280;

/** Regions that hold navigation, chrome, consent and ads, never cards. */
const CHROME =
  "script, style, noscript, template, svg, iframe, form, nav, aside, dialog, [role=navigation], [role=banner], [role=contentinfo], [role=dialog], [aria-hidden=true], [hidden]";
/** Class or id tokens (start of token) that mark chrome. Tokens, not substrings: "card-header" is content. */
const CHROME_TOKEN =
  /^(cookie|consent|cmp[-_]|gdpr|newsletter|paywall|advert|anzeige|sponsor|breadcrumb|pagination|pager|social|share[-_]|sharing|navbar|site[-_]?(nav|header|footer)|(ad|ads)$)/i;
/** A card that labels itself as an ad. */
const AD_LABEL = /^(anzeige|werbung|eigenwerbung|sponsored|gesponsert|advertisement|promoted|partnerinhalt)$/i;

/** Link texts that are actions, not titles. */
const ACTION =
  /^(mehr|weiter(lesen)?|read more|more|alle\b.*|zur übersicht|zum artikel|jetzt\b.*|hier\b.*|login|anmelden|registrieren|abonnieren|subscribe|sign in|log in|teilen|share|kommentare?|comments?|\d+\s+(comments?|kommentare?|points?))$/i;
/** Relative times and dates ("11 hours ago", "vor 3 Stunden", "5. Nov. 2026") are metadata. */
const DATE_LIKE =
  /^(vor\s+)?(\d+|ein(e|em|er)?|an?)\s+(sec|second|min|minute|hour|stunde|day|tag|week|woche|month|monat|year|jahr)\w*(\s+ago)?$|^[\d.\s/:-]+\w{0,5}\.?\s*[\d\s:]*$|^\d{1,2}(st|nd|rd|th|\.)?\s+\p{L}{3,9}\.?\s+\d{4}\b[\d\s,:.apm]*$/iu;
const SKIP_HOST =
  /(^|\.)(facebook|twitter|x|linkedin|instagram|whatsapp|pinterest|reddit|t\.me|telegram|xing|mastodon\.social|threads)\.(com|net|org|me|de)$/i;

const squash = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const words = (s: string) => s.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

function keyOf(href: string): string | undefined {
  try {
    const u = new URL(href);
    if (!/^https?:$/.test(u.protocol)) return undefined;
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/** Text of an element with spaces between block children (textContent glues "Title" + "Teaser"). */
function blockText(el: El): string {
  const parts: string[] = [];
  const walk = (n: El) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 3) parts.push(c.textContent ?? "");
      else if (c.nodeType === 1) {
        const e = c as El;
        if (e.matches("script, style, svg, noscript, template")) continue;
        parts.push(" ");
        walk(e);
        parts.push(" ");
      }
    }
  };
  walk(el);
  return squash(parts.join(""));
}

function isChrome(el: El): boolean {
  for (let n: El | null = el; n; n = n.parentElement) {
    const tokens = `${n.getAttribute("class") ?? ""} ${n.getAttribute("id") ?? ""}`.split(/\s+/);
    if (tokens.some((t) => t && CHROME_TOKEN.test(t))) return true;
  }
  return false;
}

/** Heading text; "Kicker: Headline" when the heading is built from two parts (kicker span + headline span). */
function headingText(h: El): string {
  let node = h;
  for (;;) {
    const kids = Array.from(node.childNodes);
    const elems = kids.filter((k) => k.nodeType === 1 && blockText(k as El)) as El[];
    const loose = kids.some((k) => k.nodeType === 3 && squash(k.textContent));
    if (loose) break;
    if (elems.length === 1) {
      node = elems[0]!;
      continue;
    }
    const parts = elems.map(blockText);
    if (parts.length === 2 && !/[:.!?]$/.test(parts[0]!) && parts[0]!.length < 80)
      return `${parts[0]}: ${parts[1]}`;
    break;
  }
  return blockText(h);
}

/** A link inside running text ("… that [appeared to give] …") is a reference, not a card. */
function isInline(a: El, text: string): boolean {
  const block = a.closest("p, li, td, dd, blockquote, figcaption");
  if (!block) return false;
  return blockText(block).length > text.length * 1.5 + 20;
}

/** Title of a card link: a heading inside the link, the heading around it, else its own text. */
function titleOf(a: El): { title: string; fromHeading: boolean } | undefined {
  const inner = a.querySelector("h1, h2, h3, h4, h5, h6");
  const outer = a.closest("h1, h2, h3, h4, h5, h6");
  const heading = inner
    ? headingText(inner)
    : outer
      ? blockText(outer) === blockText(a)
        ? headingText(outer)
        : blockText(a)
      : "";
  if (heading) return { title: heading, fromHeading: true };
  const own = blockText(a) || squash(a.getAttribute("title")) || squash(a.getAttribute("aria-label"));
  if (!own || isInline(a, own)) return undefined;
  return { title: own, fromHeading: false };
}

interface Candidate extends ListingItem {
  anchors: El[];
  fromHeading: boolean;
}

/** Card items of a listing page in reading order (empty when the page has no such cards). */
export function extractListingItems(doc: ListingDoc, pageUrl: string): ListingItem[] {
  const root = doc.querySelector("main, [role=main]") ?? doc.body;
  if (!root) return [];
  for (const el of Array.from(root.querySelectorAll(CHROME))) el.remove();
  // Page header/footer are chrome; a card's own <header> (kicker + headline) is content.
  for (const el of Array.from(root.querySelectorAll("header, footer")))
    if (!el.parentElement?.closest("article, li")) el.remove();
  const self = keyOf(pageUrl);
  const pageHost = hostOf(pageUrl);
  const byKey = new Map<string, Candidate>();

  for (const a of Array.from(root.querySelectorAll("a[href]"))) {
    const key = keyOf(a.getAttribute("href") ?? "");
    if (!key || key === self) continue;
    const target = new URL(key);
    if (SKIP_HOST.test(target.hostname)) continue;
    // The site's own home link (logo, "Zur Startseite") is never a card.
    if (target.pathname === "/" && !target.search && target.hostname === pageHost) continue;
    if (isChrome(a)) continue;
    const t = titleOf(a);
    if (!t) continue;
    const title = t.title.slice(0, 300);
    const good =
      !ACTION.test(title) &&
      !DATE_LIKE.test(title) &&
      title.length >= 12 &&
      (t.fromHeading ? words(title) >= 2 : words(title) >= 3);
    const prev = byKey.get(key);
    if (prev) {
      prev.anchors.push(a);
      // A heading beats a plain link text; a shorter text beats "title + teaser" glued together.
      if (good && ((t.fromHeading && !prev.fromHeading) || (!prev.title && good))) {
        prev.title = title;
        prev.fromHeading = t.fromHeading;
      }
      continue;
    }
    byKey.set(key, { url: key, title: good ? title : "", anchors: [a], fromHeading: t.fromHeading });
  }

  const items = [...byKey.values()].filter((c) => c.title);
  const owner = new Map<El, Candidate>();
  for (const c of items) for (const a of c.anchors) owner.set(a, c);

  const out: ListingItem[] = [];
  for (const c of items) {
    const card = cardOf(c, owner);
    if (Array.from(card.querySelectorAll("*")).some((e) => AD_LABEL.test(squash(e.textContent))))
      continue;
    out.push({ title: tidyTitle(c.title), url: c.url, teaser: teaserOf(c, card) });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** The card is the largest ancestor (a few levels up) that holds no other item's link. */
function cardOf(c: Candidate, owner: Map<El, Candidate>): El {
  const first = c.anchors[0]!;
  let card: El = first;
  for (let n = first.parentElement, depth = 0; n && depth < 6; n = n.parentElement, depth++) {
    const foreign = Array.from(n.querySelectorAll("a[href]")).some((a) => {
      const o = owner.get(a);
      return o !== undefined && o !== c;
    });
    if (foreign) break;
    card = n;
  }
  return card;
}

/** First paragraph of the card that is not the title; else what the card link holds after the title. */
function teaserOf(c: Candidate, card: El): string | undefined {
  const first = c.anchors[0]!;
  const title = c.title.toLowerCase();
  const pick = (text: string) => {
    let t = squash(text);
    if (t.toLowerCase().startsWith(title)) t = t.slice(title.length).trim();
    return t.length >= 30 && !title.includes(t.toLowerCase()) ? t : undefined;
  };
  const blocks = [
    ...Array.from(card.querySelectorAll("p")),
    ...Array.from(card.querySelectorAll("[class*=excerpt], [class*=summary], [class*=synopsis], [class*=dek]")),
  ].filter((el) => !el.matches("a") && !el.querySelector("a, h1, h2, h3, h4, h5, h6"));
  for (const el of blocks) {
    const t = pick(blockText(el));
    if (t) return clip(t);
  }
  // Card that is one big link: whatever is left after the title.
  const rest = pick(blockText(first));
  return rest ? clip(rest) : undefined;
}

const clip = (s: string) => (s.length > MAX_TEASER ? `${s.slice(0, MAX_TEASER - 1).trimEnd()}…` : s);
const tidyTitle = (s: string) => clip(s.replace(/^[\s|·•–—-]+|[\s|·•–—-]+$/g, ""));
const escapeText = (s: string) => s.replace(/([[\]])/g, "\\$1");

/** Markdown for a listing: page title, description, then one bullet per card. */
export function listingMarkdown(
  items: readonly ListingItem[],
  { title, description }: { title?: string; description?: string } = {},
): string {
  const md: string[] = [];
  if (title) md.push(`# ${title}`, "");
  if (description) md.push(description, "");
  for (const it of items) {
    md.push(`- [${escapeText(it.title)}](${it.url})`);
    if (it.teaser) md.push(`  ${it.teaser}`);
  }
  return md.join("\n").trim();
}

/** Share of visible Markdown text that sits inside links (0..1). */
export function linkTextRatio(markdown: string): number {
  const text = markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  const total = text.replace(/\]\([^)]*\)/g, "]").replace(/[#*_>`|\-\s[\]]/g, "").length;
  if (total === 0) return 0;
  let linked = 0;
  for (const m of text.matchAll(/\[([^\]]*)\]\([^)]*\)/g)) linked += m[1]!.replace(/[\s*_[\]]/g, "").length;
  return Math.min(1, linked / total);
}

/** Markdown text outside of links, images and syntax, in characters. */
export function proseChars(markdown: string): number {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/^#.*$/gm, "")
    .replace(/[#*_>`|\-\s]/g, "").length;
}

/**
 * True when the cards carry the page, not the article text Readability found: many cards, and the
 * extracted Markdown is mostly links, or misses most card titles while it either holds less prose
 * than the cards or is made of the cards' teasers (Readability kept the teasers, dropped the titles).
 */
export function isListing(items: readonly ListingItem[], markdown: string): boolean {
  if (items.length < MIN_LISTING_ITEMS) return false;
  if (linkTextRatio(markdown) > 0.5) return true;
  const lower = squash(markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\\([[\]])/g, "$1")).toLowerCase();
  const has = (s: string) => lower.includes(s.toLowerCase().slice(0, 40));
  const missing = items.filter((it) => !has(it.title)).length;
  if (missing / items.length <= 0.5) return false;
  const cardChars = items.reduce((n, it) => n + it.title.length + (it.teaser?.length ?? 0), 0);
  if (cardChars > proseChars(markdown) * 1.5) return true;
  const teased = items.filter((it) => it.teaser);
  return teased.length >= MIN_LISTING_ITEMS && teased.filter((it) => has(it.teaser!)).length / teased.length > 0.5;
}
