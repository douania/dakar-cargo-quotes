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

  c_expected_index_def CONSTANT TEXT :=
    'CREATE UNIQUE INDEX port_tariffs_active_unique_key ON public.port_tariffs ' ||
    'USING btree (provider, category, operation_type, classification, cargo_type) ' ||
    'WHERE (is_active = true)';

  v_expected_legacy_amounts JSONB := '{
    "T01":19239,"T02":9678,"T03":1416,"T04":3069,"T05":1180,
    "T06":885,"T07":484,"T08":1062,"T09":4367,"T10":0,
    "T11":1770,"T12":4780,"T13":11803,"T14":4072,
    "P01":28100,"P02":2325,"P03":13000,"P04":1850,"P05":3350
  }'::jsonb;

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
  -- G0
  SELECT COUNT(*) INTO v_legacy_count FROM public.port_tariffs
  WHERE provider = c_provider AND category = c_category
    AND operation_type = 'IMPORT' AND cargo_type = 'CONTENEUR'
    AND is_active = true AND source_document = c_source_doc;
  IF v_legacy_count <> c_expected_legacy THEN
    RAISE EXCEPTION 'G0 abort: expected % active legacy IMPORT/CONTENEUR rows, found %', c_expected_legacy, v_legacy_count;
  END IF;

  -- G1
  FOR r IN
    SELECT classification, amount FROM public.port_tariffs
    WHERE provider = c_provider AND category = c_category
      AND operation_type = 'IMPORT' AND cargo_type = 'CONTENEUR'
      AND is_active = true AND source_document = c_source_doc
  LOOP
    IF (v_expected_legacy_amounts ->> r.classification) IS NULL THEN
      RAISE EXCEPTION 'G1 abort: unexpected legacy classification %', r.classification;
    END IF;
    IF (v_expected_legacy_amounts ->> r.classification)::numeric IS DISTINCT FROM r.amount THEN
      RAISE EXCEPTION 'G1 abort: legacy amount mismatch for %, db=% expected=%',
        r.classification, r.amount, v_expected_legacy_amounts ->> r.classification;
    END IF;
  END LOOP;

  -- G2
  SELECT COUNT(*) INTO v_active_dup_count FROM (
    SELECT provider, category, operation_type, classification, cargo_type, COUNT(*) c
    FROM public.port_tariffs WHERE is_active = true
    GROUP BY 1,2,3,4,5 HAVING COUNT(*) > 1
  ) d;
  IF v_active_dup_count <> 0 THEN
    RAISE EXCEPTION 'G2 abort: % active duplicate group(s) on composite key (pre-state)', v_active_dup_count;
  END IF;

  -- G3
  SELECT COUNT(*) INTO v_fk_count FROM pg_constraint
  WHERE contype = 'f' AND confrelid = 'public.port_tariffs'::regclass;
  IF v_fk_count <> 0 THEN
    RAISE EXCEPTION 'G3 abort: % foreign key(s) reference public.port_tariffs', v_fk_count;
  END IF;

  -- G4
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
      RAISE EXCEPTION 'G4 abort: % quotation_versions row(s) reference legacy port_tariffs.id', v_qv_legacy_refs;
    END IF;
  END IF;

  -- PAYLOAD
  CREATE TEMP TABLE _pad2006_payload (
    operation_type TEXT NOT NULL,
    cargo_type     TEXT NOT NULL,
    classification TEXT NOT NULL,
    amount         NUMERIC NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _pad2006_payload (operation_type, cargo_type, classification, amount) VALUES
    ('EXPORT','CONTENEUR','P01',28000),('EXPORT','CONTENEUR','P02',2325),('EXPORT','CONTENEUR','P03',13000),
    ('EXPORT','CONTENEUR','P04',1850),('EXPORT','CONTENEUR','P05',3350),('EXPORT','CONTENEUR','T01',19003),
    ('EXPORT','CONTENEUR','T02',8852),('EXPORT','CONTENEUR','T03',1062),('EXPORT','CONTENEUR','T04',3010),
    ('EXPORT','CONTENEUR','T05',1128),('EXPORT','CONTENEUR','T06',873),('EXPORT','CONTENEUR','T07',476),
    ('EXPORT','CONTENEUR','T08',1015),('EXPORT','CONTENEUR','T09',4344),('EXPORT','CONTENEUR','T10',779),
    ('EXPORT','CONTENEUR','T11',1652),('EXPORT','CONTENEUR','T12',3187),('EXPORT','CONTENEUR','T13',0),
    ('EXPORT','CONTENEUR','T14',4072),
    ('EXPORT','CONVENTIONNEL','P01',27500),('EXPORT','CONVENTIONNEL','P02',1750),('EXPORT','CONVENTIONNEL','P03',12500),
    ('EXPORT','CONVENTIONNEL','P04',1300),('EXPORT','CONVENTIONNEL','P05',2250),('EXPORT','CONVENTIONNEL','T01',16288),
    ('EXPORT','CONVENTIONNEL','T02',7672),('EXPORT','CONVENTIONNEL','T03',354),('EXPORT','CONVENTIONNEL','T04',2325),
    ('EXPORT','CONVENTIONNEL','T05',437),('EXPORT','CONVENTIONNEL','T06',165),('EXPORT','CONVENTIONNEL','T07',401),
    ('EXPORT','CONVENTIONNEL','T08',212),('EXPORT','CONVENTIONNEL','T09',2715),('EXPORT','CONVENTIONNEL','T10',97),
    ('EXPORT','CONVENTIONNEL','T11',991),('EXPORT','CONVENTIONNEL','T12',2361),('EXPORT','CONVENTIONNEL','T14',3394),
    ('IMPORT','CONTENEUR','P01',28100),('IMPORT','CONTENEUR','P02',2325),('IMPORT','CONTENEUR','P03',13000),
    ('IMPORT','CONTENEUR','P04',1850),('IMPORT','CONTENEUR','P05',3350),('IMPORT','CONTENEUR','T01',19239),
    ('IMPORT','CONTENEUR','T02',9678),('IMPORT','CONTENEUR','T03',1416),('IMPORT','CONTENEUR','T04',3069),
    ('IMPORT','CONTENEUR','T05',1180),('IMPORT','CONTENEUR','T06',885),('IMPORT','CONTENEUR','T07',484),
    ('IMPORT','CONTENEUR','T08',1062),('IMPORT','CONTENEUR','T09',4367),('IMPORT','CONTENEUR','T10',0),
    ('IMPORT','CONTENEUR','T11',1770),('IMPORT','CONTENEUR','T12',4780),('IMPORT','CONTENEUR','T13',11803),
    ('IMPORT','CONTENEUR','T14',4072),
    ('IMPORT','CONVENTIONNEL','P01',27500),('IMPORT','CONVENTIONNEL','P02',1750),('IMPORT','CONVENTIONNEL','P03',12500),
    ('IMPORT','CONVENTIONNEL','P04',1300),('IMPORT','CONVENTIONNEL','P05',2250),('IMPORT','CONVENTIONNEL','T01',16288),
    ('IMPORT','CONVENTIONNEL','T02',8144),('IMPORT','CONVENTIONNEL','T03',673),('IMPORT','CONVENTIONNEL','T04',2325),
    ('IMPORT','CONVENTIONNEL','T05',425),('IMPORT','CONVENTIONNEL','T06',212),('IMPORT','CONVENTIONNEL','T07',408),
    ('IMPORT','CONVENTIONNEL','T08',224),('IMPORT','CONVENTIONNEL','T09',2715),('IMPORT','CONVENTIONNEL','T10',0),
    ('IMPORT','CONVENTIONNEL','T11',991),('IMPORT','CONVENTIONNEL','T12',4072),('IMPORT','CONVENTIONNEL','T13',0),
    ('IMPORT','CONVENTIONNEL','T14',3394),
    ('TRANSBORDEMENT','CONTENEUR','C01',9000),('TRANSBORDEMENT','CONTENEUR','C02',13500),('TRANSBORDEMENT','CONTENEUR','C03',4500),
    ('TRANSBORDEMENT','CONVENTIONNEL','T01',5520),('TRANSBORDEMENT','CONVENTIONNEL','T02',2760),('TRANSBORDEMENT','CONVENTIONNEL','T03',228),
    ('TRANSBORDEMENT','CONVENTIONNEL','T04',788),('TRANSBORDEMENT','CONVENTIONNEL','T05',144),('TRANSBORDEMENT','CONVENTIONNEL','T06',72),
    ('TRANSBORDEMENT','CONVENTIONNEL','T07',138),('TRANSBORDEMENT','CONVENTIONNEL','T08',76),('TRANSBORDEMENT','CONVENTIONNEL','T09',920),
    ('TRANSBORDEMENT','CONVENTIONNEL','T11',336),('TRANSBORDEMENT','CONVENTIONNEL','T12',1380),('TRANSBORDEMENT','CONVENTIONNEL','T14',1150),
    ('TRANSIT_EXPORT','CONTENEUR','C01',4500),('TRANSIT_EXPORT','CONTENEUR','C02',6750),('TRANSIT_EXPORT','CONTENEUR','C03',2550),
    ('TRANSIT_EXPORT','CONVENTIONNEL','T01',6900),('TRANSIT_EXPORT','CONVENTIONNEL','T02',3450),('TRANSIT_EXPORT','CONVENTIONNEL','T03',150),
    ('TRANSIT_EXPORT','CONVENTIONNEL','T04',985),('TRANSIT_EXPORT','CONVENTIONNEL','T05',185),('TRANSIT_EXPORT','CONVENTIONNEL','T06',70),
    ('TRANSIT_EXPORT','CONVENTIONNEL','T07',170),('TRANSIT_EXPORT','CONVENTIONNEL','T08',90),('TRANSIT_EXPORT','CONVENTIONNEL','T09',1150),
    ('TRANSIT_EXPORT','CONVENTIONNEL','T11',420),('TRANSIT_EXPORT','CONVENTIONNEL','T12',1000),('TRANSIT_EXPORT','CONVENTIONNEL','T14',1438),
    ('TRANSIT_IMPORT','CONTENEUR','C01',11000),('TRANSIT_IMPORT','CONTENEUR','C02',16500),('TRANSIT_IMPORT','CONTENEUR','C03',5500),
    ('TRANSIT_IMPORT','CONVENTIONNEL','T01',6900),('TRANSIT_IMPORT','CONVENTIONNEL','T02',3450),('TRANSIT_IMPORT','CONVENTIONNEL','T03',285),
    ('TRANSIT_IMPORT','CONVENTIONNEL','T04',985),('TRANSIT_IMPORT','CONVENTIONNEL','T05',180),('TRANSIT_IMPORT','CONVENTIONNEL','T06',90),
    ('TRANSIT_IMPORT','CONVENTIONNEL','T07',173),('TRANSIT_IMPORT','CONVENTIONNEL','T08',95),('TRANSIT_IMPORT','CONVENTIONNEL','T09',1150),
    ('TRANSIT_IMPORT','CONVENTIONNEL','T11',420),('TRANSIT_IMPORT','CONVENTIONNEL','T12',1725),('TRANSIT_IMPORT','CONVENTIONNEL','T14',1438);

  -- P1
  SELECT COUNT(*) INTO v_payload_count FROM _pad2006_payload;
  IF v_payload_count <> c_expected_payload THEN
    RAISE EXCEPTION 'P1 abort: payload count = %, expected %', v_payload_count, c_expected_payload;
  END IF;

  -- P2
  SELECT COUNT(*) INTO v_dup_count FROM (
    SELECT operation_type, cargo_type, classification, COUNT(*) c
    FROM _pad2006_payload GROUP BY 1,2,3 HAVING COUNT(*) > 1
  ) d;
  IF v_dup_count <> 0 THEN
    RAISE EXCEPTION 'P2 abort: % duplicate group(s) inside payload', v_dup_count;
  END IF;

  -- P3
  IF EXISTS (SELECT 1 FROM _pad2006_payload
    WHERE operation_type NOT IN ('IMPORT','EXPORT','TRANSBORDEMENT','TRANSIT_IMPORT','TRANSIT_EXPORT')) THEN
    RAISE EXCEPTION 'P3 abort: invalid operation_type in payload';
  END IF;

  -- P4
  IF EXISTS (SELECT 1 FROM _pad2006_payload WHERE cargo_type NOT IN ('CONTENEUR','CONVENTIONNEL')) THEN
    RAISE EXCEPTION 'P4 abort: invalid cargo_type in payload';
  END IF;

  -- P5
  IF EXISTS (SELECT 1 FROM _pad2006_payload WHERE amount IS NULL OR amount < 0) THEN
    RAISE EXCEPTION 'P5 abort: payload contains NULL or negative amount';
  END IF;

  -- P6
  FOR r IN
    SELECT operation_type, cargo_type, COUNT(*) AS c FROM _pad2006_payload GROUP BY 1,2
  LOOP
    IF (v_expected_cardinalities ->> (r.operation_type || '|' || r.cargo_type))::int IS DISTINCT FROM r.c THEN
      RAISE EXCEPTION 'P6 abort: cardinality mismatch %/%, payload=% expected=%',
        r.operation_type, r.cargo_type, r.c,
        v_expected_cardinalities ->> (r.operation_type || '|' || r.cargo_type);
    END IF;
  END LOOP;

  -- P6bis
  IF (SELECT COUNT(DISTINCT operation_type || '|' || cargo_type) FROM _pad2006_payload) <> 10 THEN
    RAISE EXCEPTION 'P6bis abort: payload missing one or more (op,cargo) pair(s)';
  END IF;

  -- ÉTAPE 1 — Désactivation legacy
  UPDATE public.port_tariffs
  SET is_active = false, updated_at = now()
  WHERE provider = c_provider AND category = c_category
    AND operation_type = 'IMPORT' AND cargo_type = 'CONTENEUR'
    AND is_active = true AND source_document = c_source_doc;
  GET DIAGNOSTICS v_inactive_count = ROW_COUNT;
  IF v_inactive_count <> c_expected_legacy THEN
    RAISE EXCEPTION 'Step1 abort: deactivated % legacy rows, expected %', v_inactive_count, c_expected_legacy;
  END IF;

  -- ÉTAPE 2 — INDEX
  SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = c_index_name) INTO v_index_exists;
  IF v_index_exists THEN
    SELECT indexdef INTO v_index_def FROM pg_indexes WHERE schemaname = 'public' AND indexname = c_index_name;
    IF v_index_def IS DISTINCT FROM c_expected_index_def THEN
      RAISE EXCEPTION 'Step2 abort: existing index % has unexpected definition: %', c_index_name, v_index_def;
    END IF;
    RAISE NOTICE 'Step2: index % already exists with expected definition — skipping create', c_index_name;
  ELSE
    EXECUTE format(
      'CREATE UNIQUE INDEX %I ON public.port_tariffs (provider, category, operation_type, classification, cargo_type) WHERE is_active = true',
      c_index_name
    );
  END IF;

  -- ÉTAPE 3 — INSERT 120
  INSERT INTO public.port_tariffs (
    provider, category, operation_type, classification, cargo_type,
    amount, unit, source_document, effective_date, evidence_level, is_active
  )
  SELECT c_provider, c_category, p.operation_type, p.classification, p.cargo_type,
    p.amount, c_unit, c_source_doc, c_effective_date, c_evidence_level, true
  FROM _pad2006_payload p;
  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  IF v_inserted_count <> c_expected_payload THEN
    RAISE EXCEPTION 'Step3 abort: inserted % rows, expected %', v_inserted_count, c_expected_payload;
  END IF;

  -- H1
  SELECT COUNT(*) INTO v_active_count FROM public.port_tariffs
  WHERE provider = c_provider AND category = c_category
    AND source_document = c_source_doc AND is_active = true
    AND effective_date = c_effective_date;
  IF v_active_count <> c_expected_payload THEN
    RAISE EXCEPTION 'H1 abort: active rows = %, expected %', v_active_count, c_expected_payload;
  END IF;

  -- H2
  FOR r IN
    SELECT operation_type, cargo_type, COUNT(*) AS c
    FROM public.port_tariffs
    WHERE source_document = c_source_doc AND is_active = true
    GROUP BY 1,2
  LOOP
    IF (v_expected_cardinalities ->> (r.operation_type || '|' || r.cargo_type))::int IS DISTINCT FROM r.c THEN
      RAISE EXCEPTION 'H2 abort: post-state cardinality mismatch %/%, db=% expected=%',
        r.operation_type, r.cargo_type, r.c,
        v_expected_cardinalities ->> (r.operation_type || '|' || r.cargo_type);
    END IF;
  END LOOP;

  -- H3
  SELECT COUNT(*) INTO v_inactive_count FROM public.port_tariffs
  WHERE provider = c_provider AND category = c_category
    AND source_document = c_source_doc AND is_active = false;
  IF v_inactive_count <> c_expected_legacy THEN
    RAISE EXCEPTION 'H3 abort: inactive legacy rows = %, expected %', v_inactive_count, c_expected_legacy;
  END IF;

  -- H4
  SELECT COALESCE(SUM(amount), 0) INTO v_runtime_sum_db FROM public.port_tariffs
  WHERE provider = c_provider AND category = c_category
    AND operation_type = 'IMPORT' AND cargo_type = 'CONTENEUR'
    AND is_active = true AND source_document = c_source_doc;
  SELECT COALESCE(SUM(amount), 0) INTO v_runtime_sum_payload FROM _pad2006_payload
  WHERE operation_type = 'IMPORT' AND cargo_type = 'CONTENEUR';
  IF v_runtime_sum_db IS DISTINCT FROM v_runtime_sum_payload THEN
    RAISE EXCEPTION 'H4 abort: runtime sum mismatch IMPORT/CONTENEUR db=% payload=%', v_runtime_sum_db, v_runtime_sum_payload;
  END IF;

  -- H4bis
  FOR r IN
    SELECT
      COALESCE(db.classification, p.classification) AS classification,
      db.amount  AS db_amount,
      p.amount   AS payload_amount
    FROM (
      SELECT classification, amount FROM public.port_tariffs
      WHERE provider = c_provider AND category = c_category
        AND operation_type = 'IMPORT' AND cargo_type = 'CONTENEUR'
        AND source_document = c_source_doc AND effective_date = c_effective_date
        AND is_active = true
    ) db
    FULL OUTER JOIN (
      SELECT classification, amount FROM _pad2006_payload
      WHERE operation_type = 'IMPORT' AND cargo_type = 'CONTENEUR'
    ) p USING (classification)
  LOOP
    IF r.db_amount IS DISTINCT FROM r.payload_amount THEN
      RAISE EXCEPTION 'H4bis abort: classification % amount mismatch db=% payload=%',
        r.classification, r.db_amount, r.payload_amount;
    END IF;
  END LOOP;

  -- H5
  SELECT COUNT(*) INTO v_active_dup_count FROM (
    SELECT provider, category, operation_type, classification, cargo_type, COUNT(*) c
    FROM public.port_tariffs WHERE is_active = true
    GROUP BY 1,2,3,4,5 HAVING COUNT(*) > 1
  ) d;
  IF v_active_dup_count <> 0 THEN
    RAISE EXCEPTION 'H5 abort: % active duplicate group(s) on composite key (post-state)', v_active_dup_count;
  END IF;

  -- H6
  SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = c_index_name) INTO v_index_exists;
  IF NOT v_index_exists THEN
    RAISE EXCEPTION 'H6 abort: unique partial index % missing', c_index_name;
  END IF;
  SELECT indexdef INTO v_index_def FROM pg_indexes WHERE schemaname = 'public' AND indexname = c_index_name;
  IF v_index_def IS DISTINCT FROM c_expected_index_def THEN
    RAISE EXCEPTION 'H6 abort: index % final definition mismatch: %', c_index_name, v_index_def;
  END IF;

  RAISE NOTICE 'PAD-BAREME-2006-PHASE2-IMPORT-DRAFT: all gates and post-checks PASS (120 inserted, 19 deactivated)';
END;
$$ LANGUAGE plpgsql;