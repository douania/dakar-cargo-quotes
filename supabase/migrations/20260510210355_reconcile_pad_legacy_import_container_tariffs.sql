-- Reconcile the unversioned PAD 2006 legacy seed required by the next migration.
--
-- Safe states:
--   1. Fresh rebuild: no rows for the official source -> insert the 19 legacy rows.
--   2. Exact pre-transform seed: 19 active legacy rows -> strict no-op.
--   3. Exact post-transform state: 19 inactive legacy + 120 active normalized rows
--      -> strict no-op (required when backfilling the migration ledger on Lovable).
-- Any partial, mixed, colliding, or drifted state aborts.

DO $$
DECLARE
  c_provider             CONSTANT TEXT := 'PAD';
  c_category             CONSTANT TEXT := 'DROIT_PASSAGE';
  c_operation_type       CONSTANT TEXT := 'IMPORT';
  c_cargo_type           CONSTANT TEXT := 'CONTENEUR';
  c_unit                 CONSTANT TEXT := 'PER_TONNE';
  c_source_document      CONSTANT TEXT := 'pdf_redevances_portuaires_2006';
  c_effective_date       CONSTANT DATE := DATE '2006-01-01';
  c_evidence_level       CONSTANT TEXT := 'official';
  c_index_name           CONSTANT TEXT := 'port_tariffs_active_unique_key';
  c_expected_legacy      CONSTANT INT := 19;
  c_expected_normalized  CONSTANT INT := 120;
  c_expected_total       CONSTANT INT := 139;
  c_active_payload_md5   CONSTANT TEXT := '74b37ec61ceb2638ea74b43842fee637';
  c_expected_index_def   CONSTANT TEXT :=
    'CREATE UNIQUE INDEX port_tariffs_active_unique_key ON public.port_tariffs ' ||
    'USING btree (provider, category, operation_type, classification, cargo_type) ' ||
    'WHERE (is_active = true)';

  v_source_total                    INT;
  v_source_active                   INT;
  v_source_inactive                 INT;
  v_active_target_count             INT;
  v_inactive_target_count           INT;
  v_active_target_drift             INT;
  v_inactive_target_drift           INT;
  v_active_legacy_common_drift      INT;
  v_inactive_legacy_common_drift    INT;
  v_active_normalized_common_drift  INT;
  v_active_duplicate_groups         INT;
  v_target_active_collisions        INT;
  v_fk_count                        INT;
  v_inserted_count                  INT;
  v_index_exists                    BOOLEAN;
  v_index_def                       TEXT;
  v_active_payload_md5              TEXT;
BEGIN
  IF to_regclass('public.port_tariffs') IS NULL THEN
    RAISE EXCEPTION 'PAD prerequisite abort: public.port_tariffs is missing';
  END IF;

  -- Keep state classification and the optional insert atomic with concurrent writes.
  LOCK TABLE public.port_tariffs IN SHARE ROW EXCLUSIVE MODE;

  CREATE TEMP TABLE _pad2006_legacy_expected (
    classification TEXT PRIMARY KEY,
    amount NUMERIC NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _pad2006_legacy_expected (classification, amount) VALUES
    ('T01', 19239), ('T02', 9678),  ('T03', 1416),  ('T04', 3069),
    ('T05', 1180),  ('T06', 885),   ('T07', 484),   ('T08', 1062),
    ('T09', 4367),  ('T10', 0),     ('T11', 1770),  ('T12', 4780),
    ('T13', 11803), ('T14', 4072),  ('P01', 28100), ('P02', 2325),
    ('P03', 13000), ('P04', 1850),  ('P05', 3350);

  IF (SELECT COUNT(*) FROM _pad2006_legacy_expected) <> c_expected_legacy THEN
    RAISE EXCEPTION 'PAD prerequisite abort: internal legacy payload cardinality drift';
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE is_active = true),
    COUNT(*) FILTER (WHERE is_active = false)
  INTO v_source_total, v_source_active, v_source_inactive
  FROM public.port_tariffs
  WHERE source_document = c_source_document;

  SELECT COUNT(*) INTO v_active_target_count
  FROM public.port_tariffs
  WHERE provider = c_provider
    AND category = c_category
    AND operation_type = c_operation_type
    AND cargo_type = c_cargo_type
    AND source_document = c_source_document
    AND is_active = true;

  SELECT COUNT(*) INTO v_inactive_target_count
  FROM public.port_tariffs
  WHERE provider = c_provider
    AND category = c_category
    AND operation_type = c_operation_type
    AND cargo_type = c_cargo_type
    AND source_document = c_source_document
    AND is_active = false;

  SELECT COUNT(*) INTO v_active_target_drift
  FROM _pad2006_legacy_expected expected
  FULL OUTER JOIN (
    SELECT classification, amount
    FROM public.port_tariffs
    WHERE provider = c_provider
      AND category = c_category
      AND operation_type = c_operation_type
      AND cargo_type = c_cargo_type
      AND source_document = c_source_document
      AND is_active = true
  ) actual USING (classification)
  WHERE expected.classification IS NULL
     OR actual.classification IS NULL
     OR actual.amount IS DISTINCT FROM expected.amount;

  SELECT COUNT(*) INTO v_inactive_target_drift
  FROM _pad2006_legacy_expected expected
  FULL OUTER JOIN (
    SELECT classification, amount
    FROM public.port_tariffs
    WHERE provider = c_provider
      AND category = c_category
      AND operation_type = c_operation_type
      AND cargo_type = c_cargo_type
      AND source_document = c_source_document
      AND is_active = false
  ) actual USING (classification)
  WHERE expected.classification IS NULL
     OR actual.classification IS NULL
     OR actual.amount IS DISTINCT FROM expected.amount;

  SELECT COUNT(*) INTO v_active_legacy_common_drift
  FROM public.port_tariffs
  WHERE source_document = c_source_document
    AND is_active = true
    AND (
      provider IS DISTINCT FROM c_provider
      OR category IS DISTINCT FROM c_category
      OR operation_type IS DISTINCT FROM c_operation_type
      OR cargo_type IS DISTINCT FROM c_cargo_type
      OR unit IS DISTINCT FROM c_unit
      OR surcharge_percent IS NOT NULL
      OR surcharge_conditions IS NOT NULL
      OR effective_date IS DISTINCT FROM c_effective_date
      OR expiry_date IS NOT NULL
      OR evidence_level IS DISTINCT FROM c_evidence_level
    );

  SELECT COUNT(*) INTO v_inactive_legacy_common_drift
  FROM public.port_tariffs
  WHERE source_document = c_source_document
    AND is_active = false
    AND (
      provider IS DISTINCT FROM c_provider
      OR category IS DISTINCT FROM c_category
      OR operation_type IS DISTINCT FROM c_operation_type
      OR cargo_type IS DISTINCT FROM c_cargo_type
      OR unit IS DISTINCT FROM c_unit
      OR surcharge_percent IS NOT NULL
      OR surcharge_conditions IS NOT NULL
      OR effective_date IS DISTINCT FROM c_effective_date
      OR expiry_date IS NOT NULL
      OR evidence_level IS DISTINCT FROM c_evidence_level
    );

  SELECT COUNT(*) INTO v_active_normalized_common_drift
  FROM public.port_tariffs
  WHERE source_document = c_source_document
    AND is_active = true
    AND (
      provider IS DISTINCT FROM c_provider
      OR category IS DISTINCT FROM c_category
      OR operation_type NOT IN (
        'IMPORT', 'EXPORT', 'TRANSBORDEMENT', 'TRANSIT_IMPORT', 'TRANSIT_EXPORT'
      )
      OR cargo_type NOT IN ('CONTENEUR', 'CONVENTIONNEL')
      OR unit IS DISTINCT FROM c_unit
      OR surcharge_percent IS DISTINCT FROM 0::NUMERIC
      OR surcharge_conditions IS NOT NULL
      OR effective_date IS DISTINCT FROM c_effective_date
      OR expiry_date IS NOT NULL
      OR evidence_level IS DISTINCT FROM c_evidence_level
    );

  SELECT COUNT(*) INTO v_active_duplicate_groups
  FROM (
    SELECT provider, category, operation_type, classification, cargo_type
    FROM public.port_tariffs
    WHERE is_active = true
    GROUP BY 1, 2, 3, 4, 5
    HAVING COUNT(*) > 1
  ) duplicates;

  SELECT COUNT(*) INTO v_target_active_collisions
  FROM public.port_tariffs tariffs
  JOIN _pad2006_legacy_expected expected USING (classification)
  WHERE tariffs.provider = c_provider
    AND tariffs.category = c_category
    AND tariffs.operation_type = c_operation_type
    AND tariffs.cargo_type = c_cargo_type
    AND tariffs.is_active = true;

  SELECT COUNT(*) INTO v_fk_count
  FROM pg_constraint
  WHERE contype = 'f'
    AND confrelid = 'public.port_tariffs'::regclass;

  SELECT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = c_index_name
  ) INTO v_index_exists;

  IF v_index_exists THEN
    SELECT indexdef INTO v_index_def
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = c_index_name;
  END IF;

  SELECT md5(string_agg(
    operation_type || '|' || COALESCE(cargo_type, '<NULL>') || '|' ||
      classification || '|' || amount::TEXT,
    E'\n'
    ORDER BY operation_type, cargo_type, classification
  )) INTO v_active_payload_md5
  FROM public.port_tariffs
  WHERE provider = c_provider
    AND category = c_category
    AND source_document = c_source_document
    AND is_active = true;

  -- State 1: fresh rebuild. This is the only branch allowed to write.
  IF v_source_total = 0 THEN
    IF v_index_exists THEN
      RAISE EXCEPTION 'PAD prerequisite abort: fresh state has unexpected index %', c_index_name;
    END IF;
    IF v_active_duplicate_groups <> 0 THEN
      RAISE EXCEPTION 'PAD prerequisite abort: fresh state has % active duplicate group(s)', v_active_duplicate_groups;
    END IF;
    IF v_target_active_collisions <> 0 THEN
      RAISE EXCEPTION 'PAD prerequisite abort: fresh state has % active target-key collision(s)', v_target_active_collisions;
    END IF;
    IF v_fk_count <> 0 THEN
      RAISE EXCEPTION 'PAD prerequisite abort: fresh state has % FK(s) referencing public.port_tariffs', v_fk_count;
    END IF;

    INSERT INTO public.port_tariffs (
      provider,
      category,
      operation_type,
      classification,
      cargo_type,
      amount,
      unit,
      surcharge_percent,
      surcharge_conditions,
      source_document,
      effective_date,
      expiry_date,
      is_active,
      evidence_level
    )
    SELECT
      c_provider,
      c_category,
      c_operation_type,
      expected.classification,
      c_cargo_type,
      expected.amount,
      c_unit,
      NULL,
      NULL,
      c_source_document,
      c_effective_date,
      NULL,
      true,
      c_evidence_level
    FROM _pad2006_legacy_expected expected
    ORDER BY expected.classification;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
    IF v_inserted_count <> c_expected_legacy THEN
      RAISE EXCEPTION 'PAD prerequisite abort: inserted %, expected %', v_inserted_count, c_expected_legacy;
    END IF;

    SELECT COUNT(*) INTO v_active_target_count
    FROM public.port_tariffs
    WHERE provider = c_provider
      AND category = c_category
      AND operation_type = c_operation_type
      AND cargo_type = c_cargo_type
      AND source_document = c_source_document
      AND is_active = true;

    IF v_active_target_count <> c_expected_legacy THEN
      RAISE EXCEPTION 'PAD prerequisite abort: post-insert active legacy count %, expected %',
        v_active_target_count, c_expected_legacy;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM _pad2006_legacy_expected expected
      FULL OUTER JOIN (
        SELECT classification, amount
        FROM public.port_tariffs
        WHERE provider = c_provider
          AND category = c_category
          AND operation_type = c_operation_type
          AND cargo_type = c_cargo_type
          AND source_document = c_source_document
          AND is_active = true
      ) actual USING (classification)
      WHERE expected.classification IS NULL
         OR actual.classification IS NULL
         OR actual.amount IS DISTINCT FROM expected.amount
    ) THEN
      RAISE EXCEPTION 'PAD prerequisite abort: post-insert legacy payload drift';
    END IF;

    RAISE NOTICE 'PAD prerequisite: inserted 19 exact active legacy IMPORT/CONTENEUR rows';

  -- State 2: exact seed already present. Retry/replay is a strict no-op.
  ELSIF v_source_total = c_expected_legacy
    AND v_source_active = c_expected_legacy
    AND v_source_inactive = 0
  THEN
    IF v_active_target_count <> c_expected_legacy
       OR v_active_target_drift <> 0
       OR v_active_legacy_common_drift <> 0
       OR v_active_duplicate_groups <> 0
       OR v_fk_count <> 0
       OR v_index_exists
    THEN
      RAISE EXCEPTION 'PAD prerequisite abort: drift in exact pre-transform seed state';
    END IF;

    RAISE NOTICE 'PAD prerequisite: exact 19-row pre-transform seed already present — no-op';

  -- State 3: Lovable/current post-transform state. Backfill must perform zero writes.
  ELSIF v_source_total = c_expected_total
    AND v_source_active = c_expected_normalized
    AND v_source_inactive = c_expected_legacy
  THEN
    IF v_active_target_count <> c_expected_legacy
       OR v_inactive_target_count <> c_expected_legacy
       OR v_active_target_drift <> 0
       OR v_inactive_target_drift <> 0
       OR v_inactive_legacy_common_drift <> 0
       OR v_active_normalized_common_drift <> 0
       OR v_active_duplicate_groups <> 0
       OR v_active_payload_md5 IS DISTINCT FROM c_active_payload_md5
       OR NOT v_index_exists
       OR v_index_def IS DISTINCT FROM c_expected_index_def
    THEN
      RAISE EXCEPTION 'PAD prerequisite abort: drift in post-transform no-op state';
    END IF;

    RAISE NOTICE 'PAD prerequisite: exact 139-row post-transform state already present — no-op';

  ELSE
    RAISE EXCEPTION
      'PAD prerequisite abort: unsupported state source_total=%, active=%, inactive=%, active_target=%, inactive_target=%',
      v_source_total,
      v_source_active,
      v_source_inactive,
      v_active_target_count,
      v_inactive_target_count;
  END IF;
END;
$$ LANGUAGE plpgsql;
