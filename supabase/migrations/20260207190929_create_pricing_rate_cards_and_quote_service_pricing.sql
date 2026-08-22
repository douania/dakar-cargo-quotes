-- M3.7: pricing_rate_cards — barèmes structurés pour auto-pricing
CREATE TABLE IF NOT EXISTS public.pricing_rate_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_key text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('import', 'export', 'transit')),
  currency text NOT NULL DEFAULT 'XOF',
  unit text NOT NULL DEFAULT 'forfait',
  origin_country text,
  origin_port text,
  destination_country text,
  destination_port text,
  corridor text,
  container_type text,
  weight_min_kg numeric,
  weight_max_kg numeric,
  value numeric NOT NULL,
  min_charge numeric,
  effective_from date,
  effective_to date,
  source text NOT NULL CHECK (source IN ('internal', 'official', 'historical')),
  confidence numeric NOT NULL DEFAULT 0.7,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_prc_service_scope ON public.pricing_rate_cards(service_key, scope);
CREATE INDEX IF NOT EXISTS idx_prc_dest_port ON public.pricing_rate_cards(destination_port);
CREATE INDEX IF NOT EXISTS idx_prc_corridor ON public.pricing_rate_cards(corridor);
CREATE INDEX IF NOT EXISTS idx_prc_effective ON public.pricing_rate_cards(effective_from, effective_to);

-- RLS
ALTER TABLE public.pricing_rate_cards ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pricing_rate_cards'
      AND policyname = 'pricing_rate_cards_public_read'
  ) THEN
    CREATE POLICY "pricing_rate_cards_public_read" ON public.pricing_rate_cards FOR SELECT USING (true);
  END IF;
END $$;

-- M3.7: quote_service_pricing — audit trail
CREATE TABLE IF NOT EXISTS public.quote_service_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.quote_cases(id),
  service_line_id text NOT NULL,
  service_key text NOT NULL,
  suggested_rate numeric,
  currency text NOT NULL DEFAULT 'XOF',
  source text NOT NULL CHECK (source IN ('internal', 'official', 'historical', 'fallback')),
  rate_card_id uuid REFERENCES public.pricing_rate_cards(id),
  explanation text,
  confidence numeric NOT NULL DEFAULT 0.5,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.quote_service_pricing ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'quote_service_pricing'
      AND policyname = 'qsp_select'
  ) THEN
    CREATE POLICY "qsp_select" ON public.quote_service_pricing FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM quote_cases qc
        WHERE qc.id = quote_service_pricing.case_id
        AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'quote_service_pricing'
      AND policyname = 'qsp_insert'
  ) THEN
    CREATE POLICY "qsp_insert" ON public.quote_service_pricing FOR INSERT
      WITH CHECK (EXISTS (
        SELECT 1 FROM quote_cases qc
        WHERE qc.id = quote_service_pricing.case_id
        AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
      ));
  END IF;
END $$;
