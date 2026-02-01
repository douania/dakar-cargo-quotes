-- Phase 7.0.3-fix: Sécurisation RPC + ajout event_type status_rollback/fact_insert_failed

-- 1. Sécuriser get_next_pricing_run_number
REVOKE ALL ON FUNCTION public.get_next_pricing_run_number(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_next_pricing_run_number(UUID) TO service_role;

-- 2. Sécuriser supersede_fact (signature complète avec 12 paramètres)
REVOKE ALL ON FUNCTION public.supersede_fact(
  UUID, TEXT, TEXT, TEXT, NUMERIC, JSONB, TIMESTAMPTZ, TEXT, UUID, UUID, TEXT, NUMERIC
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.supersede_fact(
  UUID, TEXT, TEXT, TEXT, NUMERIC, JSONB, TIMESTAMPTZ, TEXT, UUID, UUID, TEXT, NUMERIC
) TO service_role;

-- 3. Ajouter status_rollback et fact_insert_failed au CHECK constraint de case_timeline_events
ALTER TABLE case_timeline_events 
DROP CONSTRAINT IF EXISTS case_timeline_events_event_type_check;

ALTER TABLE case_timeline_events 
ADD CONSTRAINT case_timeline_events_event_type_check 
CHECK (event_type IN (
  'case_created', 'status_changed', 'fact_added', 'fact_updated', 'fact_superseded',
  'gap_identified', 'gap_resolved', 'gap_waived', 'pricing_started', 'pricing_completed',
  'pricing_failed', 'output_generated', 'human_approved', 'human_rejected',
  'sent', 'archived', 'email_received', 'email_sent', 'attachment_analyzed',
  'clarification_sent', 'manual_action',
  'status_rollback',
  'fact_insert_failed'
));