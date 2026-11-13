import { byLocale } from "../i18n";

/** German wording (the original). `visionOcrPrompt()` picks the language of the user. */
export const VISION_OCR_PROMPT = `Du analysierst ein Bild für Kortex, ein KI-natives Second Brain (Screenshot, Whiteboard, Diagramm, Foto oder abfotografiertes Dokument).

Liefere ein JSON-Objekt:
- "title_hint": kurzer, aussagekräftiger Titel (max. 80 Zeichen, Sprache des Inhalts, Standard Deutsch).
- "image_kind": "screenshot" | "whiteboard" | "diagram" | "photo" | "document" | "other".
- "ocr_text": der vollständige sichtbare Text, wortgetreu, mit Zeilenumbrüchen in Lesereihenfolge. Leerer String, wenn kein Text sichtbar ist.
- "description_md": Markdown-Erklärung des Bildes. Bei Architektur- oder Ablaufdiagrammen: Komponenten, Beziehungen und Datenflüsse als Liste. Bei Whiteboards: Struktur und Kernaussagen. Auf Deutsch, außer der Inhalt ist eindeutig in einer anderen Sprache.
- "objects": die wichtigsten sichtbaren Objekte/Elemente als kurze Substantive (max. 12, ohne Duplikate; bei Diagrammen die Komponenten). Leeres Array, wenn nichts Sinnvolles erkennbar ist.
- "scene": ein kurzer Satz zur Szene bzw. Situation (Ort, Anlass, Art der Darstellung). Leerer String, wenn unklar.
- "todos": konkrete Aufgaben, die im Bild stehen (z. B. Checklisten, "TODO", Notizzettel). Leeres Array, wenn keine vorhanden sind. Erfinde nichts.`;

const VISION_OCR_PROMPT_EN = `You analyze an image for Kortex, an AI-native Second Brain (screenshot, whiteboard, diagram, photo or photographed document).

Deliver a JSON object:
- "title_hint": short, meaningful title (max. 80 characters, language of the content, default English).
- "image_kind": "screenshot" | "whiteboard" | "diagram" | "photo" | "document" | "other".
- "ocr_text": the complete visible text, verbatim, with line breaks in reading order. Empty string when no text is visible.
- "description_md": Markdown explanation of the image. For architecture or flow diagrams: components, relations and data flows as a list. For whiteboards: structure and key statements. In English, unless the content is clearly in another language.
- "objects": the most important visible objects/elements as short nouns (max. 12, no duplicates; for diagrams the components). Empty array when nothing meaningful can be recognized.
- "scene": one short sentence on the scene or situation (place, occasion, kind of depiction). Empty string when unclear.
- "todos": concrete tasks that stand in the image (e.g. checklists, "TODO", sticky notes). Empty array when there are none. Invent nothing.`;

export const visionOcrPrompt = (): string =>
  byLocale({ en: VISION_OCR_PROMPT_EN, de: VISION_OCR_PROMPT });
