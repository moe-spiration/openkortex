import { TAG_DOMAINS, type TagDomain } from "@kortex/ui";
import { DOMAIN_OBJECT_TYPES } from "@kortex/db/domain";
import type { ItemType, NoteType } from "@/lib/workspace-data";
import { DEFAULT_GRAPH_QUERY, GRAPH_LIMIT_MAX, type GraphQuery } from "./types";

const NOTE_TYPE_LIST: NoteType[] = ["note", "meeting", "article", "book", "video", "podcast", "ai", "recipe"];
export const ALL_ITEM_TYPES: ItemType[] = [...NOTE_TYPE_LIST, ...DOMAIN_OBJECT_TYPES];
const SINCE_CHOICES = [7, 30, 90, 365];

/** `?types=note,meeting&domain=ai,health&since=30&semantic=0&limit=2000`; unknown values fall back to the defaults. */
export function parseGraphQuery(params: URLSearchParams | Record<string, string | undefined>): GraphQuery {
  const get = (k: string) => (params instanceof URLSearchParams ? (params.get(k) ?? undefined) : params[k]);
  const typesRaw = get("types");
  const types = typesRaw
    ? typesRaw
        .split(",")
        .map((t) => t.trim())
        .filter((t): t is ItemType => (ALL_ITEM_TYPES as string[]).includes(t))
    : [];
  const domains = (get("domain") ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter((d): d is TagDomain => (TAG_DOMAINS as string[]).includes(d));
  const since = Number(get("since"));
  const limit = Number(get("limit"));
  return {
    types: types.length ? [...new Set(types)] : null,
    domains: domains.length ? [...new Set(domains)] : null,
    sinceDays: SINCE_CHOICES.includes(since) ? since : null,
    semantic: get("semantic") !== "0",
    limit: Number.isFinite(limit) && limit >= 50 ? Math.min(Math.floor(limit), GRAPH_LIMIT_MAX) : DEFAULT_GRAPH_QUERY.limit,
  };
}

/** Inverse of `parseGraphQuery` (only non-default values). */
export function graphQueryString(q: GraphQuery): string {
  const p = new URLSearchParams();
  if (q.types?.length) p.set("types", q.types.join(","));
  if (q.domains?.length) p.set("domain", q.domains.join(","));
  if (q.sinceDays) p.set("since", String(q.sinceDays));
  if (!q.semantic) p.set("semantic", "0");
  if (q.limit !== DEFAULT_GRAPH_QUERY.limit) p.set("limit", String(q.limit));
  return p.toString();
}
