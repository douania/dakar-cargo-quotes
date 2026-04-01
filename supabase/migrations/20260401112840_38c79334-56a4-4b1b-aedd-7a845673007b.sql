
-- =============================================
-- V3: commodity_categories + port_tariffs.evidence_level
-- =============================================

-- A. Table commodity_categories
CREATE TABLE IF NOT EXISTS public.commodity_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  designation_raw text NOT NULL,
  designation_normalized text,
  hs_chapter integer,
  pad_category text,
  pad_category_label text,
  terminal_provider text,
  terminal_category text,
  terminal_handling_code text,
  terminal_storage_code_p1 text,
  terminal_storage_code_p2 text,
  terminal_storage_code_p3 text,
  unit_basis text,
  cargo_type text,
  confidence numeric,
  evidence_level text DEFAULT 'to_confirm',
  source_documents text[],
  notes_operator text,
  is_validated boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CHECK (evidence_level IN ('official', 'observed', 'to_confirm'))
);

ALTER TABLE public.commodity_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_commodity_categories" ON public.commodity_categories;
CREATE POLICY "auth_select_commodity_categories"
  ON public.commodity_categories FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_insert_commodity_categories" ON public.commodity_categories;
CREATE POLICY "auth_insert_commodity_categories"
  ON public.commodity_categories FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth_update_commodity_categories" ON public.commodity_categories;
CREATE POLICY "auth_update_commodity_categories"
  ON public.commodity_categories FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_delete_commodity_categories" ON public.commodity_categories;
CREATE POLICY "auth_delete_commodity_categories"
  ON public.commodity_categories FOR DELETE TO authenticated USING (true);

DROP TRIGGER IF EXISTS update_commodity_categories_ts ON public.commodity_categories;
CREATE TRIGGER update_commodity_categories_ts
  BEFORE UPDATE ON public.commodity_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_commodity_categories_hs_chapter
  ON public.commodity_categories(hs_chapter);
CREATE INDEX IF NOT EXISTS idx_commodity_categories_pad_category
  ON public.commodity_categories(pad_category);
CREATE INDEX IF NOT EXISTS idx_commodity_categories_terminal_provider
  ON public.commodity_categories(terminal_provider);
CREATE INDEX IF NOT EXISTS idx_commodity_categories_designation_normalized
  ON public.commodity_categories(designation_normalized);

-- B. port_tariffs: add evidence_level idempotently
ALTER TABLE public.port_tariffs
  ADD COLUMN IF NOT EXISTS evidence_level text DEFAULT 'official';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'port_tariffs_evidence_level_check'
      AND conrelid = 'public.port_tariffs'::regclass
  ) THEN
    ALTER TABLE public.port_tariffs
      ADD CONSTRAINT port_tariffs_evidence_level_check
      CHECK (evidence_level IN ('official', 'observed', 'to_confirm'));
  END IF;
END $$;
