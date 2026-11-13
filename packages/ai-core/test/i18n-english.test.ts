import { readFileSync } from "node:fs";
import { withLocale } from "@kortex/i18n";
import { describe, expect, it } from "vitest";
import { renderMeetingMarkdown, takeawaysPrompt } from "../src";
import type { MeetingTranscript } from "../src/audio/meeting-transcript";
import { emailToMarkdown, parseEmail, withEmailDigest } from "../src/email";
import { parseFlashcardsSection, renderFlashcardsSection } from "../src/flashcards/markdown";
import { headingRe, ph, phForms } from "../src/i18n";
import { meetingProtocolPrompt, MEETING_PROTOCOL_PROMPT } from "../src/prompts/meeting";
import { defaultOutputLanguage, renderOrganizerPrompt } from "../src/prompts/organizer";

// The suite runs in German (test/setup.ts). These tests cover the English side of the most
// important generators and one reader that has to accept both languages.

const fixture = (name: string) => readFileSync(new URL(`./fixtures/email/${name}`, import.meta.url));
const en = <T>(fn: () => T): T => withLocale("en", fn);

describe("prompts follow the ambient language", () => {
  const vars = { existingClusters: [], existingTags: [], existingObjects: [], manualPlacement: false };

  it("organizer: default output language", () => {
    expect(defaultOutputLanguage()).toBe("German");
    expect(en(defaultOutputLanguage)).toBe("English");
    const de = renderOrganizerPrompt(vars);
    const english = en(() => renderOrganizerPrompt(vars));
    expect(english).not.toBe(de);
    expect(english).toContain("English");
    expect(english).not.toContain("{{DEFAULT_LANGUAGE}}");
    // An explicit language still wins.
    expect(en(() => renderOrganizerPrompt({ ...vars, defaultLanguage: "French" }))).toContain("French");
  });

  it("meeting minutes and chat takeaways: German original in German, English text in English", () => {
    expect(meetingProtocolPrompt()).toBe(MEETING_PROTOCOL_PROMPT);
    const english = en(meetingProtocolPrompt);
    expect(english).not.toBe(MEETING_PROTOCOL_PROMPT);
    expect(english).not.toMatch(/[äöüß]/);
    expect(en(() => takeawaysPrompt())).not.toBe(takeawaysPrompt());
    expect(en(() => takeawaysPrompt())).not.toMatch(/[äöüß]/);
  });
});

describe("generated Markdown in English", () => {
  const transcript: MeetingTranscript = {
    format: "kortex",
    durationSec: 95,
    speakers: ["Me", "Other participant"],
    segments: [{ channel: 0, speaker: "Me", startSec: 0, endSec: 4, text: "Let us start." }],
  };
  const protocol = {
    executive_summary: "Kickoff went well.",
    topics: [{ title: "Scope", summary: "Agreed on the MVP.", start_sec: 0 }],
    decisions: ["Ship in March"],
    risks: ["No designer yet"],
  } as unknown as Parameters<typeof renderMeetingMarkdown>[1];
  const meta = { title: "Kickoff", date: "2026-11-02T09:00:00.000Z" };

  it("meeting note", () => {
    const md = en(() => renderMeetingMarkdown(transcript, protocol, [], meta));
    expect(md).toContain("Participants: Me, Other participant");
    expect(md).toContain("## Executive Summary\n\nKickoff went well.");
    expect(md).toContain("## Topics discussed\n\n### 1. Scope [00:00:00]");
    expect(md).toContain("## Decisions made\n\n- Ship in March");
    expect(md).toContain("## Open risks & blockers\n\n- No designer yet");
    expect(md).toContain("Transcript");
    expect(md).not.toMatch(/Teilnehmer|Themenblöcke|Entscheidungen|Risiken|Transkript/);

    const german = renderMeetingMarkdown(transcript, protocol, [], meta);
    expect(german).toContain("## Besprochene Themenblöcke");
    expect(german).toContain("## Getroffene Entscheidungen");

    expect(en(() => renderMeetingMarkdown(transcript, null, [], meta))).toContain(
      "> The minutes could not be created; the full transcript is saved.",
    );
  });

  it("e-mail note and its digest", async () => {
    const parsed = await parseEmail(fixture("gmail-forward-html.eml"));
    const md = en(() => emailToMarkdown(parsed));
    expect(md).toMatch(/^- \*\*From:\*\* Anna Muster <anna\.muster@agentur\.de>\n/);
    expect(md).toContain("- **Subject:** Re: Angebot Kortex Workshop");
    expect(md).toContain("- **Forwarded by:** Max Miller <max@example.com>");
    expect(md).toContain("> **Note when forwarding:**");
    expect(md).toContain("## Message\n\n");
    expect(md).not.toMatch(/\*\*(Von|An|Datum|Betreff):\*\*|## Nachricht/);

    const digest = { summary: "Anna sends the offer.", actionItems: [{ title: "Reply to Anna" }] };
    const out = en(() => withEmailDigest(md, digest));
    expect(out).toContain("## TL;DR\n\nAnna sends the offer.\n\n## Action Items\n\n- [ ] Reply to Anna");
    expect(out.indexOf("## TL;DR")).toBeLessThan(out.indexOf("> **Note when forwarding:**"));
    // Readers take both languages: an English note is not digested twice by a German process,
    // and a German note not by an English one.
    expect(withEmailDigest(out, digest)).toBe(out);
    const germanOut = withEmailDigest(emailToMarkdown(parsed), digest);
    expect(germanOut).toContain("> **Notiz beim Weiterleiten:**");
    expect(germanOut.indexOf("## TL;DR")).toBeLessThan(germanOut.indexOf("> **Notiz beim Weiterleiten:**"));
    expect(en(() => withEmailDigest(germanOut, digest))).toBe(germanOut);
  });
});

describe("readers accept both languages", () => {
  const cards = [
    { question: "What is Kortex?", answer: "A second brain." },
    { question: "Where do objects live?", answer: "In 70_Objects.\nAs Markdown." },
  ];

  it("flashcards section", () => {
    const german = renderFlashcardsSection(cards);
    const english = en(() => renderFlashcardsSection(cards));
    expect(german).toMatch(/^## Karteikarten\n\n- \*\*F:\*\* What is Kortex\?\n {2}\*\*A:\*\* A second brain\./);
    expect(english).toMatch(/^## Flashcards\n\n- \*\*Q:\*\* What is Kortex\?\n {2}\*\*A:\*\* A second brain\./);
    // Each language reads the other one's section.
    expect(parseFlashcardsSection(english)).toEqual(cards);
    expect(en(() => parseFlashcardsSection(german))).toEqual(cards);
    expect(en(() => parseFlashcardsSection(english))).toEqual(cards);
  });

  it("phrase helpers", () => {
    expect(ph("transcript")).toBe("Transkript");
    expect(en(() => ph("transcript"))).toBe("Transcript");
    expect(phForms("linked")).toEqual(expect.arrayContaining(["Linked", "Verknüpft"]));
    const re = headingRe("linked");
    expect(re.test("intro\n\n## Verknüpft\n\n- a")).toBe(true);
    expect(headingRe("linked").test("intro\n\n## Linked\n\n- a")).toBe(true);
    expect(headingRe("linked").test("intro\n\n## Links\n")).toBe(false);
  });
});
