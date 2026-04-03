-- Phase 3-B.1-A: Table d'alias BL → désignation terminale
CREATE TABLE IF NOT EXISTS public.terminal_designation_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bl_term text NOT NULL,
  normalized_term text NOT NULL,
  terminal_designation_id uuid NOT NULL REFERENCES public.terminal_designations(id) ON DELETE CASCADE,
  source_type text NOT NULL DEFAULT 'manual',
  source_reference text,
  is_validated boolean NOT NULL DEFAULT false,
  validated_by uuid,
  validated_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_tda_normalized_designation
  ON public.terminal_designation_aliases (normalized_term, terminal_designation_id);

CREATE INDEX IF NOT EXISTS idx_tda_normalized
  ON public.terminal_designation_aliases (normalized_term);

-- Trigger updated_at
CREATE OR REPLACE TRIGGER trg_terminal_designation_aliases_updated_at
  BEFORE UPDATE ON public.terminal_designation_aliases
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.terminal_designation_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read aliases"
  ON public.terminal_designation_aliases FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert aliases"
  ON public.terminal_designation_aliases FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update aliases"
  ON public.terminal_designation_aliases FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete aliases"
  ON public.terminal_designation_aliases FOR DELETE TO authenticated USING (true);