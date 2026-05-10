-- =====================================================================
-- PAD-BAREME-2006-LEGACY-BACKFILL-1 — Migration brouillon (NON APPLIQUÉE)
-- =====================================================================
-- Source d'autorité : docs/tariff-collection/pad/PAD_BAREME_2006_DROIT_PASSAGE_FULL.csv
--   SHA-256 : 1c34c05fe596eb48831aa5bc53bf16008b4b6076f541fef27d93de7b0b396be0
--   Filtre : source_page=7 / IMPORT / CONTENEUR / cell_status=PRESENT (19 lignes)
-- Audit : docs/tariff-collection/pad/PAD_BAREME_2006_LEGACY_BACKFILL_1_AUDIT.md
-- Verdict audit : BACKFILL GO (0 mismatch, 0 orphan)
--
-- ⚠️  CE FICHIER EST UN BROUILLON DOCUMENTAIRE.
-- ⚠️  NE PAS EXÉCUTER sans GO CTO explicite séparé.
-- ⚠️  N'EST PAS DANS supabase/migrations/ (intentionnel).
-- =====================================================================

DO $$
DECLARE
  v_target_count        INTEGER;
  v_already_conteneur   INTEGER;
  v_post_count          INTEGER;
  v_expected_classifs   TEXT[] := ARRAY[
    'T01','T02','T03','T04','T05','T06','T07','T08','T09','T10',
    'T11','T12','T13','T14',
    'P01','P02','P03','P04','P05'
  ];
  -- Montants officiels CSV Page 7 / IMPORT / CONTENEUR / PRESENT (XOF / PER_TONNE)
  v_expected_amounts JSONB := '{
    "T01": 19239, "T02": 9678,  "T03": 1416,  "T04": 3069,  "T05": 1180,
    "T06": 885,   "T07": 484,   "T08": 1062,  "T09": 4367,  "T10": 0,
    "T11": 1770,  "T12": 4780,  "T13": 11803, "T14": 4072,
    "P01": 28100, "P02": 2325,  "P03": 13000, "P04": 1850,  "P05": 3350
  }'::jsonb;
  r RECORD;
BEGIN
  -- =========================================================
  -- G0 : aucune ligne déjà cargo_type='CONTENEUR' active
  -- (évite double population legacy NULL + CONTENEUR existant)
  -- =========================================================
  SELECT COUNT(*) INTO v_already_conteneur
  FROM public.port_tariffs
  WHERE provider='PAD' AND category='DROIT_PASSAGE'
    AND operation_type='IMPORT' AND cargo_type='CONTENEUR' AND is_active=true;
  IF v_already_conteneur <> 0 THEN
    RAISE EXCEPTION 'BACKFILL abort G0: % active CONTENEUR rows already present', v_already_conteneur;
  END IF;

  -- =========================================================
  -- G1 : cardinalité stricte du périmètre cible
  -- =========================================================
  SELECT COUNT(*) INTO v_target_count
  FROM public.port_tariffs
  WHERE provider='PAD' AND category='DROIT_PASSAGE'
    AND operation_type='IMPORT' AND cargo_type IS NULL AND is_active=true;
  IF v_target_count <> 19 THEN
    RAISE EXCEPTION 'BACKFILL abort G1: expected exactly 19 target rows, found %', v_target_count;
  END IF;

  -- =========================================================
  -- G2 : ensemble exact des classifications
  -- =========================================================
  IF EXISTS (
    SELECT 1 FROM public.port_tariffs
    WHERE provider='PAD' AND category='DROIT_PASSAGE'
      AND operation_type='IMPORT' AND cargo_type IS NULL AND is_active=true
      AND NOT (classification = ANY (v_expected_classifs))
  ) THEN
    RAISE EXCEPTION 'BACKFILL abort G2: unexpected classification in target set';
  END IF;

  IF (
    SELECT COUNT(DISTINCT classification) FROM public.port_tariffs
    WHERE provider='PAD' AND category='DROIT_PASSAGE'
      AND operation_type='IMPORT' AND cargo_type IS NULL AND is_active=true
      AND classification = ANY (v_expected_classifs)
  ) <> array_length(v_expected_classifs, 1) THEN
    RAISE EXCEPTION 'BACKFILL abort G2bis: missing expected classification(s)';
  END IF;

  -- =========================================================
  -- G3 : montants strictement identiques au CSV officiel
  -- =========================================================
  FOR r IN
    SELECT classification, amount FROM public.port_tariffs
    WHERE provider='PAD' AND category='DROIT_PASSAGE'
      AND operation_type='IMPORT' AND cargo_type IS NULL AND is_active=true
  LOOP
    IF (v_expected_amounts ->> r.classification)::numeric IS DISTINCT FROM r.amount THEN
      RAISE EXCEPTION 'BACKFILL abort G3: amount mismatch for %, db=% csv=%',
        r.classification, r.amount, v_expected_amounts ->> r.classification;
    END IF;
  END LOOP;

  -- =========================================================
  -- G4 : unités strictement = PER_TONNE
  -- =========================================================
  IF EXISTS (
    SELECT 1 FROM public.port_tariffs
    WHERE provider='PAD' AND category='DROIT_PASSAGE'
      AND operation_type='IMPORT' AND cargo_type IS NULL AND is_active=true
      AND unit IS DISTINCT FROM 'PER_TONNE'
  ) THEN
    RAISE EXCEPTION 'BACKFILL abort G4: non-PER_TONNE unit in target set';
  END IF;

  -- =========================================================
  -- UPDATE final (idempotent : filtre sur cargo_type IS NULL)
  -- =========================================================
  UPDATE public.port_tariffs
  SET cargo_type = 'CONTENEUR',
      updated_at = now()
  WHERE provider='PAD' AND category='DROIT_PASSAGE'
    AND operation_type='IMPORT' AND cargo_type IS NULL AND is_active=true;

  -- =========================================================
  -- G5 : post-check cardinalité
  -- =========================================================
  SELECT COUNT(*) INTO v_post_count
  FROM public.port_tariffs
  WHERE provider='PAD' AND category='DROIT_PASSAGE'
    AND operation_type='IMPORT' AND cargo_type='CONTENEUR' AND is_active=true;
  IF v_post_count <> 19 THEN
    RAISE EXCEPTION 'BACKFILL abort G5: post-update cardinality = %, expected 19', v_post_count;
  END IF;

  -- =========================================================
  -- G6 : aucune ligne legacy NULL résiduelle
  -- =========================================================
  IF EXISTS (
    SELECT 1 FROM public.port_tariffs
    WHERE provider='PAD' AND category='DROIT_PASSAGE'
      AND operation_type='IMPORT' AND cargo_type IS NULL AND is_active=true
  ) THEN
    RAISE EXCEPTION 'BACKFILL abort G6: residual NULL cargo_type row(s) after update';
  END IF;
END $$;
