"use client";

import { t, tx } from "@/i18n";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Kbd } from "@kortex/ui";
import type { EditorAiRequest, WikiLinkTarget } from "@kortex/ui/editor";
import { hasFirstParagraph, suggestTags } from "@/lib/notes/properties";
import {
  NEW_NOTE_FOLDER,
  NOTE_TEMPLATES,
  applyTemplate,
  hasContent,
  initialDraft,
  newNotePath,
  promoteNewNoteTab,
  renameNoteTab,
  type NoteTemplate,
} from "@/lib/notes/new-note";
import { useNote, useNotes } from "@/lib/notes/store";
import { setActiveDraft } from "@/lib/notes/active-draft";
import { NEW_NOTE_HREF, takeNewNotePrefill } from "@/lib/shell/new-note";
import { noteHrefById } from "@/lib/shell/routes";
import { useShell } from "@/lib/shell/store";
import { DAILY_NOTES, MOCK_TODAY, NOTE_TYPES, VAULT_TREE } from "@/lib/workspace-data";
import { ensureDailyNote } from "@/components/home/daily";
import { fetchAiAnswer } from "./AiPanel";
import { NIco } from "./icons";
import { ObjectTypeMenu } from "./ObjectTypeMenu";
import { CoverDialog, CoverImg, IconPicker, PageIconGlyph } from "./PageLook";

/*
 * New-note editor (/notes/new; Tactile Craft v2 decision 8, dummy app.js NewNote). Every "new note" entry point lands
 * here; the prefill is read exactly once (takeNewNotePrefill). Cover bar (Cover, Icon, Vorlage), a large title,
 * properties (Typ Notiz, Ordner 10_Notes automatisch, Tags with suggestions after the first paragraph), the templates,
 * the BlockNote editor with its slash menu (Grundlagen, Einbetten [[Notiz]] / @Objekt / Bild, KI) and the footer
 * with the vault path.
 *
 * Draft saving: as soon as there is a title or text the note is created (store.createNote, live: server action into
 * 10_Notes) and every later change is saved automatically. The "Ohne Titel" tab turns into the note's tab in place
 * and the address becomes /notes/<id> without a reload, so the editor keeps the caret; a reload opens the saved note.
 */

const KortexEditor = dynamic(() => import("@kortex/ui/editor").then((m) => m.KortexEditor), { ssr: false, loading: () => null });

const CREATE_DELAY_MS = 700;

export function NewNoteEditor() {
  const notes = useNotes();
  const { items, createNote, setTitle: storeTitle, setContent, addTag, removeTag, setLook, moveTo } = notes;
  const { setTabs, showToast, openNote } = useShell();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [template, setTemplate] = useState<NoteTemplate["id"] | null>(null);
  const [tplMenu, setTplMenu] = useState(false);
  const [tagInput, setTagInput] = useState<string | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  // W4: cover, icon and folder chosen before the first save (afterwards the store item holds them).
  const [draftCover, setDraftCover] = useState<string | null>(null);
  const [draftIcon, setDraftIcon] = useState<string | null>(null);
  const [draftFolder, setDraftFolder] = useState(NEW_NOTE_FOLDER);
  const [look, setLookMenu] = useState<"cover" | "icon" | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const tplRef = useRef<HTMLDivElement>(null);
  const creating = useRef(false);
  const item = useNote(id);

  /** Starts a fresh draft from the prefill, which is read (and removed) here exactly once per draft. */
  const startDraft = useCallback(() => {
    const d = initialDraft(takeNewNotePrefill());
    creating.current = false;
    setActiveDraft(null);
    setId(null);
    setTags([]);
    setTemplate(d.template ?? null);
    setTplMenu(!!d.pickTemplate);
    setTagInput(null);
    setDraftCover(null);
    setDraftIcon(null);
    setDraftFolder(NEW_NOTE_FOLDER);
    setLookMenu(null);
    setTitle(d.title);
    setBody(d.body);
    setEditorKey((k) => k + 1);
    setTimeout(() => {
      // "Aus Vorlage …" opens the template menu: its first entry takes the focus so the choice works from the keyboard.
      if (d.pickTemplate) tplRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
      else if (d.title || d.template) bodyFocus(bodyRef.current);
      else titleRef.current?.focus();
    }, 60);
  }, []);

  // Mount: StrictMode runs effects twice; the ref keeps the second run from taking (and losing) the prefill.
  const took = useRef(false);
  useEffect(() => {
    if (!took.current) {
      took.current = true;
      startDraft();
    }
    // Leaving the editor: /notes/<id> shows the saved note again.
    return () => setActiveDraft(null);
  }, [startDraft]);

  // The saved draft moved the address to /notes/<id> in place; a new "Neue Notiz" (back on /notes/new while this
  // editor is still mounted) starts the next draft instead of continuing the saved one.
  const pathname = usePathname();
  useEffect(() => {
    if (pathname === NEW_NOTE_HREF && id) startDraft();
    // Only on address changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Create the note once there is something to keep, then save every change.
  useEffect(() => {
    if (id || creating.current || !hasContent({ title, body })) return;
    const t = setTimeout(() => {
      if (creating.current) return;
      creating.current = true;
      const { item: created, ready } = createNote({ title, contentMd: body, folder: draftFolder, tags, cover: draftCover, icon: draftIcon });
      setId(created.id);
      setActiveDraft(created.id);
      const href = noteHrefById(created.id);
      setTabs((all) => promoteNewNoteTab(all, { id: created.id, title: created.title, href, icon: NOTE_TYPES.note.icon }));
      // The address follows without a navigation, so the editor stays mounted (Next syncs replaceState with the router).
      window.history.replaceState(null, "", href);
      void ready.then((ok) => {
        if (ok) return;
        creating.current = false;
        setActiveDraft(null);
        setId(null);
      });
    }, CREATE_DELAY_MS);
    return () => clearTimeout(t);
  }, [id, title, body, tags, createNote, setTabs, draftFolder, draftCover, draftIcon]);

  useEffect(() => {
    if (!id) return;
    storeTitle(id, title.trim());
    setTabs((all) => renameNoteTab(all, id, title));
  }, [id, title, storeTitle, setTabs]);
  useEffect(() => {
    if (id) setContent(id, body);
  }, [id, body, setContent]);

  // Template menu: outside click and Escape close it.
  useEffect(() => {
    if (!tplMenu) return;
    const down = (e: PointerEvent) => !tplRef.current?.contains(e.target as Node) && setTplMenu(false);
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setTplMenu(false);
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key, true);
    };
  }, [tplMenu]);

  const router = useRouter();
  const applyTpl = (tpl: NoteTemplate) => {
    if (tpl.opens === "daily-note") {
      // W-18: the day's daily note, not a second "Tagesnotiz" the Journal never shows. Text typed here is
      // already saved as its own note (drafts save as soon as they have text).
      setTplMenu(false);
      ensureDailyNote(MOCK_TODAY, DAILY_NOTES).then(
        (d) => router.push(d.id && DAILY_NOTES.some((x) => x.id === d.id) ? noteHrefById(d.id) : "/journal"),
        () => showToast(t("Could not open the daily note")),
      );
      return;
    }
    setTemplate(tpl.id);
    setTplMenu(false);
    setBody((b) => applyTemplate(b, tpl));
    setEditorKey((k) => k + 1);
    setTimeout(() => bodyFocus(bodyRef.current), 60);
  };

  const currentTags = item?.tags ?? tags;
  const addTagLabel = (raw: string) => {
    const label = raw.trim().replace(/^#*/, "#").replace(/\s+/g, "-");
    if (label === "#") return;
    if (id) addTag(id, label);
    else setTags((t) => (t.some((x) => x.toLowerCase() === label.toLowerCase()) ? t : [...t, label]));
  };
  const dropTag = (label: string) => {
    if (id) removeTag(id, label);
    else setTags((t) => t.filter((x) => x !== label));
  };

  const knownTags = useMemo(() => [...new Set(Object.values(items).flatMap((i) => i.tags))], [items]);
  const ideas = useMemo(
    () => (hasFirstParagraph(body) ? suggestTags(`${title}\n${body}`, knownTags, currentTags, 3) : []),
    [body, title, knownTags, currentTags],
  );

  // Editor host callbacks, like the note body (NoteBody.tsx).
  const titles = Object.values(items)
    .filter((i) => i.id !== id)
    .map((i) => `${i.id}\u0000${i.title}\u0000${i.path}`)
    .join("\u0001");
  const wikiTargets = useMemo<WikiLinkTarget[]>(
    () =>
      titles
        ? titles.split("\u0001").map((s) => {
            const [tid, t, path] = s.split("\u0000");
            return { id: tid!, title: t!, path };
          })
        : [],
    [titles],
  );
  const onOpenWikiLink = useCallback(
    (link: { id?: string; title: string }) => {
      const target = link.id ? items[link.id] : Object.values(items).find((i) => i.title === link.title);
      if (target) openNote(target.id);
      else showToast(t("“{title}” does not exist yet", { title: link.title }));
    },
    [items, openNote, showToast],
  );
  const onAiAction = useCallback(
    async ({ action, markdown, instruction }: EditorAiRequest) => {
      try {
        return await fetchAiAnswer(action, { itemId: id ?? undefined, contentMd: markdown, instruction });
      } catch (err) {
        showToast(t("AI action failed. Please try again later."));
        throw err;
      }
    },
    [id, showToast],
  );
  const onAiSummary = useCallback(() => fetchAiAnswer("summarize", { itemId: id ?? undefined, contentMd: body }), [id, body]);

  const saved = !!id;
  const cover = item ? item.cover : draftCover;
  const icon = item ? (item.icon ?? null) : draftIcon;
  const folder = item ? item.path.split("/").slice(0, -1).join("/") : draftFolder;
  const folders = useMemo(() => [...new Set([NEW_NOTE_FOLDER, folder, ...VAULT_TREE.map((f) => f.path)].filter(Boolean))].sort(), [folder]);
  // An upload can finish after the first save: the choice always goes to the note as it is now (latest id and store),
  // never to the draft state of the render that started it.
  const live = useRef({ id, setLook, moveTo });
  live.current = { id, setLook, moveTo };
  const pickCover = useCallback((url: string | null) => {
    const { id: cur, setLook: look } = live.current;
    if (cur) look(cur, { cover: url });
    else setDraftCover(url);
  }, []);
  const pickIcon = useCallback((name: string | null) => {
    const { id: cur, setLook: look } = live.current;
    if (cur) look(cur, { icon: name });
    else setDraftIcon(name);
  }, []);
  const pickFolder = (dir: string) => (id ? moveTo(id, dir) : setDraftFolder(dir));
  const closeLook = useCallback(() => setLookMenu(null), []);
  return (
    <div className="kx-editor-page" data-new-note>
      {cover && (
        <div className="kx-ed-cover">
          <CoverImg src={cover} />
          <span className="kx-dr-cover-act">
            <button type="button" className="kx-dr-chip is-btn tc-glass" onClick={() => setLookMenu("cover")}>
              <NIco name="image" size={12} />
              {t("Change cover")}
            </button>
          </span>
        </div>
      )}
      {icon && (
        <button type="button" className="kx-ed-icon" aria-label={t("Change icon")} title={t("Change icon")} onClick={() => setLookMenu("icon")}>
          <PageIconGlyph name={icon} size={40} />
        </button>
      )}
      <div className="kx-ed-cover-bar">
        <div className="kx-look-anchor">
          <button type="button" className="kx-dr-chip is-btn" aria-haspopup="dialog" aria-expanded={look === "cover"} onClick={() => setLookMenu(look === "cover" ? null : "cover")}>
            <NIco name="image" size={12} />
            {cover ? t("Change cover") : t("Add cover")}
          </button>
          {look === "cover" && <CoverDialog value={cover} onPick={pickCover} onClose={closeLook} onError={(m) => showToast(m)} />}
        </div>
        <div className="kx-look-anchor">
          <button type="button" className="kx-dr-chip is-btn" aria-haspopup="dialog" aria-expanded={look === "icon"} onClick={() => setLookMenu(look === "icon" ? null : "icon")}>
            {icon ? <PageIconGlyph name={icon} size={12} /> : <NIco name="smile-plus" size={12} />}
            {icon ? t("Change icon") : t("Icon")}
          </button>
          {look === "icon" && <IconPicker value={icon} onPick={pickIcon} onClose={closeLook} />}
        </div>
        <div ref={tplRef} style={{ position: "relative" }}>
          <button type="button" className="kx-dr-chip is-btn" aria-haspopup="menu" aria-expanded={tplMenu} onClick={() => setTplMenu((v) => !v)}>
            <NIco name="layout-template" size={12} />
            {t("Template")}
          </button>
          {tplMenu && (
            <div className="kx-menu kx-tpl-menu" role="menu" aria-label={t("Template")}>
              {NOTE_TEMPLATES.map((t) => (
                <button key={t.id} type="button" role="menuitem" className="kx-menu-item kxb" style={{ width: "100%" }} onClick={() => applyTpl(t)}>
                  <NIco name={t.icon} />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="kx-grow" />
        <span className="kx-meta kx-ed-save" role="status">
          <i className={"kx-sync-dot" + (saved ? "" : " is-idle")} />
          {saved ? t("Saved · changes are saved automatically") : t("Draft · saved as you type")}
        </span>
      </div>

      <input
        ref={titleRef}
        className="kx-ed-title"
        placeholder={t("Untitled")}
        aria-label={t("Title")}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || (e.key === "ArrowDown" && !e.shiftKey)) {
            e.preventDefault();
            bodyFocus(bodyRef.current);
          }
        }}
      />

      <dl className="kx-props is-compact">
        <dt>
          <NIco name="shapes" />
          {t("Type")}
        </dt>
        <dd>
          {item ? (
            <ObjectTypeMenu item={item} />
          ) : (
            <span className="kx-typesel" aria-label={t("Type: note")}>
              <NIco name="notebook-pen" size={13} />
              {t("Note")}
            </span>
          )}
          <span className="kx-meta">{t("· turn into an object later")}</span>
        </dd>
        <dt>
          <NIco name="folder" />
          {t("Folder")}
        </dt>
        <dd>
          <select className="kx-mono kx-dr-folder kx-ed-folder" aria-label={t("Folder")} value={folder} onChange={(e) => pickFolder(e.target.value)}>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <span className="kx-meta">{folder === NEW_NOTE_FOLDER ? t("automatic, can be changed") : t("chosen by you")}</span>
        </dd>
        <dt>
          <NIco name="hash" />
          {t("Tags")}
        </dt>
        <dd>
          {currentTags.map((tag) => (
            <span key={tag} className="kx-dr-chip is-tag">
              {tag.replace(/^#/, "")}
              <button type="button" className="kxb kx-dr-chip-x" aria-label={t("Remove tag {tag}", { tag })} onClick={() => dropTag(tag)}>
                <NIco name="x" size={11} />
              </button>
            </span>
          ))}
          {tagInput === null ? (
            <button type="button" className="kx-dr-chip is-btn" onClick={() => setTagInput("")}>
              <NIco name="plus" size={11} /> {t("Tag")}
            </button>
          ) : (
            <input
              autoFocus
              className="kx-dr-chip kx-ed-taginput"
              aria-label={t("New tag")}
              placeholder="#tag"
              value={tagInput}
              size={Math.max(6, tagInput.length + 1)}
              onChange={(e) => setTagInput(e.target.value)}
              onBlur={() => {
                if (tagInput.trim()) addTagLabel(tagInput);
                setTagInput(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (tagInput.trim()) addTagLabel(tagInput);
                  setTagInput("");
                } else if (e.key === "Escape") {
                  e.stopPropagation();
                  setTagInput(null);
                }
              }}
            />
          )}
          {ideas.length ? (
            ideas.map((tag) => (
              <button key={tag} type="button" className="kx-dr-chip is-ai" title={t("Accept suggestion")} onClick={() => addTagLabel(tag)}>
                <NIco name="sparkles" size={11} />
                {tag.replace(/^#/, "")}
              </button>
            ))
          ) : (
            <span className="kx-dr-chip is-ai" style={{ cursor: "default" }}>
              <NIco name="sparkles" size={11} />
              {t("Suggestions after the first paragraph")}
            </span>
          )}
        </dd>
      </dl>

      {!body && !template && (
        <div className="kx-tpls" role="group" aria-label={t("Start with")}>
          <span className="tc-micro">{t("Start with")}</span>
          {NOTE_TEMPLATES.map((t) => (
            <button key={t.id} type="button" className="kx-dr-chip is-btn" onClick={() => applyTpl(t)}>
              <NIco name={t.icon} size={12} />
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div ref={bodyRef} className="kx-ed-body-wrap kx-note-body" aria-label={t("Note text")}>
        <KortexEditor
          key={editorKey}
          markdown={body}
          onChange={setBody}
          wikiTargets={wikiTargets}
          onOpenWikiLink={onOpenWikiLink}
          onAiAction={onAiAction}
          onAiSummary={onAiSummary}
          placeholder={t("Start writing or type / for commands")}
        />
      </div>

      <div className="kx-ed-foot">
        <span className="kx-mono kx-meta">{item ? item.path : newNotePath(title, draftFolder)}</span>
        <span className="kx-dot" />
        <span className="kx-meta">{t("Markdown with YAML frontmatter")}</span>
        <span className="kx-grow" />
        <span className="kx-meta kx-ed-keys">
          <Kbd size="sm">/</Kbd> {t("Commands")} <Kbd size="sm">[[</Kbd> {tx("verb", "Link")} <Kbd size="sm">@</Kbd> {t("Object")}
        </span>
      </div>
    </div>
  );
}

/** Puts the caret into the block editor (end of the document). */
function bodyFocus(wrap: HTMLElement | null) {
  const el = wrap?.querySelector<HTMLElement>('[contenteditable="true"]');
  el?.focus();
}
