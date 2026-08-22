-- ============================================================================
-- Prerequisite to Lot 1.1: restore versioned provenance for the 21 carrier
-- billing templates seeded by 20260114114407.
--
-- The historical Lovable data backfill was not committed as a migration. This
-- reconciliation uses deterministic business keys, never environment UUIDs.
-- It is deliberately a no-op when the observed Lovable state is already exact.
-- ============================================================================

DO $$
DECLARE
  v_expected_count integer;
  v_cardinality_violations text;
  v_fingerprint_violations text;
  v_state_violations text;
  v_updated_count integer;
  v_post_match_count integer;
  v_validated_internal_count integer;
  v_to_confirm_count integer;
  v_one_coll_count integer;
BEGIN
  CREATE TEMP TABLE dcq_20260424201917_expected_carrier_provenance (
    carrier text NOT NULL,
    charge_code text NOT NULL,
    charge_name text NOT NULL,
    operation_type text NOT NULL,
    invoice_type text NOT NULL,
    invoice_sequence integer NOT NULL,
    calculation_method text NOT NULL,
    default_amount numeric NOT NULL,
    currency text NOT NULL,
    expected_source_documents text[] NOT NULL,
    expected_evidence_level text NOT NULL,
    PRIMARY KEY (
      carrier,
      charge_code,
      operation_type,
      invoice_type,
      invoice_sequence
    )
  ) ON COMMIT DROP;

  INSERT INTO dcq_20260424201917_expected_carrier_provenance (
    carrier,
    charge_code,
    charge_name,
    operation_type,
    invoice_type,
    invoice_sequence,
    calculation_method,
    default_amount,
    currency,
    expected_source_documents,
    expected_evidence_level
  )
  VALUES
    ('GENERIC', 'CEF', 'Control Equipment Fees', 'TRANSIT', 'PORT_CHARGES', 1, 'PER_CNT', 15138, 'XOF', ARRAY['TO_VERIFY']::text[], 'to_confirm'),
    ('GENERIC', 'PCD', 'Port Charges Destination', 'TRANSIT', 'PORT_CHARGES', 1, 'PER_CNT', 14652, 'XOF', ARRAY['TO_VERIFY']::text[], 'to_confirm'),
    ('GENERIC', 'ORBUS', 'Orbus Fee', 'TRANSIT', 'PORT_CHARGES', 1, 'PER_CNT', 4500, 'XOF', ARRAY['TO_VERIFY']::text[], 'to_confirm'),
    ('GENERIC', 'TRANSIT_COC_20', 'In Transit Fees COC 20ft', 'TRANSIT', 'PORT_CHARGES', 1, 'PER_CNT', 100000, 'XOF', ARRAY['TO_VERIFY']::text[], 'to_confirm'),
    ('GENERIC', 'TRANSIT_COC_40', 'In Transit Fees COC 40ft', 'TRANSIT', 'PORT_CHARGES', 1, 'PER_CNT', 200000, 'XOF', ARRAY['TO_VERIFY']::text[], 'to_confirm'),
    ('GENERIC', 'ISPS', 'ISPS Fee', 'TRANSIT', 'PORT_CHARGES', 1, 'PER_CNT', 5805, 'XOF', ARRAY['TO_VERIFY']::text[], 'to_confirm'),
    ('HAPAG_LLOYD', 'XPV_20', 'Port Dues Transit 20ft', 'TRANSIT', 'PORT_CHARGES', 1, 'PER_CNT', 11000, 'XOF', ARRAY['Hapag-Lloyd Sénégal - local charges & service fees']::text[], 'validated_internal'),
    ('HAPAG_LLOYD', 'XPV_40', 'Port Dues Transit 40ft', 'TRANSIT', 'PORT_CHARGES', 1, 'PER_CNT', 16500, 'XOF', ARRAY['Hapag-Lloyd Sénégal - local charges & service fees']::text[], 'validated_internal'),
    ('HAPAG_LLOYD', 'XAO', 'EDO Transit', 'TRANSIT', 'DOCUMENTATION', 2, 'PER_TEU', 4500, 'XOF', ARRAY['Hapag-Lloyd Sénégal - local charges & service fees']::text[], 'validated_internal'),
    ('HAPAG_LLOYD', 'TXI', 'Tax Import', 'IMPORT', 'PORT_CHARGES', 1, 'PER_BL', 25000, 'XOF', ARRAY['Hapag-Lloyd Sénégal - local charges & service fees']::text[], 'validated_internal'),
    ('HAPAG_LLOYD', 'ETD_20', 'Equipment Transfer 20ft', 'IMPORT', 'PORT_CHARGES', 1, 'PER_CNT', 90000, 'XOF', ARRAY['Hapag-Lloyd Sénégal - local charges & service fees']::text[], 'validated_internal'),
    ('HAPAG_LLOYD', 'ETD_40', 'Equipment Transfer 40ft', 'IMPORT', 'PORT_CHARGES', 1, 'PER_CNT', 150000, 'XOF', ARRAY['Hapag-Lloyd Sénégal - local charges & service fees']::text[], 'validated_internal'),
    ('HAPAG_LLOYD', 'PSX_20', 'Port Tax Transit Export 20ft', 'EXPORT', 'PORT_CHARGES', 1, 'PER_CNT', 4500, 'XOF', ARRAY['Hapag-Lloyd Sénégal - local charges & service fees']::text[], 'validated_internal'),
    ('HAPAG_LLOYD', 'PSX_40', 'Port Tax Transit Export 40ft', 'EXPORT', 'PORT_CHARGES', 1, 'PER_CNT', 9000, 'XOF', ARRAY['Hapag-Lloyd Sénégal - local charges & service fees']::text[], 'validated_internal'),
    ('ONE', 'DOF', 'Delivery Order Fees', 'IMPORT', 'DOCUMENTATION', 1, 'PER_BL', 18000, 'XOF', ARRAY['one_line_local_charges.pdf']::text[], 'validated_internal'),
    ('ONE', 'COLL', 'Collection Fees', 'IMPORT', 'DOCUMENTATION', 1, 'PERCENTAGE', 2.8, 'XOF', ARRAY['one_line_local_charges.pdf']::text[], 'to_confirm'),
    ('ONE', 'MNF', 'Manifest Fees', 'IMPORT', 'DOCUMENTATION', 1, 'PER_BL', 600, 'XOF', ARRAY['one_line_local_charges.pdf']::text[], 'validated_internal'),
    ('ONE', 'TBL', 'BL Stamp', 'IMPORT', 'DOCUMENTATION', 1, 'PER_CNT', 10000, 'XOF', ARRAY['one_line_local_charges.pdf']::text[], 'validated_internal'),
    ('ONE', 'TSS_IMP', 'Terminal Security Surcharge', 'IMPORT', 'PORT_CHARGES', 1, 'PER_CNT', 25000, 'XOF', ARRAY['one_line_local_charges.pdf']::text[], 'validated_internal'),
    ('ONE', 'CMF', 'Container Management Fee', 'IMPORT', 'PORT_CHARGES', 1, 'PER_CONTAINER', 115000, 'XOF', ARRAY['one_line_local_charges.pdf']::text[], 'validated_internal'),
    ('ONE', 'DG_HANDLING', 'DG Container Handling', 'IMPORT', 'PORT_CHARGES', 1, 'PER_CONTAINER', 5000, 'XOF', ARRAY['one_line_local_charges.pdf']::text[], 'validated_internal');

  SELECT COUNT(*)
  INTO v_expected_count
  FROM dcq_20260424201917_expected_carrier_provenance;

  IF v_expected_count <> 21 THEN
    RAISE EXCEPTION
      'Carrier seed provenance reconciliation: expected mapping cardinality 21, got %',
      v_expected_count;
  END IF;

  SELECT string_agg(
           format(
             '%s/%s/%s/%s/%s(count=%s)',
             bad.carrier,
             bad.charge_code,
             bad.operation_type,
             bad.invoice_type,
             bad.invoice_sequence,
             bad.actual_count
           ),
           ', ' ORDER BY
             bad.carrier,
             bad.charge_code,
             bad.operation_type,
             bad.invoice_type,
             bad.invoice_sequence
         )
  INTO v_cardinality_violations
  FROM (
    SELECT
      expected.carrier,
      expected.charge_code,
      expected.operation_type,
      expected.invoice_type,
      expected.invoice_sequence,
      COUNT(template.id) AS actual_count
    FROM dcq_20260424201917_expected_carrier_provenance AS expected
    LEFT JOIN public.carrier_billing_templates AS template
      ON template.carrier = expected.carrier
     AND template.charge_code = expected.charge_code
     AND template.operation_type = expected.operation_type
     AND template.invoice_type = expected.invoice_type
     AND template.invoice_sequence = expected.invoice_sequence
    GROUP BY
      expected.carrier,
      expected.charge_code,
      expected.operation_type,
      expected.invoice_type,
      expected.invoice_sequence
    HAVING COUNT(template.id) <> 1
  ) AS bad;

  IF v_cardinality_violations IS NOT NULL THEN
    RAISE EXCEPTION
      'Carrier seed provenance reconciliation: business-key cardinality violation(s): %',
      v_cardinality_violations;
  END IF;

  SELECT string_agg(
           format(
             '%s/%s/%s/%s/%s',
             expected.carrier,
             expected.charge_code,
             expected.operation_type,
             expected.invoice_type,
             expected.invoice_sequence
           ),
           ', ' ORDER BY
             expected.carrier,
             expected.charge_code,
             expected.operation_type,
             expected.invoice_type,
             expected.invoice_sequence
         )
  INTO v_fingerprint_violations
  FROM dcq_20260424201917_expected_carrier_provenance AS expected
  JOIN public.carrier_billing_templates AS template
    ON template.carrier = expected.carrier
   AND template.charge_code = expected.charge_code
   AND template.operation_type = expected.operation_type
   AND template.invoice_type = expected.invoice_type
   AND template.invoice_sequence = expected.invoice_sequence
  WHERE template.charge_name IS DISTINCT FROM expected.charge_name
     OR template.calculation_method IS DISTINCT FROM expected.calculation_method
     OR template.default_amount IS DISTINCT FROM expected.default_amount
     OR template.currency IS DISTINCT FROM expected.currency
     OR template.is_active IS DISTINCT FROM true
     OR template.vat_rate IS DISTINCT FROM 18::numeric
     OR template.is_variable IS DISTINCT FROM false
     OR template.variable_unit IS NOT NULL
     OR template.base_reference IS NOT NULL;

  IF v_fingerprint_violations IS NOT NULL THEN
    RAISE EXCEPTION
      'Carrier seed provenance reconciliation: seed fingerprint mismatch(es): %',
      v_fingerprint_violations;
  END IF;

  SELECT string_agg(
           format(
             '%s/%s/%s/%s/%s',
             expected.carrier,
             expected.charge_code,
             expected.operation_type,
             expected.invoice_type,
             expected.invoice_sequence
           ),
           ', ' ORDER BY
             expected.carrier,
             expected.charge_code,
             expected.operation_type,
             expected.invoice_type,
             expected.invoice_sequence
         )
  INTO v_state_violations
  FROM dcq_20260424201917_expected_carrier_provenance AS expected
  JOIN public.carrier_billing_templates AS template
    ON template.carrier = expected.carrier
   AND template.charge_code = expected.charge_code
   AND template.operation_type = expected.operation_type
   AND template.invoice_type = expected.invoice_type
   AND template.invoice_sequence = expected.invoice_sequence
  WHERE (
          template.source_documents IS NOT NULL
      AND template.source_documents IS DISTINCT FROM expected.expected_source_documents
        )
     OR (
          template.evidence_level IS NOT NULL
      AND template.evidence_level IS DISTINCT FROM expected.expected_evidence_level
        );

  IF v_state_violations IS NOT NULL THEN
    RAISE EXCEPTION
      'Carrier seed provenance reconciliation: contradictory provenance state(s): %',
      v_state_violations;
  END IF;

  UPDATE public.carrier_billing_templates AS template
  SET source_documents = expected.expected_source_documents,
      evidence_level = expected.expected_evidence_level
  FROM dcq_20260424201917_expected_carrier_provenance AS expected
  WHERE template.carrier = expected.carrier
    AND template.charge_code = expected.charge_code
    AND template.operation_type = expected.operation_type
    AND template.invoice_type = expected.invoice_type
    AND template.invoice_sequence = expected.invoice_sequence
    AND (
         template.source_documents IS DISTINCT FROM expected.expected_source_documents
      OR template.evidence_level IS DISTINCT FROM expected.expected_evidence_level
    );

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count < 0 OR v_updated_count > 21 THEN
    RAISE EXCEPTION
      'Carrier seed provenance reconciliation: unexpected update count %',
      v_updated_count;
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE template.evidence_level = 'validated_internal'),
    COUNT(*) FILTER (WHERE template.evidence_level = 'to_confirm')
  INTO
    v_post_match_count,
    v_validated_internal_count,
    v_to_confirm_count
  FROM dcq_20260424201917_expected_carrier_provenance AS expected
  JOIN public.carrier_billing_templates AS template
    ON template.carrier = expected.carrier
   AND template.charge_code = expected.charge_code
   AND template.operation_type = expected.operation_type
   AND template.invoice_type = expected.invoice_type
   AND template.invoice_sequence = expected.invoice_sequence
  WHERE template.source_documents = expected.expected_source_documents
    AND template.evidence_level = expected.expected_evidence_level;

  IF v_post_match_count <> 21
     OR v_validated_internal_count <> 14
     OR v_to_confirm_count <> 7 THEN
    RAISE EXCEPTION
      'Carrier seed provenance reconciliation: invalid postcondition (matched=%, validated_internal=%, to_confirm=%)',
      v_post_match_count,
      v_validated_internal_count,
      v_to_confirm_count;
  END IF;

  SELECT COUNT(*)
  INTO v_one_coll_count
  FROM public.carrier_billing_templates AS template
  WHERE template.carrier = 'ONE'
    AND template.charge_code = 'COLL'
    AND template.operation_type = 'IMPORT'
    AND template.invoice_type = 'DOCUMENTATION'
    AND template.invoice_sequence = 1
    AND template.evidence_level = 'to_confirm'
    AND template.source_documents = ARRAY['one_line_local_charges.pdf']::text[];

  IF v_one_coll_count <> 1 THEN
    RAISE EXCEPTION
      'Carrier seed provenance reconciliation: ONE/COLL safety classification mismatch (count=%)',
      v_one_coll_count;
  END IF;

  RAISE NOTICE
    'Carrier seed provenance reconciliation OK: % row(s) updated; 21 exact rows; validated_internal=14; to_confirm=7.',
    v_updated_count;

  DROP TABLE dcq_20260424201917_expected_carrier_provenance;
END
$$;
