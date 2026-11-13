import { describe, expect, it } from "vitest";
import type { PageSnapshot } from "@kortex/ai-core";
import { applyWatchPatch, hasUnseenChange, parseWatch, watchDue } from "@/lib/radar";
import { CRON_SECRET_HEADER, createCronHandlers } from "../cron/handler";
import { appendChangeEntry, diffSnapshots, snapshotText, textHash } from "../radar/diff";
import { createReminderHandlers } from "../reminder/handler";
import { FakeSupabase } from "./fake-supabase";
import { mockModel, mockRouter, NOW, postJson, setup, USER_ID } from "./helpers";

const SECRET = "cron-secret-0123456789-abcdefghijklmnop";
const CRON_URL = "https://kortex.test/api/cron/radar";
const ITEM = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const URL_ = "https://shop.example.com/preise";

const PAGE_V1 = "# Preise\n\nBasic kostet 9 Euro im Monat.\n\nPro kostet 19 Euro im Monat.\n\nSupport per Mail.";
const PAGE_V2 = "# Preise\n\nBasic kostet 12 Euro im Monat.\n\nPro kostet 19 Euro im Monat.\n\nSupport per Mail.\n\nNeu: Team-Tarif.";

function make(opts: { watch?: Record<string, unknown> | null; models?: ReturnType<typeof mockRouter> } = {}) {
  const watch = opts.watch === undefined ? { enabled: true, interval: "daily" } : opts.watch;
  const db = new FakeSupabase({
    allowed_users: [{ user_id: USER_ID }],
    user_settings: [{ user_id: USER_ID, weekly_digest_day: 1, daily_ai_budget_eur: 2 }],
    knowledge_items: [
      {
        id: ITEM,
        user_id: USER_ID,
        title: "Preise Shop",
        type: "bookmark",
        status: "processed",
        source_url: URL_,
        content_md: "# Preise Shop\n\nNotizen",
        metadata: watch ? { watch, other: 1 } : { other: 1 },
        remind_at: null,
      },
    ],
  });
  const s = setup({ db, models: opts.models ?? mockRouter({ fast: mockModel(["Basic kostet jetzt 12 statt 9 Euro; neuer Team-Tarif."]) }), env: { KORTEX_CRON_SECRET: SECRET } });
  const page: { next: PageSnapshot; urls: string[] } = { next: { ok: true, markdown: PAGE_V1 }, urls: [] };
  const h = createCronHandlers(() => s.deps, {
    fetchPage: async (url) => {
      page.urls.push(url);
      return page.next;
    },
  });
  const run = (body: unknown = {}) =>
    h.radar(new Request(CRON_URL, { method: "POST", headers: { "content-type": "application/json", [CRON_SECRET_HEADER]: SECRET }, body: JSON.stringify(body) }));
  const item = () => db.rows("knowledge_items").find((r) => r.id === ITEM)!;
  const watchOf = () => (item().metadata as { watch: Record<string, unknown> }).watch;
  return { db, h, run, page, item, watchOf };
}

describe("diff helpers", () => {
  it("snapshot text drops link targets and duplicates; diff lists new and removed lines", () => {
    const a = snapshotText("# Titel\n\n[Preis](https://x.test/a?utm=1) 9 Euro\n\nPreis 9 Euro\n\n![bild](x.png)");
    expect(a).toBe("Titel\nPreis 9 Euro");
    const d = diffSnapshots("Titel\nPreis 9 Euro\nAlt", "Titel\nPreis 12 Euro");
    expect(d).toMatchObject({ added: ["Preis 12 Euro"], removed: ["Preis 9 Euro", "Alt"], addedCount: 1, removedCount: 2 });
    expect(textHash("a")).toBe(textHash("a"));
    expect(textHash("a")).not.toBe(textHash("b"));
  });

  it("keeps the snapshot small", () => {
    const big = Array.from({ length: 2000 }, (_, i) => `Zeile ${i} mit etwas Text`).join("\n\n");
    expect(snapshotText(big).length).toBeLessThanOrEqual(6000);
  });

  it("appendChangeEntry adds one bullet to the Änderungen section and keeps the rest", () => {
    const one = appendChangeEntry("# T\n\nText", "2026-11-01", "Preis steigt");
    expect(one).toBe("# T\n\nText\n\n## Änderungen\n\n- 2026-11-01: Preis steigt\n");
    const two = appendChangeEntry(`${one}\n## Weiteres\n\nSpäter`, "2026-11-02", "Neu");
    expect(two).toContain("## Änderungen\n\n- 2026-11-01: Preis steigt\n- 2026-11-02: Neu\n");
    expect(two).toContain("## Weiteres\n\nSpäter");
  });
});

describe("watch state", () => {
  it("is due on the first check and after the interval", () => {
    const w = parseWatch({ watch: { enabled: true, interval: "daily" } })!;
    expect(watchDue(w, NOW)).toBe(true);
    expect(watchDue({ ...w, last_checked_at: new Date(NOW.getTime() - 3_600_000).toISOString() }, NOW)).toBe(false);
    expect(watchDue({ ...w, last_checked_at: new Date(NOW.getTime() - 24 * 3_600_000).toISOString() }, NOW)).toBe(true);
    const weekly = { ...w, interval: "weekly" as const, last_checked_at: new Date(NOW.getTime() - 3 * 86_400_000).toISOString() };
    expect(watchDue(weekly, NOW)).toBe(false);
    expect(watchDue({ ...w, enabled: false }, NOW)).toBe(false);
  });

  it("applyWatchPatch resets the check on enable and marks changes as seen", () => {
    const on = applyWatchPatch(null, { enabled: true, interval: "weekly" }, NOW);
    expect(on).toMatchObject({ enabled: true, interval: "weekly", last_checked_at: null });
    const withDiff = { ...on, last_diff: { at: "2026-10-23T07:00:00Z", summary: "x", added: [], removed: [] } };
    expect(hasUnseenChange(withDiff)).toBe(true);
    expect(hasUnseenChange(applyWatchPatch(withDiff, { seen: true }, NOW))).toBe(false);
  });
});

describe("POST /api/cron/radar", () => {
  it("refuses without the cron secret", async () => {
    const { h } = make();
    const res = await h.radar(new Request(CRON_URL, { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });

  it("first check stores the baseline, an unchanged page only moves last_checked_at", async () => {
    const { run, watchOf, page, item } = make();
    const first = await (await run()).json();
    expect(first.results).toEqual([{ item_id: ITEM, user_id: USER_ID, status: "baseline" }]);
    expect(page.urls).toEqual([URL_]);
    expect(watchOf()).toMatchObject({ enabled: true, status: "ok", last_hash: expect.any(String), last_checked_at: NOW.toISOString() });
    expect(watchOf().last_diff ?? null).toBeNull();
    expect(item().metadata).toMatchObject({ other: 1 }); // other metadata untouched

    // Not due again within the interval; forced it is unchanged.
    expect((await (await run()).json()).results).toEqual([]);
    const again = await (await run({ force: true })).json();
    expect(again.results[0].status).toBe("unchanged");
    expect(watchOf().last_diff ?? null).toBeNull();
  });

  it("a changed page gets a model summary, last_diff and an Änderungen entry", async () => {
    const { run, page, watchOf, item, db } = make();
    await run();
    page.next = { ok: true, markdown: PAGE_V2 };
    const out = await (await run({ force: true })).json();
    expect(out.results[0].status).toBe("changed");
    const diff = watchOf().last_diff as { summary: string; added: string[]; removed: string[] };
    expect(diff.summary).toBe("Basic kostet jetzt 12 statt 9 Euro; neuer Team-Tarif.");
    expect(diff.added).toContain("Basic kostet 12 Euro im Monat.");
    expect(diff.removed).toEqual(["Basic kostet 9 Euro im Monat."]);
    expect(String(item().content_md)).toContain("## Änderungen\n\n- 2026-10-23: Basic kostet jetzt 12 statt 9 Euro; neuer Team-Tarif.");
    expect(String(item().content_md)).toMatch(/^# Preise Shop\n\nNotizen/);
    // Unchanged afterwards: no new model call needed, no new diff.
    const before = db.log.length;
    const third = await (await run({ force: true })).json();
    expect(third.results[0].status).toBe("unchanged");
    expect(db.log.length).toBeGreaterThan(before);
  });

  it("falls back to a line count when the summary model fails, never silently", async () => {
    const failing = mockRouter({ fast: mockModel([]) });
    failing.fast = () => {
      throw new Error("model down");
    };
    const { run, page, watchOf } = make({ models: failing });
    await run();
    page.next = { ok: true, markdown: PAGE_V2 };
    const out = await (await run({ force: true })).json();
    expect(out.results[0].status).toBe("changed");
    expect((watchOf().last_diff as { summary: string }).summary).toBe("2 Zeilen neu, 1 entfernt");
  });

  it.each([
    ["403", "Zugriff verweigert (HTTP 403)"],
    ["429", "Zu viele Anfragen, Seite drosselt (HTTP 429)"],
    ["captcha", "Bot-/Consent-Sperre erkannt"],
    ["leer", "Seite liefert keinen Text"],
  ])("a blocking page (%s) is marked nicht beobachtbar with the reason", async (_k, reason) => {
    const { run, page, watchOf } = make();
    page.next = { ok: false, reason };
    const out = await (await run()).json();
    expect(out.results[0]).toMatchObject({ status: "nicht beobachtbar", reason });
    expect(watchOf()).toMatchObject({ enabled: true, status: "nicht beobachtbar", reason, last_checked_at: NOW.toISOString() });
  });

  it("recovers: a page that works again clears the blocked state", async () => {
    const { run, page, watchOf } = make();
    page.next = { ok: false, reason: "HTTP 429" };
    await run();
    page.next = { ok: true, markdown: PAGE_V1 };
    await run({ force: true });
    expect(watchOf()).toMatchObject({ status: "ok", reason: null });
  });

  it("ignores items that are not watched and honours the per-run limit", async () => {
    const off = make({ watch: null });
    expect((await (await off.run({ force: true })).json()).results).toEqual([]);
    const disabled = make({ watch: { enabled: false, interval: "daily" } });
    expect((await (await disabled.run({ force: true })).json()).results).toEqual([]);
    const dry = make();
    expect((await (await dry.run({ dry_run: true })).json()).results).toEqual([{ item_id: ITEM, user_id: USER_ID, status: "due" }]);
    expect(dry.page.urls).toEqual([]);
  });
});

describe("POST /api/reminder", () => {
  const REMINDER_URL = "https://kortex.test/api/reminder";
  function makeReminder() {
    const db = new FakeSupabase({
      knowledge_items: [{ id: ITEM, user_id: USER_ID, title: "x", status: "processed", remind_at: null }],
    });
    const s = setup({ db });
    return { db, h: createReminderHandlers(() => s.deps) };
  }

  it("sets, moves and clears remind_at", async () => {
    const { h, db } = makeReminder();
    const row = () => db.rows("knowledge_items")[0]!;
    const set = await h.POST(postJson(REMINDER_URL, { item_id: ITEM, remind_at: "2026-11-02T07:00:00+00:00" }));
    expect(set.status).toBe(200);
    expect(row().remind_at).toBe("2026-11-02T07:00:00.000Z");
    await h.POST(postJson(REMINDER_URL, { item_id: ITEM, remind_at: "2026-11-09T07:00:00Z" }));
    expect(row().remind_at).toBe("2026-11-09T07:00:00.000Z");
    const cleared = await h.POST(postJson(REMINDER_URL, { item_id: ITEM, remind_at: null }));
    expect(await cleared.json()).toMatchObject({ ok: true, remind_at: null });
    expect(row().remind_at).toBeNull();
  });

  it("rejects bad dates and unknown items, and needs auth", async () => {
    const { h } = makeReminder();
    expect((await h.POST(postJson(REMINDER_URL, { item_id: ITEM, remind_at: "morgen" }))).status).toBe(400);
    const missing = await h.POST(postJson(REMINDER_URL, { item_id: "22222222-2222-4222-8222-222222222222", remind_at: null }));
    expect(missing.status).toBe(404);
    const anon = await h.POST(new Request(REMINDER_URL, { method: "POST", body: "{}" }));
    expect(anon.status).toBe(401);
  });
});
