
-- Table enfant 1:1 pour métadonnées documentaires structurées
CREATE TABLE IF NOT EXISTS public.case_document_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_document_id uuid NOT NULL UNIQUE
    REFERENCES public.case_documents(id) ON DELETE CASCADE,

  -- Type raffiné (text libre, liste contrôlée côté UI uniquement)
  document_type_refined text,

  -- Références documentaires
  document_reference text,
  invoice_number text,
  document_date date,
  bl_number text,
  hbl_number text,
  awb_number text,
  container_numbers text[],

  -- Transport
  carrier text,
  vessel text,
  voyage text,
  port_loading text,
  port_discharge text,

  -- Parties
  emitter text,
  client text,
  consignee text,

  -- Marchandise
  goods_description text,
  weight_kg numeric,
  volume_cbm numeric,
  packages integer,

  -- Montants
  amount_ht numeric,
  amount_ttc numeric,
  vat numeric,
  currency text DEFAULT 'XOF',

  -- Profil financier du document
  document_financial_profile text DEFAULT 'not_applicable'
    CHECK (document_financial_profile IN ('official', 'surcharge_exceptional', 'tax_accessory', 'mixed', 'not_applicable')),

  -- Traçabilité
  evidence_level text DEFAULT 'to_confirm'
    CHECK (evidence_level IN ('official', 'observed', 'to_confirm')),

  matching_confidence numeric
    CHECK (matching_confidence IS NULL OR (matching_confidence >= 0 AND matching_confidence <= 1)),

  evidence_basis text[],

  notes_operator text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.case_document_metadata ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_case_doc_meta" ON public.case_document_metadata;
CREATE POLICY "auth_select_case_doc_meta"
  ON public.case_document_metadata FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_insert_case_doc_meta" ON public.case_document_metadata;
CREATE POLICY "auth_insert_case_doc_meta"
  ON public.case_document_metadata FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth_update_case_doc_meta" ON public.case_document_metadata;
CREATE POLICY "auth_update_case_doc_meta"
  ON public.case_document_metadata FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_delete_case_doc_meta" ON public.case_document_metadata;
CREATE POLICY "auth_delete_case_doc_meta"
  ON public.case_document_metadata FOR DELETE TO authenticated USING (true);

-- Trigger updated_at
DROP TRIGGER IF EXISTS update_case_document_metadata_ts ON public.case_document_metadata;
CREATE TRIGGER update_case_document_metadata_ts
  BEFORE UPDATE ON public.case_document_metadata
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Index minimaux
CREATE INDEX IF NOT EXISTS idx_case_doc_meta_bl_number ON public.case_document_metadata(bl_number);
CREATE INDEX IF NOT EXISTS idx_case_doc_meta_hbl_number ON public.case_document_metadata(hbl_number);
CREATE INDEX IF NOT EXISTS idx_case_doc_meta_awb_number ON public.case_document_metadata(awb_number);
CREATE INDEX IF NOT EXISTS idx_case_doc_meta_document_reference ON public.case_document_metadata(document_reference);
CREATE INDEX IF NOT EXISTS idx_case_doc_meta_invoice_number ON public.case_document_metadata(invoice_number);
CREATE INDEX IF NOT EXISTS idx_case_doc_meta_container_numbers_gin ON public.case_document_metadata USING GIN (container_numbers);
