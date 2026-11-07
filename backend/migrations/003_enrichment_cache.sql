-- 003_enrichment_cache.sql
--
-- Adds public.enrichment_cache: a small shared, persistent cache for lookups against rate-limited
-- public APIs (SC-04, SC-11). Today it holds:
--   * 'geo:<lat>:<lng>:<lang>'  reverse-geocoded ~1 km cells (Nominatim), 7 days;
--   * 'p18:<QID>'               Wikidata P18 depictions resolved to a Commons thumbnail, 7 days.
-- The in-process caches stay in front of it; this table only saves re-fetching after a restart or
-- deploy, and shares results between instances.
--
-- Only the backend (service_role) may read or write it: RLS is on with no policies, and table
-- privileges are revoked from public / anon / authenticated.
--
-- Run manually in the Supabase SQL editor; it is idempotent. Until it is applied the backend sees
-- PostgREST 404 / PGRST205, disables the cache for 10 minutes at a time and works as before.

create table if not exists public.enrichment_cache (
  key text primary key,
  value jsonb not null,
  expires_at timestamptz not null
);

create index if not exists enrichment_cache_expires_at_idx on public.enrichment_cache (expires_at);

alter table public.enrichment_cache enable row level security;

revoke all on table public.enrichment_cache from public;
revoke all on table public.enrichment_cache from anon;
revoke all on table public.enrichment_cache from authenticated;
grant select, insert, update, delete on table public.enrichment_cache to service_role;

-- Deletes expired rows; returns how many. Schedule it (e.g. daily with pg_cron) or run it by hand:
--   select public.purge_expired_enrichment_cache();
create or replace function public.purge_expired_enrichment_cache()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.enrichment_cache where expires_at < now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.purge_expired_enrichment_cache() from public;
revoke execute on function public.purge_expired_enrichment_cache() from anon;
revoke execute on function public.purge_expired_enrichment_cache() from authenticated;
grant execute on function public.purge_expired_enrichment_cache() to service_role;
