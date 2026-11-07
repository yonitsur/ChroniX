-- 002_reserve_ai_credits.sql
--
-- Adds public.reserve_ai_credits(): reserves AI credits on ALL of a caller's counters (e.g. guest
-- session, hashed IP, IPv6 /56 bucket) and checks each against its cap in ONE round trip and ONE
-- transaction (P-08). Before, the backend made one increment_ai_usage() call per counter plus a
-- separate spend read, and rolled back with more calls.
--
-- Semantics (identical to the backend's per-counter fallback path):
--   * every identifier is incremented by p_delta (> 0);
--   * within_limit = no counter ended above its cap;
--   * otherwise the reservation is kept only when p_keep_overlimit is true and no counter
--     "straddled" its cap (new - p_delta < cap < new), i.e. the caller was already at/over every
--     cap it exceeds (this keeps the over-limit tick the UI shows as used credits);
--   * a rejected reservation is rolled back inside this same transaction (nothing is written);
--   * p_read_identifiers are read on p_date after the reservation (the caller's spend counters),
--     so the backend needs no second request.
-- Returns jsonb: {"within_limit": bool, "kept": bool, "counts": {id: new_count}, "reads": {id: count}}.
-- "counts" are the post-increment values even when the reservation was rolled back.
--
-- Requires public.ai_usage (see README). Run manually in the Supabase SQL editor; it is
-- idempotent (create or replace). Until it is applied the backend detects the missing function
-- (PostgREST 404 / PGRST202), remembers that for 10 minutes and uses increment_ai_usage() instead.

create or replace function public.reserve_ai_credits(
  p_date date,
  p_identifiers text[],
  p_caps integer[],
  p_delta integer,
  p_keep_overlimit boolean default false,
  p_read_identifiers text[] default '{}'
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_idx integer;
  v_new integer;
  v_counts jsonb := '{}'::jsonb;
  v_reads jsonb := '{}'::jsonb;
  v_any_over boolean := false;
  v_any_straddled boolean := false;
  v_within boolean := true;
  v_kept boolean := true;
begin
  if p_delta is null or p_delta <= 0 then
    raise exception 'p_delta must be positive' using errcode = '22023';
  end if;
  if coalesce(array_length(p_identifiers, 1), 0) <> coalesce(array_length(p_caps, 1), 0) then
    raise exception 'p_identifiers and p_caps must have the same length' using errcode = '22023';
  end if;

  begin
    -- Lock rows in a fixed (sorted) order so overlapping reservations can never deadlock.
    for v_idx in
      select s.i
      from generate_subscripts(p_identifiers, 1) as s(i)
      order by p_identifiers[s.i], s.i
    loop
      insert into public.ai_usage (usage_date, identifier, count, updated_at)
      values (p_date, p_identifiers[v_idx], p_delta, now())
      on conflict (usage_date, identifier) do update
        set count = greatest(0, public.ai_usage.count + p_delta),
            updated_at = now()
      returning public.ai_usage.count into v_new;

      v_counts := v_counts || jsonb_build_object(p_identifiers[v_idx], v_new);
      if v_new > p_caps[v_idx] then
        v_any_over := true;
        if v_new - p_delta < p_caps[v_idx] then
          v_any_straddled := true;
        end if;
      end if;
    end loop;

    v_within := not v_any_over;
    v_kept := v_within or (p_keep_overlimit and not v_any_straddled);
    if not v_kept then
      -- Undo every increment of this block (the local variables keep their values).
      raise exception 'reservation rejected' using errcode = 'CX001';
    end if;
  exception
    when sqlstate 'CX001' then
      null;
  end;

  if coalesce(array_length(p_read_identifiers, 1), 0) > 0 then
    select coalesce(jsonb_object_agg(u.identifier, u.count), '{}'::jsonb)
      into v_reads
      from public.ai_usage u
     where u.usage_date = p_date
       and u.identifier = any(p_read_identifiers);
  end if;

  return jsonb_build_object(
    'within_limit', v_within,
    'kept', v_kept,
    'counts', v_counts,
    'reads', v_reads
  );
end;
$$;

revoke execute on function public.reserve_ai_credits(date, text[], integer[], integer, boolean, text[])
  from public, anon, authenticated;
grant execute on function public.reserve_ai_credits(date, text[], integer[], integer, boolean, text[])
  to service_role;

-- Verify (as service_role, e.g. in the SQL editor), then clean up the test rows:
-- select public.reserve_ai_credits(current_date, array['test:a','test:b'], array[2,5], 1, false, array['test:a']);
-- delete from public.ai_usage where identifier like 'test:%';
