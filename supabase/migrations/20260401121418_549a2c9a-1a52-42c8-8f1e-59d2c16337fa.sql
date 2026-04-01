
-- Table commodity_designation_matches
CREATE TABLE IF NOT EXISTS public.commodity_designation_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observed_term text NOT NULL,
  normalized_term text,
  commodity_category_id uuid REFERENCES public.commodity_categories(id) ON DELETE SET NULL,
  pad_category_candidate text,
  match_score numeric CHECK (match_score IS NULL OR (match_score >= 0 AND match_score <= 1)),
  match_reason text,
  match_method text,
  source_type text DEFAULT 'manual'
    CHECK (source_type IN ('manual','document_extraction','operator_correction','seeded_synonym')),
  source_document_id uuid REFERENCES public.case_documents(id) ON DELETE SET NULL,
  source_reference text,
  is_validated boolean DEFAULT false,
  validated_by uuid,
  validated_at timestamptz,
  notes_operator text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.commodity_designation_matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cdm_select" ON public.commodity_designation_matches;
CREATE POLICY "cdm_select" ON public.commodity_designation_matches FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "cdm_insert" ON public.commodity_designation_matches;
CREATE POLICY "cdm_insert" ON public.commodity_designation_matches FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "cdm_update" ON public.commodity_designation_matches;
CREATE POLICY "cdm_update" ON public.commodity_designation_matches FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "cdm_delete" ON public.commodity_designation_matches;
CREATE POLICY "cdm_delete" ON public.commodity_designation_matches FOR DELETE TO authenticated USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cdm_observed_term ON public.commodity_designation_matches (observed_term);
CREATE INDEX IF NOT EXISTS idx_cdm_normalized_term ON public.commodity_designation_matches (normalized_term);
CREATE INDEX IF NOT EXISTS idx_cdm_category_id ON public.commodity_designation_matches (commodity_category_id);
CREATE INDEX IF NOT EXISTS idx_cdm_pad_candidate ON public.commodity_designation_matches (pad_category_candidate);

-- Partial unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS uq_cdm_norm_category
  ON public.commodity_designation_matches (normalized_term, commodity_category_id)
  WHERE commodity_category_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cdm_norm_pad_candidate
  ON public.commodity_designation_matches (normalized_term, pad_category_candidate)
  WHERE commodity_category_id IS NULL AND pad_category_candidate IS NOT NULL;

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_cdm_updated_at ON public.commodity_designation_matches;
CREATE TRIGGER trg_cdm_updated_at BEFORE UPDATE ON public.commodity_designation_matches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
