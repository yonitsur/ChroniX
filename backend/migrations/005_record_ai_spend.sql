-- 005_record_ai_spend.sql
--
-- Adds public.record_ai_spend(): meters one AI operation's real cost and writes its activity row in
-- ONE round trip and ONE transaction (SC-13). Before, each operation queued 4-8 sequential
-- Supabase calls (identity spend counters, the system-wide daily counter, the personal-cap hit
-- counter, the cumulative community ledger with its cent carry, then the activity insert) on a
-- 2-thread pool, so at a few operations per second the USD caps were enforced minutes late.
--
-- Semantics (identical to the backend's per-counter fallback path in quota_service.py):
--   * p_identity_micro > 0: every p_identity_ids[i] counter on p_day is incremented by it. A counter
--     "crosses" its cap when new - p_identity_micro < cap <= new; if any did, p_personal_hits_id is
--     incremented by 1. p_community_day_id (when given) is incremented by p_identity_micro.
--   * p_ledger_micro > 0: the cumulative community ledger on p_ledger_date gets the whole cents on
--     p_ledger_cents_id and the sub-cent rest on p_ledger_remainder_id; when the remainder crosses
--     whole cents, those cents move from the remainder to the cents counter (exactly the backend's
--     carry rule, so every boundary is carried once).
--   * p_activity (when not null) is inserted into public.activity_log. A failing insert (missing
--     table, rejected row) never rolls back the counters: it is reported as activity_inserted=false
--     and the backend retries it through the REST insert, which applies the usual back-off.
-- Rows are locked in a fixed (sorted identifier) order so concurrent calls can never deadlock.
-- Returns jsonb: {"identity": {id: new_count}, "community_day": int|null, "personal_hits": int|null,
--                 "activity_inserted": bool|null, "activity_error": text|null}.
--
-- Requires public.ai_usage and public.increment_ai_usage() (see README). Run manually in the
-- Supabase SQL editor; it is idempotent (create or replace). Until it is applied the backend
-- detects the missing function (PostgREST 404 / PGRST202), remembers that for 10 minutes and
-- uses the per-counter calls instead.

create or replace function public.record_ai_spend(
  p_day date,
  p_identity_ids text[] default '{}',
  p_identity_caps bigint[] default '{}',
  p_identity_micro integer default 0,
  p_personal_hits_id text default null,
  p_community_day_id text default null,
  p_ledger_date date default '1970-01-01',
  p_ledger_cents_id text default null,
  p_ledger_remainder_id text default null,
  p_ledger_micro bigint default 0,
  p_activity jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_idx integer;
  v_new integer;
  v_identity jsonb := '{}'::jsonb;
  v_crossed boolean := false;
  v_hits integer := null;
  v_community_day integer := null;
  v_cents integer;
  v_rem integer;
  v_new_rem integer;
  v_old_rem integer;
  v_carry integer;
  v_inserted boolean := null;
  v_error text := null;
begin
  if coalesce(array_length(p_identity_ids, 1), 0) <> coalesce(array_length(p_identity_caps, 1), 0) then
    raise exception 'p_identity_ids and p_identity_caps must have the same length' using errcode = '22023';
  end if;

  if coalesce(p_identity_micro, 0) > 0 then
    for v_idx in
      select s.i
      from generate_subscripts(p_identity_ids, 1) as s(i)
      order by p_identity_ids[s.i], s.i
    loop
      v_new := public.increment_ai_usage(p_day, p_identity_ids[v_idx], p_identity_micro);
      v_identity := v_identity || jsonb_build_object(p_identity_ids[v_idx], v_new);
      if p_identity_caps[v_idx] > 0
         and v_new - p_identity_micro < p_identity_caps[v_idx]
         and p_identity_caps[v_idx] <= v_new then
        v_crossed := true;
      end if;
    end loop;
    if v_crossed and p_personal_hits_id is not null then
      v_hits := public.increment_ai_usage(p_day, p_personal_hits_id, 1);
    end if;
    if p_community_day_id is not null then
      v_community_day := public.increment_ai_usage(p_day, p_community_day_id, p_identity_micro);
    end if;
  end if;

  if coalesce(p_ledger_micro, 0) > 0 and p_ledger_cents_id is not null and p_ledger_remainder_id is not null then
    v_cents := (p_ledger_micro / 10000)::integer;
    v_rem := (p_ledger_micro % 10000)::integer;
    if v_cents > 0 then
      perform public.increment_ai_usage(p_ledger_date, p_ledger_cents_id, v_cents);
    end if;
    if v_rem > 0 then
      v_new_rem := public.increment_ai_usage(p_ledger_date, p_ledger_remainder_id, v_rem);
      v_old_rem := greatest(0, v_new_rem - v_rem);
      v_carry := v_new_rem / 10000 - v_old_rem / 10000;
      if v_carry > 0 then
        perform public.increment_ai_usage(p_ledger_date, p_ledger_remainder_id, -v_carry * 10000);
        perform public.increment_ai_usage(p_ledger_date, p_ledger_cents_id, v_carry);
      end if;
    end if;
  end if;

  if p_activity is not null then
    begin
      insert into public.activity_log (
        action, status, user_id, is_guest, is_admin, content_mode, search_mode, key_tier,
        timeline_id, prompt, language, result_count, duration_ms, model, input_tokens,
        output_tokens, thinking_tokens, cost_usd, ai_images, error, details
      )
      select
        r.action, coalesce(r.status, 'success'), r.user_id, coalesce(r.is_guest, false),
        coalesce(r.is_admin, false), r.content_mode, r.search_mode, r.key_tier, r.timeline_id,
        r.prompt, r.language, r.result_count, r.duration_ms, r.model, r.input_tokens,
        r.output_tokens, r.thinking_tokens, r.cost_usd, r.ai_images, r.error, r.details
      from jsonb_populate_record(null::public.activity_log, p_activity) as r;
      v_inserted := true;
    exception when others then
      v_inserted := false;
      v_error := sqlstate;
    end;
  end if;

  return jsonb_build_object(
    'identity', v_identity,
    'community_day', v_community_day,
    'personal_hits', v_hits,
    'activity_inserted', v_inserted,
    'activity_error', v_error
  );
end;
$$;

revoke execute on function public.record_ai_spend(date, text[], bigint[], integer, text, text, date, text, text, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_ai_spend(date, text[], bigint[], integer, text, text, date, text, text, bigint, jsonb)
  to service_role;

notify pgrst, 'reload schema';
