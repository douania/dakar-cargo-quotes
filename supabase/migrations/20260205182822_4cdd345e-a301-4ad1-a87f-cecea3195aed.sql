-- Phase 14: Sécurisation RPC upsert_rate_limit_bucket
-- CTO FIX: REVOKE EXECUTE FROM PUBLIC pour éviter abus via API publique

-- Révoquer l'exécution pour tous les rôles publics
REVOKE EXECUTE ON FUNCTION upsert_rate_limit_bucket(uuid, text, timestamptz) FROM PUBLIC;

-- Accorder l'exécution uniquement au service_role (Edge Functions)
GRANT EXECUTE ON FUNCTION upsert_rate_limit_bucket(uuid, text, timestamptz) TO service_role;

-- Également sécuriser la fonction prevent_runtime_events_mutation
REVOKE EXECUTE ON FUNCTION prevent_runtime_events_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prevent_runtime_events_mutation() TO service_role;

-- Ajout SET search_path sur le trigger function pour sécurité
CREATE OR REPLACE FUNCTION prevent_runtime_events_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'runtime_events is append-only';
END;
$$ LANGUAGE plpgsql SET search_path = public;