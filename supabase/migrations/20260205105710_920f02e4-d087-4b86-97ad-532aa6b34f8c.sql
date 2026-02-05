-- PATCH 1: RPC atomique pour insertion version avec deselection transactionnelle
CREATE OR REPLACE FUNCTION insert_quotation_version_atomic(
  p_id UUID,
  p_case_id UUID,
  p_pricing_run_id UUID,
  p_version_number INTEGER,
  p_snapshot JSONB,
  p_created_by UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Lock transactionnel sur case_id pour éviter race conditions
  PERFORM pg_advisory_xact_lock(hashtext('qv_insert_' || p_case_id::text));
  
  -- Désactiver toutes les versions précédentes (atomique)
  UPDATE quotation_versions
  SET is_selected = false
  WHERE case_id = p_case_id AND is_selected = true;
  
  -- Insérer la nouvelle version
  INSERT INTO quotation_versions (
    id, case_id, pricing_run_id, version_number,
    status, is_selected, snapshot, created_by
  ) VALUES (
    p_id, p_case_id, p_pricing_run_id, p_version_number,
    'draft', true, p_snapshot, p_created_by
  );
  
  RETURN p_id;
END;
$$;

-- Révoquer accès public, accorder service_role uniquement
REVOKE ALL ON FUNCTION insert_quotation_version_atomic FROM PUBLIC;
GRANT EXECUTE ON FUNCTION insert_quotation_version_atomic TO service_role;

-- BONUS: RPC atomique pour sélection version (UI)
CREATE OR REPLACE FUNCTION select_quotation_version(
  p_version_id UUID,
  p_case_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Lock transactionnel
  PERFORM pg_advisory_xact_lock(hashtext('qv_select_' || p_case_id::text));
  
  -- Désélectionner toutes les versions du case
  UPDATE quotation_versions SET is_selected = false WHERE case_id = p_case_id;
  
  -- Sélectionner la version demandée
  UPDATE quotation_versions SET is_selected = true WHERE id = p_version_id AND case_id = p_case_id;
END;
$$;

-- Révoquer accès public, accorder service_role uniquement
REVOKE ALL ON FUNCTION select_quotation_version FROM PUBLIC;
GRANT EXECUTE ON FUNCTION select_quotation_version TO service_role;