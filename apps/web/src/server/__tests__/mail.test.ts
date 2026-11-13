import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAccessCache, resetRateLimits } from "../limits";
import {
  findInboundRecipient,
  generateInboundToken,
  INBOUND_TOKEN,
  inboundMailConfig,
  parseInboundRecipient,
} from "../ingest/mail/address";
import { createMailHandlers } from "../ingest/mail/handler";
import type { ResendAttachment, ResendClient, ResendReceivedEmail } from "../ingest/mail/resend";
import { mailItemId } from "../ingest/mail/service";
import { disableInboundMail, readInboundMail, rotateInboundMail } from "../ingest/mail/settings";
import { signSvix, verifySvix } from "../ingest/mail/svix";
import { FakeSupabase } from "./fake-supabase";
import { authed, mockModel, mockRouter, NOW, OTHER_USER, seedFolders, setup, USER_ID } from "./helpers";

// Mail an Kortex (S4): Resend webhook → email item. No real Resend or model calls.

const URL_MAIL = "https://kortex.test/api/ingest/mail";
const DOMAIN = "in.kortex.example.com";
const SECRET = `whsec_${randomBytes(32).toString("base64")}`;
const TOKEN = "k7x2mqa4vd5tbe3pwn6r";
const ENV = { RESEND_API_KEY: "re_test", RESEND_WEBHOOK_SECRET: SECRET, KORTEX_INBOUND_MAIL_DOMAIN: DOMAIN };
const fixture = (name: string) =>
  readFileSync(new URL(`../../../../../packages/ai-core/test/fixtures/email/${name}`, import.meta.url));

const event = (over: Record<string, unknown> = {}) => ({
  type: "email.received",
  created_at: "2026-11-01T08:15:01.000Z",
  data: {
    email_id: "56761188-7520-42d8-8898-ff6fc54ce618",
    created_at: "2026-11-01T08:15:00.000Z",
    from: "Max Miller <max@example.com>",
    to: [`${TOKEN}@${DOMAIN}`],
    cc: [],
    bcc: [],
    received_for: [],
    message_id: "<CAF+fwd-001@mail.gmail.com>",
    subject: "WG: Angebot Kortex Workshop",
    attachments: [],
    ...over,
  },
});

function signed(body: unknown, opts: { secret?: string; at?: Date; id?: string } = {}) {
  const raw = JSON.stringify(body);
  const id = opts.id ?? "msg_2Kx";
  const ts = String(Math.floor((opts.at ?? NOW).getTime() / 1000));
  return new Request(URL_MAIL, {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": ts,
      "svix-signature": `v1,${signSvix(opts.secret ?? SECRET, id, ts, raw)}`,
    },
  });
}

/** In-memory Resend: one received mail with optional attachments. */
function fakeResend(opts: { raw?: Uint8Array | null; attachments?: ResendAttachment[]; files?: Record<string, Uint8Array>; text?: string } = {}) {
  const calls: string[] = [];
  const email: ResendReceivedEmail = {
    id: "56761188-7520-42d8-8898-ff6fc54ce618",
    from: "Max Miller <max@example.com>",
    to: [`${TOKEN}@${DOMAIN}`],
    subject: "WG: Angebot Kortex Workshop",
    created_at: "2026-11-01T08:15:00.000Z",
    html: null,
    text: opts.text ?? "Hallo Max,\n\nbitte bis Mittwoch antworten.",
    headers: { from: "Max Miller <max@example.com>", date: "Sun, 01 Nov 2026 09:15:00 +0100" },
    message_id: "<CAF+fwd-001@mail.gmail.com>",
    raw: opts.raw === null ? null : { download_url: "https://inbound-cdn.resend.test/raw/1", expires_at: "x" },
    attachments: (opts.attachments ?? []).map((a) => ({ id: a.id, filename: a.filename, content_type: a.content_type, size: a.size })),
  };
  const client: ResendClient = {
    async getReceivedEmail(id) {
      calls.push(`get ${id}`);
      return email;
    },
    async listAttachments(id) {
      calls.push(`list ${id}`);
      return opts.attachments ?? [];
    },
    async download(url) {
      calls.push(`download ${url}`);
      if (url.endsWith("/raw/1")) return opts.raw === null ? null : (opts.raw ?? new Uint8Array(fixture("gmail-forward.eml")));
      return opts.files?.[url] ?? null;
    },
  };
  return { client, calls };
}

function make(opts: { env?: Record<string, string>; resend?: ReturnType<typeof fakeResend>; token?: string | null } = {}) {
  const db = new FakeSupabase();
  seedFolders(db);
  db.rows("user_settings").push(
    { user_id: USER_ID, inbound_mail_token: opts.token === undefined ? TOKEN : opts.token, inbound_mail_rotated_at: "2026-11-01T00:00:00.000Z" },
    { user_id: OTHER_USER, inbound_mail_token: null },
  );
  const s = setup({
    db,
    env: opts.env ?? ENV,
    models: mockRouter({
      fast: mockModel([
        {
          title: "Workshop-Angebot",
          summary: "Anna schickt das Angebot.",
          cluster_name: "Arbeit",
          suggested_folder_path: "00_Inbox",
          tags: ["arbeit"],
          entities: [],
          action_items: [
            { title: "Anna antworten", description: null, assignee: "Me", priority: "high", due_date: "2026-11-04", source_timestamp_sec: null },
          ],
        },
      ]),
    }),
  });
  const resend = opts.resend ?? fakeResend();
  return { ...s, resend, h: createMailHandlers(() => s.deps, { resend: resend.client }) };
}

const items = (db: FakeSupabase) => db.rows("knowledge_items");

beforeEach(() => {
  resetAccessCache();
  resetRateLimits();
});

describe("svix signature", () => {
  const body = '{"type":"email.received"}';
  const ts = String(Math.floor(NOW.getTime() / 1000));
  const sig = (s = SECRET) => `v1,${signSvix(s, "msg_1", ts, body)}`;
  const h = (signature: string, timestamp = ts) => ({ id: "msg_1", timestamp, signature });

  it("accepts a valid signature, also next to a rotated one", () => {
    expect(verifySvix(SECRET, h(sig()), body, NOW)).toEqual({ ok: true });
    const other = `whsec_${randomBytes(32).toString("base64")}`;
    expect(verifySvix(SECRET, h(`${sig(other)} ${sig()}`), body, NOW)).toEqual({ ok: true });
  });

  it.each([
    ["wrong secret", () => verifySvix(SECRET, h(sig(`whsec_${randomBytes(32).toString("base64")}`)), body, NOW)],
    ["tampered body", () => verifySvix(SECRET, h(sig()), body.replace("received", "sent"), NOW)],
    ["stale timestamp", () => verifySvix(SECRET, h(sig(), String(Number(ts) - 600)), body, NOW)],
    ["missing headers", () => verifySvix(SECRET, { id: null, timestamp: ts, signature: sig() }, body, NOW)],
    ["no secret configured", () => verifySvix(undefined, h(sig()), body, NOW)],
    ["unknown version", () => verifySvix(SECRET, h(sig().replace("v1,", "v2,")), body, NOW)],
  ])("rejects %s", (_name, run) => {
    expect(run().ok).toBe(false);
  });
});

describe("inbound address", () => {
  it("generates unguessable lowercase base32 tokens", () => {
    const a = generateInboundToken();
    expect(a).toMatch(INBOUND_TOKEN);
    expect(a).toHaveLength(20);
    expect(new Set(Array.from({ length: 200 }, generateInboundToken)).size).toBe(200);
  });

  it("parses token, +tag and refuses other domains or malformed tokens", () => {
    expect(parseInboundRecipient(`Kortex <${TOKEN}+Rechnungen@${DOMAIN.toUpperCase()}>`, DOMAIN)).toEqual({
      token: TOKEN,
      tag: "rechnungen",
      address: `${TOKEN}+rechnungen@${DOMAIN}`,
    });
    expect(parseInboundRecipient(`${TOKEN}@evil.example`, DOMAIN)).toBeNull();
    expect(parseInboundRecipient(`admin@${DOMAIN}`, DOMAIN)).toBeNull();
    expect(parseInboundRecipient(`${TOKEN.replace("k", "1")}@${DOMAIN}`, DOMAIN)).toBeNull();
  });

  it("prefers received_for (auto-forward from another mailbox)", () => {
    expect(
      findInboundRecipient({ to: ["me@gmail.com"], received_for: [`${TOKEN}@${DOMAIN}`] }, DOMAIN)?.token,
    ).toBe(TOKEN);
  });

  it("is off unless all three env values are set", () => {
    expect(inboundMailConfig(ENV).enabled).toBe(true);
    expect(inboundMailConfig({ ...ENV, RESEND_WEBHOOK_SECRET: "" }).enabled).toBe(false);
    expect(inboundMailConfig({ ...ENV, KORTEX_INBOUND_MAIL_DOMAIN: "<DEINE_DOMAIN>" }).enabled).toBe(false);
  });
});

describe("POST /api/ingest/mail", () => {
  it("answers 503 and does nothing without the env", async () => {
    const m = make({ env: {} });
    const res = await m.h.POST(signed(event()));
    expect(res.status).toBe(503);
    expect(m.resend.calls).toEqual([]);
    expect(items(m.db)).toEqual([]);
  });

  it("rejects a bad signature with 401 (fail-closed)", async () => {
    const m = make();
    const forged = await m.h.POST(signed(event(), { secret: `whsec_${randomBytes(32).toString("base64")}` }));
    expect(forged.status).toBe(401);
    const unsigned = await m.h.POST(new Request(URL_MAIL, { method: "POST", body: JSON.stringify(event()) }));
    expect(unsigned.status).toBe(401);
    const old = await m.h.POST(signed(event(), { at: new Date(NOW.getTime() - 3600_000) }));
    expect(old.status).toBe(401);
    expect(m.resend.calls).toEqual([]);
    expect(items(m.db)).toEqual([]);
  });

  it("drops mail to an unknown address with the same 200 as an accepted one", async () => {
    const m = make();
    const res = await m.h.POST(signed(event({ to: [`abcdefghijklmnopqrst@${DOMAIN}`] })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(m.resend.calls).toEqual([]);
    expect(items(m.db)).toEqual([]);
  });

  it("ignores other event types", async () => {
    const m = make();
    const res = await m.h.POST(signed({ type: "email.delivered", data: { email_id: "x" } }));
    expect(res.status).toBe(200);
    expect(items(m.db)).toEqual([]);
  });

  it("maps the token to its user and creates one processed email item", async () => {
    const m = make();
    const res = await m.h.POST(signed(event({ to: [`${TOKEN}+angebote@${DOMAIN}`] })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await m.drain();

    const all = items(m.db);
    expect(all).toHaveLength(1);
    const item = all[0]!;
    expect(item).toMatchObject({
      id: mailItemId(USER_ID, "CAF+fwd-001@mail.gmail.com"),
      user_id: USER_ID,
      type: "email",
      source_platform: "email",
      title: "Angebot Kortex Workshop",
      status: "processed",
      folder_path: "00_Inbox",
      file_storage_path: `${USER_ID}/${item.id}.eml`,
    });
    expect(item.tags).toContain("angebote");
    expect(item.metadata).toMatchObject({
      message_id: "CAF+fwd-001@mail.gmail.com",
      resend_email_id: "56761188-7520-42d8-8898-ff6fc54ce618",
      sender: "anna.muster@agentur.de",
      forwarded: true,
      ingest: { adapter: "email", state: "done" },
    });
    // The private address never ends up in the note.
    expect(String(item.content_md)).not.toContain(TOKEN);
    // Structured note: the forward's original sender heads the header block, TL;DR and tasks below.
    expect(String(item.content_md)).toMatch(/^- \*\*Von:\*\* Anna Muster <anna\.muster@agentur\.de>\n/);
    expect(String(item.content_md)).toContain("## TL;DR");
    expect(String(item.content_md)).toContain("- [ ] Anna antworten");
    expect(m.db.rows("action_items")).toMatchObject([{ source_item_id: item.id, title: "Anna antworten" }]);
    expect(m.db.storage.has(`kortex-documents/${USER_ID}/${item.id}.eml`)).toBe(true);
  });

  it("is idempotent: the same mail twice is one item and Resend is asked once", async () => {
    const m = make();
    expect((await m.h.POST(signed(event(), { id: "msg_a" }))).status).toBe(200);
    await m.drain();
    expect((await m.h.POST(signed(event(), { id: "msg_b" }))).status).toBe(200);
    await m.drain();
    expect(items(m.db)).toHaveLength(1);
    expect(m.resend.calls.filter((c) => c.startsWith("get "))).toHaveLength(1);
  });

  it("dedups the same text under another Message-ID (content_hash, @kortex/db dedup)", async () => {
    const text = "Hallo Max, anbei das Angebot für den Kortex-Workshop am 12.11. Bitte gib mir bis Mittwoch Bescheid, ob der Termin passt.";
    const m = make({ resend: fakeResend({ raw: null, text }) });
    expect((await m.h.POST(signed(event()))).status).toBe(200);
    await m.drain();
    const first = items(m.db)[0]!;
    expect(first.content_hash).toMatch(/^[0-9a-f]{64}$/);
    const again = event({ email_id: "7f000000-0000-4000-8000-000000000002", message_id: "<resent-2@mail.gmail.com>" });
    expect((await m.h.POST(signed(again, { id: "msg_c" }))).status).toBe(200);
    await m.drain();
    expect(items(m.db)).toHaveLength(1);
  });

  it("rebuilds the mail from Resend's JSON when the raw .eml is unavailable", async () => {
    const m = make({ resend: fakeResend({ raw: null }) });
    await m.h.POST(signed(event()));
    await m.drain();
    const item = items(m.db)[0]!;
    expect(item.type).toBe("email");
    expect(String(item.content_md)).toContain("bitte bis Mittwoch antworten.");
  });

  it("turns readable attachments into sub-pages and skips signature logos", async () => {
    const pdf = new Uint8Array(Buffer.from("%PDF-1.4\n%EOF\n"));
    const m = make({
      resend: fakeResend({
        attachments: [
          { id: "a1", filename: "angebot.pdf", content_type: "application/pdf", size: pdf.byteLength, content_disposition: "attachment", download_url: "https://inbound-cdn.resend.test/a1" },
          { id: "a2", filename: "logo.png", content_type: "image/png", size: 2048, content_disposition: "inline", content_id: "img001", download_url: "https://inbound-cdn.resend.test/a2" },
          { id: "a3", filename: "makro.docm", content_type: "application/vnd.ms-word", size: 100, content_disposition: "attachment", download_url: "https://inbound-cdn.resend.test/a3" },
        ],
        files: { "https://inbound-cdn.resend.test/a1": pdf },
      }),
    });
    await m.h.POST(signed(event()));
    await Promise.all(m.deferred);
    await m.drain();
    const mail = items(m.db).find((i) => i.type === "email")!;
    const children = items(m.db).filter((i) => i.parent_item_id === mail.id);
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ user_id: USER_ID, type: "pdf", title: "angebot" });
    expect(m.resend.calls).not.toContain("download https://inbound-cdn.resend.test/a2");
    expect(m.resend.calls).not.toContain("download https://inbound-cdn.resend.test/a3");
  });

  it("answers 5xx when Resend fails, so the webhook is retried, and writes nothing", async () => {
    const r = fakeResend();
    r.client.getReceivedEmail = async () => {
      throw new Error("Resend /emails/receiving: HTTP 502");
    };
    const m = make({ resend: r });
    const res = await m.h.POST(signed(event()));
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(items(m.db)).toEqual([]);
  });
});

describe("address settings", () => {
  it("GET returns the signed-in user's address", async () => {
    const m = make();
    const res = await m.h.GET(new Request(URL_MAIL, authed()));
    expect(await res.json()).toEqual({
      ok: true,
      data: {
        configured: true,
        domain: DOMAIN,
        address: `${TOKEN}@${DOMAIN}`,
        rotatedAt: "2026-11-01T00:00:00.000Z",
      },
    });
  });

  it("rotates (old address stops working) and switches off", async () => {
    const m = make();
    const client = m.db.client;
    const next = await rotateInboundMail(client, USER_ID, ENV, NOW);
    expect(next.address).not.toBe(`${TOKEN}@${DOMAIN}`);
    expect(next.address).toMatch(new RegExp(`^[a-z2-7]{20}@${DOMAIN.replace(/\./g, "\\.")}$`));
    expect(next.rotatedAt).toBe(NOW.toISOString());

    const res = await m.h.POST(signed(event()));
    expect(res.status).toBe(200);
    expect(items(m.db)).toEqual([]);

    const off = await disableInboundMail(client, USER_ID, ENV);
    expect(off.address).toBeNull();
    expect((await readInboundMail(client, USER_ID, ENV)).address).toBeNull();
  });

  it("refuses to create an address while the server is not set up", async () => {
    const m = make({ token: null });
    await expect(rotateInboundMail(m.db.client, USER_ID, {}, NOW)).rejects.toThrow(/nicht eingerichtet/);
  });
});
