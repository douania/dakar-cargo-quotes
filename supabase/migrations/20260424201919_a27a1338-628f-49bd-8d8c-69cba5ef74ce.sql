-- ============================================================================
-- LOT 1.1 — Migration tracée provenance tarifaire (idempotente / rejouable)
-- ============================================================================

-- BLOC 1 — port_tariffs
UPDATE port_tariffs SET evidence_level = 'official'
WHERE provider = 'PAD' AND (evidence_level IS NULL OR evidence_level <> 'official');

UPDATE port_tariffs SET evidence_level = 'validated_internal'
WHERE provider IN ('HAPAG_LLOYD','CMA_CGM','ONE','MSC')
  AND (evidence_level IS NULL OR evidence_level NOT IN ('validated_internal','observed','historical_only','to_confirm'));

-- BLOC 2.a — carrier_billing_templates : 3 lignes historical_only (doublons structurels)
UPDATE carrier_billing_templates
SET evidence_level = 'historical_only',
    notes = COALESCE(notes,'') || ' [Lot 1.1: archive — doublon structurel avec port_tariffs THC/THD, non réactivable]'
WHERE id IN (
  '4a0ab86d-d1dd-4c4f-af8e-84c2c29113b1',
  '580995b0-f335-4f2f-a111-64658e44bb67',
  'c7b7ca06-ea61-4746-b9d3-e9643ccafb90'
)
AND evidence_level IS NULL;

-- BLOC 2.b — carrier_billing_templates : 8 lignes to_confirm
UPDATE carrier_billing_templates
SET evidence_level = 'to_confirm',
    notes = COALESCE(notes,'') || ' [Lot 1.1: preuve insuffisante, bloqué runtime jusqu''à validation]'
WHERE id IN (
  'c3b7514d-9c4d-409a-afac-b001169024a1',
  '6fbec233-6334-4fcf-96d9-346feabda2b8',
  'a5fe03e8-61c6-4a9a-885c-a0e3c4dd7398',
  '6a73238e-9d4d-4e4a-96d8-94db20f7a115',
  '443fcedd-8411-40bb-81ec-9f96540a5fdb',
  '89d882e6-ccf6-4b99-ad77-1f0d6820e263',
  'b5a19229-2685-4f6c-a913-8f091950a415',
  'bcee1a2e-64f5-42da-b79c-e2565d449c52'
)
AND evidence_level IS NULL;

-- BLOC 3 — local_transport_rates (discriminant : provider)
UPDATE local_transport_rates SET evidence_level = 'client_override'
WHERE provider ILIKE '%AKSA%'
  AND (evidence_level IS NULL OR evidence_level <> 'client_override');

UPDATE local_transport_rates SET evidence_level = 'to_confirm'
WHERE (provider IS NULL OR provider NOT ILIKE '%AKSA%')
  AND (evidence_level IS NULL OR evidence_level NOT IN ('to_confirm','official','validated_internal'));

-- BLOC 4 — pricing_rate_cards : désactivation TRUCKING à 0 (anomalie risque)
UPDATE pricing_rate_cards SET status = 'inactive'
WHERE service_key ILIKE '%TRUCK%'
  AND (value = 0 OR value IS NULL)
  AND status = 'active';

-- BLOC 5 — Vérification finale
DO $$
DECLARE
  v_null_carrier int; v_null_port int; v_null_transport int;
BEGIN
  SELECT COUNT(*) INTO v_null_carrier   FROM carrier_billing_templates WHERE evidence_level IS NULL;
  SELECT COUNT(*) INTO v_null_port      FROM port_tariffs              WHERE evidence_level IS NULL;
  SELECT COUNT(*) INTO v_null_transport FROM local_transport_rates     WHERE evidence_level IS NULL;
  IF v_null_carrier > 0 OR v_null_port > 0 OR v_null_transport > 0 THEN
    RAISE EXCEPTION 'Lot 1.1 incomplet — NULL résiduels: carrier=%, port=%, transport=%',
      v_null_carrier, v_null_port, v_null_transport;
  END IF;
  RAISE NOTICE 'Lot 1.1 OK — aucun evidence_level NULL résiduel.';
END $$;