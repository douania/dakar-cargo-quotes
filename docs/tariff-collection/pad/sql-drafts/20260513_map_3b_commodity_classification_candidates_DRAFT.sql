-- =====================================================================
-- MIGRATION CANDIDATE ONLY — DO NOT APPLY
-- This file is documentation/draft only.
-- Execution requires separate CTO GO and a separate MAP-3b-exec lot.
-- =====================================================================
--
-- Source schema design : docs/tariff-collection/pad/MAP_3_SCHEMA_DESIGN_COMMODITY_CLASSIFICATION_CANDIDATES.md (§14)
-- Plan associé          : docs/tariff-collection/pad/MAP_3B_MIGRATION_PLAN.md
-- Date                  : 2026-05-13 (patch RLS read/write split : 2026-05-14)
-- Statut                : 📋 MAP-3B MIGRATION PLAN DRAFT — RLS aligned with quote_facts
--
-- Location intentionally OUTSIDE supabase/migrations/ to prevent any
-- accidental auto-apply by the Lovable / Supabase migration pipeline.
-- This file MUST NOT be moved into supabase/migrations/ without an
-- explicit CTO GO opening MAP-3b-exec.
--
-- Aucune écriture DB n'est produite par ce lot. Aucun test DB n'est
-- déclaré PASS ici — voir le plan §11 pour la liste des tests attendus
-- côté MAP-3b-exec.
--
-- PATCH 2026-05-14 — RLS draft alignment
-- --------------------------------------
-- Précédente fonction unique `has_case_access` supprimée (lecture+écriture
-- shared workspace) car les policies INSERT/UPDATE réelles de quote_facts
-- sont owner/assigned (created_by = auth.uid() OR assigned_to = auth.uid()).
-- Maintenir un INSERT/UPDATE shared workspace sur cette nouvelle table
-- créerait une asymétrie RLS volontairement évitée (cf. plan §4bis).
--
-- Remplacée par DEUX fonctions :
--   - has_case_read_access  → lecture shared workspace
--   - has_case_write_access → écriture owner/assigned (alignée quote_facts)
-- =====================================================================


-- ---------------------------------------------------------------------
-- Prerequisite 1 — public.has_case_read_access(_case_id uuid)
--
-- SHARED WORKSPACE READ POLICY:
--   Any authenticated user may READ any existing case.
--   Aligned with docs/SECURITY_CONTRACT.md § "Access Model"
--   ("All authenticated operators can access all cases").
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_case_read_access(_case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.quote_cases qc WHERE qc.id = _case_id
    );
$$;

COMMENT ON FUNCTION public.has_case_read_access(uuid) IS
  'Shared workspace READ access — any authenticated user may read any existing case. Aligned with docs/SECURITY_CONTRACT.md §Access Model. Do NOT reuse for write paths: use has_case_write_access for INSERT/UPDATE.';


-- ---------------------------------------------------------------------
-- Prerequisite 2 — public.has_case_write_access(_case_id uuid)
--
-- OWNER/ASSIGNED WRITE POLICY:
--   Authenticated user may WRITE only if owner OR assignee of the case.
--   Aligned with the actual INSERT/UPDATE RLS policies currently enforced
--   on public.quote_facts (created_by = auth.uid() OR assigned_to = auth.uid()).
--
--   Diverges intentionally from the theoretical shared-workspace model
--   described in docs/SECURITY_CONTRACT.md to avoid an RLS regression on
--   this new table (the contract describes intent ; the DB enforces the
--   stricter owner/assigned model on writes).
--
--   Reconciliation contract ↔ DB is OUT OF SCOPE for MAP-3b — see plan §4bis.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_case_write_access(_case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1
      FROM public.quote_cases qc
      WHERE qc.id = _case_id
        AND (qc.created_by = auth.uid() OR qc.assigned_to = auth.uid())
    );
$$;

COMMENT ON FUNCTION public.has_case_write_access(uuid) IS
  'Owner/assigned WRITE access — aligned on the actual INSERT/UPDATE RLS policies of public.quote_facts (created_by = auth.uid() OR assigned_to = auth.uid()). Diverges intentionally from the shared-workspace model to avoid an RLS regression on this new table. See MAP_3B_MIGRATION_PLAN.md §4bis.';


-- ---------------------------------------------------------------------
-- Table public.commodity_classification_candidates
-- (Schema MAP-3 §4 + §14)
-- ---------------------------------------------------------------------
CREATE TABLE public.commodity_classification_candidates (
  id                       uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                  uuid          NOT NULL,
  article_id               uuid          NULL,
  source_fact_id           uuid          NULL,

  designation_normalized   text          NOT NULL,
  candidate_kind           text          NOT NULL,
  candidate_value          text          NOT NULL,
  pad_category             text          NULL,
  droit_passage_value      numeric       NULL,
  droit_passage_currency   text          NULL,
  droit_passage_unit       text          NULL,

  source                   text          NOT NULL,
  evidence                 jsonb         NULL,
  confidence               numeric(3,2)  NOT NULL DEFAULT 0,
  score                    numeric       NULL,
  rank                     smallint      NULL,

  status                   text          NOT NULL DEFAULT 'suggested',
  is_current               boolean       NOT NULL DEFAULT true,
  validated_by             uuid          NULL,
  validated_at             timestamptz   NULL,
  rejection_reason         text          NULL,
  supersedes_id            uuid          NULL,

  created_at               timestamptz   NOT NULL DEFAULT now(),
  updated_at               timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT ccc_kind_chk CHECK (candidate_kind IN (
    'cn8','hs6','hs10_uemoa','nhm','nst2007','nstr','pad_label','pad_category'
  )),
  CONSTRAINT ccc_source_chk CHECK (source IN (
    'operator','structured_code_exact','validated_alias',
    'pad_label_2_3','reference_label_cn_nhm_nst_nstr',
    'ai_suggestion','web_hs_lookup'
  )),
  CONSTRAINT ccc_status_chk CHECK (status IN (
    'suggested','accepted','rejected','superseded'
  )),
  CONSTRAINT ccc_confidence_chk CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT ccc_rank_chk CHECK (rank IS NULL OR rank > 0),

  CONSTRAINT ccc_case_fk
    FOREIGN KEY (case_id) REFERENCES public.quote_cases(id) ON DELETE CASCADE,
  CONSTRAINT ccc_source_fact_fk
    FOREIGN KEY (source_fact_id) REFERENCES public.quote_facts(id) ON DELETE SET NULL,
  CONSTRAINT ccc_supersedes_fk
    FOREIGN KEY (supersedes_id) REFERENCES public.commodity_classification_candidates(id) ON DELETE SET NULL,
  CONSTRAINT ccc_validated_by_fk
    FOREIGN KEY (validated_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.commodity_classification_candidates IS
  'MAP-3 — Stocke les propositions multi-source de classification commodity (CN/HS/NHM/NST/NSTR/PAD). Validations explicites opérateur uniquement déclenchent l''écriture pivot dans quote_facts via supersede_fact (futur MAP-5). RLS : SELECT shared workspace (has_case_read_access), INSERT/UPDATE owner/assigned (has_case_write_access, aligné quote_facts), DELETE refusé. Voir docs/tariff-collection/pad/MAP_3_SCHEMA_DESIGN_COMMODITY_CLASSIFICATION_CANDIDATES.md.';


-- ---------------------------------------------------------------------
-- Index (MAP-3 §8 + §11.1 idempotence)
-- ---------------------------------------------------------------------
CREATE INDEX idx_ccc_case
  ON public.commodity_classification_candidates (case_id);

CREATE INDEX idx_ccc_case_article
  ON public.commodity_classification_candidates (case_id, article_id);

CREATE INDEX idx_ccc_case_kind_current
  ON public.commodity_classification_candidates (case_id, candidate_kind)
  WHERE is_current = true;

-- Idempotence : clé naturelle d'unicité courante avec sentinel pour article_id NULL
CREATE UNIQUE INDEX uq_ccc_current
  ON public.commodity_classification_candidates (
    case_id,
    COALESCE(article_id, '00000000-0000-0000-0000-000000000000'::uuid),
    candidate_kind,
    source,
    candidate_value
  )
  WHERE is_current = true;

CREATE INDEX idx_ccc_status_suggested
  ON public.commodity_classification_candidates (status)
  WHERE status = 'suggested';

CREATE INDEX idx_ccc_source_fact
  ON public.commodity_classification_candidates (source_fact_id)
  WHERE source_fact_id IS NOT NULL;


-- ---------------------------------------------------------------------
-- RLS — Read shared workspace / Write owner-or-assigned
-- Alignée sur les policies réelles INSERT/UPDATE de quote_facts.
-- DELETE volontairement non couvert par policy → refusé par défaut.
-- Purge admin = job futur hors périmètre MAP-3/3b.
-- ---------------------------------------------------------------------
ALTER TABLE public.commodity_classification_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ccc_select_case_access"
  ON public.commodity_classification_candidates
  FOR SELECT
  TO authenticated
  USING (public.has_case_read_access(case_id));

CREATE POLICY "ccc_insert_owner_assigned"
  ON public.commodity_classification_candidates
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_case_write_access(case_id));

CREATE POLICY "ccc_update_owner_assigned"
  ON public.commodity_classification_candidates
  FOR UPDATE
  TO authenticated
  USING (public.has_case_write_access(case_id))
  WITH CHECK (public.has_case_write_access(case_id));

-- (No DELETE policy — DELETE refused by default RLS for `authenticated`. `service_role` bypasses RLS as usual.)


-- ---------------------------------------------------------------------
-- Triggers (MAP-3 §10)
-- ---------------------------------------------------------------------

-- 1. updated_at maintained via existing function public.update_updated_at_column()
CREATE TRIGGER trg_ccc_updated_at
  BEFORE UPDATE ON public.commodity_classification_candidates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Garde-fou cohérence status / is_current
--    - status='rejected'   ⇒ is_current must be false
--    - status='superseded' ⇒ is_current must be false
--    - status='accepted'   ⇒ is_current may be true (single accepted current per group)
CREATE OR REPLACE FUNCTION public.ccc_status_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('rejected','superseded') AND NEW.is_current = true THEN
    RAISE EXCEPTION
      'commodity_classification_candidates: is_current must be false when status=%',
      NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ccc_status_consistency
  BEFORE INSERT OR UPDATE ON public.commodity_classification_candidates
  FOR EACH ROW
  EXECUTE FUNCTION public.ccc_status_consistency();


-- =====================================================================
-- END OF MIGRATION CANDIDATE
-- DO NOT APPLY without CTO GO (MAP_3B_MIGRATION_EXECUTED) and a
-- separate MAP-3b-exec lot that copies/adapts this file into
-- supabase/migrations/ via the supabase--migration tool.
-- =====================================================================
