#!/bin/sh
# Applies the Kortex migrations that are not applied yet, in file order, each in one transaction.
# The bookkeeping table is the one the Supabase CLI uses, so `supabase db push` agrees with it.
set -eu

psql -v ON_ERROR_STOP=1 -q <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
SQL

count=0
for file in /migrations/*.sql; do
  base=$(basename "$file" .sql)
  version=${base%%_*}
  name=${base#*_}
  case "$version" in
    *[!0-9]*) echo "migrate: unexpected file name $base" >&2; exit 1 ;;
  esac
  applied=$(psql -At -c "select 1 from supabase_migrations.schema_migrations where version = '$version'")
  if [ "$applied" = "1" ]; then continue; fi
  echo "migrate: applying $base"
  psql -v ON_ERROR_STOP=1 -q --single-transaction -o /dev/null \
    -f "$file" \
    -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name')"
  count=$((count + 1))
done

psql -q -c "notify pgrst, 'reload schema'"
echo "migrate: done, $count new migration(s)"
