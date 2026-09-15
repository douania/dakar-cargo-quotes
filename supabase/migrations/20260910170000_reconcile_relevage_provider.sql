-- Authored 2026-09-14 under explicit CTO GO, ordered BEFORE 20260910180000 F1.
-- The 20260114114407 seed names these two rows DP_WORLD; F1/F1b require DPW.
-- This is a narrowly guarded provider reconciliation, NOT a tariff decision.
-- Do not edit/replay F1 on an already migrated runtime. Any Cloud application
-- and migration-ledger reconciliation require a separate GO and preflight.
-- No legacy candidate => strict no-op, including databases already past F1b.
-- Legacy candidates => require the exact two seed rows, no competing RELEVAGE.
-- Only provider changes (plus updated_at through the existing trigger).
DO $$
DECLARE
  v_ids uuid[];
  v_count integer;
  v_before jsonb;
  v_after jsonb;
  v_outside_before jsonb;
  v_outside_after jsonb;
BEGIN
  IF to_regclass('public.port_tariffs') IS NULL THEN
    RAISE EXCEPTION '[RELEVAGE-PROVIDER] STOP: port_tariffs absent';
  END IF;
  LOCK TABLE public.port_tariffs IN SHARE ROW EXCLUSIVE MODE;
  IF NOT EXISTS (SELECT 1 FROM public.port_tariffs
                 WHERE provider = 'DP_WORLD' AND category = 'RELEVAGE') THEN
    RAISE NOTICE '[RELEVAGE-PROVIDER] NO-OP: no legacy candidate';
    RETURN;
  END IF;

  -- A missing row, duplicate, mixed provider or additional RELEVAGE requires review.
  IF (SELECT count(*) FROM public.port_tariffs WHERE category = 'RELEVAGE') <> 2 THEN
    RAISE EXCEPTION '[RELEVAGE-PROVIDER] STOP: expected exactly two legacy RELEVAGE rows';
  END IF;
  SELECT array_agg(t.id ORDER BY t.id) INTO v_ids
  FROM public.port_tariffs t
  JOIN (VALUES
    ('CONTENEUR_20', 'Standard 20 pieds', 36560::numeric, 'FCFA/EVP'),
    ('CONTENEUR_40', 'Standard 40 pieds', 73120::numeric, 'FCFA/CNT')
  ) e(cargo_type, classification, amount, unit) ON t.cargo_type = e.cargo_type
  WHERE t.provider = 'DP_WORLD' AND t.category = 'RELEVAGE'
    AND t.operation_type = 'TRANSIT' AND t.classification = e.classification
    AND t.amount = e.amount AND t.unit = e.unit
    AND t.source_document = 'Taleb_Quote_2024' AND t.evidence_level = 'observed'
    AND t.effective_date = DATE '2024-10-01' AND t.expiry_date IS NULL
    AND t.is_active IS TRUE AND t.surcharge_percent = 0 AND t.surcharge_conditions IS NULL;
  IF coalesce(cardinality(v_ids), 0) <> 2
     OR (SELECT count(DISTINCT cargo_type) FROM public.port_tariffs WHERE id = ANY(v_ids)) <> 2 THEN
    RAISE EXCEPTION '[RELEVAGE-PROVIDER] STOP: legacy identity, amount or provenance differs';
  END IF;

  SELECT jsonb_agg(to_jsonb(t) - 'provider' - 'updated_at' ORDER BY id) INTO v_before
    FROM public.port_tariffs t WHERE id = ANY(v_ids);
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) INTO v_outside_before
    FROM public.port_tariffs t WHERE NOT (id = ANY(v_ids));
  UPDATE public.port_tariffs SET provider = 'DPW' WHERE id = ANY(v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 2 OR (SELECT count(*) FROM public.port_tariffs
                     WHERE id = ANY(v_ids) AND provider = 'DPW') <> 2 THEN
    RAISE EXCEPTION '[RELEVAGE-PROVIDER] STOP: unexpected update count';
  END IF;
  SELECT jsonb_agg(to_jsonb(t) - 'provider' - 'updated_at' ORDER BY id) INTO v_after
    FROM public.port_tariffs t WHERE id = ANY(v_ids);
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) INTO v_outside_after
    FROM public.port_tariffs t WHERE NOT (id = ANY(v_ids));
  IF v_before IS DISTINCT FROM v_after OR v_outside_before IS DISTINCT FROM v_outside_after THEN
    RAISE EXCEPTION '[RELEVAGE-PROVIDER] STOP: unexpected data mutation';
  END IF;
  RAISE NOTICE '[RELEVAGE-PROVIDER] PASS: exactly two providers reconciled, tariffs unchanged';
END $$;
