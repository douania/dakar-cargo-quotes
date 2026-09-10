-- =============================================================================
-- IMO-STORAGE-1-C — Réservation de la clé de service du régime de séjour IMO.
-- GO CTO SODATRA du 10 septembre 2026 (« go pour le branchement magasinage »).
--
-- IMO-STORAGE-1-B a créé une nouvelle clé de service structurelle,
-- `IMO_TERMINAL_STORAGE_REGIME`, émise par la couche d'enrichissement
-- `enrichment_imo_storage` de run-pricing. Le garde-fou H2-d2 doit donc la
-- refuser comme code de ligne d'honoraires : sans cela, un administrateur
-- pourrait créer une ligne du même code, qui entrerait en collision avec la
-- ligne réglementaire (double ligne, ou disparition à la déduplication).
--
-- Patch minimal : la fonction `fee_line_code_is_reserved` est réécrite à
-- l'identique, avec la seule clé ajoutée à sa liste fixe. Aucun trigger,
-- aucune policy, aucune donnée touchée.
--
-- Idempotent (CREATE OR REPLACE). Rollback : réappliquer
-- 20260909170000_h2d2_fee_lines_reserved_codes.sql.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fee_line_code_is_reserved(p_code text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  code text := upper(btrim(coalesce(p_code, '')));
BEGIN
  IF code = '' THEN
    RETURN false;
  END IF;

  -- Honoraires internes légitimes : ce modèle EST leur source (H2-c).
  IF code IN ('AGENCY', 'CUSTOMS_DAKAR') THEN
    RETURN false;
  END IF;

  IF code = ANY (ARRAY[
    -- price-service-lines : VALID_SERVICE_KEYS / run-pricing : SERVICE_KEY_LABELS
    'DTHC', 'ON_CARRIAGE', 'EMPTY_RETURN', 'DISCHARGE',
    'PORT_CHARGES', 'TRUCKING', 'CUSTOMS', 'PORT_DAKAR_HANDLING',
    'CUSTOMS_EXPORT', 'BORDER_FEES', 'SURVEY', 'CUSTOMS_BAMAKO',
    'TRANSIT_DOCS', 'AIR_HANDLING', 'AIR_FREIGHT',
    'PICKUP_ORIGIN', 'PRE_CARRIAGE', 'SEA_FREIGHT',
    'THC_EXPORT', 'DOCUMENTATION_BL', 'VGM_WEIGHING',
    'STUFFING_FACTORY', 'STUFFING_CFS', 'EMPTY_REPO',
    -- run-pricing : couches d'enrichissement structurelles
    'PAD_DROIT_PASSAGE', 'TERMINAL_STORAGE_PROVISION_ESTIMATE', 'CMA_CGM_COMM',
    -- IMO-STORAGE-1 : couche enrichment_imo_storage
    'IMO_TERMINAL_STORAGE_REGIME',
    -- run-pricing : DEDUP_GROUP_MAP (une collision de groupe fait disparaître
    -- silencieusement une ligne à la déduplication)
    'TERMINAL_HANDLING', 'TERMINAL_STORAGE',
    'SUIVI_OPERATIONNEL', 'OUVERTURE_DOSSIER', 'FRAIS_DOCUMENTATION', 'DEDOUANEMENT'
  ]) THEN
    RETURN true;
  END IF;

  -- Clés dynamiques <compagnie>_<code de charge>.
  IF to_regclass('public.carrier_billing_templates') IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.carrier_billing_templates t
      WHERE coalesce(t.is_active, false)
        AND public.normalize_carrier_code(t.carrier) || '_' || upper(btrim(coalesce(t.charge_code, ''))) = code
    );
  END IF;

  RETURN false;
END;
$$;

-- Contrôle : la nouvelle clé doit être refusée, les honoraires internes admis.
DO $$
BEGIN
  IF NOT public.fee_line_code_is_reserved('IMO_TERMINAL_STORAGE_REGIME') THEN
    RAISE EXCEPTION '[IMO-STORAGE-1] STOP — la clé IMO_TERMINAL_STORAGE_REGIME n''est pas réservée.';
  END IF;
  IF public.fee_line_code_is_reserved('AGENCY') OR public.fee_line_code_is_reserved('CUSTOMS_DAKAR') THEN
    RAISE EXCEPTION '[IMO-STORAGE-1] STOP — un honoraire interne légitime est devenu réservé.';
  END IF;
END $$;
