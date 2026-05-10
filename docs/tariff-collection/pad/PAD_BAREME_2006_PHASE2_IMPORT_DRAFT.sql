-- =====================================================================
-- PAD-BAREME-2006-PHASE2-IMPORT-DRAFT — Brouillon SQL documentaire
-- =====================================================================
-- ⚠️  CE FICHIER EST UN BROUILLON DOCUMENTAIRE. NE PAS EXÉCUTER.
-- ⚠️  N'EST PAS DANS supabase/migrations/ (intentionnel).
-- ⚠️  Toute exécution requiert un GO CTO séparé (étape 2c puis 2d).
--
-- Source d'autorité : docs/tariff-collection/pad/PAD_BAREME_2006_DROIT_PASSAGE_FULL.csv
--   SHA-256 (manifest figé) : 1c34c05fe596eb48831aa5bc53bf16008b4b6076f541fef27d93de7b0b396be0
--   Manifest               : docs/tariff-collection/pad/PAD_BAREME_2006_MANIFEST.json
--   Stratégie (v2)         : docs/tariff-collection/pad/PAD_BAREME_2006_PHASE2_IMPORT_STRATEGY.md
--   Validator              : docs/tariff-collection/pad/validate_pad_csv.py (24 PASS / 0 FAIL)
--
-- ⚠️  SHA-256 CSV : contrôlé hors SQL par validate_pad_csv.py + manifest figé.
--     Ce DO block ne recalcule PAS le SHA du fichier CSV (non accessible depuis SQL).
--     Le payload INSERT est supposé généré à partir du CSV validé.
--
-- Doctrine PostgreSQL :
--   * Une seule transaction (BEGIN ... COMMIT).
--   * Toutes les gardes lèvent RAISE EXCEPTION ; rollback natif sur échec.
--   * AUCUN bloc EXCEPTION WHEN OTHERS, AUCUN ROLLBACK manuel.
--
-- Ordre d'exécution (v2 §6) :
--   G0..G4 + payload checks
--   → désactivation legacy R2 (19 lignes)
--   → CREATE UNIQUE INDEX partiel (garde structurelle)
--   → INSERT 120 lignes PRESENT (BLANK_IN_PDF exclus)
--   → post-checks H1..H6
--
-- Cardinalités attendues (v2 §10 — H2 figées, recomptées CSV) :
--   IMPORT/CONTENEUR=19 ; IMPORT/CONVENTIONNEL=19
--   EXPORT/CONTENEUR=19 ; EXPORT/CONVENTIONNEL=18
--   TRANSBORDEMENT/CONTENEUR=3 ; TRANSBORDEMENT/CONVENTIONNEL=12
--   TRANSIT_IMPORT/CONTENEUR=3 ; TRANSIT_IMPORT/CONVENTIONNEL=12
--   TRANSIT_EXPORT/CONTENEUR=3 ; TRANSIT_EXPORT/CONVENTIONNEL=12
--   TOTAL = 120
-- =====================================================================

BEGIN;

DO $$
DECLARE
  -- Constantes
  c_provider          CONSTANT TEXT := 'PAD';
  c_category          CONSTANT TEXT := 'DROIT_PASSAGE';
  c_source_doc        CONSTANT TEXT := 'pdf_redevances_portuaires_2006';
  c_effective_date    CONSTANT DATE := '2006-01-01';
  c_evidence_level    CONSTANT TEXT := 'official';
  c_unit              CONSTANT TEXT := 'PER_TONNE';
  c_index_name        CONSTANT TEXT := 'port_tariffs_active_unique_key';
  c_expected_payload  CONSTANT INT  := 120;
  c_expected_legacy   CONSTANT INT  := 19;

  -- Définition canonique attendue de l'index unique partiel.
  -- Doit matcher pg_get_indexdef(...) à la normalisation près.
  c_expected_index_def CONSTANT TEXT :=
    'CREATE UNIQUE INDEX port_tariffs_active_unique_key ON public.port_tariffs ' ||
    'USING btree (provider, category, operation_type, classification, cargo_type) ' ||
    'WHERE (is_active = true)';

  -- Montants legacy attendus (figés depuis lecture DB read-only au moment du draft,
  -- identiques au CSV IMPORT/CONTENEUR PRESENT).
  v_expected_legacy_amounts JSONB := '{
    "T01":19239,"T02":9678,"T03":1416,"T04":3069,"T05":1180,
    "T06":885,"T07":484,"T08":1062,"T09":4367,"T10":0,
    "T11":1770,"T12":4780,"T13":11803,"T14":4072,
    "P01":28100,"P02":2325,"P03":13000,"P04":1850,"P05":3350
  }'::jsonb;

  -- Cardinalités H2 attendues
  v_expected_cardinalities JSONB := '{
    "IMPORT|CONTENEUR":19,"IMPORT|CONVENTIONNEL":19,
    "EXPORT|CONTENEUR":19,"EXPORT|CONVENTIONNEL":18,
    "TRANSBORDEMENT|CONTENEUR":3,"TRANSBORDEMENT|CONVENTIONNEL":12,
    "TRANSIT_IMPORT|CONTENEUR":3,"TRANSIT_IMPORT|CONVENTIONNEL":12,
    "TRANSIT_EXPORT|CONTENEUR":3,"TRANSIT_EXPORT|CONVENTIONNEL":12
  }'::jsonb;

  v_legacy_count        INT;
  v_payload_count       INT;
  v_dup_count           INT;
  v_fk_count            INT;
  v_qv_present          BOOLEAN;
  v_qv_legacy_refs      INT;
  v_index_exists        BOOLEAN;
  v_index_def           TEXT;
  v_inserted_count      INT;
  v_active_count        INT;
  v_inactive_count      INT;
  v_runtime_sum_db      NUMERIC;
  v_runtime_sum_payload NUMERIC;
  v_active_dup_count    INT;
  r RECORD;
BEGIN
  -- ===================================================================
  -- G0 — 19 lignes legacy actives IMPORT/CONTENEUR
  -- ===================================================================
  SELECT COUNT(*) INTO v_legacy_count
  FROM public.port_tariffs
  WHERE provider = c_provider AND category = c_category
    AND operation_type = 'IMPORT' AND cargo_type = 'CONTENEUR'
    AND is_active = true
    AND source_document = c_source_doc;
  IF v_legacy_count <> c_expected_legacy THEN
    RAISE EXCEPTION 'G0 abort: expected % active legacy IMPORT/CONTENEUR rows, found %',
      c_expected_legacy, v_legacy_count;
  END IF;

  -- ===================================================================
  -- G1 — Montants legacy strictement identiques aux valeurs attendues
  -- ===================================================================
  FOR r IN
    SELECT classification, amount
    FROM public.port_tariffs
    WHERE provider = c_provider AND category = c_category
      AND operation_type = 'IMPORT' AND cargo_type = 'CONTENEUR'
      AND is_active = true
      AND source_document = c_source_doc
  LOOP
    IF (v_expected_legacy_amounts ->> r.classification) IS NULL THEN
      RAISE EXCEPTION 'G1 abort: unexpected legacy classification %', r.classification;
    END IF;
    IF (v_expected_legacy_amounts ->> r.classification)::numeric IS DISTINCT FROM r.amount THEN
      RAISE EXCEPTION 'G1 abort: legacy amount mismatch for %, db=% expected=%',
        r.classification, r.amount,
        v_expected_legacy_amounts ->> r.classification;
    END IF;
  END LOOP;

  -- ===================================================================
  -- G2 — Pré-état : aucun doublon actif sur la clé composite
  -- ===================================================================
  SELECT COUNT(*) INTO v_active_dup_count
  FROM (
    SELECT provider, category, operation_type, classification, cargo_type, COUNT(*) c
    FROM public.port_tariffs
    WHERE is_active = true
    GROUP BY 1,2,3,4,5
    HAVING COUNT(*) > 1
  ) d;
  IF v_active_dup_count <> 0 THEN
    RAISE EXCEPTION 'G2 abort: % active duplicate group(s) on composite key (pre-state)',
      v_active_dup_count;
  END IF;

  -- ===================================================================
  -- G3 — Aucune FK ne référence port_tariffs.id
  -- ===================================================================
  SELECT COUNT(*) INTO v_fk_count
  FROM pg_constraint
  WHERE contype = 'f'
    AND confrelid = 'public.port_tariffs'::regclass;
  IF v_fk_count <> 0 THEN
    RAISE EXCEPTION 'G3 abort: % foreign key(s) reference public.port_tariffs', v_fk_count;
  END IF;

  -- ===================================================================
  -- G4 — quotation_versions.snapshot : aucune référence textuelle aux IDs legacy
  --   * table absente   → NOTICE (non bloquant)
  --   * table présente + référence trouvée → RAISE EXCEPTION
  --   * table présente + 0 référence → PASS
  -- ===================================================================
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'quotation_versions'
  ) INTO v_qv_present;

  IF NOT v_qv_present THEN
    RAISE NOTICE 'G4: quotation_versions table absent — non-blocking PASS';
  ELSE
    EXECUTE $q$
      SELECT COUNT(*) FROM public.quotation_versions qv
      JOIN public.port_tariffs pt
        ON pt.provider = 'PAD' AND pt.category = 'DROIT_PASSAGE'
       AND pt.operation_type = 'IMPORT' AND pt.cargo_type = 'CONTENEUR'
       AND pt.is_active = true
       AND pt.source_document = 'pdf_redevances_portuaires_2006'
      WHERE qv.snapshot::text LIKE '%' || pt.id::text || '%'
    $q$ INTO v_qv_legacy_refs;
    IF v_qv_legacy_refs > 0 THEN
      RAISE EXCEPTION 'G4 abort: % quotation_versions row(s) reference legacy port_tariffs.id',
        v_qv_legacy_refs;
    END IF;
  END IF;

  -- ===================================================================
  -- PAYLOAD — table temporaire (rôle de CTE persistant pour gardes + INSERT)
  -- ===================================================================
  CREATE TEMP TABLE _pad2006_payload (
    operation_type TEXT NOT NULL,
    cargo_type     TEXT NOT NULL,
    classification TEXT NOT NULL,
    amount         NUMERIC NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _pad2006_payload (operation_type, cargo_type, classification, amount) VALUES
    ('EXPORT', 'CONTENEUR', 'P01', 28000::numeric), -- page 7
    ('EXPORT', 'CONTENEUR', 'P02', 2325::numeric), -- page 7
    ('EXPORT', 'CONTENEUR', 'P03', 13000::numeric), -- page 7
    ('EXPORT', 'CONTENEUR', 'P04', 1850::numeric), -- page 7
    ('EXPORT', 'CONTENEUR', 'P05', 3350::numeric), -- page 7
    ('EXPORT', 'CONTENEUR', 'T01', 19003::numeric), -- page 7
    ('EXPORT', 'CONTENEUR', 'T02', 8852::numeric), -- page 7
    ('EXPORT', 'CONTENEUR', 'T03', 1062::numeric), -- page 7
    ('EXPORT', 'CONTENEUR', 'T04', 3010::numeric), -- page 7
    ('EXPORT', 'CONTENEUR', 'T05', 1128::numeric), -- page 7
    ('EXPORT', 'CONTENEUR', 'T06', 873::numeric), -- page 7
    ('EXPORT', 'CONTENEUR', 'T07', 476::numeric), -- page 7
    ('EXPORT', 'CONTENEUR', 'T08', 1015::numeric), -- page 7
    ('EXPORT', 'CONTENEUR', 'T09', 4344::numeric), -- page 7
    ('EXPORT', 'CONTENEUR', 'T10', 779::numeric), -- page 7
    ('EXPORT', 'CONTENEUR', 'T11', 1652::numeric), -- page 7
    ('EXPORT', 'CONTENEUR', 'T12', 3187::numeric), -- page 7
    ('EXPORT', 'CONTENEUR', 'T13', 0::numeric), -- page 7
    ('EXPORT', 'CONTENEUR', 'T14', 4072::numeric), -- page 7
    ('EXPORT', 'CONVENTIONNEL', 'P01', 27500::numeric), -- page 7
    ('EXPORT', 'CONVENTIONNEL', 'P02', 1750::numeric), -- page 7
    ('EXPORT', 'CONVENTIONNEL', 'P03', 12500::numeric), -- page 7
    ('EXPORT', 'CONVENTIONNEL', 'P04', 1300::numeric), -- page 7
    ('EXPORT', 'CONVENTIONNEL', 'P05', 2250::numeric), -- page 7
    ('EXPORT', 'CONVENTIONNEL', 'T01', 16288::numeric), -- page 7
    ('EXPORT', 'CONVENTIONNEL', 'T02', 7672::numeric), -- page 7
    ('EXPORT', 'CONVENTIONNEL', 'T03', 354::numeric), -- page 7
    ('EXPORT', 'CONVENTIONNEL', 'T04', 2325::numeric), -- page 7
    ('EXPORT', 'CONVENTIONNEL', 'T05', 437::numeric), -- page 7
    ('EXPORT', 'CONVENTIONNEL', 'T06', 165::numeric), -- page 7
    ('EXPORT', 'CONVENTIONNEL', 'T07', 401::numeric), -- page 7
    ('EXPORT', 'CONVENTIONNEL', 'T08', 212::numeric), -- page 7
    ('EXPORT', 'CONVENTIONNEL', 'T09', 2715::numeric), -- page 7
    ('EXPORT', 'CONVENTIONNEL', 'T10', 97::numeric), -- page 7
    ('EXPORT', 'CONVENTIONNEL', 'T11', 991::numeric), -- page 7
    ('EXPORT', 'CONVENTIONNEL', 'T12', 2361::numeric), -- page 7
    ('EXPORT', 'CONVENTIONNEL', 'T14', 3394::numeric), -- page 7
    ('IMPORT', 'CONTENEUR', 'P01', 28100::numeric), -- page 7
    ('IMPORT', 'CONTENEUR', 'P02', 2325::numeric), -- page 7
    ('IMPORT', 'CONTENEUR', 'P03', 13000::numeric), -- page 7
    ('IMPORT', 'CONTENEUR', 'P04', 1850::numeric), -- page 7
    ('IMPORT', 'CONTENEUR', 'P05', 3350::numeric), -- page 7
    ('IMPORT', 'CONTENEUR', 'T01', 19239::numeric), -- page 7
    ('IMPORT', 'CONTENEUR', 'T02', 9678::numeric), -- page 7
    ('IMPORT', 'CONTENEUR', 'T03', 1416::numeric), -- page 7
    ('IMPORT', 'CONTENEUR', 'T04', 3069::numeric), -- page 7
    ('IMPORT', 'CONTENEUR', 'T05', 1180::numeric), -- page 7
    ('IMPORT', 'CONTENEUR', 'T06', 885::numeric), -- page 7
    ('IMPORT', 'CONTENEUR', 'T07', 484::numeric), -- page 7
    ('IMPORT', 'CONTENEUR', 'T08', 1062::numeric), -- page 7
    ('IMPORT', 'CONTENEUR', 'T09', 4367::numeric), -- page 7
    ('IMPORT', 'CONTENEUR', 'T10', 0::numeric), -- page 7
    ('IMPORT', 'CONTENEUR', 'T11', 1770::numeric), -- page 7
    ('IMPORT', 'CONTENEUR', 'T12', 4780::numeric), -- page 7
    ('IMPORT', 'CONTENEUR', 'T13', 11803::numeric), -- page 7
    ('IMPORT', 'CONTENEUR', 'T14', 4072::numeric), -- page 7
    ('IMPORT', 'CONVENTIONNEL', 'P01', 27500::numeric), -- page 7
    ('IMPORT', 'CONVENTIONNEL', 'P02', 1750::numeric), -- page 7
    ('IMPORT', 'CONVENTIONNEL', 'P03', 12500::numeric), -- page 7
    ('IMPORT', 'CONVENTIONNEL', 'P04', 1300::numeric), -- page 7
    ('IMPORT', 'CONVENTIONNEL', 'P05', 2250::numeric), -- page 7
    ('IMPORT', 'CONVENTIONNEL', 'T01', 16288::numeric), -- page 7
    ('IMPORT', 'CONVENTIONNEL', 'T02', 8144::numeric), -- page 7
    ('IMPORT', 'CONVENTIONNEL', 'T03', 673::numeric), -- page 7
    ('IMPORT', 'CONVENTIONNEL', 'T04', 2325::numeric), -- page 7
    ('IMPORT', 'CONVENTIONNEL', 'T05', 425::numeric), -- page 7
    ('IMPORT', 'CONVENTIONNEL', 'T06', 212::numeric), -- page 7
    ('IMPORT', 'CONVENTIONNEL', 'T07', 408::numeric), -- page 7
    ('IMPORT', 'CONVENTIONNEL', 'T08', 224::numeric), -- page 7
    ('IMPORT', 'CONVENTIONNEL', 'T09', 2715::numeric), -- page 7
    ('IMPORT', 'CONVENTIONNEL', 'T10', 0::numeric), -- page 7
    ('IMPORT', 'CONVENTIONNEL', 'T11', 991::numeric), -- page 7
    ('IMPORT', 'CONVENTIONNEL', 'T12', 4072::numeric), -- page 7
    ('IMPORT', 'CONVENTIONNEL', 'T13', 0::numeric), -- page 7
    ('IMPORT', 'CONVENTIONNEL', 'T14', 3394::numeric), -- page 7
    ('TRANSBORDEMENT', 'CONTENEUR', 'C01', 9000::numeric), -- page 8
    ('TRANSBORDEMENT', 'CONTENEUR', 'C02', 13500::numeric), -- page 8
    ('TRANSBORDEMENT', 'CONTENEUR', 'C03', 4500::numeric), -- page 8
    ('TRANSBORDEMENT', 'CONVENTIONNEL', 'T01', 5520::numeric), -- page 8
    ('TRANSBORDEMENT', 'CONVENTIONNEL', 'T02', 2760::numeric), -- page 8
    ('TRANSBORDEMENT', 'CONVENTIONNEL', 'T03', 228::numeric), -- page 8
    ('TRANSBORDEMENT', 'CONVENTIONNEL', 'T04', 788::numeric), -- page 8
    ('TRANSBORDEMENT', 'CONVENTIONNEL', 'T05', 144::numeric), -- page 8
    ('TRANSBORDEMENT', 'CONVENTIONNEL', 'T06', 72::numeric), -- page 8
    ('TRANSBORDEMENT', 'CONVENTIONNEL', 'T07', 138::numeric), -- page 8
    ('TRANSBORDEMENT', 'CONVENTIONNEL', 'T08', 76::numeric), -- page 8
    ('TRANSBORDEMENT', 'CONVENTIONNEL', 'T09', 920::numeric), -- page 8
    ('TRANSBORDEMENT', 'CONVENTIONNEL', 'T11', 336::numeric), -- page 8
    ('TRANSBORDEMENT', 'CONVENTIONNEL', 'T12', 1380::numeric), -- page 8
    ('TRANSBORDEMENT', 'CONVENTIONNEL', 'T14', 1150::numeric), -- page 8
    ('TRANSIT_EXPORT', 'CONTENEUR', 'C01', 4500::numeric), -- page 8
    ('TRANSIT_EXPORT', 'CONTENEUR', 'C02', 6750::numeric), -- page 8
    ('TRANSIT_EXPORT', 'CONTENEUR', 'C03', 2550::numeric), -- page 8
    ('TRANSIT_EXPORT', 'CONVENTIONNEL', 'T01', 6900::numeric), -- page 8
    ('TRANSIT_EXPORT', 'CONVENTIONNEL', 'T02', 3450::numeric), -- page 8
    ('TRANSIT_EXPORT', 'CONVENTIONNEL', 'T03', 150::numeric), -- page 8
    ('TRANSIT_EXPORT', 'CONVENTIONNEL', 'T04', 985::numeric), -- page 8
    ('TRANSIT_EXPORT', 'CONVENTIONNEL', 'T05', 185::numeric), -- page 8
    ('TRANSIT_EXPORT', 'CONVENTIONNEL', 'T06', 70::numeric), -- page 8
    ('TRANSIT_EXPORT', 'CONVENTIONNEL', 'T07', 170::numeric), -- page 8
    ('TRANSIT_EXPORT', 'CONVENTIONNEL', 'T08', 90::numeric), -- page 8
    ('TRANSIT_EXPORT', 'CONVENTIONNEL', 'T09', 1150::numeric), -- page 8
    ('TRANSIT_EXPORT', 'CONVENTIONNEL', 'T11', 420::numeric), -- page 8
    ('TRANSIT_EXPORT', 'CONVENTIONNEL', 'T12', 1000::numeric), -- page 8
    ('TRANSIT_EXPORT', 'CONVENTIONNEL', 'T14', 1438::numeric), -- page 8
    ('TRANSIT_IMPORT', 'CONTENEUR', 'C01', 11000::numeric), -- page 8
    ('TRANSIT_IMPORT', 'CONTENEUR', 'C02', 16500::numeric), -- page 8
    ('TRANSIT_IMPORT', 'CONTENEUR', 'C03', 5500::numeric), -- page 8
    ('TRANSIT_IMPORT', 'CONVENTIONNEL', 'T01', 6900::numeric), -- page 8
    ('TRANSIT_IMPORT', 'CONVENTIONNEL', 'T02', 3450::numeric), -- page 8
    ('TRANSIT_IMPORT', 'CONVENTIONNEL', 'T03', 285::numeric), -- page 8
    ('TRANSIT_IMPORT', 'CONVENTIONNEL', 'T04', 985::numeric), -- page 8
    ('TRANSIT_IMPORT', 'CONVENTIONNEL', 'T05', 180::numeric), -- page 8
    ('TRANSIT_IMPORT', 'CONVENTIONNEL', 'T06', 90::numeric), -- page 8
    ('TRANSIT_IMPORT', 'CONVENTIONNEL', 'T07', 173::numeric), -- page 8
    ('TRANSIT_IMPORT', 'CONVENTIONNEL', 'T08', 95::numeric), -- page 8
    ('TRANSIT_IMPORT', 'CONVENTIONNEL', 'T09', 1150::numeric), -- page 8
    ('TRANSIT_IMPORT', 'CONVENTIONNEL', 'T11', 420::numeric), -- page 8
    ('TRANSIT_IMPORT', 'CONVENTIONNEL', 'T12', 1725::numeric), -- page 8
    ('TRANSIT_IMPORT', 'CONVENTIONNEL', 'T14', 1438::numeric)  -- page 8
;

  -- P1 — cardinalité totale = 120
  SELECT COUNT(*) INTO v_payload_count FROM _pad2006_payload;
  IF v_payload_count <> c_expected_payload THEN
    RAISE EXCEPTION 'P1 abort: payload count = %, expected %',
      v_payload_count, c_expected_payload;
  END IF;

  -- P2 — 0 doublon dans le payload sur (op, cargo, class)
  SELECT COUNT(*) INTO v_dup_count
  FROM (
    SELECT operation_type, cargo_type, classification, COUNT(*) c
    FROM _pad2006_payload GROUP BY 1,2,3 HAVING COUNT(*) > 1
  ) d;
  IF v_dup_count <> 0 THEN
    RAISE EXCEPTION 'P2 abort: % duplicate group(s) inside payload', v_dup_count;
  END IF;

  -- P3 — operation_type ∈ {IMPORT, EXPORT, TRANSBORDEMENT, TRANSIT_IMPORT, TRANSIT_EXPORT}
  IF EXISTS (
    SELECT 1 FROM _pad2006_payload
    WHERE operation_type NOT IN
      ('IMPORT','EXPORT','TRANSBORDEMENT','TRANSIT_IMPORT','TRANSIT_EXPORT')
  ) THEN
    RAISE EXCEPTION 'P3 abort: invalid operation_type in payload';
  END IF;

  -- P4 — cargo_type ∈ {CONTENEUR, CONVENTIONNEL}
  IF EXISTS (
    SELECT 1 FROM _pad2006_payload WHERE cargo_type NOT IN ('CONTENEUR','CONVENTIONNEL')
  ) THEN
    RAISE EXCEPTION 'P4 abort: invalid cargo_type in payload';
  END IF;

  -- P5 — amount NUMERIC, >= 0 (jamais NULL, jamais négatif)
  IF EXISTS (SELECT 1 FROM _pad2006_payload WHERE amount IS NULL OR amount < 0) THEN
    RAISE EXCEPTION 'P5 abort: payload contains NULL or negative amount';
  END IF;

  -- P6 — cardinalités H2 par (operation_type, cargo_type) strictement = grille v2
  FOR r IN
    SELECT operation_type, cargo_type, COUNT(*) AS c
    FROM _pad2006_payload GROUP BY 1,2
  LOOP
    IF (v_expected_cardinalities ->> (r.operation_type || '|' || r.cargo_type))::int
       IS DISTINCT FROM r.c THEN
      RAISE EXCEPTION 'P6 abort: cardinality mismatch %/%, payload=% expected=%',
        r.operation_type, r.cargo_type, r.c,
        v_expected_cardinalities ->> (r.operation_type || '|' || r.cargo_type);
    END IF;
  END LOOP;

  -- P6bis — toutes les paires attendues sont présentes
  IF (SELECT COUNT(DISTINCT operation_type || '|' || cargo_type) FROM _pad2006_payload) <> 10 THEN
    RAISE EXCEPTION 'P6bis abort: payload missing one or more (op,cargo) pair(s)';
  END IF;

  -- ===================================================================
  -- ÉTAPE 1 — Désactivation legacy R2 (19 lignes IMPORT/CONTENEUR)
  -- ===================================================================
  UPDATE public.port_tariffs
  SET is_active = false, updated_at = now()
  WHERE provider = c_provider AND category = c_category
    AND operation_type = 'IMPORT' AND cargo_type = 'CONTENEUR'
    AND is_active = true
    AND source_document = c_source_doc;
  GET DIAGNOSTICS v_inactive_count = ROW_COUNT;
  IF v_inactive_count <> c_expected_legacy THEN
    RAISE EXCEPTION 'Step1 abort: deactivated % legacy rows, expected %',
      v_inactive_count, c_expected_legacy;
  END IF;

  -- ===================================================================
  -- ÉTAPE 2 — CREATE UNIQUE INDEX partiel (garde structurelle AVANT INSERT)
  --   Vérification stricte : si index homonyme existe, sa définition doit
  --   correspondre exactement à c_expected_index_def. Sinon RAISE EXCEPTION.
  -- ===================================================================
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = c_index_name
  ) INTO v_index_exists;

  IF v_index_exists THEN
    SELECT indexdef INTO v_index_def
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = c_index_name;
    IF v_index_def IS DISTINCT FROM c_expected_index_def THEN
      RAISE EXCEPTION 'Step2 abort: existing index % has unexpected definition: %',
        c_index_name, v_index_def;
    END IF;
    RAISE NOTICE 'Step2: index % already exists with expected definition — skipping create', c_index_name;
  ELSE
    EXECUTE format(
      'CREATE UNIQUE INDEX %I ON public.port_tariffs ' ||
      '(provider, category, operation_type, classification, cargo_type) ' ||
      'WHERE is_active = true',
      c_index_name
    );
  END IF;

  -- ===================================================================
  -- ÉTAPE 3 — INSERT des 120 lignes PRESENT depuis le payload
  --   * pas de ON CONFLICT (l'index partiel doit échouer en cas de doublon)
  --   * source_document, effective_date, evidence_level, unit, is_active : littéraux fixes
  -- ===================================================================
  INSERT INTO public.port_tariffs (
    provider, category, operation_type, classification, cargo_type,
    amount, unit, source_document, effective_date, evidence_level, is_active
  )
  SELECT
    c_provider, c_category, p.operation_type, p.classification, p.cargo_type,
    p.amount, c_unit, c_source_doc, c_effective_date, c_evidence_level, true
  FROM _pad2006_payload p;
  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  IF v_inserted_count <> c_expected_payload THEN
    RAISE EXCEPTION 'Step3 abort: inserted % rows, expected %',
      v_inserted_count, c_expected_payload;
  END IF;

  -- ===================================================================
  -- POST-CHECKS H1..H6
  -- ===================================================================

  -- H1 — 120 lignes actives source_document
  SELECT COUNT(*) INTO v_active_count
  FROM public.port_tariffs
  WHERE source_document = c_source_doc AND is_active = true
    AND effective_date = c_effective_date;
  IF v_active_count <> c_expected_payload THEN
    RAISE EXCEPTION 'H1 abort: active rows = %, expected %',
      v_active_count, c_expected_payload;
  END IF;

  -- H2 — cardinalités exactes par (operation_type, cargo_type)
  FOR r IN
    SELECT operation_type, cargo_type, COUNT(*) AS c
    FROM public.port_tariffs
    WHERE source_document = c_source_doc AND is_active = true
    GROUP BY 1,2
  LOOP
    IF (v_expected_cardinalities ->> (r.operation_type || '|' || r.cargo_type))::int
       IS DISTINCT FROM r.c THEN
      RAISE EXCEPTION 'H2 abort: post-state cardinality mismatch %/%, db=% expected=%',
        r.operation_type, r.cargo_type, r.c,
        v_expected_cardinalities ->> (r.operation_type || '|' || r.cargo_type);
    END IF;
  END LOOP;

  -- H3 — 19 lignes inactives legacy source_document
  SELECT COUNT(*) INTO v_inactive_count
  FROM public.port_tariffs
  WHERE source_document = c_source_doc AND is_active = false;
  IF v_inactive_count <> c_expected_legacy THEN
    RAISE EXCEPTION 'H3 abort: inactive legacy rows = %, expected %',
      v_inactive_count, c_expected_legacy;
  END IF;

  -- H4 — non-régression runtime : sum(amount) IMPORT/CONTENEUR active = sum payload équivalent
  SELECT COALESCE(SUM(amount), 0) INTO v_runtime_sum_db
  FROM public.port_tariffs
  WHERE provider = c_provider AND category = c_category
    AND operation_type = 'IMPORT' AND cargo_type = 'CONTENEUR'
    AND is_active = true AND source_document = c_source_doc;
  SELECT COALESCE(SUM(amount), 0) INTO v_runtime_sum_payload
  FROM _pad2006_payload
  WHERE operation_type = 'IMPORT' AND cargo_type = 'CONTENEUR';
  IF v_runtime_sum_db IS DISTINCT FROM v_runtime_sum_payload THEN
    RAISE EXCEPTION 'H4 abort: runtime sum mismatch IMPORT/CONTENEUR db=% payload=%',
      v_runtime_sum_db, v_runtime_sum_payload;
  END IF;

  -- H5 — 0 doublon actif sur la clé composite (post-état)
  SELECT COUNT(*) INTO v_active_dup_count
  FROM (
    SELECT provider, category, operation_type, classification, cargo_type, COUNT(*) c
    FROM public.port_tariffs
    WHERE is_active = true
    GROUP BY 1,2,3,4,5 HAVING COUNT(*) > 1
  ) d;
  IF v_active_dup_count <> 0 THEN
    RAISE EXCEPTION 'H5 abort: % active duplicate group(s) on composite key (post-state)',
      v_active_dup_count;
  END IF;

  -- H6 — index unique partiel présent et valide
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = c_index_name
  ) INTO v_index_exists;
  IF NOT v_index_exists THEN
    RAISE EXCEPTION 'H6 abort: unique partial index % missing', c_index_name;
  END IF;
  SELECT indexdef INTO v_index_def
  FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = c_index_name;
  IF v_index_def IS DISTINCT FROM c_expected_index_def THEN
    RAISE EXCEPTION 'H6 abort: index % final definition mismatch: %',
      c_index_name, v_index_def;
  END IF;

  RAISE NOTICE 'PAD-BAREME-2006-PHASE2-IMPORT-DRAFT: all gates and post-checks PASS (120 inserted, 19 deactivated)';
END;
$$ LANGUAGE plpgsql;

COMMIT;
