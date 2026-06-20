-- PAD-C1-DB-GUARDRAILS
-- Phase C1 — Durcissement DB chirurgical (guardrails additifs uniquement)
-- Date : 2026-06-20
-- CTO GO requis avant exécution en production.
--
-- Scope :
--   public.commodity_designation_matches (CDM)
--   public.pad_designation_aliases (PDA)
--
-- Interdictions respectées :
--   - Aucune suppression de données
--   - Aucune modification RLS (voir TODO en bas)
--   - Aucune modification runtime / Edge Function / UI
--   - Aucune migration destructive
--
-- Stratégie :
--   Chaque contrainte est précédée d'un DO block de diagnostic non destructif.
--   Un RAISE EXCEPTION dans un DO block annule TOUTE la migration (transaction atomique).
--   Les DO blocks d'ajout de contrainte sont idempotents (IF NOT EXISTS).
--
-- Contraintes ajoutées :
--   C1 — CDM : FK validated_by → auth.users(id) (NO ACTION, aligné PDA)
--   C2 — CDM : CHECK validation cohérente NOT VALID (historical rows grandfathered)
--             TODO future phase : backfill audit CDM historique après doctrine CTO explicite,
--             puis VALIDATE CONSTRAINT chk_cdm_validation_coherence.
--   C3 — PDA : CHECK validation cohérente NOT VALID (seeds grandfathered)
--   C4 — CDM : CHECK normalized_term non vide si non NULL
--   C5 — PDA : CHECK normalized_term non vide
--   C6 — CDM : INDEX UNIQUE PARTIEL propositions Phase B non résolues

-- =============================================================================
-- C1 — CDM : FK validated_by → auth.users(id) (NO ACTION, aligné PDA)
-- =============================================================================

-- Diagnostic C1 : orphelins validated_by non liés à auth.users
DO $$
DECLARE
  v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.commodity_designation_matches cdm
  WHERE cdm.validated_by IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM auth.users u WHERE u.id = cdm.validated_by
    );
  IF v_count > 0 THEN
    RAISE EXCEPTION
      '[PAD-C1] STOP — % ligne(s) de commodity_designation_matches ont validated_by absent de auth.users. Corriger les orphelins avant ajout FK.',
      v_count;
  END IF;
  RAISE NOTICE '[PAD-C1] C1 precheck orphelins validated_by : % — OK', v_count;
END;
$$;

-- Ajout FK C1 (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_cdm_validated_by'
      AND conrelid = 'public.commodity_designation_matches'::regclass
  ) THEN
    ALTER TABLE public.commodity_designation_matches
      ADD CONSTRAINT fk_cdm_validated_by
      FOREIGN KEY (validated_by) REFERENCES auth.users(id);
    RAISE NOTICE '[PAD-C1] C1 : FK fk_cdm_validated_by ajoutée.';
  ELSE
    RAISE NOTICE '[PAD-C1] C1 : FK fk_cdm_validated_by déjà présente — skip.';
  END IF;
END;
$$;

-- =============================================================================
-- C2 — CDM : CHECK validation cohérente NOT VALID (historical rows grandfathered)
--   is_validated IS NOT TRUE OR (validated_by IS NOT NULL AND validated_at IS NOT NULL)
-- =============================================================================

-- Diagnostic C2 : lignes CDM validées sans validated_by ou validated_at
-- (INFORMATIF — ne stoppe pas la migration)
--
-- Audit runtime 2026-06-20 : 49 lignes CDM is_validated=true avec validated_by IS NULL
-- ou validated_at IS NULL. Ces lignes historiques sont intentionnellement grandfathered —
-- aucun validated_by fictif ou utilisateur système n'est introduit. La contrainte est
-- ajoutée en NOT VALID afin de protéger les INSERT/UPDATE futurs sans invalider les
-- lignes historiques existantes.
DO $$
DECLARE
  v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.commodity_designation_matches
  WHERE is_validated = true
    AND (validated_by IS NULL OR validated_at IS NULL);
  RAISE NOTICE '[PAD-C1] C2 audit cohérence CDM : % ligne(s) is_validated=true avec validated_by/validated_at NULL (grandfathered, NOT VALID).', v_count;
END;
$$;

-- Ajout CHECK C2 NOT VALID (idempotent)
-- NOT VALID : les lignes historiques grandfathered ne sont pas scannées lors de
-- l'ajout ; seuls les INSERT/UPDATE futurs seront vérifiés par cette contrainte.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_cdm_validation_coherence'
      AND conrelid = 'public.commodity_designation_matches'::regclass
  ) THEN
    ALTER TABLE public.commodity_designation_matches
      ADD CONSTRAINT chk_cdm_validation_coherence
      CHECK (is_validated IS NOT TRUE OR (validated_by IS NOT NULL AND validated_at IS NOT NULL))
      NOT VALID;
    RAISE NOTICE '[PAD-C1] C2 : CHECK chk_cdm_validation_coherence ajouté (NOT VALID).';
  ELSE
    RAISE NOTICE '[PAD-C1] C2 : CHECK chk_cdm_validation_coherence déjà présent — skip.';
  END IF;
END;
$$;

-- =============================================================================
-- C3 — PDA : CHECK validation cohérente (NOT VALID — seeds grandfathered)
--
-- ATTENTION : les seeds PAD-1 (migration 20260404091738) et PAD-NOM-2
-- (migration 20260507090056) insèrent is_validated=true SANS validated_by
-- ni validated_at. Ces ~330+ lignes existantes violeraient un CHECK classique.
--
-- Stratégie : NOT VALID.
--   - S'applique à toutes les INSERT et UPDATE futurs.
--   - N'invalide PAS les lignes existantes.
--   - EFFET DE BORD : tout UPDATE d'une ligne seed existante sans renseigner
--     validated_by + validated_at échouera désormais. Behaviour attendu.
--
-- TODO Phase C2 : backfill seeds (validated_by = uuid système, validated_at =
--   created_at), puis VALIDATE CONSTRAINT chk_pda_validation_coherence.
-- RISQUE RÉSIDUEL : seeds grandfathered ne sont pas auditables via cette contrainte.
--   Voir rapport audit Phase C (2026-06-20) §Risques R2.
-- =============================================================================

-- Diagnostic C3 : compte les seeds qui seront grandfathered (informatif, ne stoppe pas)
DO $$
DECLARE
  v_violating bigint;
BEGIN
  SELECT COUNT(*) INTO v_violating
  FROM public.pad_designation_aliases
  WHERE is_validated = true
    AND (validated_by IS NULL OR validated_at IS NULL);
  RAISE NOTICE '[PAD-C1] C3 : % ligne(s) PDA is_validated=true sans validated_by/validated_at — seront grandfathered par NOT VALID.',
    v_violating;
END;
$$;

-- Ajout CHECK C3 NOT VALID (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_pda_validation_coherence'
      AND conrelid = 'public.pad_designation_aliases'::regclass
  ) THEN
    ALTER TABLE public.pad_designation_aliases
      ADD CONSTRAINT chk_pda_validation_coherence
      CHECK (is_validated IS NOT TRUE OR (validated_by IS NOT NULL AND validated_at IS NOT NULL))
      NOT VALID;
    RAISE NOTICE '[PAD-C1] C3 : CHECK chk_pda_validation_coherence ajouté (NOT VALID).';
  ELSE
    RAISE NOTICE '[PAD-C1] C3 : CHECK chk_pda_validation_coherence déjà présent — skip.';
  END IF;
END;
$$;

-- =============================================================================
-- C4 — CDM : CHECK normalized_term non vide si non NULL
-- =============================================================================

-- Diagnostic C4 : normalized_term = chaîne vide dans CDM
DO $$
DECLARE
  v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.commodity_designation_matches
  WHERE normalized_term IS NOT NULL
    AND btrim(normalized_term) = '';
  IF v_count > 0 THEN
    RAISE EXCEPTION
      '[PAD-C1] STOP — % ligne(s) CDM avec normalized_term chaîne vide. Nettoyer avant ajout CHECK.',
      v_count;
  END IF;
  RAISE NOTICE '[PAD-C1] C4 precheck normalized_term vide CDM : % violation(s) — OK', v_count;
END;
$$;

-- Ajout CHECK C4 (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_cdm_normalized_term_nonempty'
      AND conrelid = 'public.commodity_designation_matches'::regclass
  ) THEN
    ALTER TABLE public.commodity_designation_matches
      ADD CONSTRAINT chk_cdm_normalized_term_nonempty
      CHECK (normalized_term IS NULL OR btrim(normalized_term) <> '');
    RAISE NOTICE '[PAD-C1] C4 : CHECK chk_cdm_normalized_term_nonempty ajouté.';
  ELSE
    RAISE NOTICE '[PAD-C1] C4 : CHECK chk_cdm_normalized_term_nonempty déjà présent — skip.';
  END IF;
END;
$$;

-- =============================================================================
-- C5 — PDA : CHECK normalized_term non vide (normalized_term est NOT NULL en DDL)
-- =============================================================================

-- Diagnostic C5 : normalized_term = chaîne vide dans PDA
DO $$
DECLARE
  v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.pad_designation_aliases
  WHERE btrim(normalized_term) = '';
  IF v_count > 0 THEN
    RAISE EXCEPTION
      '[PAD-C1] STOP — % ligne(s) PDA avec normalized_term chaîne vide.',
      v_count;
  END IF;
  RAISE NOTICE '[PAD-C1] C5 precheck normalized_term vide PDA : % violation(s) — OK', v_count;
END;
$$;

-- Ajout CHECK C5 (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_pda_normalized_term_nonempty'
      AND conrelid = 'public.pad_designation_aliases'::regclass
  ) THEN
    ALTER TABLE public.pad_designation_aliases
      ADD CONSTRAINT chk_pda_normalized_term_nonempty
      CHECK (btrim(normalized_term) <> '');
    RAISE NOTICE '[PAD-C1] C5 : CHECK chk_pda_normalized_term_nonempty ajouté.';
  ELSE
    RAISE NOTICE '[PAD-C1] C5 : CHECK chk_pda_normalized_term_nonempty déjà présent — skip.';
  END IF;
END;
$$;

-- =============================================================================
-- C6 — CDM : INDEX UNIQUE PARTIEL propositions Phase B non résolues
--
-- Comble le gap documenté dans propose-pad-alias-enrichment/index.ts (lignes 17-21) :
-- "il n'existe pas d'index unique partiel pour les propositions non résolues
--  (pad_category_candidate NULL). La déduplication est best-effort via pré-select."
--
-- Cet index garantit la déduplication DB-level pour les propositions Phase B :
--   is_validated=false, commodity_category_id IS NULL, pad_category_candidate IS NULL.
-- L'Edge Function continue à gérer le code d'erreur 23505 (race-condition résiduelle
-- entre pré-select et insert) — ce comportement est inchangé et reste correct.
-- =============================================================================

-- Diagnostic C6 : doublons de normalized_term dans le scope Phase B non résolu
DO $$
DECLARE
  v_dup_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_dup_count
  FROM (
    SELECT normalized_term
    FROM public.commodity_designation_matches
    WHERE is_validated = false
      AND commodity_category_id IS NULL
      AND pad_category_candidate IS NULL
      AND normalized_term IS NOT NULL
    GROUP BY normalized_term
    HAVING COUNT(*) > 1
  ) sub;
  IF v_dup_count > 0 THEN
    RAISE EXCEPTION
      '[PAD-C1] STOP — % normalized_term(s) en doublon dans les propositions Phase B non résolues. Dédupliquer avant ajout index unique.',
      v_dup_count;
  END IF;
  RAISE NOTICE '[PAD-C1] C6 precheck doublons propositions Phase B : % groupe(s) en doublon — OK', v_dup_count;
END;
$$;

-- Ajout index unique partiel C6 (idempotent via IF NOT EXISTS)
CREATE UNIQUE INDEX IF NOT EXISTS uq_cdm_norm_unresolved
  ON public.commodity_designation_matches (normalized_term)
  WHERE is_validated = false
    AND commodity_category_id IS NULL
    AND pad_category_candidate IS NULL
    AND normalized_term IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_cdm_norm_unresolved'
  ) THEN
    RAISE NOTICE '[PAD-C1] C6 : index uq_cdm_norm_unresolved présent (créé ou déjà existant).';
  END IF;
END;
$$;

-- =============================================================================
-- RLS — Non modifiée dans ce patch (Phase C1)
--
-- RISQUE RÉSIDUEL DOCUMENTÉ (rapport audit 2026-06-20 §R1) :
--   Les policies INSERT/UPDATE/DELETE sur pad_designation_aliases et
--   commodity_designation_matches sont ouvertes à tout utilisateur authenticated.
--   Tout authenticated peut donc écrire un alias PAD ou valider une proposition
--   CDM sans garde DB supplémentaire.
--
-- Durcissement RLS volontairement exclu de C1 car il nécessite :
--   - une décision CTO sur le modèle de rôle admin (absent en DB à ce jour)
--   - une coordination avec PadAliasTab.tsx et CorrespondancesTab.tsx (admin UI)
--     pour ne pas casser l'interface existante
--
-- TODO Phase C2 :
--   1. Définir table app_roles ou colonne is_admin dans profiles.
--   2. Restreindre policy INSERT/UPDATE/DELETE sur pad_designation_aliases
--      au rôle admin ou à service_role uniquement.
--   3. Coordonner avec admin UI (PadAliasTab.tsx) pour passage par Edge Function.
-- =============================================================================
