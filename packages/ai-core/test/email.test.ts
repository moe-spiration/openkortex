import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createDefaultRegistry, createEmailAdapter } from "../src/adapters";
import type { Enrichment } from "../src/enrichment/auto-organizer";
import {
  buildEml,
  cleanSubject,
  detectForward,
  emailMetadata,
  emailToMarkdown,
  encodeHeader,
  parseEmail,
  splitEmailBody,
  withEmailDigest,
} from "../src/email";
import { ingest } from "../src/pipeline/ingest";
import { createMemoryStorageGateway } from "../src/storage";
import { ITEM_ID, mockEmbeddingModel, mockModel, staticRouter, USER_ID } from "./helpers";

// Mail an Kortex (S4): parser, forwarded-mail detection, .eml builder and the email adapter.
// Fixtures are real-shaped .eml files; no network, no model calls.

const fixture = (name: string) => readFileSync(new URL(`./fixtures/email/${name}`, import.meta.url));
const INBOUND = "in.kortex.example.com";

describe("parseEmail", () => {
  it("turns an HTML newsletter into clean Markdown with subject as title", async () => {
    const e = await parseEmail(fixture("newsletter.eml"));
    expect(e.title).toBe("MCP erklärt: Agenten verbinden");
    expect(e.from).toEqual({ name: "heise Newsletter für Entwickler", address: "news@heise.de" });
    expect(e.date).toBe("2026-10-31T13:02:00.000Z");
    expect(e.messageId).toBe("20261031130200.abc123@mail.heise.de");
    expect(e.forwarded).toBeNull();
    expect(e.bodyMd).toContain("# MCP erklärt");
    expect(e.bodyMd).toContain("**Model Context Protocol**");
    expect(e.bodyMd).toContain("[Werkzeugen](https://modelcontextprotocol.io)");
    // No CSS, hidden preheader, embedded base64 image or tracking pixel in the note.
    expect(e.bodyMd).not.toMatch(/color:red|Vorschautext|data:image|track\.heise|<img/);
  });

  it("recognises the original sender of an inline forward (Gmail, German)", async () => {
    const e = await parseEmail(fixture("gmail-forward.eml"));
    expect(e.title).toBe("Angebot Kortex Workshop");
    expect(e.from?.address).toBe("max@example.com");
    expect(e.forwarded).toMatchObject({
      via: "inline",
      from: { name: "Anna Muster", address: "anna.muster@agentur.de" },
      date: "2026-10-30T16:40:00.000Z",
      subject: "Angebot Kortex Workshop",
    });
    const meta = emailMetadata(e);
    expect(meta).toMatchObject({
      forwarded: true,
      sender: "anna.muster@agentur.de",
      sender_name: "Anna Muster",
      from: "max@example.com",
      original_from: "anna.muster@agentur.de",
    });
  });

  it("reads a forward sent as attached message (Outlook) and lists real attachments", async () => {
    const e = await parseEmail(fixture("outlook-attachment-forward.eml"));
    expect(e.title).toBe("Protokoll Kickoff");
    expect(e.forwarded).toMatchObject({
      via: "attachment",
      from: { name: "Bernd Beispiel", address: "bernd@kunde.de" },
    });
    expect(e.bodyMd).toContain("FYI");
    expect(e.bodyMd).toContain("Max schickt die Roadmap bis 06.11.");
    expect(e.attachments).toEqual([
      { filename: "roadmap.pdf", mimeType: "application/pdf", sizeBytes: 82, inline: false, contentId: null },
    ]);
    const md = emailToMarkdown(e);
    expect(md).toMatch(/^- \*\*Von:\*\* Bernd Beispiel <bernd@kunde\.de>\n/);
    expect(md).toContain("- **Datum:** 2026-10-29 11:00 UTC\n- **Betreff:** Protokoll Kickoff");
    expect(md).toContain("- **Weitergeleitet von:** Max Miller <max@example.com>, 2026-11-01 10:00 UTC");
    expect(md).toContain("> **Notiz beim Weiterleiten:** FYI\n\n## Nachricht\n\nErgebnisse vom Kickoff");
    expect(md).toMatch(/## Anhänge\n\n- roadmap\.pdf \(application\/pdf, 1 KB\)$/);
  });
});

describe("structured email note", () => {
  const INBOUND_HIDE = (address: string) => address.endsWith(`@${INBOUND}`);
  const render = async (name: string) => {
    const parsed = await parseEmail(fixture(name));
    return { parsed, md: emailToMarkdown({ ...parsed, to: parsed.to.filter((a) => !INBOUND_HIDE(a.address)) }) };
  };
  const headings = (md: string) => md.match(/^#{2,3} .+$/gm);

  it("Gmail HTML forward: header block from the forward, note, message, signature, quoted reply", async () => {
    const { parsed, md } = await render("gmail-forward-html.eml");
    expect(parsed.title).toBe("Angebot Kortex Workshop");
    expect(md.startsWith(
      [
        "- **Von:** Anna Muster <anna.muster@agentur.de>",
        "- **An:** Max Miller <max@example.com>",
        "- **Datum:** 2026-10-30 16:40 UTC",
        "- **Betreff:** Re: Angebot Kortex Workshop",
        "- **Weitergeleitet von:** Max Miller <max@example.com>, 2026-11-01 08:15 UTC",
        "",
        "> **Notiz beim Weiterleiten:** Bitte ablegen, Termin steht.",
        "",
        "## Nachricht",
        "",
        "Hallo Max,",
        "",
        "anbei das Angebot für den Workshop am **12.11.**\\",
        "Bitte gib mir bis Mittwoch Bescheid.",
        "",
        "Details: <https://agentur.de/angebot/4711>",
      ].join("\n"),
    )).toBe(true);
    expect(headings(md)).toEqual(["## Nachricht", "### Signatur", "## Zitierter Verlauf"]);
    expect(md).toContain("### Signatur\n\nAnna Muster\\\nAgentur GmbH | Musterstraße 1 | 10115 Berlin\\\nTel. +49 30 1234567");
    expect(md).toContain(
      "## Zitierter Verlauf\n\n> Am Do., 29. Okt. 2026 um 10:00 Uhr schrieb Max Miller <max@example.com>:\n>\n> > Hallo Anna,",
    );
    // The forward marker and its header lines are parsed, not left in the text.
    expect(md).not.toMatch(/Forwarded message|^Date:|^Subject:|^To:/m);
    // No tracking pixels, no raw HTML, no escaped dashes, no runs of blank lines.
    expect(md).not.toMatch(/mailtrack|\/e\/o\/|<img|<div|\\-|\n{3,}/);
    expect(md).not.toContain("k7x2mqa4vd5tbe3pwn6r");
  });

  it("Outlook HTML forward without marker line: Von/Gesendet block becomes the header, reply chain is quoted", async () => {
    const { parsed, md } = await render("outlook-forward-html.eml");
    expect(parsed.forwarded).toMatchObject({
      from: { name: "Erik Ernst", address: "erik@firma.de" },
      date: "2026-10-30T08:00:00.000Z",
      subject: "AW: Rechnung 4711",
    });
    expect(emailMetadata(parsed)).toMatchObject({ forwarded: true, sender: "erik@firma.de" });
    expect(md).toMatch(/^- \*\*Von:\*\* Erik Ernst <erik@firma\.de>\n- \*\*An:\*\* Max Miller <max@example\.com>\n- \*\*Datum:\*\* 2026-10-30 08:00 UTC\n- \*\*Betreff:\*\* AW: Rechnung 4711\n/);
    expect(headings(md)).toEqual(["## Nachricht", "## Zitierter Verlauf", "## Anhänge"]);
    const message = md.slice(md.indexOf("## Nachricht"), md.indexOf("## Zitierter Verlauf"));
    expect(message).toContain("Das Zahlungsziel ist der **15.11.2026**.");
    // Links keep their target exactly as sent.
    expect(message).toContain("[Kundenportal](https://firma.de/portal?utm_source=mail)");
    expect(message).not.toMatch(/Gesendet:|wann kommt die Rechnung/);
    expect(md).toContain("> **Gesendet:** Donnerstag, 29. Oktober 2026 17:12\\\n");
    expect(md).toContain(">\n> Hallo Herr Ernst, wann kommt die Rechnung?");
    expect(md).toMatch(/## Anhänge\n\n- Rechnung_4711\.pdf \(application\/pdf, 1 KB\)$/);
    expect(md).not.toMatch(/track\/open|&nbsp;|MsoNormal|o:p|\n{3,}/);
  });

  it("plain-text mail: short lines keep their breaks, wrapped paragraphs flow, quotes move down", async () => {
    const text = [
      "Hallo Max,",
      "",
      "hier ein längerer Absatz, den das Mailprogramm nach rund siebzig Zeichen hart umbrochen",
      "hat, damit er in alten Clients lesbar bleibt. Er soll als ein Absatz erscheinen.",
      "",
      "Viele Grüße",
      "Carla",
      "",
      "-- ",
      "Carla Client",
      "client.io",
      "",
      "Von meinem iPhone gesendet",
      "",
      "On Thu, Oct 29, 2026 at 9:12 AM Max Miller <max@example.com> wrote:",
      "> Wie ist der Stand?",
      "> Danke",
    ].join("\n");
    const parsed = await parseEmail(
      buildEml({ from: "Carla Client <carla@client.io>", to: ["max@example.com"], subject: "Re: Stand", text }),
    );
    const md = emailToMarkdown(parsed);
    expect(parsed.forwarded).toBeNull();
    expect(md).toContain("- **Betreff:** Re: Stand");
    expect(md).toContain(
      "## Nachricht\n\nHallo Max,\n\nhier ein längerer Absatz, den das Mailprogramm nach rund siebzig Zeichen hart umbrochen\nhat, damit er",
    );
    expect(md).toContain("Viele Grüße\\\nCarla\n\n### Signatur\n\nCarla Client\\\nclient.io\n\n## Zitierter Verlauf");
    expect(md).toContain("> On Thu, Oct 29, 2026 at 9:12 AM Max Miller <max@example.com> wrote:\n> > Wie ist der Stand?");
    expect(md).not.toContain("iPhone");
  });

  it("splitEmailBody keeps a mail that is only a quote as the message", () => {
    expect(splitEmailBody("> nur zitiert\n> zweite Zeile")).toMatchObject({
      message: "> nur zitiert\n> zweite Zeile",
      quoted: null,
      note: null,
      signature: null,
    });
  });

  it("withEmailDigest puts TL;DR and action items under the header, once", async () => {
    const { md } = await render("gmail-forward-html.eml");
    const digest = {
      summary: "Anna schickt das Angebot für den Workshop am 12.11.",
      actionItems: [{ title: "Anna bis Mittwoch antworten", due_date: "2026-11-04" }],
    };
    const out = withEmailDigest(md, digest);
    expect(out).toContain(
      "- **Weitergeleitet von:** Max Miller <max@example.com>, 2026-11-01 08:15 UTC\n\n## TL;DR\n\nAnna schickt das Angebot für den Workshop am 12.11.\n\n## Aufgaben\n\n- [ ] Anna bis Mittwoch antworten · Fällig: 2026-11-04\n\n> **Notiz beim Weiterleiten:**",
    );
    expect(withEmailDigest(out, digest)).toBe(out);
    expect(withEmailDigest(md, { summary: null, actionItems: [] })).toBe(md);
  });
});

describe("detectForward", () => {
  it.each([
    [
      "Outlook (English, underscores)",
      "See below\n\n________________________________\nFrom: Carla Client <carla@client.io>\nSent: Thursday, October 29, 2026 9:12 AM\nTo: Max\nSubject: RE: Budget\n\nHi",
      { address: "carla@client.io", subject: "RE: Budget" },
    ],
    [
      "Apple Mail",
      "Begin forwarded message:\n\nFrom: Dora <dora@icloud.com>\nSubject: Fotos\nDate: 28 October 2026 at 18:03:11 CET\nTo: Max <max@example.com>\n\nHier die Fotos",
      { address: "dora@icloud.com", subject: "Fotos" },
    ],
    [
      "Outlook (German, mailto in brackets)",
      "-----Ursprüngliche Nachricht-----\nVon: Erik Ernst [mailto:erik@firma.de]\nGesendet: Freitag, 30. Oktober 2026 08:00\nAn: Max\nBetreff: Rechnung 4711\n\nAnbei.",
      { address: "erik@firma.de", subject: "Rechnung 4711" },
    ],
    [
      "Markdown from HTML (bold keys, mailto links)",
      "---------- Forwarded message ---------\n**From:** Fritz <[fritz@x.org](mailto:fritz@x.org)>\n**Subject:** Hallo\n\nText",
      { address: "fritz@x.org", subject: "Hallo" },
    ],
  ])("%s", (_name, body, want) => {
    const f = detectForward(body);
    expect(f?.from?.address).toBe(want.address);
    expect(f?.subject).toBe(want.subject);
  });

  it("parses German dates", () => {
    const f = detectForward(
      "-----Ursprüngliche Nachricht-----\nVon: Erik <erik@firma.de>\nGesendet: Freitag, 30. Oktober 2026 08:00\n\nx",
    );
    expect(f?.date).toBe("2026-10-30T08:00:00.000Z");
  });

  it("ignores mails without a forward block", () => {
    expect(detectForward("Hallo,\n\nVon: hier aus geht es los.")).toBeNull();
    expect(detectForward("---------- Forwarded message ---------\n\nnur Text ohne Kopf")).toBeNull();
  });
});

describe("helpers", () => {
  it("cleans reply and forward prefixes", () => {
    expect(cleanSubject("Fwd: AW: WG: Re[2]: Angebot")).toBe("Angebot");
    expect(cleanSubject("Reisekosten")).toBe("Reisekosten");
  });

  it("buildEml round-trips Resend's JSON through the same parser (umlauts, no header injection)", async () => {
    const eml = buildEml({
      from: "Jürgen Groß <juergen@example.de>",
      to: ["k7x2mqa4vd5tbe3pwn6r@in.kortex.example.com"],
      subject: "Überweisung\r\nBcc: evil@x",
      date: "2026-10-31T10:00:00.000Z",
      messageId: "<abc@example.de>",
      html: "<p>Bitte <b>bis Montag</b> zahlen.</p>",
      text: "Bitte bis Montag zahlen.",
    });
    const e = await parseEmail(eml);
    expect(e.from).toEqual({ name: "Jürgen Groß", address: "juergen@example.de" });
    expect(e.subject).toBe("Überweisung Bcc: evil@x");
    expect(e.messageId).toBe("abc@example.de");
    expect(e.date).toBe("2026-10-31T10:00:00.000Z");
    expect(e.bodyMd).toBe("Bitte **bis Montag** zahlen.");
    expect(new TextDecoder().decode(eml)).not.toMatch(/^Bcc:/m);
    expect(encodeHeader("plain")).toBe("plain");
  });
});

describe("email adapter", () => {
  it("extracts subject, metadata and stores the original .eml; hides the private Kortex address", async () => {
    const storage = createMemoryStorageGateway();
    const adapter = createEmailAdapter({ storage, inboundDomain: INBOUND });
    const input = {
      userId: USER_ID,
      itemId: ITEM_ID,
      fileBuffer: new Uint8Array(fixture("gmail-forward.eml")),
      fileName: "mail.eml",
      mimeType: "message/rfc822",
    };
    expect(adapter.canHandle(input)).toBe(true);
    const out = await adapter.extract(input);
    expect(out).toMatchObject({
      type: "email",
      sourcePlatform: "email",
      titleHint: "Angebot Kortex Workshop",
      file: { bucket: "kortex-documents", path: `${USER_ID}/${ITEM_ID}.eml`, mimeType: "message/rfc822" },
      metadata: { message_id: "CAF+fwd-001@mail.gmail.com", to: [], sender: "anna.muster@agentur.de" },
    });
    expect(out.contentMd).not.toContain(INBOUND);
    expect(storage.files.has(`kortex-documents/${USER_ID}/${ITEM_ID}.eml`)).toBe(true);
  });

  it("declines bytes that are not an e-mail", async () => {
    const adapter = createEmailAdapter();
    const err = await adapter
      .extract({ userId: USER_ID, fileBuffer: new Uint8Array(0), fileName: "x.eml" })
      .catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/email declined/);
  });

  it("runs through ingest(): email item, organizer action items, subject kept as title hint", async () => {
    const enrichment: Enrichment = {
      title: "Angebot Kortex Workshop",
      summary: "Anna schickt das Angebot für den Workshop am 12.11.",
      cluster_name: "Arbeit",
      suggested_folder_path: "00_Inbox",
      tags: ["arbeit/angebote"],
      entities: [{ name: "Anna Muster", type: "person" }],
      action_items: [
        {
          title: "Anna bis Mittwoch antworten",
          description: null,
          assignee: "Me",
          priority: "high",
          due_date: "2026-11-04",
          source_timestamp_sec: null,
        },
      ],
    };
    const storage = createMemoryStorageGateway();
    const models = staticRouter({ fast: mockModel(enrichment), embedding: mockEmbeddingModel() });
    const registry = createDefaultRegistry({ storage, models, inboundMailDomain: INBOUND });
    const res = await ingest(
      {
        userId: USER_ID,
        fileBuffer: new Uint8Array(fixture("gmail-forward.eml")),
        fileName: "mail.eml",
        mimeType: "message/rfc822",
        typeHint: "email",
      },
      {
        existingTags: [],
        existingClusters: [],
        existingObjects: [],
        folders: [{ id: "f-inbox", folder_path: "00_Inbox" }],
      },
      { registry, models, generateId: () => ITEM_ID, now: () => new Date("2026-11-01T09:00:00Z") },
    );
    expect(res.adapterId).toBe("email");
    expect(res.item).toMatchObject({ type: "email", source_platform: "email", icon: "mail" });
    expect(res.item.file_storage_path).toBe(`${USER_ID}/${ITEM_ID}.eml`);
    expect(res.actionItems).toMatchObject([{ title: "Anna bis Mittwoch antworten", priority: "high" }]);
    expect(res.item.metadata).toMatchObject({ message_id: "CAF+fwd-001@mail.gmail.com", forwarded: true });
    // The organizer's TL;DR and tasks sit under the header block (one model call, no extra one).
    const md = res.item.content_md!;
    expect(md).toContain(
      "## TL;DR\n\nAnna schickt das Angebot für den Workshop am 12.11.\n\n## Aufgaben\n\n- [ ] Anna bis Mittwoch antworten · Fällig: 2026-11-04",
    );
    expect(md.indexOf("- **Von:** Anna Muster")).toBe(0);
    expect(md.indexOf("## TL;DR")).toBeLessThan(md.indexOf("## Nachricht"));
  });
});
