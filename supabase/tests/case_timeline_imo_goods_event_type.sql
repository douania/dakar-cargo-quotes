-- Synthetic local fixture only, always rolls back. No customer rows or emails.
-- Run after supabase/migrations/20260923180000_case_timeline_imo_goods_event_type.sql.
begin;
do $test$
declare
  cid uuid := gen_random_uuid(); tid uuid := gen_random_uuid(); t text; n integer := 0; con text;
  existing text[] := array[
    'case_created', 'status_changed', 'fact_added', 'fact_updated', 'fact_superseded',
    'gap_identified', 'gap_resolved', 'gap_waived', 'pricing_started', 'pricing_completed',
    'pricing_failed', 'output_generated', 'human_approved', 'human_rejected', 'sent',
    'archived', 'email_received', 'email_sent', 'attachment_analyzed', 'clarification_sent',
    'manual_action', 'status_rollback', 'fact_insert_failed', 'document_uploaded',
    'fact_injected_manual', 'assumption_applied', 'detection_corrected',
    'fact_injected_from_attachment', 'thread_intent_v1',
    'service_scope_v1', 'case_reasoning_v1', 'case_coherence_v1',
    'external_request_created', 'external_response_analyzed',
    'new_email_received', 'quotation_version_created', 'decision_committed',
    'all_decisions_complete', 'pricing_unlocked', 'pricing_blocked'];
begin
  insert into public.email_threads(id, subject_normalized, client_email)
    values (tid, 'SYNTHETIC IMO EVENT TYPE TEST', 'imo-event-type-test@example.invalid');
  insert into public.quote_cases(id, thread_id) values (cid, tid);

  -- New value accepted, with the same upsert shape as build-case-puzzle.
  insert into public.case_timeline_events(id, case_id, event_type, event_data, actor_type)
    values (gen_random_uuid(), cid, 'imo_goods_recognition', '{"version":1,"status":"REVIEW"}', 'system')
    on conflict (id) do nothing;
  if not exists (select 1 from public.case_timeline_events where case_id = cid and event_type = 'imo_goods_recognition') then
    raise exception 'imo_goods_recognition rejected';
  end if;

  -- Every M19b value is still accepted by the database.
  foreach t in array existing loop
    insert into public.case_timeline_events(case_id, event_type, actor_type) values (cid, t, 'system');
  end loop;
  select count(distinct event_type) into n from public.case_timeline_events
    where case_id = cid and event_type = any(existing);
  if n <> 40 then raise exception 'existing values not all stored: %', n; end if;

  -- The catalog is exactly M19b + imo_goods_recognition, nothing more permissive.
  if (select array_agg(m[1] order by m[1])
      from pg_catalog.pg_constraint c, regexp_matches(pg_catalog.pg_get_constraintdef(c.oid), '''([^'']*)''', 'g') m
      where c.conrelid = 'public.case_timeline_events'::regclass and c.conname = 'case_timeline_events_event_type_check')
     is distinct from (select array_agg(v order by v) from unnest(existing || 'imo_goods_recognition'::text) v) then
    raise exception 'event_type catalog is not exactly M19b + imo_goods_recognition';
  end if;

  -- Unknown values stay refused by this very constraint, including near-misses.
  foreach t in array array['unknown_event_type', 'imo_goods_recognition_v2', 'IMO_GOODS_RECOGNITION', ''] loop
    begin
      insert into public.case_timeline_events(case_id, event_type, actor_type) values (cid, t, 'system');
      raise exception 'unknown event type accepted: %', t;
    exception when check_violation then
      get stacked diagnostics con = constraint_name;
      if con is distinct from 'case_timeline_events_event_type_check' then raise exception 'unexpected constraint %', con; end if;
    end;
  end loop;

  -- Other protections unchanged: actor_type check still enforced.
  begin
    insert into public.case_timeline_events(case_id, event_type, actor_type) values (cid, 'imo_goods_recognition', 'robot');
    raise exception 'actor_type check lost';
  exception when check_violation then
    get stacked diagnostics con = constraint_name;
    if con is distinct from 'case_timeline_events_actor_type_check' then raise exception 'unexpected constraint %', con; end if;
  end;

  if not (select convalidated from pg_catalog.pg_constraint
          where conrelid = 'public.case_timeline_events'::regclass and conname = 'case_timeline_events_event_type_check') then
    raise exception 'constraint not validated';
  end if;
end $test$;
rollback;
