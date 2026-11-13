"use client";

import { t, tn } from "@/i18n";
import { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { useNotes } from "@/lib/notes/store";
import { useShell } from "@/lib/shell/store";
import { optionLabel, typedFieldsOf, typedInput, type TypedField } from "@/lib/typed/fields";
import { promptVariables, sessionTabs } from "@/lib/typed/views";
import type { KnowledgeItem } from "@/lib/workspace-data";

/*
 * Note view panels of the typed items (type registry): the property section (metadata.status, rating, feedback and
 * the type's own fields such as isbn or imdb_id), the prompt view (copy + {{variablen}}) and the session view
 * (tab list, "Alle öffnen"). Fields save one at a time through the notes store (setField → setMetadataField), which
 * changes only that key.
 */

function FieldControl({ item, field }: { item: KnowledgeItem; field: TypedField }) {
  const { setField } = useNotes();
  const stored = typedInput(field, item.metadata[field.key]);
  const [draft, setDraft] = useState(stored);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState(stored);
  // The stored value changed elsewhere (Copilot status, a refresh): show it.
  if (seen !== stored) {
    setSeen(stored);
    setDraft(stored);
  }
  const save = (value: string) => {
    if (value === stored) return setError(null);
    setError(setField(item.id, field.key, value));
  };
  const id = `tf-${item.id}-${field.key}`;
  let control;
  if (field.kind === "enum") {
    control = (
      <span className="kx-control kx-control--sm">
        <select id={id} value={draft} onChange={(e) => (setDraft(e.target.value), save(e.target.value))}>
          <option value="">–</option>
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {optionLabel(o)}
            </option>
          ))}
        </select>
      </span>
    );
  } else if (field.kind === "longtext") {
    control = (
      <span className="kx-control kx-control--area">
        <textarea id={id} value={draft} rows={2} style={{ minHeight: 44 }} onChange={(e) => setDraft(e.target.value)} onBlur={() => save(draft)} />
      </span>
    );
  } else {
    control = (
      <span className={"kx-control kx-control--sm" + (error ? " is-invalid" : "")}>
        <input
          id={id}
          type={field.kind === "date" ? "date" : "text"}
          inputMode={field.kind === "number" ? "decimal" : undefined}
          placeholder={field.kind === "list" ? t("Comma-separated") : undefined}
          value={draft}
          aria-invalid={!!error}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => save(draft)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </span>
    );
  }
  return (
    <div className="kx-field" style={{ display: "grid", gap: 4, gridColumn: field.kind === "longtext" ? "1 / -1" : undefined }}>
      <label className="kx-label" htmlFor={id}>
        {field.label}
      </label>
      {control}
      {error && <span className="kx-help kx-help--error">{error}</span>}
    </div>
  );
}

/** Reading types (books, documents) and long entries open on the content: their Eigenschaften start folded. */
const FOLDED_PROPS_TYPES = new Set(["book", "epub", "pdf"]);
export const propsOpenByDefault = (item: Pick<KnowledgeItem, "dbType" | "type" | "contentMd">) =>
  !(FOLDED_PROPS_TYPES.has(item.dbType ?? "") || item.type === "book" || item.contentMd.length > 12_000);

/** Eigenschaften of a typed item; nothing for free types and domain objects. */
export function TypedProperties({ item, bare = false }: { item: KnowledgeItem; bare?: boolean }) {
  const [open, setOpen] = useState(() => propsOpenByDefault(item));
  const fields = typedFieldsOf(item.dbType);
  if (!fields.length) return null;
  // Feinschliff Live: inside the note head's "Eigenschaft" panel the fields show without their own fold button.
  if (bare)
    return (
      <section aria-label={t("Properties")} style={{ display: "grid", gap: "10px 14px", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
        {fields.map((f) => (
          <FieldControl key={f.key} item={item} field={f} />
        ))}
      </section>
    );
  return (
    <section aria-label={t("Properties")} style={{ marginTop: 12, display: "grid", gap: 10 }}>
      <button type="button" className="kx-more-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? t("Hide properties") : t("Properties")}
        {!open && typeof item.metadata.status === "string" && <span className="kx-meta">· {optionLabel(item.metadata.status)}</span>}
      </button>
      {open && (
        <div style={{ display: "grid", gap: "10px 14px", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
          {fields.map((f) => (
            <FieldControl key={f.key} item={item} field={f} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Prompt: copy the text, see its {{variablen}}. */
export function PromptPanel({ item }: { item: KnowledgeItem }) {
  const { showToast } = useShell();
  const vars = promptVariables(item.contentMd, item.metadata);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(item.contentMd.trim());
      showToast(t("Prompt copied"));
    } catch {
      showToast(t("Cannot copy"));
    }
  };
  const varParts = t("Variables: {list} – you fill them in when pasting in the Windows launcher (“>”).", { list: "\u0001" }).split("\u0001");
  return (
    <section aria-label={t("Prompt")} className="kxh-wrap" style={{ marginTop: 12, gap: 8, alignItems: "center" }}>
      <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" onClick={() => void copy()}>
        <Copy aria-hidden className="kx-ico kx-ico--sm" />
        {t("Copy prompt")}
      </button>
      {vars.length > 0 ? (
        <span className="kx-help">
          {varParts[0]}
          {vars.map((v, i) => (
            <span key={v}>
              {i > 0 && ", "}
              <code className="kx-mono">{`{{${v}}}`}</code>
            </span>
          ))}
          {varParts[1]}
        </span>
      ) : (
        <span className="kx-help">{t("Tip: you fill in placeholders like {example} when pasting in the Windows launcher.", { example: "{{name}}" })}</span>
      )}
    </section>
  );
}

/** Opens every tab of a session (new browser tabs, no opener). */
export function openAll(urls: readonly string[]): void {
  for (const u of urls) window.open(u, "_blank", "noopener,noreferrer");
}

/** Session: the saved tabs as links, "Alle öffnen" restores them. */
export function SessionPanel({ item }: { item: KnowledgeItem }) {
  const tabs = sessionTabs(item.metadata, item.contentMd);
  if (!tabs.length) return null;
  return (
    <section aria-label={t("Tab session")} style={{ marginTop: 12, display: "grid", gap: 8 }}>
      <div className="kxh-row" style={{ gap: 8 }}>
        <span className="kx-label">
          {tn(tabs.length, "{n} tab", "{n} tabs")}
        </span>
        <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" style={{ marginLeft: "auto" }} onClick={() => openAll(tabs.map((t) => t.url))}>
          <ExternalLink aria-hidden className="kx-ico kx-ico--sm" />
          {t("Open all")}
        </button>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
        {tabs.map((t) => (
          <li key={t.url}>
            <a href={t.url} target="_blank" rel="noopener noreferrer" className="kx-truncate" style={{ display: "block", fontSize: "calc(13px * var(--kx-fs, 1))", color: "var(--text-primary)" }} title={t.url}>
              {t.title}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
