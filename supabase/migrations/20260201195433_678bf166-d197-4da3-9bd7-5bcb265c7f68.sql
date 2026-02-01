-- Phase 7.0.1: Email-Centric Puzzle IA - Database Infrastructure

-- 1. Enums for explicit typing
CREATE TYPE quote_request_type AS ENUM (
  'SEA_FCL_IMPORT',
  'SEA_LCL_IMPORT', 
  'SEA_BREAKBULK_IMPORT',
  'AIR_IMPORT',
  'ROAD_IMPORT',
  'MULTIMODAL_IMPORT'
);

CREATE TYPE quote_case_status AS ENUM (
  'NEW_THREAD',
  'RFQ_DETECTED', 
  'FACTS_PARTIAL',
  'NEED_INFO',
  'READY_TO_PRICE',
  'PRICING_RUNNING',
  'PRICED_DRAFT',
  'HUMAN_REVIEW',
  'SENT',
  'ARCHIVED'
);

-- 2. Table quote_cases
CREATE TABLE quote_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  
  status quote_case_status NOT NULL DEFAULT 'NEW_THREAD',
  request_type quote_request_type,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  
  assigned_to UUID REFERENCES auth.users(id),
  created_by UUID REFERENCES auth.users(id),
  
  facts_count INTEGER DEFAULT 0,
  gaps_count INTEGER DEFAULT 0,
  pricing_runs_count INTEGER DEFAULT 0,
  puzzle_completeness NUMERIC(5,2) DEFAULT 0.00,
  
  last_activity_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(thread_id)
);

CREATE INDEX idx_quote_cases_status ON quote_cases(status);
CREATE INDEX idx_quote_cases_thread ON quote_cases(thread_id);
CREATE INDEX idx_quote_cases_created_by ON quote_cases(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX idx_quote_cases_assigned ON quote_cases(assigned_to) WHERE assigned_to IS NOT NULL;

-- 3. Table quote_facts
CREATE TABLE quote_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES quote_cases(id) ON DELETE CASCADE,
  
  fact_key TEXT NOT NULL,
  fact_category TEXT NOT NULL CHECK (fact_category IN (
    'cargo', 'routing', 'timing', 'pricing', 'documents', 'contacts', 'other'
  )),
  
  value_text TEXT,
  value_number NUMERIC,
  value_json JSONB,
  value_date TIMESTAMPTZ,
  
  source_type TEXT NOT NULL CHECK (source_type IN (
    'email_body', 'email_subject', 'attachment_pdf', 'attachment_excel',
    'attachment_image', 'manual_input', 'ai_extraction', 'ai_assumption',
    'quotation_engine'
  )),
  source_email_id UUID REFERENCES emails(id),
  source_attachment_id UUID REFERENCES email_attachments(id),
  source_excerpt TEXT,
  
  confidence NUMERIC(3,2) DEFAULT 0.80 CHECK (confidence BETWEEN 0 AND 1),
  is_validated BOOLEAN DEFAULT false,
  validated_by UUID REFERENCES auth.users(id),
  validated_at TIMESTAMPTZ,
  
  supersedes_fact_id UUID REFERENCES quote_facts(id),
  is_current BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_quote_facts_case ON quote_facts(case_id);
CREATE INDEX idx_quote_facts_key ON quote_facts(fact_key);
CREATE INDEX idx_quote_facts_source_email ON quote_facts(source_email_id) WHERE source_email_id IS NOT NULL;
CREATE UNIQUE INDEX uq_quote_facts_current_key ON quote_facts(case_id, fact_key) WHERE is_current = true;

-- 4. Table quote_gaps
CREATE TABLE quote_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES quote_cases(id) ON DELETE CASCADE,
  
  gap_key TEXT NOT NULL,
  gap_category TEXT NOT NULL CHECK (gap_category IN (
    'cargo', 'routing', 'timing', 'pricing', 'documents', 'contacts', 'other'
  )),
  
  is_blocking BOOLEAN DEFAULT true,
  priority TEXT DEFAULT 'high' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  
  question_fr TEXT NOT NULL,
  question_en TEXT,
  
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'pending_response', 'resolved', 'waived')),
  resolved_by_fact_id UUID REFERENCES quote_facts(id),
  resolved_at TIMESTAMPTZ,
  waived_by UUID REFERENCES auth.users(id),
  waived_reason TEXT,
  
  clarification_sent_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_quote_gaps_case ON quote_gaps(case_id);
CREATE INDEX idx_quote_gaps_status ON quote_gaps(status);
CREATE INDEX idx_quote_gaps_blocking ON quote_gaps(case_id, is_blocking) WHERE is_blocking = true AND status = 'open';
CREATE UNIQUE INDEX uq_quote_gaps_open_key ON quote_gaps(case_id, gap_key) WHERE status = 'open';

-- 5. Table pricing_runs
CREATE TABLE pricing_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES quote_cases(id) ON DELETE CASCADE,
  
  run_number INTEGER NOT NULL DEFAULT 1,
  
  inputs_json JSONB NOT NULL,
  facts_snapshot JSONB NOT NULL,
  
  engine_request JSONB,
  engine_response JSONB,
  engine_version TEXT,
  
  outputs_json JSONB,
  tariff_lines JSONB,
  
  total_ht NUMERIC,
  total_ttc NUMERIC,
  currency TEXT DEFAULT 'XOF',
  
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'running', 'success', 'failed', 'superseded'
  )),
  error_message TEXT,
  
  tariff_sources JSONB,
  
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  
  UNIQUE(case_id, run_number)
);

CREATE INDEX idx_pricing_runs_case ON pricing_runs(case_id);
CREATE INDEX idx_pricing_runs_status ON pricing_runs(status);
CREATE INDEX idx_pricing_runs_latest ON pricing_runs(case_id, run_number DESC);

-- 6. Table case_timeline_events
CREATE TABLE case_timeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES quote_cases(id) ON DELETE CASCADE,
  
  event_type TEXT NOT NULL CHECK (event_type IN (
    'case_created', 'status_changed', 'fact_added', 'fact_updated', 'fact_superseded',
    'gap_identified', 'gap_resolved', 'gap_waived', 'pricing_started', 'pricing_completed',
    'pricing_failed', 'output_generated', 'human_approved', 'human_rejected',
    'sent', 'archived', 'email_received', 'email_sent', 'attachment_analyzed',
    'clarification_sent', 'manual_action'
  )),
  
  event_data JSONB,
  previous_value TEXT,
  new_value TEXT,
  
  related_email_id UUID REFERENCES emails(id),
  related_fact_id UUID REFERENCES quote_facts(id),
  related_gap_id UUID REFERENCES quote_gaps(id),
  related_pricing_run_id UUID REFERENCES pricing_runs(id),
  
  actor_type TEXT DEFAULT 'system' CHECK (actor_type IN ('system', 'user', 'ai')),
  actor_user_id UUID REFERENCES auth.users(id),
  
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_timeline_case ON case_timeline_events(case_id);
CREATE INDEX idx_timeline_type ON case_timeline_events(event_type);
CREATE INDEX idx_timeline_created ON case_timeline_events(created_at DESC);

-- 7. RLS Policies (séparées SELECT/INSERT/UPDATE)

-- quote_cases
ALTER TABLE quote_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quote_cases_select_owner"
  ON quote_cases FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR assigned_to = auth.uid());

CREATE POLICY "quote_cases_insert_authenticated"
  ON quote_cases FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "quote_cases_update_owner"
  ON quote_cases FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR assigned_to = auth.uid())
  WITH CHECK (created_by = auth.uid() OR assigned_to = auth.uid());

-- quote_facts
ALTER TABLE quote_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quote_facts_select"
  ON quote_facts FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM quote_cases qc 
    WHERE qc.id = case_id 
    AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
  ));

CREATE POLICY "quote_facts_insert"
  ON quote_facts FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM quote_cases qc 
    WHERE qc.id = case_id 
    AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
  ));

CREATE POLICY "quote_facts_update"
  ON quote_facts FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM quote_cases qc 
    WHERE qc.id = case_id 
    AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
  ));

-- quote_gaps
ALTER TABLE quote_gaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quote_gaps_select"
  ON quote_gaps FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM quote_cases qc 
    WHERE qc.id = case_id 
    AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
  ));

CREATE POLICY "quote_gaps_insert"
  ON quote_gaps FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM quote_cases qc 
    WHERE qc.id = case_id 
    AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
  ));

CREATE POLICY "quote_gaps_update"
  ON quote_gaps FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM quote_cases qc 
    WHERE qc.id = case_id 
    AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
  ));

-- pricing_runs (SELECT only via RLS, INSERT/UPDATE via service_role)
ALTER TABLE pricing_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pricing_runs_select"
  ON pricing_runs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM quote_cases qc 
    WHERE qc.id = case_id 
    AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
  ));

-- case_timeline_events (SELECT only via RLS)
ALTER TABLE case_timeline_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "timeline_select"
  ON case_timeline_events FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM quote_cases qc 
    WHERE qc.id = case_id 
    AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
  ));