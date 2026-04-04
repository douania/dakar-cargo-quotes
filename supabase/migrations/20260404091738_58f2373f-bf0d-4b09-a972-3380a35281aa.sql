
-- Phase PAD-1: Table d'alias PAD dédiée
CREATE TABLE IF NOT EXISTS public.pad_designation_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bl_term text NOT NULL,
  normalized_term text NOT NULL,
  commodity_category_id uuid NOT NULL REFERENCES public.commodity_categories(id) ON DELETE CASCADE,
  pad_category text NOT NULL,
  is_validated boolean NOT NULL DEFAULT false,
  validated_by uuid REFERENCES auth.users(id),
  validated_at timestamptz,
  source_type text NOT NULL DEFAULT 'seed' CHECK (source_type IN ('seed', 'operator_correction', 'ai_suggestion_validated')),
  source_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index unique anti-doublon: un seul alias par (normalized_term, commodity_category_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pda_normalized_category
  ON public.pad_designation_aliases (normalized_term, commodity_category_id);

-- Index pour lookup runtime rapide
CREATE INDEX IF NOT EXISTS idx_pda_normalized_validated
  ON public.pad_designation_aliases (normalized_term) WHERE is_validated = true;

-- Trigger updated_at
CREATE OR REPLACE TRIGGER update_pad_designation_aliases_updated_at
  BEFORE UPDATE ON public.pad_designation_aliases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE public.pad_designation_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pad_designation_aliases_read" ON public.pad_designation_aliases;
CREATE POLICY "pad_designation_aliases_read"
  ON public.pad_designation_aliases FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "pad_designation_aliases_insert" ON public.pad_designation_aliases;
CREATE POLICY "pad_designation_aliases_insert"
  ON public.pad_designation_aliases FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "pad_designation_aliases_update" ON public.pad_designation_aliases;
CREATE POLICY "pad_designation_aliases_update"
  ON public.pad_designation_aliases FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pad_designation_aliases_delete" ON public.pad_designation_aliases;
CREATE POLICY "pad_designation_aliases_delete"
  ON public.pad_designation_aliases FOR DELETE TO authenticated
  USING (true);

-- Seed depuis les 51 correspondances validées (0 collision auditée)
INSERT INTO public.pad_designation_aliases (bl_term, normalized_term, commodity_category_id, pad_category, is_validated, source_type, source_reference)
SELECT
  cdm.observed_term,
  cdm.normalized_term,
  cdm.commodity_category_id,
  cc.pad_category,
  true,
  'seed',
  'Seed depuis commodity_designation_matches (Phase PAD-1, 0 collision auditée)'
FROM public.commodity_designation_matches cdm
JOIN public.commodity_categories cc ON cc.id = cdm.commodity_category_id
WHERE cdm.is_validated = true
  AND cdm.commodity_category_id IS NOT NULL
  AND cc.pad_category IS NOT NULL
ON CONFLICT (normalized_term, commodity_category_id) DO NOTHING;
