-- Add missing event_types: document_uploaded, fact_injected_manual
ALTER TABLE public.case_timeline_events
  DROP CONSTRAINT case_timeline_events_event_type_check;

ALTER TABLE public.case_timeline_events
  ADD CONSTRAINT case_timeline_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'case_created', 'status_changed',
    'fact_added', 'fact_updated', 'fact_superseded',
    'gap_identified', 'gap_resolved', 'gap_waived',
    'pricing_started', 'pricing_completed', 'pricing_failed',
    'output_generated',
    'human_approved', 'human_rejected',
    'sent', 'archived',
    'email_received', 'email_sent',
    'attachment_analyzed', 'clarification_sent',
    'manual_action', 'status_rollback', 'fact_insert_failed',
    'document_uploaded', 'fact_injected_manual'
  ]));

-- Add missing actor_type: operator
ALTER TABLE public.case_timeline_events
  DROP CONSTRAINT case_timeline_events_actor_type_check;

ALTER TABLE public.case_timeline_events
  ADD CONSTRAINT case_timeline_events_actor_type_check
  CHECK (actor_type = ANY (ARRAY['system', 'user', 'ai', 'operator']));
