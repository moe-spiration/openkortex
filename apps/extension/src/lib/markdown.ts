// HTML -> clean Markdown for chat exports (ChatGPT / Claude render answers as HTML).
// Input is an HTML string (not a live node) so behaviour is identical in the browser and in tests.
import TurndownService from "turndown";

export interface MarkdownOptions {
  /** Shift every heading down by this many levels (capped at h6) so `### User/Assistant` stays the top structure. */
  headingOffset?: number;
}

const DROP = "button, svg, style, script, noscript, template, textarea, input, select, [data-kortex-ignore]";

const fenceFor = (code: string) => {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((m) => m.length));
  return "`".repeat(Math.max(3, longest + 1));
};

function languageOf(pre: Element, code: Element | null): string {
  const classes = `${code?.getAttribute("class") ?? ""} ${pre.getAttribute("class") ?? ""}`;
  const m = /(?:language|lang)-([\w+#.-]+)/.exec(classes);
  if (m?.[1] && m[1] !== "plaintext" && m[1] !== "text") return m[1];
  const attr = code?.getAttribute("data-language") ?? pre.getAttribute("data-language");
  return attr && attr !== "plaintext" ? attr : "";
}

function createService(opts: MarkdownOptions): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
    hr: "---",
    linkStyle: "inlined",
  });

  td.remove((node) => node.nodeType === 1 && (node as Element).matches(DROP));

  // Fenced code blocks: language from the class, UI chrome (copy buttons, language labels) ignored.
  td.addRule("kortexFence", {
    filter: (node) => node.nodeName === "PRE",
    replacement: (_content, node) => {
      const pre = node as Element;
      const code = pre.querySelector("code");
      const text = (code ?? pre).textContent?.replace(/\n+$/, "") ?? "";
      const fence = fenceFor(text);
      return `\n\n${fence}${languageOf(pre, code)}\n${text}\n${fence}\n\n`;
    },
  });

  // KaTeX / MathJax: keep the TeX source instead of the duplicated glyph soup.
  td.addRule("kortexMath", {
    filter: (node) => node.nodeType === 1 && (node as Element).classList.contains("katex"),
    replacement: (_content, node) => {
      const el = node as Element;
      const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
      if (!tex) return el.textContent ?? "";
      return el.closest(".katex-display") ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
    },
  });
  td.remove((node) => node.nodeType === 1 && (node as Element).classList.contains("katex-html"));

  // "- item" / "1. item" instead of turndown's default three-space marker padding.
  td.addRule("kortexListItem", {
    filter: "li",
    replacement: (content, node, options) => {
      const parent = node.parentNode as Element | null;
      let prefix = `${options.bulletListMarker} `;
      if (parent?.nodeName === "OL") {
        const start = Number(parent.getAttribute("start") ?? 1);
        prefix = `${start + Array.from(parent.children).indexOf(node as Element)}. `;
      }
      const body = content
        .replace(/^\n+/, "")
        .replace(/\n+$/, "\n")
        .replace(/\n/g, `\n${" ".repeat(prefix.length)}`);
      return prefix + body + (node.nextSibling && !/\n$/.test(body) ? "\n" : "");
    },
  });

  td.addRule("kortexTable", {
    filter: "table",
    replacement: (_content, node) => {
      // Array.from: domino (Node-side parser) NodeLists are array-likes without an iterator.
      const rows = Array.from((node as Element).querySelectorAll("tr")).map((tr) =>
        Array.from(tr.querySelectorAll("th, td")).map((cell) =>
          td
            .turndown(cell.innerHTML)
            .replace(/\|/g, "\\|")
            .replace(/\s*\n+\s*/g, " ")
            .trim(),
        ),
      );
      const [head, ...body] = rows;
      if (!head || head.length === 0) return "";
      const line = (cells: string[]) => `| ${head.map((_, i) => cells[i] ?? "").join(" | ")} |`;
      const sep = `| ${head.map(() => "---").join(" | ")} |`;
      return `\n\n${[line(head), sep, ...body.map(line)].join("\n")}\n\n`;
    },
  });

  const offset = opts.headingOffset ?? 0;
  if (offset > 0) {
    td.addRule("kortexHeading", {
      filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
      replacement: (content, node) => {
        const level = Math.min(6, Number(node.nodeName[1]) + offset);
        return `\n\n${"#".repeat(level)} ${content.trim()}\n\n`;
      },
    });
  }
  return td;
}

export function htmlToMarkdown(html: string, opts: MarkdownOptions = {}): string {
  return createService(opts)
    .turndown(html)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
