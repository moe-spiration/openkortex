import { Fragment, type ReactNode } from "react";

/*
 * Read-only rendering of canonical content_md in the prototype's editor classes (kx-ed-*).
 * Used as the server-rendered first paint while the BlockNote editor loads on the client,
 * so the sheet doesn't jump. Covers the block types the mock notes use; the editor takes over
 * for everything else.
 */

/** Body text in the read style (UI spec W7: 15/400/1.7 in Text 2), the same as the editor (editor.css). */
const READ = { color: "var(--text-secondary)", lineHeight: 1.7 } as const;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[\[[^\]]+\]\]|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k++} className="kx-inline-code">{t.slice(1, -1)}</code>);
    else if (t.startsWith("[[")) {
      const [title, alias] = t.slice(2, -2).split("|");
      out.push(
        <span key={k++} className="kx-wikilink" style={{ color: "var(--tag-ai-fg)" }}>
          <span className="kx-mono" style={{ opacity: 0.6 }}>[[</span>
          {alias ?? title}
          <span className="kx-mono" style={{ opacity: 0.6 }}>]]</span>
        </span>,
      );
    } else out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function MarkdownStatic({ markdown }: { markdown: string }) {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "");
  const blocks = body.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (/^#{1,3} /.test(b)) {
          const level = b.match(/^#+/)![0].length;
          const text = b.replace(/^#+ /, "");
          return level === 3 ? <h3 key={i} className="kx-ed-h3">{inline(text)}</h3> : <h2 key={i} className="kx-ed-h2">{inline(text)}</h2>;
        }
        if (lines.every((l) => /^- \[[ x]\] /.test(l)))
          return (
            <Fragment key={i}>
              {lines.map((l, j) => {
                const done = l.startsWith("- [x]");
                return (
                  <div key={j} className="kx-block">
                    <label className={"kx-ed-todo" + (done ? " is-done" : "")} style={READ}>
                      <input type="checkbox" className="kx-check" checked={done} readOnly aria-label={l.slice(6)} />
                      <span>{inline(l.slice(6))}</span>
                    </label>
                  </div>
                );
              })}
            </Fragment>
          );
        if (lines.every((l) => /^- /.test(l)))
          return (
            <ul key={i} className="kx-ed-ul" style={READ}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.slice(2))}</li>
              ))}
            </ul>
          );
        if (lines.every((l) => l.startsWith(">")))
          return (
            <blockquote key={i} className="kx-ed-quote">
              {inline(lines.map((l) => l.replace(/^> ?/, "")).join(" "))}
            </blockquote>
          );
        return (
          <div key={i} className="kx-block">
            <p className="kx-ed-p" style={READ}>{inline(lines.join(" "))}</p>
          </div>
        );
      })}
    </>
  );
}
