-- Preserve the reviewed timeline catalogue; only customs adoption is added.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.case_timeline_events IN ACCESS EXCLUSIVE MODE;
DO $migration$
DECLARE
 previous text[] := ARRAY[
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
    'imo_goods_recognition'
 ];
 allowed text[]; definition text; validated boolean;
BEGIN
 SELECT pg_get_constraintdef(c.oid),c.convalidated INTO definition,validated FROM pg_constraint c
 WHERE c.conrelid='public.case_timeline_events'::regclass
  AND c.conname='case_timeline_events_event_type_check' AND c.contype='c';
 IF definition IS NULL OR NOT validated OR definition !~ '^CHECK \(\(event_type = ANY \(ARRAY\[.*\]\)\)\)$' THEN
  RAISE EXCEPTION 'CUSTOMS_EVENT_TYPE_CHECK_REVIEW_REQUIRED';
 END IF;
 SELECT array_agg(m[1] ORDER BY m[1]) INTO allowed FROM regexp_matches(definition,'''([^'']*)''','g') m;
 IF allowed = (SELECT array_agg(v ORDER BY v) FROM unnest(previous || 'customs_basis_adopted'::text) v) THEN RETURN; END IF;
 IF allowed IS DISTINCT FROM (SELECT array_agg(v ORDER BY v) FROM unnest(previous) v) THEN
  RAISE EXCEPTION 'CUSTOMS_EVENT_TYPE_CHECK_DRIFT_REVIEW_REQUIRED';
 END IF;
 ALTER TABLE public.case_timeline_events DROP CONSTRAINT case_timeline_events_event_type_check;
 ALTER TABLE public.case_timeline_events ADD CONSTRAINT case_timeline_events_event_type_check CHECK(event_type IN (
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
    'imo_goods_recognition',
  'customs_basis_adopted'
 ));
END $migration$;
COMMIT;
