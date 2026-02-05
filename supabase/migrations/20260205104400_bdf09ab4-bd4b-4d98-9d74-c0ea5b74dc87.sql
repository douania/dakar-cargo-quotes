-- ============================================================================
-- PHASE 12: Quotation Versioning System
-- CTO Adjustments #1-6 included
-- ============================================================================

-- Table 1: quotation_versions (immutable version snapshots)
CREATE TABLE public.quotation_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.quote_cases(id) ON DELETE CASCADE,
  pricing_run_id UUID NOT NULL REFERENCES public.pricing_runs(id),
  version_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'superseded')),
  is_selected BOOLEAN NOT NULL DEFAULT false,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  
  CONSTRAINT uq_qv_case_version UNIQUE(case_id, version_number)
);

-- Index for fast lookup
CREATE INDEX idx_qv_case ON public.quotation_versions(case_id);

-- CTO ADJUSTMENT #3: Partial unique index guaranteeing only ONE is_selected=true per case
CREATE UNIQUE INDEX uq_qv_selected_per_case 
ON public.quotation_versions(case_id) 
WHERE is_selected = true;

-- Table 2: quotation_version_lines (frozen pricing lines)
CREATE TABLE public.quotation_version_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_version_id UUID NOT NULL REFERENCES public.quotation_versions(id) ON DELETE CASCADE,
  line_order INTEGER NOT NULL DEFAULT 0,
  service_code TEXT NOT NULL,
  description TEXT,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  amount NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'XOF',
  breakdown JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_qvl_version ON public.quotation_version_lines(quotation_version_id);

-- CTO ADJUSTMENT #6: Add quotation_version_id to quotation_documents for PDF traceability
ALTER TABLE public.quotation_documents 
ADD COLUMN IF NOT EXISTS quotation_version_id UUID REFERENCES public.quotation_versions(id);

CREATE INDEX IF NOT EXISTS idx_qd_version ON public.quotation_documents(quotation_version_id);

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS on quotation_versions
ALTER TABLE public.quotation_versions ENABLE ROW LEVEL SECURITY;

-- SELECT: owner or assigned (via quote_cases)
CREATE POLICY quotation_versions_select ON public.quotation_versions
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.quote_cases qc 
    WHERE qc.id = quotation_versions.case_id 
    AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
  )
);

-- CTO ADJUSTMENT #1: INSERT allows both created_by AND assigned_to
CREATE POLICY quotation_versions_insert ON public.quotation_versions
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.quote_cases qc 
    WHERE qc.id = quotation_versions.case_id 
    AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
  )
);

-- UPDATE: owner or assigned (for is_selected toggle)
CREATE POLICY quotation_versions_update ON public.quotation_versions
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.quote_cases qc 
    WHERE qc.id = quotation_versions.case_id 
    AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
  )
);

-- Enable RLS on quotation_version_lines
ALTER TABLE public.quotation_version_lines ENABLE ROW LEVEL SECURITY;

-- SELECT via parent quotation_versions
CREATE POLICY qv_lines_select ON public.quotation_version_lines
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.quotation_versions qv
    JOIN public.quote_cases qc ON qc.id = qv.case_id
    WHERE qv.id = quotation_version_lines.quotation_version_id
    AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
  )
);

-- CTO ADJUSTMENT #2: INSERT policy for quotation_version_lines
CREATE POLICY qv_lines_insert ON public.quotation_version_lines
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.quotation_versions qv
    JOIN public.quote_cases qc ON qc.id = qv.case_id
    WHERE qv.id = quotation_version_lines.quotation_version_id
    AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
  )
);

-- ============================================================================
-- CTO ADJUSTMENT #4: Atomic version number function with advisory lock
-- Pattern identical to get_next_pricing_run_number (Phase 7.0.4)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_next_quotation_version_number(p_case_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_next INTEGER;
BEGIN
  -- Transactional advisory lock on case_id to prevent concurrency issues
  PERFORM pg_advisory_xact_lock(hashtext('qv_' || p_case_id::text));
  
  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO v_next
  FROM public.quotation_versions
  WHERE case_id = p_case_id;
  
  RETURN v_next;
END;
$$;

-- Revoke public access, grant only to service_role
REVOKE ALL ON FUNCTION public.get_next_quotation_version_number(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_next_quotation_version_number(UUID) TO service_role;