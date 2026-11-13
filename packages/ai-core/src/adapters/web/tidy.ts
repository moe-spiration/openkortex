// Last cleanup of clipped web Markdown, whatever the extractor (Jina, Firecrawl, direct). Only removes
// things that are never content: placeholders, empty links, ad labels, consent leftovers, repeats.

/** Lines that are only a label of the page chrome. */
const LABEL_LINE =
  /^(anzeige|werbung|eigenwerbung|advertisement|sponsored|gesponsert|promoted|partnerinhalt|diesen inhalt immer laden|externen inhalt laden|inhalt laden|zum newsticker|weiterlesen|mehr lesen|read more|suchen|search|menü|menu|teilen|share|__proto_\w+__|\\_\\_proto\\_\w+\\_\\_)$/i;

/** Image whose source is a placeholder, a data URI or an icon sprite: nothing to show outside the page. */
const DEAD_IMAGE = /!\[[^\]]*\]\((?:<[^>]*>|data:[^)]*|[^)\s]*\.svg(?:[?#][^)\s]*)?)(?:\s+"[^"]*")?\)[ \t]?/gi;

export function tidyClipMarkdown(md: string): string {
  let out = md.replace(/\r\n/g, "\n");
  out = out.replace(DEAD_IMAGE, "");
  // Hard line breaks inside link text ("[![img]\\\nTeaser](url)") become a space.
  out = out.replace(/\\\\?\n(?=[^\n])/g, (m, offset: number) => {
    const before = out.lastIndexOf("[", offset);
    const close = out.lastIndexOf("]", offset);
    return before > close ? " " : m;
  });
  out = out.replace(/\[[ \t]+(?=[^\]\s])/g, "[");
  // Links without text ("[](url)") and image links that lost their image.
  out = out.replace(/(^|[^!])\[\s*\]\([^)]*\)/g, "$1");
  out = out
    .split("\n")
    .filter((line) => !LABEL_LINE.test(line.replace(/^[-*>\s]+/, "").trim()))
    .join("\n");
  // Separator runs (Firecrawl writes "* * *" between every card).
  out = out.replace(/^(?:[ \t]*(?:\* \* \*|---|___)[ \t]*\n+){2,}/gm, "---\n\n");
  out = dedupeParagraphs(out);
  return out
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^(?:\s*(?:\* \* \*|---)\s*\n)+/, "")
    .trim();
}

/** Drops a paragraph that repeats the one before it (responsive pages render teasers twice). */
function dedupeParagraphs(md: string): string {
  const paras = md.split(/\n{2,}/);
  const out: string[] = [];
  let inFence = false;
  for (const p of paras) {
    const fences = (p.match(/^```/gm) ?? []).length;
    const norm = p.replace(/\s+/g, " ").trim();
    const prev = out.length ? out[out.length - 1]!.replace(/\s+/g, " ").trim() : undefined;
    if (!inFence && norm.length > 20 && norm === prev) continue;
    out.push(p);
    if (fences % 2 === 1) inFence = !inFence;
  }
  return out.join("\n\n");
}
