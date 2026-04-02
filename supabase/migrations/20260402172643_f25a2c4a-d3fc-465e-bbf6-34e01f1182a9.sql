
CREATE TABLE IF NOT EXISTS public.terminal_tariff_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  tariff_type text NOT NULL CHECK (tariff_type IN ('storage', 'handling')),
  period text CHECK (period IN ('P1', 'P2', 'P3') OR period IS NULL),
  amount_per_unit numeric NOT NULL CHECK (amount_per_unit >= 0),
  currency text NOT NULL DEFAULT 'XOF',
  unit_basis text NOT NULL DEFAULT 'tonne_per_day',
  terminal_provider text NOT NULL DEFAULT 'dakar_terminal'
    CHECK (terminal_provider IN ('dakar_terminal', 'dpw')),
  source_document text,
  evidence_level text NOT NULL DEFAULT 'official'
    CHECK (evidence_level IN ('official', 'observed', 'to_confirm')),
  effective_date date,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(code, terminal_provider, period),
  CHECK (
    (tariff_type = 'storage' AND period IS NOT NULL) OR
    (tariff_type = 'handling' AND period IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS terminal_tariff_codes_lookup_idx
  ON public.terminal_tariff_codes (terminal_provider, tariff_type, code);

ALTER TABLE public.terminal_tariff_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_terminal_tariff_codes" ON public.terminal_tariff_codes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_terminal_tariff_codes" ON public.terminal_tariff_codes
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_terminal_tariff_codes" ON public.terminal_tariff_codes
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_terminal_tariff_codes" ON public.terminal_tariff_codes
  FOR DELETE TO authenticated USING (true);
