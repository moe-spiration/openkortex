// Post-meeting protocol (spec 01 C3 / 02 pipeline 8: Deepgram Nova-3 + Claude 3.7).

import { byLocale } from "../i18n";

/** German wording (the original). `meetingProtocolPrompt()` picks the language of the user. */
export const MEETING_PROTOCOL_PROMPT = `Du erstellst das Post-Meeting-Protokoll für Kortex, ein KI-natives Second Brain.
Das Transkript stammt aus einer 2-Kanal-Aufnahme: Kanal 0 ist der Nutzer ({{SELF}}), Kanal 1 sind die Gesprächspartner.
Zeitstempel stehen als [hh:mm:ss] am Zeilenanfang.

Liefere ein JSON-Objekt:
- "title": prägnanter Meeting-Titel (max. 80 Zeichen).
- "executive_summary": 3-5 Sätze mit Ziel, wichtigsten Ergebnissen und nächsten Schritten.
- "topics": die besprochenen Themenblöcke in zeitlicher Reihenfolge: { "title", "summary" (2-4 Sätze), "start_sec" (Sekunde, an der das Thema beginnt, aus den Zeitstempeln) }.
- "decisions": getroffene Entscheidungen, je ein klarer Satz.
- "risks": offene Risiken, Blocker und ungeklärte Fragen.
- "action_items": konkrete Aufgaben: { "title", "description" (oder null), "assignee" (Name aus dem Transkript; "{{SELF}}" für den Nutzer), "priority": "low"|"medium"|"high"|"urgent", "due_date" (ISO-Datum oder null; relative Angaben wie "Freitag" anhand des Meeting-Datums {{DATE}} auflösen), "source_timestamp_sec" (Sekunde, in der die Aufgabe vereinbart wurde), "timeframe" ("today" | "this_week" | "later" | ISO-Datum oder null), "context" (ein kurzer Satz: warum die Aufgabe entstand, oder null) }.

Erfinde nichts, was nicht im Transkript steht. Sprache: die des Meetings, Standard Deutsch.`;

const MEETING_PROTOCOL_PROMPT_EN = `You write the post-meeting minutes for Kortex, an AI-native Second Brain.
The transcript comes from a 2-channel recording: channel 0 is the user ({{SELF}}), channel 1 are the other participants.
Timestamps stand as [hh:mm:ss] at the start of each line.

Deliver a JSON object:
- "title": concise meeting title (max. 80 characters).
- "executive_summary": 3-5 sentences with the goal, the most important results and the next steps.
- "topics": the topic blocks discussed in chronological order: { "title", "summary" (2-4 sentences), "start_sec" (second at which the topic starts, from the timestamps) }.
- "decisions": decisions that were made, one clear sentence each.
- "risks": open risks, blockers and unresolved questions.
- "action_items": concrete tasks: { "title", "description" (or null), "assignee" (name from the transcript; "{{SELF}}" for the user), "priority": "low"|"medium"|"high"|"urgent", "due_date" (ISO date or null; resolve relative dates such as "Friday" from the meeting date {{DATE}}), "source_timestamp_sec" (second in which the task was agreed), "timeframe" ("today" | "this_week" | "later" | ISO date or null), "context" (one short sentence: why the task came up, or null) }.

Invent nothing that is not in the transcript. Language: that of the meeting, default English.`;

export const meetingProtocolPrompt = (): string =>
  byLocale({ en: MEETING_PROTOCOL_PROMPT_EN, de: MEETING_PROTOCOL_PROMPT });

export const renderMeetingPrompt = (self: string, date: string) =>
  meetingProtocolPrompt().replaceAll("{{SELF}}", self).replaceAll("{{DATE}}", date);
