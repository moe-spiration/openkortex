import { createReactBlockSpec } from "@blocknote/react";
import { t, tx } from "@kortex/i18n";
import { Check, Code, Copy, Eye } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { mermaidErrorText, renderMermaid } from "./mermaid";

const ico = { className: "kx-ico kx-ico--sm", "aria-hidden": true } as const;

/** Plain text of a code block's content (inline runs joined). */
export function blockText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content.map((c) => (typeof c?.text === "string" ? c.text : "")).join("");
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ getText }: { getText: () => string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(async () => {
    setState((await copyText(getText())) ? "done" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1600);
  }, [getText]);
  const label = state === "done" ? t("Copied") : state === "failed" ? t("Copy failed") : t("Copy code");
  return (
    <button
      type="button"
      className="kxb kx-ed-code-btn"
      aria-label={label}
      title={label}
      data-state={state}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => void copy()}
    >
      {state === "done" ? <Check {...ico} /> : <Copy {...ico} />}
      <span className="kx-ed-code-btn-text" aria-live="polite">
        {state === "idle" ? "" : label}
      </span>
    </button>
  );
}

const readDark = () => document.documentElement.dataset.theme !== "light";

function useIsDark(): boolean {
  const [dark, setDark] = useState(readDark);
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(readDark()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    setDark(readDark());
    return () => obs.disconnect();
  }, []);
  return dark;
}

/** Rendered diagram of a ```mermaid block; a diagram error shows the message instead of crashing. */
function MermaidPreview({ source }: { source: string }) {
  const dark = useIsDark();
  const [result, setResult] = useState<{ svg?: string; error?: string } | null>(null);
  useEffect(() => {
    if (!source.trim()) {
      setResult({ error: t("Empty diagram") });
      return;
    }
    let live = true;
    // Debounce: the source can change by typing in another tab or an AI edit.
    const timer = setTimeout(() => {
      renderMermaid(source, dark).then(
        (svg) => live && setResult({ svg }),
        (err) => live && setResult({ error: mermaidErrorText(err) }),
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [source, dark]);
  if (!result) return <div className="kx-ed-mermaid-state">{t("Rendering diagram …")}</div>;
  if (result.error !== undefined) {
    return (
      <div className="kx-ed-mermaid-error" role="alert">
        <strong>{t("Diagram error")}</strong>
        <pre>{result.error}</pre>
      </div>
    );
  }
  // SVG comes from mermaid with securityLevel "strict" (sanitized).
  return <div className="kx-ed-mermaid-svg" dangerouslySetInnerHTML={{ __html: result.svg ?? "" }} />;
}

/**
 * Code block: header with the language label and a copy button. ```mermaid additionally gets a
 * source/preview switch; the Markdown stays a plain fence (the source is the storage).
 */
export const CodeBlock = createReactBlockSpec(
  {
    type: "codeBlock",
    propSchema: { language: { default: "text" }, meta: { default: "" } },
    content: "plain",
  },
  {
    meta: { code: true, defining: true, isolating: false },
    experimental_keyboard: { enter: "line-break" },
    render: function CodeBlockView({ block, contentRef, editor }) {
      const language = block.props.language;
      const isMermaid = language.toLowerCase() === "mermaid";
      const [mode, setMode] = useState<"preview" | "source">("preview");
      const preview = isMermaid && mode === "preview";
      const getText = useCallback(
        () => blockText(editor.getBlock(block.id)?.content ?? block.content),
        [editor, block],
      );
      return (
        <div className="kx-ed-code" data-mermaid={isMermaid || undefined} data-preview={preview || undefined}>
          <div className="kx-ed-code-head" contentEditable={false}>
            <span className="kx-ed-code-lang" title={block.props.meta || undefined}>
              {language}
            </span>
            {isMermaid ? (
              <button
                type="button"
                className="kxb kx-ed-code-btn"
                aria-pressed={preview}
                aria-label={preview ? t("Show source") : t("Show preview")}
                title={preview ? t("Show source") : t("Show preview")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setMode(preview ? "source" : "preview")}
              >
                {preview ? <Code {...ico} /> : <Eye {...ico} />}
                <span className="kx-ed-code-btn-text">{preview ? tx("code", "Source") : t("Preview")}</span>
              </button>
            ) : null}
            <CopyButton getText={getText} />
          </div>
          {preview ? (
            <div className="kx-ed-mermaid" contentEditable={false}>
              <MermaidPreview source={blockText(block.content)} />
            </div>
          ) : null}
          {/* Stays mounted (hidden in preview) so ProseMirror keeps its content node. */}
          <pre className="kx-ed-code-pre" hidden={preview}>
            <code ref={contentRef} />
          </pre>
        </div>
      );
    },
  },
);
