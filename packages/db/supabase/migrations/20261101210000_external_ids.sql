-- Dedup stage external_id: exact, indexed lookup of normalised external ids. Additive only.
--
-- The dedup module (packages/db/src/dedup.ts) normalises an external id (registry `idKeys`:
-- book.isbn, movie.imdb_id, email.message_id) by trimming, removing whitespace and hyphens and
-- lowercasing. The stored metadata keeps the user's spelling (978-3-..., <CAF-1@mail>), so a
-- lookup against `metadata->>isbn` never matched hyphenated ids, and ILIKE also treated `_`/`%`
-- as wildcards. This generated column holds the normalised ids as `key:value` tokens, so the
-- lookup is an exact array containment (`external_ids @> '{isbn:978...}'`) on a GIN index.
--
-- Keep the key list in sync with every `idKeys` of packages/db/src/type-registry.ts (a test in
-- packages/db/src/dedup.test.ts enforces it). The expression mirrors `externalIds()` in dedup.ts.
-- Generated STORED: existing rows are filled by the ALTER, no backfill script needed.
-- RLS is unchanged. Idempotent, drops no data.

alter table kortex.knowledge_items
  add column if not exists external_ids text[] generated always as (
    array_remove(
      array[
        'isbn:' || nullif(lower(regexp_replace(btrim(metadata ->> 'isbn'), '[[:space:]-]', '', 'g')), ''),
        'imdb_id:' || nullif(lower(regexp_replace(btrim(metadata ->> 'imdb_id'), '[[:space:]-]', '', 'g')), ''),
        'message_id:' || nullif(lower(regexp_replace(btrim(metadata ->> 'message_id'), '[[:space:]-]', '', 'g')), '')
      ],
      null
    )
  ) stored;

create index if not exists idx_items_external_ids
  on kortex.knowledge_items using gin (external_ids);
