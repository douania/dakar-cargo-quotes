-- IMO-EVENT-TYPE-1 (GO CTO 2026-09-23): allow the IMO goods evidence event.
-- build-case-puzzle writes event_type 'imo_goods_recognition' (IMO_GOODS_EVENT,
-- _shared/imo-goods-recognition.ts) after its blocking gap; the M19b CHECK
-- (20260325163446) rejects it, so the evidence is never stored and the analysis
-- stops. Adds that single value. Every existing value is kept, no event row is
-- deleted or rewritten, no Auth/RLS change.

-- Serialize with every writer for the whole swap (DROP/ADD take the same lock);
-- give up quickly rather than queue every timeline read/write behind a long
-- transaction. Must run inside the migration transaction.
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.case_timeline_events IN ACCESS EXCLUSIVE MODE;

DO $guard$
DECLARE
  m19b text[] := ARRAY[
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
  defs text[];
  allowed text[];
BEGIN
  SELECT array_agg(pg_catalog.pg_get_constraintdef(c.oid)) INTO defs
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = 'public.case_timeline_events'::regclass
    AND c.conname = 'case_timeline_events_event_type_check' AND c.contype = 'c';
  IF coalesce(array_length(defs, 1), 0) <> 1 THEN
    RAISE EXCEPTION 'IMO_EVENT_TYPE_CHECK_MISSING_OR_DUPLICATED';
  END IF;
  -- Only the plain `event_type = ANY (ARRAY[...])` shape is understood here.
  IF defs[1] !~ '^CHECK \(\(event_type = ANY \(ARRAY\[.*\]\)\)\)$' THEN
    RAISE EXCEPTION 'IMO_EVENT_TYPE_CHECK_SHAPE_REVIEW_REQUIRED';
  END IF;
  -- Every quoted literal, whatever its characters, so no value can be missed.
  SELECT array_agg(m[1] ORDER BY m[1]) INTO allowed
  FROM regexp_matches(defs[1], '''([^'']*)''', 'g') AS m;
  IF allowed = (SELECT array_agg(v ORDER BY v) FROM unnest(m19b || 'imo_goods_recognition'::text) v) THEN
    RAISE EXCEPTION 'IMO_EVENT_TYPE_CHECK_ALREADY_APPLIED';
  END IF;
  -- Replace only the exact reviewed M19b catalog; refuse any drift instead of
  -- silently dropping a value added elsewhere.
  IF allowed IS DISTINCT FROM (SELECT array_agg(v ORDER BY v) FROM unnest(m19b) v) THEN
    RAISE EXCEPTION 'IMO_EVENT_TYPE_CHECK_DRIFT_REVIEW_REQUIRED';
  END IF;
END $guard$;

ALTER TABLE public.case_timeline_events
  DROP CONSTRAINT case_timeline_events_event_type_check;

ALTER TABLE public.case_timeline_events
  ADD CONSTRAINT case_timeline_events_event_type_check CHECK (event_type IN (
    -- M19b values (unchanged)
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
    -- IMO-EVENT-TYPE-1
    'imo_goods_recognition'
  ));
