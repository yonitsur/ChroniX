-- 004_timeline_flag_columns.sql
--
-- Promotes the timeline flags the backend filters and projects on out of the `data` JSONB into
-- stored generated columns, and indexes them (P-06). Before, the Public Library index query
-- (`data->>isLibrary = 'true'`) scanned and decompressed the `data` of EVERY user's timelines, and
-- each ownership / version lookup decompressed a multi-MB row several times. The README's partial
-- index is on the `is_library` column, which saves never write, so it was never used.
--
-- Columns (all derived from `data`, so no backend write is needed and they can never drift):
--   flag_is_library          isLibrary / is_library is JSON true, or the string 'true' / '1'
--   flag_is_featured         isFeatured / is_featured, same rule
--   flag_is_deleted          isDeleted / is_deleted, same rule
--   flag_hidden_from_saved   hiddenFromSaved / hidden_from_saved, same rule
--   flag_featured_order      featuredOrder / featured_order: a JSON integer (negative -> 0) or a
--                            string of digits; anything else is NULL (never a failing cast)
--   flag_updated_at          data->>'updatedAt' (the optimistic-concurrency version token, B-04)
--   flag_has_legacy_podcast  data->'podcast'->'segments'->0->>'id' is present
-- The mode columns from the README's activity-log section (content_mode, search_mode,
-- creation_source) are added here too when missing, with the same expressions.
--
-- The truthiness rule matches the backend's _is_timeline_in_library / _is_truthy_flag exactly:
-- JSON true, or a JSON string whose trimmed, lower-cased value is 'true' or '1'. (A JSON number 1
-- is not truthy there, so it isn't here either.)
--
-- Run manually in the Supabase SQL editor; it is idempotent. Adding stored generated columns
-- rewrites the table once (takes a lock for the duration), so run it at a quiet moment.
-- Until it is applied the backend sees PostgREST 400 (42703 "column ... does not exist"),
-- remembers that for 10 minutes and keeps using the JSONB expressions.

alter table public.timelines
  add column if not exists flag_is_library boolean
    generated always as (
      coalesce(
        (jsonb_typeof(data->'isLibrary') = 'boolean' and (data->'isLibrary') = 'true'::jsonb)
        or (jsonb_typeof(data->'isLibrary') = 'string' and lower(btrim(data->>'isLibrary')) in ('true', '1'))
        or (jsonb_typeof(data->'is_library') = 'boolean' and (data->'is_library') = 'true'::jsonb)
        or (jsonb_typeof(data->'is_library') = 'string' and lower(btrim(data->>'is_library')) in ('true', '1')),
        false
      )
    ) stored,
  add column if not exists flag_is_featured boolean
    generated always as (
      coalesce(
        (jsonb_typeof(data->'isFeatured') = 'boolean' and (data->'isFeatured') = 'true'::jsonb)
        or (jsonb_typeof(data->'isFeatured') = 'string' and lower(btrim(data->>'isFeatured')) in ('true', '1'))
        or (jsonb_typeof(data->'is_featured') = 'boolean' and (data->'is_featured') = 'true'::jsonb)
        or (jsonb_typeof(data->'is_featured') = 'string' and lower(btrim(data->>'is_featured')) in ('true', '1')),
        false
      )
    ) stored,
  add column if not exists flag_is_deleted boolean
    generated always as (
      coalesce(
        (jsonb_typeof(data->'isDeleted') = 'boolean' and (data->'isDeleted') = 'true'::jsonb)
        or (jsonb_typeof(data->'isDeleted') = 'string' and lower(btrim(data->>'isDeleted')) in ('true', '1'))
        or (jsonb_typeof(data->'is_deleted') = 'boolean' and (data->'is_deleted') = 'true'::jsonb)
        or (jsonb_typeof(data->'is_deleted') = 'string' and lower(btrim(data->>'is_deleted')) in ('true', '1')),
        false
      )
    ) stored,
  add column if not exists flag_hidden_from_saved boolean
    generated always as (
      coalesce(
        (jsonb_typeof(data->'hiddenFromSaved') = 'boolean' and (data->'hiddenFromSaved') = 'true'::jsonb)
        or (jsonb_typeof(data->'hiddenFromSaved') = 'string' and lower(btrim(data->>'hiddenFromSaved')) in ('true', '1'))
        or (jsonb_typeof(data->'hidden_from_saved') = 'boolean' and (data->'hidden_from_saved') = 'true'::jsonb)
        or (jsonb_typeof(data->'hidden_from_saved') = 'string' and lower(btrim(data->>'hidden_from_saved')) in ('true', '1')),
        false
      )
    ) stored,
  add column if not exists flag_featured_order integer
    generated always as (
      coalesce(
        case
          when jsonb_typeof(data->'featuredOrder') = 'number' and (data->>'featuredOrder') ~ '^-?[0-9]{1,9}(\.0+)?$'
            then greatest(0, (data->>'featuredOrder')::numeric::integer)
          when jsonb_typeof(data->'featuredOrder') = 'string' and btrim(data->>'featuredOrder') ~ '^[0-9]{1,9}$'
            then btrim(data->>'featuredOrder')::integer
        end,
        case
          when jsonb_typeof(data->'featured_order') = 'number' and (data->>'featured_order') ~ '^-?[0-9]{1,9}(\.0+)?$'
            then greatest(0, (data->>'featured_order')::numeric::integer)
          when jsonb_typeof(data->'featured_order') = 'string' and btrim(data->>'featured_order') ~ '^[0-9]{1,9}$'
            then btrim(data->>'featured_order')::integer
        end
      )
    ) stored,
  add column if not exists flag_updated_at text
    generated always as (data->>'updatedAt') stored,
  add column if not exists flag_has_legacy_podcast boolean
    generated always as ((data->'podcast'->'segments'->0->>'id') is not null) stored;

-- Same definitions as the README's activity-log section; skipped when they already exist.
alter table public.timelines
  add column if not exists content_mode text
    generated always as (coalesce(data->>'contentMode', 'classic')) stored,
  add column if not exists search_mode text
    generated always as (
      case
        when data->>'searchMode' in ('fast', 'web_search') then data->>'searchMode'
        when data->'isManual' = 'true'::jsonb then null
        when jsonb_typeof(data->'grounding') = 'object' then 'web_search'
        else 'fast'
      end
    ) stored,
  add column if not exists creation_source text
    generated always as (
      coalesce(
        data->>'creationSource',
        case when data->'isManual' = 'true'::jsonb then 'manual' end
      )
    ) stored;

-- The Public Library index: only published rows, in the order the backend pages them.
create index if not exists idx_timelines_flag_library
  on public.timelines (updated_at desc, id)
  where flag_is_library = true;

-- Saved lists filter by owner and order by recency (also in the README; repeated so this file is
-- enough on its own).
create index if not exists idx_timelines_user_updated
  on public.timelines (user_id, updated_at desc);

-- Let PostgREST see the new columns right away.
notify pgrst, 'reload schema';
