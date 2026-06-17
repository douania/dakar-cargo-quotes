-- MULTI-CARGO-LINES-ARCHITECTURE-1 / Phase 2-A : DB foundation (additive, inerte)
CREATE TABLE IF NOT EXISTS public.cargo_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES quote_cases(id) ON DELETE CASCADE,
  line_index INTEGER NOT NULL CHECK (line_index >= 1),
  status TEXT NOT NULL DEFAULT 'to_confirm'
    CHECK (status IN ('to_confirm', 'confirmed', 'superseded')),
  description TEXT,
  hs_code TEXT,
  value_number NUMERIC,
  value_currency TEXT,
  weight_kg NUMERIC,
  volume_cbm NUMERIC,
  pieces_count NUMERIC,
  source_quote_request_line_id UUID REFERENCES quote_request_lines(id) ON DELETE SET NULL,
  source_email_id UUID REFERENCES emails(id) ON DELETE SET NULL,
  source_excerpt TEXT,
  supersedes_cargo_line_id UUID REFERENCES public.cargo_lines(id),
  is_current BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT cargo_lines_superseded_not_current
    CHECK (NOT (status = 'superseded' AND is_current = true))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cargo_lines_current_line
  ON public.cargo_lines(case_id, line_index) WHERE is_current = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cargo_lines_id_case
  ON public.cargo_lines(id, case_id);

CREATE INDEX IF NOT EXISTS idx_cargo_lines_case ON public.cargo_lines(case_id);
CREATE INDEX IF NOT EXISTS idx_cargo_lines_status ON public.cargo_lines(status);
CREATE INDEX IF NOT EXISTS idx_cargo_lines_source_qrl
  ON public.cargo_lines(source_quote_request_line_id)
  WHERE source_quote_request_line_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.cargo_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES quote_cases(id) ON DELETE CASCADE,
  cargo_line_id UUID,
  equipment_type TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'to_confirm'
    CHECK (status IN ('to_confirm', 'confirmed', 'superseded')),
  source_quote_request_line_id UUID REFERENCES quote_request_lines(id) ON DELETE SET NULL,
  source_email_id UUID REFERENCES emails(id) ON DELETE SET NULL,
  source_excerpt TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT cargo_equipment_line_case_fk
    FOREIGN KEY (cargo_line_id, case_id)
    REFERENCES public.cargo_lines(id, case_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cargo_equipment_case ON public.cargo_equipment(case_id);
CREATE INDEX IF NOT EXISTS idx_cargo_equipment_line
  ON public.cargo_equipment(cargo_line_id) WHERE cargo_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cargo_equipment_type ON public.cargo_equipment(equipment_type);

ALTER TABLE public.cargo_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargo_equipment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cargo_lines_select_team" ON public.cargo_lines;
CREATE POLICY "cargo_lines_select_team"
  ON public.cargo_lines FOR SELECT TO authenticated
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "cargo_equipment_select_team" ON public.cargo_equipment;
CREATE POLICY "cargo_equipment_select_team"
  ON public.cargo_equipment FOR SELECT TO authenticated
  USING (auth.role() = 'authenticated');

REVOKE ALL ON public.cargo_lines FROM PUBLIC;
REVOKE ALL ON public.cargo_lines FROM anon;
REVOKE ALL ON public.cargo_lines FROM authenticated;
GRANT SELECT ON public.cargo_lines TO authenticated;

REVOKE ALL ON public.cargo_equipment FROM PUBLIC;
REVOKE ALL ON public.cargo_equipment FROM anon;
REVOKE ALL ON public.cargo_equipment FROM authenticated;
GRANT SELECT ON public.cargo_equipment TO authenticated;