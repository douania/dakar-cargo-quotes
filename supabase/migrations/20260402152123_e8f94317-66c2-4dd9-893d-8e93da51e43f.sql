-- Create demurrage_tiers child table
CREATE TABLE IF NOT EXISTS public.demurrage_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demurrage_rate_id uuid NOT NULL REFERENCES public.demurrage_rates(id) ON DELETE CASCADE,
  tier_order smallint NOT NULL,
  day_from smallint NOT NULL CHECK (day_from >= 1),
  day_to smallint CHECK (day_to IS NULL OR day_to >= day_from),
  rate_per_day numeric NOT NULL,
  currency text NOT NULL,
  evidence_level text NOT NULL DEFAULT 'to_confirm'
    CHECK (evidence_level IN ('official','observed','to_confirm')),
  source_document text,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (demurrage_rate_id, tier_order),
  UNIQUE (demurrage_rate_id, day_from)
);

-- Index on parent FK for efficient joins
CREATE INDEX IF NOT EXISTS demurrage_tiers_rate_id_idx
  ON public.demurrage_tiers (demurrage_rate_id);

-- RLS: shared workspace authenticated CRUD
ALTER TABLE public.demurrage_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "demurrage_tiers_select" ON public.demurrage_tiers
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "demurrage_tiers_insert" ON public.demurrage_tiers
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "demurrage_tiers_update" ON public.demurrage_tiers
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "demurrage_tiers_delete" ON public.demurrage_tiers
  FOR DELETE TO authenticated USING (true);

-- Inject 4 proven tiers
INSERT INTO public.demurrage_tiers (demurrage_rate_id, tier_order, day_from, day_to, rate_per_day, currency, evidence_level, source_document, notes)
VALUES
  -- MSC 20DV tier 1
  ('26b67f17-f9aa-4917-b186-82a0be14d46c', 1, 11, 20, 27.00, 'EUR', 'observed',
   'Facture MSC BL MEDUF8860316', '2j × 27 EUR vérifié par facture'),
  -- MSC 20DV tier 2
  ('26b67f17-f9aa-4917-b186-82a0be14d46c', 2, 21, NULL, 37.00, 'EUR', 'observed',
   'Facture MSC BL MEDUF8860316 + MEDUAK978032', '17j × 37 EUR et 50j × 37 EUR vérifiés'),
  -- CMA CGM 40HC tier 1
  ('b94192e4-0495-4446-9bd8-d901626db40a', 1, 11, 20, 38050, 'XOF', 'official',
   'Facture CMA CGM BL SNIM0709935 + barème officiel Sénégal', '10j × 38050 XOF vérifié'),
  -- CMA CGM 40HC tier 2
  ('b94192e4-0495-4446-9bd8-d901626db40a', 2, 21, NULL, 45920, 'XOF', 'official',
   'Facture CMA CGM BL SNIM0709935 + barème officiel Sénégal', '18j × 45920 XOF vérifié');
