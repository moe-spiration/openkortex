/** Mermaid, loaded lazily (only when a ```mermaid block is shown). */
type MermaidApi = typeof import("mermaid").default;
let loader: Promise<MermaidApi> | null = null;
let seq = 0;

const cssVar = (name: string, fallback: string): string => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

function configure(mermaid: MermaidApi, dark: boolean) {
  // securityLevel "strict": no scripts, no click handlers, labels are sanitized.
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: {
      darkMode: dark,
      background: cssVar("--bg-surface-muted", dark ? "#1b1b1f" : "#f4f4f5"),
      primaryColor: cssVar("--bg-surface-muted", dark ? "#26262b" : "#ececee"),
      primaryTextColor: cssVar("--text-primary", dark ? "#f4f4f5" : "#18181b"),
      primaryBorderColor: cssVar("--border-subtle", dark ? "#3f3f46" : "#d4d4d8"),
      lineColor: cssVar("--text-muted", dark ? "#a1a1aa" : "#71717a"),
      textColor: cssVar("--text-primary", dark ? "#f4f4f5" : "#18181b"),
      fontFamily: cssVar("--font-sans", "sans-serif"),
    },
  });
}

/** Renders mermaid source to an SVG string; rejects with the parser's message on a diagram error. */
export async function renderMermaid(source: string, dark: boolean): Promise<string> {
  loader ??= import("mermaid").then((m) => m.default);
  const mermaid = await loader;
  configure(mermaid, dark);
  const id = `kx-mermaid-${++seq}`;
  try {
    const { svg } = await mermaid.render(id, source);
    return svg;
  } finally {
    // Mermaid leaves a temp node behind when the render fails.
    document.getElementById(`d${id}`)?.remove();
  }
}

/** First line of an error for display (mermaid messages can carry a long stack). */
export const mermaidErrorText = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).split("\n").slice(0, 4).join("\n");
