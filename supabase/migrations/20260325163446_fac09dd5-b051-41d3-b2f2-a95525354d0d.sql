-- M19b: Align case_timeline_events CHECK constraint with runtime event_types
-- Adds 6 event_types actually written by edge functions but rejected by the old constraint.
-- Restores traceability for future events only. No retroactive recovery.

ALTER TABLE public.case_timeline_events
  DROP CONSTRAINT IF EXISTS case_timeline_events_event_type_check;

ALTER TABLE public.case_timeline_events
  ADD CONSTRAINT case_timeline_events_event_type_check CHECK (event_type IN (
    -- Original 29 values (unchanged)
    'case_created', 'status_changed', 'fact_added', 'fact_updated', 'fact_superseded',
    'gap_identified', 'gap_resolved', 'gap_waived', 'pricing_started', 'pricing_completed',
    'pricing_failed', 'output_generated', 'human_approved', 'human_rejected', 'sent',
    'archived', 'email_received', 'email_sent', 'attachment_analyzed', 'clarification_sent',
    'manual_action', 'status_rollback', 'fact_insert_failed', 'document_uploaded',
    'fact_injected_manual', 'assumption_applied', 'detection_corrected',
    'fact_injected_from_attachment', 'thread_intent_v1',
    -- Phase 8.2 additions (unchanged)
    'service_scope_v1', 'case_reasoning_v1', 'case_coherence_v1',
    'external_request_created', 'external_response_analyzed',
    -- M19b: 6 missing event_types confirmed in runtime grep
    'new_email_received',
    'quotation_version_created',
    'decision_committed',
    'all_decisions_complete',
    'pricing_unlocked',
    'pricing_blocked'
  ));