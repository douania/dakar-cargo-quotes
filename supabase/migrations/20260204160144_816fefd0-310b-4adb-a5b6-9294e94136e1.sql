-- Phase 9.1: Decision Support Infrastructure
-- CTO APPROVED PLAN: Zero DB writes without human action

-- 1. Create ENUM for decision types
CREATE TYPE decision_type AS ENUM (
  'regime',
  'routing', 
  'services',
  'incoterm',
  'container'
);

-- 2. Create ENUM for confidence levels (NO NUMERIC - CTO rule)
CREATE TYPE confidence_level AS ENUM (
  'low',
  'medium',
  'high'
);

-- 3. Add new quote_case statuses
ALTER TYPE quote_case_status ADD VALUE IF NOT EXISTS 'DECISIONS_PENDING';
ALTER TYPE quote_case_status ADD VALUE IF NOT EXISTS 'DECISIONS_COMPLETE';
ALTER TYPE quote_case_status ADD VALUE IF NOT EXISTS 'ACK_READY_FOR_PRICING';

-- 4. Create decision_proposals table (snapshot IA immuable)
-- ⚠️ CTO RULE: Insertion ONLY via commit-decision edge function (human action)
-- ⚠️ CTO RULE: suggest-decisions is STATELESS - never writes here
CREATE TABLE public.decision_proposals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES public.quote_cases(id) ON DELETE CASCADE,
  proposal_batch_id UUID NOT NULL DEFAULT gen_random_uuid(),
  decision_type decision_type NOT NULL,
  options_json JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by TEXT NOT NULL DEFAULT 'ai',
  committed_at TIMESTAMPTZ,
  committed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Create operator_decisions table (choix humain tracé)
CREATE TABLE public.operator_decisions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES public.quote_cases(id) ON DELETE CASCADE,
  proposal_id UUID NOT NULL REFERENCES public.decision_proposals(id) ON DELETE CASCADE,
  decision_type decision_type NOT NULL,
  selected_key TEXT NOT NULL,
  override_value TEXT,
  override_reason TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by UUID NOT NULL REFERENCES auth.users(id),
  is_final BOOLEAN NOT NULL DEFAULT false,
  superseded_by UUID REFERENCES public.operator_decisions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- ⚠️ CTO RULE: Override MUST have justification
  CONSTRAINT override_requires_reason CHECK (
    override_value IS NULL OR override_reason IS NOT NULL
  )
);

-- 6. Indexes for performance
CREATE INDEX idx_decision_proposals_case_id ON public.decision_proposals(case_id);
CREATE INDEX idx_decision_proposals_batch ON public.decision_proposals(proposal_batch_id);
CREATE INDEX idx_operator_decisions_case_id ON public.operator_decisions(case_id);
CREATE INDEX idx_operator_decisions_proposal ON public.operator_decisions(proposal_id);
CREATE INDEX idx_operator_decisions_decided_by ON public.operator_decisions(decided_by);

-- 7. Enable RLS
ALTER TABLE public.decision_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_decisions ENABLE ROW LEVEL SECURITY;

-- 8. RLS Policies for decision_proposals
-- Owner-only access via quote_case ownership
CREATE POLICY "decision_proposals_select_owner" ON public.decision_proposals
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.quote_cases qc
      WHERE qc.id = decision_proposals.case_id
      AND qc.created_by = auth.uid()
    )
  );

CREATE POLICY "decision_proposals_insert_owner" ON public.decision_proposals
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.quote_cases qc
      WHERE qc.id = case_id
      AND qc.created_by = auth.uid()
    )
  );

CREATE POLICY "decision_proposals_update_owner" ON public.decision_proposals
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.quote_cases qc
      WHERE qc.id = decision_proposals.case_id
      AND qc.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.quote_cases qc
      WHERE qc.id = decision_proposals.case_id
      AND qc.created_by = auth.uid()
    )
  );

-- 9. RLS Policies for operator_decisions
CREATE POLICY "operator_decisions_select_owner" ON public.operator_decisions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.quote_cases qc
      WHERE qc.id = operator_decisions.case_id
      AND qc.created_by = auth.uid()
    )
  );

CREATE POLICY "operator_decisions_insert_owner" ON public.operator_decisions
  FOR INSERT TO authenticated
  WITH CHECK (
    decided_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.quote_cases qc
      WHERE qc.id = case_id
      AND qc.created_by = auth.uid()
    )
  );

CREATE POLICY "operator_decisions_update_owner" ON public.operator_decisions
  FOR UPDATE TO authenticated
  USING (
    decided_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.quote_cases qc
      WHERE qc.id = operator_decisions.case_id
      AND qc.created_by = auth.uid()
    )
  );

-- 10. Add comments for documentation
COMMENT ON TABLE public.decision_proposals IS 'Phase 9: AI-generated decision options snapshot. Immutable once committed. Insertion ONLY via commit-decision edge function.';
COMMENT ON TABLE public.operator_decisions IS 'Phase 9: Human operator decisions with full audit trail. Override requires justification.';
COMMENT ON COLUMN public.decision_proposals.committed_at IS 'NULL until human commits decision. Marks the snapshot as used.';
COMMENT ON COLUMN public.operator_decisions.override_reason IS 'CTO RULE: Mandatory when override_value is set.';