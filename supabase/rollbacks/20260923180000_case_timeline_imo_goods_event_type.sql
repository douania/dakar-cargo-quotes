-- LOCAL/REVIEWED USE ONLY. Rollback of IMO-EVENT-TYPE-1.
-- Never deletes or rewrites evidence: refuses as soon as one
-- 'imo_goods_recognition' event exists (written after delivery). In that case
-- keep the constraint and fix forward.
-- Deploy it together with a build-case-puzzle that no longer writes the event,
-- or the evidence write fails again after the blocking gap.
begin;
set local lock_timeout = '5s';
lock table public.case_timeline_events in access exclusive mode;
do $guard$
declare defs text[]; allowed text[];
  expected text[] := array[
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
    'all_decisions_complete', 'pricing_unlocked', 'pricing_blocked',
    'imo_goods_recognition'];
begin
  if exists (select 1 from public.case_timeline_events where event_type = 'imo_goods_recognition') then
    raise exception 'IMO_GOODS_EVIDENCE_MUST_BE_PRESERVED';
  end if;
  select array_agg(pg_catalog.pg_get_constraintdef(c.oid)) into defs
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.case_timeline_events'::regclass
    and c.conname = 'case_timeline_events_event_type_check' and c.contype = 'c';
  if coalesce(array_length(defs, 1), 0) <> 1 then
    raise exception 'IMO_EVENT_TYPE_CHECK_MISSING_OR_DUPLICATED';
  end if;
  if defs[1] !~ '^CHECK \(\(event_type = ANY \(ARRAY\[.*\]\)\)\)$' then
    raise exception 'IMO_EVENT_TYPE_CHECK_SHAPE_REVIEW_REQUIRED';
  end if;
  select array_agg(m[1] order by m[1]) into allowed
  from regexp_matches(defs[1], '''([^'']*)''', 'g') as m;
  -- Only the exact IMO-EVENT-TYPE-1 catalog is rolled back.
  if allowed is distinct from (select array_agg(v order by v) from unnest(expected) v) then
    raise exception 'IMO_EVENT_TYPE_CHECK_DRIFT_REVIEW_REQUIRED';
  end if;
end $guard$;
alter table public.case_timeline_events drop constraint case_timeline_events_event_type_check;
-- Restores the exact M19b definition (20260325163446).
alter table public.case_timeline_events
  add constraint case_timeline_events_event_type_check check (event_type in (
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
    'all_decisions_complete', 'pricing_unlocked', 'pricing_blocked'
  ));
commit;
