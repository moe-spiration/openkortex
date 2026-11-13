# Kortex editor (`@kortex/ui/editor`)

BlockNote 0.56 with the Kortex schema, reading and writing portable Markdown (`content_md`). Markdown is the
storage format; the editor never holds anything the Markdown can't carry.

## Markdown forms (W8, decisions K3/K4)

| Editor | Markdown | Why |
|---|---|---|
| Underline (toolbar U, Ctrl+U) | `<u>Text</u>` | Markdown has no underline. `<u>` is plain inline HTML that Obsidian, GitHub and CommonMark renderers show. Only a balanced pair is modelled; any other inline HTML stays a raw Markdown block (lossless). |
| Callout | `> [!note] Titel` + `> Text` | Obsidian callout (unchanged). Fold markers `-`/`+` are kept. |
| Toggle ("Aufklappbar") | `> [!toggle]- Titel` + `> Body …` | Obsidian fold callout of kind `toggle`: renders folded in Obsidian, the title is rich text, the body is any Markdown (paragraphs, lists, tasks, headings, tables, nested toggles). `-` = closed (default for new toggles), `+` = open; the editor keeps the marker as written. Whether a toggle is open while reading is view state, not saved. |
| Task | `- [ ]` / `- [x]` | GFM (unchanged); a bare `- [ ]` is an empty task. |
| Table | GFM table | unchanged; underline works in cells. |

A toggle's body starts on the line after the title when it begins with a paragraph (Obsidian's usual form), and
after an empty `>` line otherwise (so a table or a setext-looking line never continues the title).

Rejected: `<details><summary>` for toggles (HTML block: the body can't hold Markdown reliably, and md-sync /
Obsidian show it as raw HTML); `__text__` or `++text++` for underline (bold in CommonMark, not standard).

**Round trip (A-17):** `fixtures/*.md` are canonical documents (callout, toggle, tasks, table, underline):
`blocksToMarkdown(markdownToBlocks(md)) === md`, checked in `fixtures.test.ts`. Non-canonical input is normalized once
on the first save (see `markdown.test.ts`), then stays stable.

## Editing (W8)

- **Block handle** (hover): `+` inserts a block, the grip drags; click the grip for *Umwandeln in* (Text, Überschrift
  1–3, Aufgabe, Callout, Aufklappbar), *Duplizieren*, *Löschen*. **Alt+↑ / Alt+↓** moves the block at the caret (or
  the selected blocks).
- **Floating toolbar** over a selection: Bold, Kursiv, Unterstrichen, Durchgestrichen, Code, Link, Textart (the same
  types as *Umwandeln in*), **KI**.
- **KI** (toolbar) on the selection: Umformulieren, Kürzen, Fortsetzen, Zusammenfassen, Frage dazu stellen. Rewrite /
  shorten replace the selection (or add below when the selection moved or the answer has several blocks), continue
  inserts after it, summarize adds a *KI-Zusammenfassung* block.
- **Slash menu** in groups *Grundlagen*, *Einbetten*, *KI*; typing filters (title and aliases), arrows and Enter
  select. *Fortsetzen* (KI group) appears when the host passes `onAiAction`.

## Host props

```tsx
<KortexEditor
  markdown={item.contentMd}
  onChange={(md) => setContent(id, md)}
  wikiTargets={targets}
  onOpenWikiLink={open}
  onAiSummary={summarize}            // slash "KI-Zusammenfassung"
  onCreateSubpage={createSubpage}    // slash "Unterseite"
  // KI menu + slash "Fortsetzen": the same server actions as the header's KI menu.
  onAiAction={async ({ action, markdown }) => {
    // action: "rewrite" | "shorten" | "continue" | "summarize"
    // chatAction throws on errors: show a toast and rethrow, the editor leaves the text as it was.
    const res = await chatAction({ action, content_md: markdown, item_id: id });
    return "content_md" in res ? res.content_md : "";
  }}
  onAiAsk={(selection) => openCopilot({ prompt: selection })} // "Frage dazu stellen"
/>
```

Without `onAiAction` / `onAiAsk` the KI entries are hidden. `POST /api/chat/action` accepts `shorten` and `continue`
besides the existing actions.

## Files

`KortexEditor.tsx` component · `schema.tsx` blocks (callout, toggle, AI summary, sub-page, raw Markdown) and styles ·
`markdown.ts` Markdown ⇄ blocks (pure) · `menus.tsx` slash and `[[` menus · `controls.tsx` toolbar and block-handle
menu · `ai.ts` KI actions on the selection · `bridge.ts` host callbacks per editor · `editor.css` skin.
