-- PAD-NST-2E-C-B-LOG-1 — Migration-only audit log
-- Scope: create append-only PAD-NST recommendation audit log table only.
-- NO runtime logging.
-- NO src changes.
-- NO Edge Function changes.
-- NO config.toml changes.
-- NO run-pricing / quotation-engine change.
-- NO C-C.

CREATE TABLE public.pad_recommendation_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Traçabilité temporelle et acteur
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid NOT NULL,

  -- Contexte dossier
  case_id uuid NULL REFERENCES public.quote_cases(id) ON DELETE SET NULL,

  -- Corrélation / idempotence
  request_id uuid NOT NULL,
  related_event_id uuid NULL REFERENCES public.pad_recommendation_audit_log(id) ON DELETE SET NULL,
  dedupe_key text NOT NULL UNIQUE,

  -- Type d'événement
  event_type text NOT NULL,

  -- Entrée NST
  nst_level text NULL,
  nst_code text NULL,

  -- Snapshot recommandation
  rule_id uuid NULL REFERENCES public.pad_nst_recommendation_rules(id) ON DELETE SET NULL,
  recommended_pad_category text NULL,
  confidence numeric NULL,
  evidence_level text NULL,
  notes text NULL,
  source_document text NULL,
  source_reference text NULL,

  -- Doctrine PAD-NST
  source_type text NULL,
  requires_operator_confirmation boolean NOT NULL DEFAULT true,

  -- Décision opérateur future
  operator_decision text NULL,
  operator_pad_category text NULL,
  operator_comment text NULL,

  -- Payload contrôlé pour compatibilité future
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT pad_recommendation_audit_log_event_type_chk
    CHECK (
      event_type IN (
        'recommendation_requested',
        'recommendation_empty',
        'recommendation_emitted',
        'recommendation_copied',
        'operator_accepted',
        'operator_rejected',
        'operator_modified',
        'operator_manual_override',
        'client_info_required'
      )
    ),

  CONSTRAINT pad_recommendation_audit_log_nst_level_chk
    CHECK (
      nst_level IS NULL
      OR nst_level IN ('group', 'division')
    ),

  CONSTRAINT pad_recommendation_audit_log_confidence_chk
    CHECK (
      confidence IS NULL
      OR (confidence >= 0 AND confidence <= 1)
    ),

  CONSTRAINT pad_recommendation_audit_log_source_type_chk
    CHECK (
      source_type IS NULL
      OR source_type = 'TO_CONFIRM'
    ),

  CONSTRAINT pad_recommendation_audit_log_requires_operator_confirmation_true_chk
    CHECK (
      requires_operator_confirmation = true
    ),

  CONSTRAINT pad_recommendation_audit_log_operator_decision_chk
    CHECK (
      operator_decision IS NULL
      OR operator_decision IN (
        'accepted',
        'rejected',
        'modified',
        'manual_override',
        'client_info_required'
      )
    ),

  CONSTRAINT pad_recommendation_audit_log_dedupe_key_not_blank_chk
    CHECK (
      length(btrim(dedupe_key)) > 0
    ),

  CONSTRAINT pad_recommendation_audit_log_event_payload_object_chk
    CHECK (
      jsonb_typeof(event_payload) = 'object'
    )
);

CREATE INDEX pad_rec_audit_case_created_idx
  ON public.pad_recommendation_audit_log (case_id, created_at DESC);

CREATE INDEX pad_rec_audit_request_idx
  ON public.pad_recommendation_audit_log (request_id, created_at ASC);

CREATE INDEX pad_rec_audit_rule_idx
  ON public.pad_recommendation_audit_log (rule_id)
  WHERE rule_id IS NOT NULL;

CREATE INDEX pad_rec_audit_nst_idx
  ON public.pad_recommendation_audit_log (nst_level, nst_code, created_at DESC);

CREATE INDEX pad_rec_audit_event_type_idx
  ON public.pad_recommendation_audit_log (event_type, created_at DESC);

CREATE INDEX pad_rec_audit_actor_created_idx
  ON public.pad_recommendation_audit_log (actor_user_id, created_at DESC);

ALTER TABLE public.pad_recommendation_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated operators can read PAD recommendation audit log"
  ON public.pad_recommendation_audit_log
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated operators can insert own PAD recommendation audit log"
  ON public.pad_recommendation_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (actor_user_id = auth.uid());

-- Pas de policy UPDATE.
-- Pas de policy DELETE.
