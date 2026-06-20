-- PAD-C1-DB-GUARDRAILS (retry, C2 en NOT VALID, audit informatif)

-- C1 — FK validated_by
DO $$
DECLARE v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.commodity_designation_matches cdm
  WHERE cdm.validated_by IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = cdm.validated_by);
  IF v_count > 0 THEN
    RAISE EXCEPTION '[PAD-C1] STOP — % orphelin(s) validated_by absent de auth.users.', v_count;
  END IF;
  RAISE NOTICE '[PAD-C1] C1 precheck orphelins : % — OK', v_count;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname='fk_cdm_validated_by'
      AND conrelid='public.commodity_designation_matches'::regclass) THEN
    ALTER TABLE public.commodity_designation_matches
      ADD CONSTRAINT fk_cdm_validated_by FOREIGN KEY (validated_by) REFERENCES auth.users(id);
    RAISE NOTICE '[PAD-C1] C1 : FK fk_cdm_validated_by ajoutée.';
  ELSE
    RAISE NOTICE '[PAD-C1] C1 : FK fk_cdm_validated_by déjà présente — skip.';
  END IF;
END $$;

-- C2 — CDM CHECK validation cohérente (NOT VALID, audit informatif)
DO $$
DECLARE v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.commodity_designation_matches
  WHERE is_validated = true
    AND (validated_by IS NULL OR validated_at IS NULL);
  RAISE NOTICE '[PAD-C1] C2 audit CDM : % ligne(s) grandfathered (NOT VALID).', v_count;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname='chk_cdm_validation_coherence'
      AND conrelid='public.commodity_designation_matches'::regclass) THEN
    ALTER TABLE public.commodity_designation_matches
      ADD CONSTRAINT chk_cdm_validation_coherence
      CHECK (is_validated IS NOT TRUE OR (validated_by IS NOT NULL AND validated_at IS NOT NULL))
      NOT VALID;
    RAISE NOTICE '[PAD-C1] C2 : CHECK chk_cdm_validation_coherence ajouté (NOT VALID).';
  ELSE
    RAISE NOTICE '[PAD-C1] C2 : CHECK chk_cdm_validation_coherence déjà présent — skip.';
  END IF;
END $$;

-- C3 — PDA CHECK validation cohérente (NOT VALID)
DO $$
DECLARE v_violating bigint;
BEGIN
  SELECT COUNT(*) INTO v_violating
  FROM public.pad_designation_aliases
  WHERE is_validated = true
    AND (validated_by IS NULL OR validated_at IS NULL);
  RAISE NOTICE '[PAD-C1] C3 audit PDA : % ligne(s) grandfathered.', v_violating;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname='chk_pda_validation_coherence'
      AND conrelid='public.pad_designation_aliases'::regclass) THEN
    ALTER TABLE public.pad_designation_aliases
      ADD CONSTRAINT chk_pda_validation_coherence
      CHECK (is_validated IS NOT TRUE OR (validated_by IS NOT NULL AND validated_at IS NOT NULL))
      NOT VALID;
    RAISE NOTICE '[PAD-C1] C3 : CHECK chk_pda_validation_coherence ajouté (NOT VALID).';
  ELSE
    RAISE NOTICE '[PAD-C1] C3 : CHECK chk_pda_validation_coherence déjà présent — skip.';
  END IF;
END $$;

-- C4 — CDM normalized_term non vide
DO $$
DECLARE v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.commodity_designation_matches
  WHERE normalized_term IS NOT NULL AND btrim(normalized_term) = '';
  IF v_count > 0 THEN
    RAISE EXCEPTION '[PAD-C1] STOP — % CDM normalized_term vide.', v_count;
  END IF;
  RAISE NOTICE '[PAD-C1] C4 precheck : OK';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname='chk_cdm_normalized_term_nonempty'
      AND conrelid='public.commodity_designation_matches'::regclass) THEN
    ALTER TABLE public.commodity_designation_matches
      ADD CONSTRAINT chk_cdm_normalized_term_nonempty
      CHECK (normalized_term IS NULL OR btrim(normalized_term) <> '');
    RAISE NOTICE '[PAD-C1] C4 : CHECK chk_cdm_normalized_term_nonempty ajouté.';
  ELSE
    RAISE NOTICE '[PAD-C1] C4 : déjà présent — skip.';
  END IF;
END $$;

-- C5 — PDA normalized_term non vide
DO $$
DECLARE v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.pad_designation_aliases
  WHERE btrim(normalized_term) = '';
  IF v_count > 0 THEN
    RAISE EXCEPTION '[PAD-C1] STOP — % PDA normalized_term vide.', v_count;
  END IF;
  RAISE NOTICE '[PAD-C1] C5 precheck : OK';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname='chk_pda_normalized_term_nonempty'
      AND conrelid='public.pad_designation_aliases'::regclass) THEN
    ALTER TABLE public.pad_designation_aliases
      ADD CONSTRAINT chk_pda_normalized_term_nonempty
      CHECK (btrim(normalized_term) <> '');
    RAISE NOTICE '[PAD-C1] C5 : CHECK chk_pda_normalized_term_nonempty ajouté.';
  ELSE
    RAISE NOTICE '[PAD-C1] C5 : déjà présent — skip.';
  END IF;
END $$;

-- C6 — Index unique partiel propositions Phase B non résolues
DO $$
DECLARE v_dup_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_dup_count
  FROM (
    SELECT normalized_term
    FROM public.commodity_designation_matches
    WHERE is_validated = false
      AND commodity_category_id IS NULL
      AND pad_category_candidate IS NULL
      AND normalized_term IS NOT NULL
    GROUP BY normalized_term HAVING COUNT(*) > 1
  ) sub;
  IF v_dup_count > 0 THEN
    RAISE EXCEPTION '[PAD-C1] STOP — % doublons propositions Phase B.', v_dup_count;
  END IF;
  RAISE NOTICE '[PAD-C1] C6 precheck : OK';
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cdm_norm_unresolved
  ON public.commodity_designation_matches (normalized_term)
  WHERE is_validated = false
    AND commodity_category_id IS NULL
    AND pad_category_candidate IS NULL
    AND normalized_term IS NOT NULL;