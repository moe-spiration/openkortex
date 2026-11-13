import type { KortexPartialBlock } from "./markdown";

/*
 * Folded chapters for long entries (books, long articles): view state only. Every heading becomes a
 * toggle heading and the blocks of its section (up to the next heading of the same or a higher
 * level) become its children, so BlockNote hides them while the heading is closed. Markdown cannot
 * nest under headings: `blocksToMarkdown` writes the children back as following siblings, so the
 * stored Markdown stays byte-identical (sections.test.ts).
 *
 * Not folded: a table of contents heading (it stays open) and a single H1 (the document title).
 */

const TOC = /^(inhaltsverzeichnis|inhalt|table of contents|contents|toc)$/i;

const headingText = (b: KortexPartialBlock): string =>
  b.type === "heading"
    ? b.content.map((c) => ("text" in c && typeof c.text === "string" ? c.text : "")).join("").trim()
    : "";

type Heading = Extract<KortexPartialBlock, { type: "heading" }>;
type Foldable = Omit<Heading, "props"> & { props: Heading["props"] & { isToggleable?: boolean } };

export function nestSections(blocks: readonly KortexPartialBlock[]): KortexPartialBlock[] {
  const h1s = blocks.filter((b) => b.type === "heading" && b.props.level === 1).length;
  const out: KortexPartialBlock[] = [];
  const stack: { level: number; children: KortexPartialBlock[] }[] = [];
  const container = () => stack.at(-1)?.children ?? out;
  for (const b of blocks) {
    if (b.type !== "heading") {
      container().push(b);
      continue;
    }
    const level = b.props.level;
    while (stack.length && stack.at(-1)!.level >= level) stack.pop();
    const foldable = !TOC.test(headingText(b)) && !(level === 1 && h1s < 2);
    if (!foldable) {
      // A barrier: it stays a plain heading, the blocks after it belong to the enclosing section.
      container().push(b);
      continue;
    }
    const children: KortexPartialBlock[] = [...(b.children ?? [])];
    const folded: Foldable = { ...b, props: { ...b.props, isToggleable: true }, children };
    container().push(folded as KortexPartialBlock);
    stack.push({ level, children });
  }
  return out;
}

