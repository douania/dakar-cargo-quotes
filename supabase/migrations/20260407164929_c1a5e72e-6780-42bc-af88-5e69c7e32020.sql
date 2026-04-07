
-- Table dédiée COM-2A : suggestions de réponse partenaire
-- Pattern : terminal_designation_suggestions (suggestions séparées du pipeline EQ1)

CREATE TABLE IF NOT EXISTS public.partner_response_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.quote_cases(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES public.external_quote_requests(id) ON DELETE CASCADE,
  suggested_email_id uuid NOT NULL REFERENCES public.emails(id) ON DELETE CASCADE,
  score integer NOT NULL DEFAULT 0,
  confidence_level text NOT NULL CHECK (confidence_level IN ('high','medium','low')),
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggestion_status text NOT NULL DEFAULT 'pending' CHECK (suggestion_status IN ('pending','accepted','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by uuid,
  confirmed_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  UNIQUE (request_id, suggested_email_id)
);

-- Index pour requêtes UI fréquentes
CREATE INDEX IF NOT EXISTS idx_partner_response_suggestions_case_status
  ON public.partner_response_suggestions(case_id, suggestion_status);

-- RLS : shared workspace authenticated (cohérent avec EQ1)
ALTER TABLE public.partner_response_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "partner_response_suggestions_select"
  ON public.partner_response_suggestions FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "partner_response_suggestions_insert"
  ON public.partner_response_suggestions FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "partner_response_suggestions_update"
  ON public.partner_response_suggestions FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "partner_response_suggestions_delete"
  ON public.partner_response_suggestions FOR DELETE TO authenticated
  USING (true);
