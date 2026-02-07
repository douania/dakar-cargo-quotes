
-- ============================================================
-- Phase R1 — Stabilisation base tarifaire
-- 3 nouvelles tables + 2 colonnes sur pricing_rate_cards
-- ============================================================

-- 1. unit_conversions
CREATE TABLE public.unit_conversions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversion_type text NOT NULL,
  key text NOT NULL,
  factor numeric NOT NULL,
  source_document text,
  effective_date date DEFAULT CURRENT_DATE,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (conversion_type, key)
);

ALTER TABLE public.unit_conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "unit_conversions_public_read"
  ON public.unit_conversions FOR SELECT
  USING (true);

-- 2. service_quantity_rules
CREATE TABLE public.service_quantity_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  service_key text NOT NULL UNIQUE,
  quantity_basis text NOT NULL,
  default_unit text NOT NULL,
  requires_fact_key text,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.service_quantity_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_quantity_rules_public_read"
  ON public.service_quantity_rules FOR SELECT
  USING (true);

-- 3. tariff_resolution_log
CREATE TABLE public.tariff_resolution_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tariff_table text NOT NULL,
  tariff_id uuid NOT NULL,
  gold_document text,
  resolution_type text NOT NULL,
  justification text NOT NULL,
  resolved_by text DEFAULT 'system_r1',
  resolved_at timestamptz DEFAULT now()
);

ALTER TABLE public.tariff_resolution_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tariff_resolution_log_public_read"
  ON public.tariff_resolution_log FOR SELECT
  USING (true);

-- 4. Ajout colonnes pricing_rate_cards
ALTER TABLE public.pricing_rate_cards
  ADD COLUMN IF NOT EXISTS tariff_document_id uuid REFERENCES public.tariff_documents(id),
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
