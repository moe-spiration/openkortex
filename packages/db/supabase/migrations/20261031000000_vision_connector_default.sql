-- N1 Phase-1 acceptance: image OCR must work out of the box ('vision' on by default).
-- Superseded by 20261031200000_connectors_default_all.sql (already live), which turns on
-- 'vision', 'podcast' and 'social' by default and backfills existing rows. Running the
-- original statement here would have reset the column default without 'podcast'/'social',
-- so this migration is intentionally a no-op.
select 1;
