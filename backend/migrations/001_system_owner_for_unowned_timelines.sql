-- 001_system_owner_for_unowned_timelines.sql
--
-- Re-homes unowned timelines (user_id IS NULL: curated Library demos seeded with user_id=None and
-- Library rows detached by hard account deletion) to a dedicated system owner account.
--
-- The backend now treats a NULL owner as admin-only, so this migration is optional. It makes
-- ownership explicit and lets the system account manage these rows like any owner would.
--
-- Run manually in the Supabase SQL editor. It is idempotent: re-running it only touches rows that
-- are still unowned. It changes no functions or grants.
--
-- BEFORE RUNNING:
--   1. Pick (or create) the system owner account in Supabase Auth, normally an admin, and copy its
--      user id (Authentication -> Users). The uuid MUST exist in auth.users, because
--      public.timelines.user_id references auth.users(id) and the update fails otherwise.
--   2. Set the same uuid as the backend env var SYSTEM_OWNER_USER_ID.
--   3. Replace <SYSTEM_OWNER_USER_ID> below with that uuid.
--
-- WARNING: the foreign key is `on delete cascade`. Deleting the system owner from Supabase Auth
-- directly (dashboard or admin API) would delete every timeline it owns, including these curated
-- rows. (Deleting it through the app's own account deletion first detaches its Library rows.)

-- 1) Inspect the unowned rows first:
-- select id, title, updated_at, data->>'isLibrary' as is_library
-- from public.timelines
-- where user_id is null
-- order by updated_at desc;

-- 2) Check that the system owner exists (must return exactly one row):
-- select id, email from auth.users where id = '<SYSTEM_OWNER_USER_ID>';

-- 3) Re-home them:
update public.timelines
set user_id = '<SYSTEM_OWNER_USER_ID>'
where user_id is null;
