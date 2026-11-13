import { acceptLanguage, msg, t } from "../../i18n";
import { BROWSER_USER_AGENT, defaultFetch, type FetchLike } from "../../http";
import { createSafeFetch, readBodyLimited } from "../../net/safe-fetch";
import { blockedPageReason } from "../web-article.adapter";
import { decodeHtml, readHtml } from "./direct-reader";

/*
 * Page snapshot for the delta radar (S11): fetch one watched URL politely and return its main text
 * as Markdown, or say why that is not possible. Never throws: a page that blocks us (403/429,
 * robots.txt, captcha, empty shell) comes back as `{ ok: false, reason }`, so the caller can mark
 * it "nicht beobachtbar" instead of failing silently. Public hosts only (createSafeFetch).
 */

export type PageSnapshot =
  | { ok: true; markdown: string; title?: string }
  | { ok: false; reason: string };

export interface PageSnapshotOptions {
  fetch?: FetchLike;
  /** Per request (robots.txt and page). Default 15 s. */
  timeoutMs?: number;
  /** HTML bytes read at most. Default 2 MB. */
  maxBytes?: number;
}

/** Pages shorter than this (characters of Markdown) are treated as empty shells. */
export const MIN_SNAPSHOT_CHARS = 200;

const STATUS_REASON: Record<number, string> = {
  401: msg("Sign-in required (HTTP 401)"),
  403: msg("Access denied (HTTP 403)"),
  404: msg("Page not found (HTTP 404)"),
  410: msg("Page removed (HTTP 410)"),
  429: msg("Too many requests, the site is throttling (HTTP 429)"),
  451: msg("Blocked for legal reasons (HTTP 451)"),
};

/** True when robots.txt (rules for "kortexbot" or "*") disallows `path`. Longest matching rule wins. */
export function robotsDisallows(robots: string, path: string): boolean {
  type Group = { agents: string[]; rules: Array<{ allow: boolean; prefix: string }> };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (cur && (key === "disallow" || key === "allow") && value)
      cur.rules.push({ allow: key === "allow", prefix: value });
  }
  const own = groups.filter((g) => g.agents.some((a) => a.includes("kortexbot")));
  const rules = (own.length ? own : groups.filter((g) => g.agents.includes("*"))).flatMap(
    (g) => g.rules,
  );
  let best: { allow: boolean; len: number } | null = null;
  for (const r of rules) {
    const prefix = r.prefix.replace(/\$$/, "");
    const hit = r.prefix.endsWith("$") ? path === prefix : path.startsWith(prefix.replace(/\*.*$/, ""));
    if (hit && (!best || prefix.length > best.len)) best = { allow: r.allow, len: prefix.length };
  }
  return !!best && !best.allow;
}

export async function fetchPageSnapshot(
  url: string,
  options: PageSnapshotOptions = {},
): Promise<PageSnapshot> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const safe = createSafeFetch({ fetch: options.fetch ?? defaultFetch, timeoutMs });
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { ok: false, reason: t("Invalid address") };
  }
  const headers = { "User-Agent": BROWSER_USER_AGENT };

  try {
    // robots.txt: unreachable or broken means "no rules".
    const robots = await safe(new URL("/robots.txt", target).href, { headers }).catch(() => null);
    if (robots?.ok) {
      const text = (await robots.text().catch(() => "")).slice(0, 200_000);
      if (robotsDisallows(text, target.pathname + target.search))
        return { ok: false, reason: t("The site's robots.txt forbids fetching") };
    } else await robots?.body?.cancel().catch(() => {});

    const res = await safe(target.href, {
      headers: {
        ...headers,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": acceptLanguage(),
      },
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: STATUS_REASON[res.status] ? t(STATUS_REASON[res.status]!) : `HTTP ${res.status}` };
    }
    const type = res.headers.get("content-type");
    if (type && !/html|xml/i.test(type))
      return { ok: false, reason: t("Not HTML ({type})", { type: type.split(";")[0] ?? "" }) };
    const bytes = await readBodyLimited(res, options.maxBytes ?? 2 * 1024 * 1024);
    if (!bytes) return { ok: false, reason: t("Page too large") };
    const page = await readHtml(decodeHtml(bytes, type), res.url || target.href);
    const blocked = blockedPageReason(page.title, page.markdown);
    if (blocked) return { ok: false, reason: t("Bot or consent wall detected: {reason}", { reason: blocked }) };
    if (page.markdown.length < MIN_SNAPSHOT_CHARS)
      return { ok: false, reason: t("The page returns no text (empty or JavaScript only)") };
    return { ok: true, markdown: page.markdown, title: page.title };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: t("Not reachable: {reason}", { reason: message.slice(0, 160) }) };
  }
}
