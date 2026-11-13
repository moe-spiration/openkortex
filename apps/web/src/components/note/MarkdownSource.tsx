"use client";

import { t } from "@/i18n";
import type { KnowledgeItem } from "@/lib/workspace-data";
import { markdownSource } from "@/lib/notes/md-source";
import { NIco } from "./icons";

/*
 * "Markdown-Quelle" (decision 4): the raw vault file, read-only. Frontmatter from the item's metadata, then content_md
 * verbatim; the H1 and TL;DR the view hides are marked, with a note that the view only hides them.
 */
export function MarkdownSource({ item }: { item: KnowledgeItem }) {
  const src = markdownSource(item);
  return (
    <div className="kx-dr-in kx-md-src-wrap">
      <div className="kx-dr-src">
        <span className="tc-glyph tc-glyph--sm">
          <NIco name="file-code" size={11} />
        </span>
        <span className="kx-mono kx-truncate">{src.path}</span>
        <span className="kx-meta" style={{ marginLeft: "auto", flex: "none" }}>
          {t("Raw file in the vault")}
        </span>
      </div>
      <pre className="kx-md-src" aria-label={t("Markdown source")} tabIndex={0}>
        <span className="kx-md-fm">{src.frontmatter}</span>
        {"\n\n"}
        {src.marked && <mark className="kx-md-hl">{src.marked.replace(/\s+$/, "")}</mark>}
        {src.marked && "\n\n"}
        {src.rest}
      </pre>
      <p className="kx-md-note">
        <NIco name="info" size={12} />
        {src.marked
          ? t("Highlighted: title and TL;DR are fully in the file. The view only hides them because they are already shown in the header above.")
          : t("The view only hides a title or TL;DR at the start; they stay fully in the file.")}
      </p>
    </div>
  );
}
