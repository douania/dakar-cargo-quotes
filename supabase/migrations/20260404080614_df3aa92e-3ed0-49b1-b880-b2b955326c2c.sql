
-- Table terminal_designation_suggestions (Phase 3-B.2-A)
CREATE TABLE IF NOT EXISTS public.terminal_designation_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_text text NOT NULL,
  normalized_source_text text NOT NULL,
  terminal_designation_id uuid REFERENCES public.terminal_designations(id) ON DELETE SET NULL,
  suggested_label text,
  confidence_score numeric CHECK (confidence_score >= 0 AND confidence_score <= 1),
  reasoning text,
  suggestion_rank smallint NOT NULL DEFAULT 1,
  suggestion_status text NOT NULL DEFAULT 'pending'
    CHECK (suggestion_status IN ('pending','accepted','rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text,
  alias_created boolean NOT NULL DEFAULT false,
  created_alias_id uuid REFERENCES public.terminal_designation_aliases(id) ON DELETE SET NULL,
  source_type text NOT NULL DEFAULT 'ai'
    CHECK (source_type IN ('ai')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tds_normalized ON public.terminal_designation_suggestions(normalized_source_text);
CREATE INDEX IF NOT EXISTS idx_tds_status ON public.terminal_designation_suggestions(suggestion_status);
CREATE INDEX IF NOT EXISTS idx_tds_designation ON public.terminal_designation_suggestions(terminal_designation_id);

-- RLS
ALTER TABLE public.terminal_designation_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_tds" ON public.terminal_designation_suggestions;
CREATE POLICY "auth_select_tds" ON public.terminal_designation_suggestions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_insert_tds" ON public.terminal_designation_suggestions;
CREATE POLICY "auth_insert_tds" ON public.terminal_designation_suggestions FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth_update_tds" ON public.terminal_designation_suggestions;
CREATE POLICY "auth_update_tds" ON public.terminal_designation_suggestions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_delete_tds" ON public.terminal_designation_suggestions;
CREATE POLICY "auth_delete_tds" ON public.terminal_designation_suggestions FOR DELETE TO authenticated USING (true);

-- updated_at trigger
DROP TRIGGER IF EXISTS set_updated_at ON public.terminal_designation_suggestions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.terminal_designation_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
