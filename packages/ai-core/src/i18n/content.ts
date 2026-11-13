// Words and headings that ai-core writes into `content_md` (and that code reads back later).
//
// One table for the whole package: the generator writes the form of the ambient language
// (`ph("summary")`), every reader accepts BOTH forms (`phAlt`, `headingRe`), so notes written in
// German keep working after the account switches to English and the other way round. Code outside
// this package that parses generated Markdown (web app, mobile, scripts) must use the same pairs.
import { byLocale, type Locale } from "@kortex/i18n";

export interface ContentPhrase {
  readonly en: string;
  readonly de: string;
}

const p = (en: string, de: string): ContentPhrase => ({ en, de });

export const CONTENT_PHRASES = {
  // --- shared -----------------------------------------------------------------------------
  transcript: p("Transcript", "Transkript"),
  section: p("Section", "Abschnitt"),
  intro: p("Intro", "Einstieg"),
  speaker: p("Speaker", "Sprecher"),
  tip: p("Tip", "Tipp"),
  source: p("Source", "Quelle"),
  date: p("Date", "Datum"),
  duration: p("Duration", "Dauer"),
  description: p("Description", "Beschreibung"),
  images: p("Images", "Bilder"),
  image: p("Image", "Bild"),
  tableOfContents: p("Table of contents", "Inhaltsverzeichnis"),
  executiveSummary: p("Executive Summary", "Executive Summary"),
  tldr: p("TL;DR", "TL;DR"),
  actionItems: p("Action Items", "Action Items"),
  keyTakeaways: p("Key Takeaways", "Key Takeaways"),
  untitled: p("Untitled", "Ohne Titel"),
  me: p("Me", "Ich"),
  none: p("(none)", "(keine)"),
  noneNeuter: p("(none)", "(keins)"),
  unknown: p("(unknown)", "(unbekannt)"),

  // --- chunk header (context line in front of every embedded chunk) ---------------------------
  chunkDocument: p("Document", "Dokument"),
  chunkPosition: p("Position", "Position"),

  // --- auto-organizer / reindex (appended sections) ----------------------------------------
  keyPoints: p("Key points", "Kernpunkte"),
  linked: p("Linked", "Verknüpft"),
  mentioned: p("Mentioned", "Erwähnt"),
  mentionBook: p("Book", "Buch"),
  mentionTool: p("Tool", "Tool"),

  // --- flashcards ---------------------------------------------------------------------------
  flashcards: p("Flashcards", "Karteikarten"),
  flashcardQuestion: p("Q", "F"),
  flashcardAnswer: p("A", "A"),

  // --- AI chats / agent memories ------------------------------------------------------------
  aiChat: p("AI chat", "KI-Chat"),
  agentMemory: p("Agent memory", "Agent-Memory"),
  chatLength: p("Length", "Umfang"),
  messages: p("messages", "Nachrichten"),
  question: p("question", "Frage"),
  questions: p("questions", "Fragen"),
  questionN: p("Question", "Frage"),
  decisions: p("Decisions", "Entscheidungen"),
  openPoints: p("Open points", "Offene Punkte"),
  content: p("Content", "Inhalt"),
  questionsOverview: p("Questions at a glance", "Fragen im Überblick"),
  dialog: p("Dialog", "Dialog"),
  you: p("You", "Du"),

  // --- meetings -----------------------------------------------------------------------------
  participants: p("Participants", "Teilnehmer"),
  otherParty: p("Other participant", "Gesprächspartner"),
  topicsDiscussed: p("Topics discussed", "Besprochene Themenblöcke"),
  decisionsMade: p("Decisions made", "Getroffene Entscheidungen"),
  openRisks: p("Open risks & blockers", "Offene Risiken & Blocker"),
  extractedActionItems: p("Extracted action items", "Extrahierte Action Items"),
  timeframe: p("Timeframe", "Zeitrahmen"),
  context: p("Context", "Kontext"),
  minutes: p("Minutes", "Protokoll"),
  minutesFailed: p(
    "The minutes could not be created; the full transcript is saved.",
    "Protokoll konnte nicht erstellt werden; das Transkript ist vollständig gespeichert.",
  ),
  decision: p("Decision", "Entscheidung"),
  risk: p("Risk", "Risiko"),
  task: p("Task", "Aufgabe"),

  // --- e-mail -------------------------------------------------------------------------------
  email: p("E-mail", "E-Mail"),
  emailFrom: p("E-mail from", "E-Mail von"),
  mailAttachmentName: p("attachment", "anhang"),
  mailFrom: p("From", "Von"),
  mailTo: p("To", "An"),
  mailCc: p("Cc", "Cc"),
  mailSubject: p("Subject", "Betreff"),
  mailForwardedBy: p("Forwarded by", "Weitergeleitet von"),
  mailForwardNote: p("Note when forwarding", "Notiz beim Weiterleiten"),
  mailMessage: p("Message", "Nachricht"),
  mailNoText: p("_(no text)_", "_(kein Text)_"),
  mailSignature: p("Signature", "Signatur"),
  mailQuotedThread: p("Quoted thread", "Zitierter Verlauf"),
  mailAttachments: p("Attachments", "Anhänge"),

  // --- media notes (video, podcast) ---------------------------------------------------------
  learnings: p("Learnings", "Learnings"),
  chapters: p("Chapters", "Kapitel"),
  quotes: p("Quotes", "Zitate"),
  resourcesMentioned: p("Resources mentioned", "Erwähnte Ressourcen"),
  channel: p("Channel", "Kanal"),
  published: p("Published", "Veröffentlicht"),
  watchOnYouTube: p("Watch on YouTube", "Auf YouTube ansehen"),
  openOriginal: p("Open original", "Quelle öffnen"),
  openOnSpotify: p("Open on Spotify", "Auf Spotify öffnen"),
  openInApplePodcasts: p("Open in Apple Podcasts", "In Apple Podcasts öffnen"),

  // --- documents ----------------------------------------------------------------------------
  page: p("Page", "Seite"),
  pageCountOne: p("page", "Seite"),
  pageCountOther: p("pages", "Seiten"),
  pageAbbr: p("p.", "S."),
  pdfDocument: p("PDF document", "PDF-Dokument"),
  chapterCountOne: p("chapter", "Kapitel"),
  chapterCountOther: p("chapters", "Kapitel"),
  imageInArticle: p("Image in the article", "Bild im Artikel"),
  googleSearch: p("Google search", "Google-Suche"),

  // --- images, voice memos, social shorts ---------------------------------------------------
  recognizedText: p("Recognized text", "Erkannter Text"),
  todos: p("To-dos", "To-dos"),
  outline: p("Outline", "Gliederung"),
  steps: p("Steps", "Schritte"),
  keyStatements: p("Key points", "Kernaussagen"),
  toolsMentioned: p("Tools & products mentioned", "Erwähnte Tools & Produkte"),
  textOverlays: p("Text overlays", "Text-Overlays"),
  caption: p("Caption", "Caption"),
  note: p("Note", "Notiz"),

  // --- recipes ------------------------------------------------------------------------------
  recipe: p("Recipe", "Rezept"),
  servings: p("Servings", "Portionen"),
  prepTime: p("Prep", "Vorbereitung"),
  cookTime: p("Cooking/baking", "Kochen/Backen"),
  restTime: p("Resting time", "Ruhezeit"),
  totalTime: p("Total", "Gesamt"),
  difficulty: p("Difficulty", "Schwierigkeit"),
  rating: p("Rating", "Bewertung"),
  ingredients: p("Ingredients", "Zutaten"),
  preparation: p("Preparation", "Zubereitung"),
  nutritionPerServing: p("Nutrition per serving", "Nährwerte pro Portion"),
  perSource: p("per source", "laut Quelle"),
  aiEstimate: p("AI estimate", "KI-Schätzung"),
  protein: p("Protein", "Eiweiß"),
  carbs: p("Carbs", "Kohlenhydrate"),
  fat: p("Fat", "Fett"),
  fiber: p("Fiber", "Ballaststoffe"),
  lowCarbRating: p("Low-carb rating", "Low-Carb-Einstufung"),
  lowCarbKeto: p("Keto (≤ 10 g net carbs)", "Keto (≤ 10 g Netto-KH)"),
  lowCarbLow: p("Low-carb (≤ 25 g net carbs)", "Low-Carb (≤ 25 g Netto-KH)"),
  lowCarbModerate: p("Moderate (≤ 50 g net carbs)", "Moderat (≤ 50 g Netto-KH)"),
  lowCarbHigh: p("High-carb (> 50 g net carbs)", "Kohlenhydratreich (> 50 g Netto-KH)"),
  recipeBy: p("Recipe by", "Rezept von"),

  // --- movies and typed captures (fact rows) ------------------------------------------------
  type: p("Type", "Typ"),
  movie: p("Movie", "Film"),
  series: p("Series", "Serie"),
  episode: p("Episode", "Episode"),
  year: p("Year", "Jahr"),
  runtime: p("Runtime", "Laufzeit"),
  episodeLength: p("Episode length", "Folgenlänge"),
  certificate: p("Certificate", "Freigabe"),
  contentRating: p("Content rating", "Altersfreigabe"),
  votes: p("votes", "Stimmen"),
  genre: p("Genre", "Genre"),
  originalTitle: p("Original title", "Originaltitel"),
  director: p("Director", "Regie"),
  writer: p("Writer", "Drehbuch"),
  creator: p("Creator", "Idee"),
  createdBy: p("Created by", "Erstellt von"),
  country: p("Country", "Land"),
  crew: p("Crew", "Stab"),
  cast: p("Cast", "Besetzung"),
  actor: p("Actor", "Darsteller:in"),
  role: p("Role", "Rolle"),
  author: p("Author", "Autor"),
  language: p("Language", "Sprache"),
  brand: p("Brand", "Marke"),
  address: p("Address", "Adresse"),
  phone: p("Phone", "Telefon"),
  themes: p("Themes", "Themen"),
  price: p("Price", "Preis"),
  shop: p("Shop", "Händler"),
  category: p("Category", "Kategorie"),
  amount: p("Amount", "Betrag"),
  kind: p("Kind", "Art"),
  lineItems: p("Line items", "Positionen"),
  lineItem: p("Item", "Position"),
  quantity: p("Quantity", "Menge"),
  tax: p("Tax", "Steuer"),
  travel: p("Travel", "Reise"),
  other: p("Other", "Sonstiges"),
  confidence: p("confidence", "Konfidenz"),
  aiSuggestion: p("AI suggestion, please check", "KI-Vorschlag, bitte prüfen"),
  minutesAbbr: p("min", "Min."),
  hoursAbbr: p("h", "Std."),
  enriched: p("Enriched", "Angereichert"),
  added: p("added", "ergänzt"),
} as const satisfies Record<string, ContentPhrase>;

export type ContentPhraseKey = keyof typeof CONTENT_PHRASES;

/** The phrase in the ambient language (what a generator writes). */
export const ph = (key: ContentPhraseKey, locale?: Locale): string =>
  byLocale(CONTENT_PHRASES[key], locale);

/** Both forms of a phrase, English first (what a reader has to accept). */
export const phForms = (key: ContentPhraseKey): string[] => [
  ...new Set([CONTENT_PHRASES[key].en, CONTENT_PHRASES[key].de]),
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Regex source matching either form of the given phrases: `(?:Key points|Kernpunkte)`. */
export const phAlt = (...keys: ContentPhraseKey[]): string =>
  `(?:${[...new Set(keys.flatMap(phForms))].map(escapeRe).join("|")})`;

/** A whole heading line (`## Linked` or `## Verknüpft`) in either language, multi-line flag set. */
export const headingRe = (key: ContentPhraseKey, level = 2, flags = "m"): RegExp =>
  new RegExp(`^${"#".repeat(level)} ${phAlt(key)}[ \\t]*$`, flags);

/** True when `text` is one of the two forms of the phrase (case-insensitive, trimmed). */
export const isPhrase = (key: ContentPhraseKey, text: string): boolean =>
  phForms(key).some((f) => f.toLowerCase() === text.trim().toLowerCase());
