
-- ============================================================
-- terminal_designations — DT-DESIGNATION-MODEL Phase 1
-- Référentiel de désignations terminales Dakar Terminal
-- ============================================================

CREATE TABLE IF NOT EXISTS public.terminal_designations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  designation_label text NOT NULL,
  tariff_position integer NOT NULL CHECK (tariff_position > 0),
  handling_code text CHECK (handling_code ~ '^[0-9]{3}$'),
  storage_code_p1 text CHECK (storage_code_p1 ~ '^[0-9]{3}$'),
  storage_code_p2 text CHECK (storage_code_p2 ~ '^[0-9]{3}$'),
  storage_code_p3 text CHECK (storage_code_p3 ~ '^[0-9]{3}$'),
  unit_basis text NOT NULL DEFAULT 'tonne_per_day',
  terminal_provider text NOT NULL DEFAULT 'dakar_terminal'
    CHECK (terminal_provider IN ('dakar_terminal', 'dpw')),
  source_document text,
  evidence_level text NOT NULL DEFAULT 'official'
    CHECK (evidence_level IN ('official', 'observed', 'to_confirm')),
  effective_date date,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(designation_label, terminal_provider)
);

-- Index pour recherche par provider + libellé
CREATE INDEX IF NOT EXISTS terminal_designations_label_idx
  ON public.terminal_designations USING btree (terminal_provider, designation_label);

-- Index pour recherche par provider + position tarifaire
CREATE INDEX IF NOT EXISTS terminal_designations_position_idx
  ON public.terminal_designations USING btree (terminal_provider, tariff_position);

-- RLS
ALTER TABLE public.terminal_designations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "terminal_designations_select" ON public.terminal_designations;
CREATE POLICY "terminal_designations_select"
  ON public.terminal_designations FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "terminal_designations_insert" ON public.terminal_designations;
CREATE POLICY "terminal_designations_insert"
  ON public.terminal_designations FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "terminal_designations_update" ON public.terminal_designations;
CREATE POLICY "terminal_designations_update"
  ON public.terminal_designations FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "terminal_designations_delete" ON public.terminal_designations;
CREATE POLICY "terminal_designations_delete"
  ON public.terminal_designations FOR DELETE TO authenticated
  USING (true);
