-- 006_book_imports.sql
--
-- Book import (docs/book-import-spec.md): long books, scans and page photos become a reviewed personal
-- timeline through a multi-stage background pipeline that survives restarts.
--
--   * public.book_imports        one row per import: status, per-stage checkpoints, progress, usage,
--                                the reviewable draft (jsonb + optimistic draft_rev) and a fenced lease.
--   * claim_book_import()        atomically hands the oldest claimable import to one runner
--                                (FOR UPDATE SKIP LOCKED), respecting a global cap of running imports.
--   * renew_book_import_lease()  extends a lease; returns the current status (so a runner notices a
--                                cancel) or NULL when the lease is no longer held by that runner.
--   * release_book_import_lease()
--   * activity_log.action        CHECK constraint extended with 'book_import' (and 'story_overview',
--                                which the backend already logs).
--
-- Artifacts and uploaded files live in the PRIVATE Storage bucket `book-imports` (created by the backend
-- on first use, like the podcasts bucket).
--
-- Run manually in the Supabase SQL editor. Idempotent. Until it is applied, /api/book-imports/limits
-- reports enabled=false (reason migration_missing) and the runner stays idle.

create table if not exists public.book_imports (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  status          text not null default 'awaiting_upload' check (status in (
                    'awaiting_upload', 'queued', 'running', 'paused', 'review', 'finalizing',
                    'completed', 'failed', 'cancelled', 'expired')),
  paused_reason   text,
  stage           text,
  key_tier        text not null check (key_tier in ('admin_paid', 'custom')),
  user_snapshot   jsonb not null default '{}'::jsonb,
  instructions    text check (instructions is null or char_length(instructions) <= 10000),
  output_language text not null default 'auto',
  lane            text not null default 'full' check (lane in ('full', 'fast')),
  sources         jsonb not null default '[]'::jsonb,
  stages          jsonb not null default '{}'::jsonb,
  progress        jsonb not null default '{}'::jsonb,
  usage           jsonb not null default '{}'::jsonb,
  error           jsonb,
  draft           jsonb,
  draft_rev       integer not null default 0,
  timeline_id     text,
  attempts        integer not null default 0,
  not_before      timestamptz,
  lease_owner     text,
  lease_until     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '14 days'),
  deleted_at      timestamptz
);

create index if not exists book_imports_user_idx
  on public.book_imports (user_id, created_at desc) where deleted_at is null;
create index if not exists book_imports_claim_idx
  on public.book_imports (status, not_before, created_at) where status in ('queued', 'running', 'finalizing');
create index if not exists book_imports_expiry_idx
  on public.book_imports (expires_at) where deleted_at is null;

alter table public.book_imports drop constraint if exists book_imports_instructions_check;
alter table public.book_imports add constraint book_imports_instructions_check
  check (instructions is null or char_length(instructions) <= 10000);

alter table public.book_imports enable row level security;
revoke all on public.book_imports from public, anon, authenticated;
grant select, insert, update, delete on public.book_imports to service_role;

-- Atomic claim: the oldest claimable row whose lease is free or expired, unless the global number of
-- imports actively held (running/finalizing with a live lease) already reached p_max_active.
create or replace function public.claim_book_import(p_owner text, p_lease_seconds integer, p_max_active integer)
returns setof public.book_imports
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_held integer;
begin
  select count(*) into v_held
    from public.book_imports
   where status in ('running', 'finalizing')
     and lease_owner is not null
     and lease_until > now()
     and deleted_at is null;
  if v_held >= p_max_active then
    return;
  end if;

  return query
  update public.book_imports b
     set lease_owner = p_owner,
         lease_until = now() + make_interval(secs => p_lease_seconds),
         status = case when b.status = 'queued' then 'running' else b.status end,
         updated_at = now()
   where b.id = (
           select id
             from public.book_imports
            where status in ('queued', 'running', 'finalizing')
              and deleted_at is null
              and (lease_owner is null or lease_until is null or lease_until < now())
              and (not_before is null or not_before <= now())
            order by created_at
            for update skip locked
            limit 1)
  returning b.*;
end;
$$;

create or replace function public.renew_book_import_lease(p_id uuid, p_owner text, p_lease_seconds integer)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  update public.book_imports
     set lease_until = now() + make_interval(secs => p_lease_seconds)
   where id = p_id and lease_owner = p_owner
  returning status into v_status;
  return v_status;
end;
$$;

create or replace function public.release_book_import_lease(p_id uuid, p_owner text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.book_imports
     set lease_owner = null, lease_until = null
   where id = p_id and lease_owner = p_owner;
$$;

revoke execute on function public.claim_book_import(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.renew_book_import_lease(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.release_book_import_lease(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_book_import(text, integer, integer) to service_role;
grant execute on function public.renew_book_import_lease(uuid, text, integer) to service_role;
grant execute on function public.release_book_import_lease(uuid, text) to service_role;

-- activity_log: allow the new action. (Rebuilds the CHECK from the README list plus
-- 'story_overview' and 'book_import'; compare with `select pg_get_constraintdef(oid) from pg_constraint
-- where conname = 'activity_log_action_check'` first if the live list was customized.)
do $$
begin
  if to_regclass('public.activity_log') is not null then
    alter table public.activity_log drop constraint if exists activity_log_action_check;
    alter table public.activity_log add constraint activity_log_action_check check (action in (
      'generate_timeline', 'generate_from_files', 'generate_from_photo_prompt',
      'refine_timeline', 'chat', 'chat_attach_files', 'generate_quiz',
      'generate_whoami', 'generate_podcast', 'podcast_audio', 'suggest_event',
      'generate_image', 'polish_text', 'story_overview', 'game_completed', 'podcast_listen',
      'book_import'));
  end if;
end;
$$;
