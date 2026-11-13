import { byLocale } from "@kortex/i18n";
import type { Citation, ContextMode } from "./contract";
import { routingContext } from "./routing-guide";

const MODE_LABEL: Record<"en" | "de", Record<ContextMode, string>> = {
  en: {
    note: "the note or document that is currently open",
    folder: "the current folder or cluster",
    brain: "the whole Second Brain (hybrid search)",
  },
  de: {
    note: "die aktuell geöffnete Notiz bzw. das Dokument",
    folder: "den aktuellen Ordner bzw. Cluster",
    brain: "das gesamte Second Brain (Hybrid-Suche)",
  },
};

export function copilotSystemPrompt(
  mode: ContextMode,
  citations: readonly Citation[],
  today: string,
  opts: { routing?: boolean; brief?: boolean; focus?: string | null } = {},
): string {
  const mode_label = byLocale(MODE_LABEL)[mode];
  const sourceList = (folderLabel: string) =>
    citations
      .map((c) => {
        const where = c.page_or_timestamp ? ` · ${c.page_or_timestamp}` : "";
        const folder = c.folder_path ? `\n${folderLabel}: ${c.folder_path}` : "";
        return `[${c.n}] ${c.title} (${c.type}${where})${folder}\n${c.snippet}`;
      })
      .join("\n\n---\n\n");
  const routing = opts.routing ? `\n${routingContext()}\n` : "";
  return byLocale({
    en: () => {
      const focus = opts.focus
        ? `\nThe user's focus profile (background for context and prioritisation only, not a source, do not cite it):\n${opts.focus}\n`
        : "";
      const sources = citations.length === 0 ? "(No matching sources found.)" : sourceList("Folder");
      return `You are the AI copilot of Kortex, the user's Second Brain. Today is ${today}.
Context of this conversation: ${mode_label}.

Rules:
- Answer on the basis of the numbered sources below. Back every statement taken from a source directly with [n], e.g. "… is verified with SHA-256 [2]."
- If the sources do not answer the question, say so clearly and offer what you can do instead. Do not invent sources or content.
- Answer in the language of the question (default English), precise and well structured in Markdown.
- Refer to pages or timestamps when the source gives them.
${opts.brief ? "- Short answer: at most three sentences, no headings, no lists. The references [n] stay.\n" : ""}${routing}${focus}
Sources:
${sources}`;
    },
    de: () => {
      const focus = opts.focus
        ? `\nFokus-Profil des Nutzers (nur Hintergrund zur Einordnung und Priorisierung, keine Quelle, nicht zitieren):\n${opts.focus}\n`
        : "";
      const sources = citations.length === 0 ? "(Keine passenden Quellen gefunden.)" : sourceList("Ordner");
      return `Du bist der KI-Copilot von Kortex, dem Second Brain des Nutzers. Heute ist ${today}.
Kontext dieser Unterhaltung: ${mode_label}.

Regeln:
- Antworte auf Basis der nummerierten Quellen unten. Belege jede Aussage aus einer Quelle direkt mit [n], z. B. "… wird per SHA-256 geprüft [2]."
- Wenn die Quellen die Frage nicht beantworten, sag das klar und biete an, was du stattdessen tun kannst. Erfinde keine Quellen oder Inhalte.
- Antworte in der Sprache der Frage (Standard Deutsch), präzise und gut strukturiert in Markdown.
- Verweise auf Seiten oder Zeitstempel, wenn die Quelle sie angibt.
${opts.brief ? "- Kurzantwort: höchstens drei Sätze, keine Überschriften, keine Listen. Die Belege [n] bleiben.\n" : ""}${routing}${focus}
Quellen:
${sources}`;
    },
  })();
}

const ACTION_PROMPTS_DE = {
  rewrite:
    "Überarbeite den folgenden Markdown-Text: klarer, präziser, gut lesbar. Behalte Bedeutung, Fakten, Links, [[Wiki-Links]], Checklisten und die Sprache bei. Gib nur das überarbeitete Markdown zurück.",
  shorten:
    "Kürze den folgenden Markdown-Text auf etwa die Hälfte. Behalte die Kernaussagen, Fakten, Links, [[Wiki-Links]], Formatierung und die Sprache bei; nichts hinzuerfinden. Gib nur das gekürzte Markdown zurück.",
  continue:
    "Setze den folgenden Text fort: ein bis drei Absätze im selben Ton, Stil und in derselben Sprache, logisch an das Ende anschließend. Wiederhole den vorhandenen Text nicht und erfinde keine Fakten über den Nutzer. Gib nur die Fortsetzung als Markdown zurück.",
  summarize:
    "Fasse den folgenden Text als TL;DR zusammen: 2-4 Sätze mit der Kernaussage, danach bis zu 5 Stichpunkte mit den wichtigsten Details. Sprache des Textes, Standard Deutsch. Gib nur Markdown zurück.",
  outline:
    "Erstelle eine kreative, logisch aufgebaute Gliederung (Markdown-Überschriften und verschachtelte Listen) zum folgenden Text bzw. Thema. Ergänze sinnvolle Abschnitte, die noch fehlen, und markiere sie mit (neu). Gib nur Markdown zurück.",
  flashcards:
    "Erstelle Active-Recall-Lernkarten aus dem folgenden Text. Jede Karte prüft genau einen Fakt oder ein Konzept; Fragen präzise, Antworten kurz (max. 2 Sätze). Sprache des Textes, Standard Deutsch.",
  tasks:
    'Extrahiere konkrete Aufgaben aus dem folgenden Text. Nur echte, umsetzbare To-dos; nichts erfinden. assignee "Me", wenn die Aufgabe für den Nutzer selbst ist.',
  custom:
    "Wende die Anweisung des Nutzers (unten) auf den folgenden Markdown-Text an, z. B. Namen korrigieren, Suchen und Ersetzen, umformatieren, übersetzen, ergänzen. Ändere nur, was die Anweisung verlangt; alles andere bleibt wortgleich (Fakten, Links, [[Wiki-Links]], Checklisten, Formatierung). Gib nur das Ergebnis als Markdown zurück, ohne Erklärung.",
  status:
    'Der Nutzer meldet den Stand eines Eintrags, den er schon in Kortex hat (Buch, Film/Serie, Produkt, Ort, ...), z. B. "Dune gelesen, hat mir gefallen". ' +
    "Extrahiere: query = Titel oder Name des Eintrags (ohne Füllwörter), type = Typ des Eintrags oder null, status = neuer Status aus der erlaubten Liste des Typs oder null, " +
    "feedback = die Meinung des Nutzers in seinen Worten oder null, rating = Bewertung 0-10 nur wenn genannt (5 Sterne = 10) oder null. Nichts erfinden.",
} as const;

const ACTION_PROMPTS_EN: Record<keyof typeof ACTION_PROMPTS_DE, string> = {
  rewrite:
    "Revise the following Markdown text: clearer, more precise, easy to read. Keep the meaning, facts, links, [[wiki links]], checklists and the language. Return only the revised Markdown.",
  shorten:
    "Shorten the following Markdown text to about half. Keep the key statements, facts, links, [[wiki links]], formatting and the language; do not invent anything. Return only the shortened Markdown.",
  continue:
    "Continue the following text: one to three paragraphs in the same tone, style and language, following logically from the end. Do not repeat the existing text and do not invent facts about the user. Return only the continuation as Markdown.",
  summarize:
    "Summarise the following text as a TL;DR: 2-4 sentences with the key message, then up to 5 bullet points with the most important details. Language of the text, default English. Return only Markdown.",
  outline:
    "Create a creative, logically structured outline (Markdown headings and nested lists) for the following text or topic. Add sensible sections that are still missing and mark them with (new). Return only Markdown.",
  flashcards:
    "Create active recall flashcards from the following text. Each card tests exactly one fact or concept; precise questions, short answers (max. 2 sentences). Language of the text, default English.",
  tasks:
    'Extract concrete tasks from the following text. Only real, actionable to-dos; do not invent anything. assignee "Me" when the task is for the user themselves.',
  custom:
    "Apply the user's instruction (below) to the following Markdown text, e.g. correct names, search and replace, reformat, translate, add content. Change only what the instruction asks for; everything else stays word for word (facts, links, [[wiki links]], checklists, formatting). Return only the result as Markdown, without explanation.",
  status:
    'The user reports the state of an entry they already have in Kortex (book, film/series, product, place, ...), e.g. "Read Dune, I liked it". ' +
    "Extract: query = title or name of the entry (without filler words), type = type of the entry or null, status = new status from the allowed list of the type or null, " +
    "feedback = the user's opinion in their own words or null, rating = rating 0-10 only if given (5 stars = 10) or null. Do not invent anything.",
};

/** System prompt of an editor action in the current language. */
export const actionPrompt = (action: keyof typeof ACTION_PROMPTS_DE): string =>
  byLocale<Record<keyof typeof ACTION_PROMPTS_DE, string>>({ en: ACTION_PROMPTS_EN, de: ACTION_PROMPTS_DE })[action];
