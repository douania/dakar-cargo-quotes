-- Phase 5D-bis : Migration explicite vers admin choisi (VERSION FINALE CTO)

-- ================================================================
-- FONCTION 1 : Migrer les legacy vers un admin UUID explicite
-- ================================================================
CREATE OR REPLACE FUNCTION migrate_legacy_quotations(owner_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  migrated_count INTEGER;
  legacy_uuid UUID := '00000000-0000-0000-0000-000000000000'::uuid;
BEGIN
  IF owner_user_id IS NULL THEN
    RAISE EXCEPTION 'owner_user_id est requis';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = owner_user_id) THEN
    RAISE EXCEPTION 'owner_user_id % n''existe pas dans auth.users', owner_user_id;
  END IF;

  SELECT COUNT(*) INTO migrated_count
  FROM quotation_history
  WHERE created_by = legacy_uuid;

  IF migrated_count = 0 THEN
    RETURN 'INFO: Aucun devis legacy à migrer';
  END IF;

  UPDATE quotation_history
  SET created_by = owner_user_id
  WHERE created_by = legacy_uuid;

  RETURN format('SUCCESS: %s devis legacy migrés vers %s', migrated_count, owner_user_id);
END;
$$;

-- ================================================================
-- FONCTION 2 : Finaliser (restaurer FK + RLS stricte)
-- ================================================================
CREATE OR REPLACE FUNCTION finalize_quotation_ownership()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  legacy_count INTEGER;
  legacy_uuid UUID := '00000000-0000-0000-0000-000000000000'::uuid;
  fk_exists BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO legacy_count
  FROM quotation_history
  WHERE created_by = legacy_uuid;

  IF legacy_count > 0 THEN
    RETURN format('ERREUR: %s devis legacy existent encore. Exécutez d''abord migrate_legacy_quotations(uuid).', legacy_count);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'quotation_history_created_by_fkey'
      AND table_name = 'quotation_history'
  ) INTO fk_exists;

  IF NOT fk_exists THEN
    ALTER TABLE quotation_history
    ADD CONSTRAINT quotation_history_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id);
  END IF;

  DROP POLICY IF EXISTS "quotation_history_owner_select" ON quotation_history;
  CREATE POLICY "quotation_history_owner_select"
  ON quotation_history FOR SELECT TO authenticated
  USING (auth.uid() = created_by);

  DROP POLICY IF EXISTS "quotation_history_owner_update" ON quotation_history;
  CREATE POLICY "quotation_history_owner_update"
  ON quotation_history FOR UPDATE TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

  DROP POLICY IF EXISTS "quotation_history_owner_delete" ON quotation_history;
  CREATE POLICY "quotation_history_owner_delete"
  ON quotation_history FOR DELETE TO authenticated
  USING (auth.uid() = created_by);

  RETURN 'SUCCESS: FK restaurée, RLS stricte activée. Intégrité complète.';
END;
$$;

-- ================================================================
-- FONCTION 3 : Diagnostic (vérifier l'état actuel)
-- ================================================================
CREATE OR REPLACE FUNCTION check_quotation_ownership_status()
RETURNS TABLE(metric TEXT, value TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  legacy_uuid UUID := '00000000-0000-0000-0000-000000000000'::uuid;
  total_count INTEGER;
  legacy_count INTEGER;
  migrated_count INTEGER;
  fk_exists BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO total_count FROM quotation_history;
  SELECT COUNT(*) INTO legacy_count FROM quotation_history WHERE created_by = legacy_uuid;
  migrated_count := total_count - legacy_count;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'quotation_history_created_by_fkey'
    AND table_name = 'quotation_history'
  ) INTO fk_exists;

  RETURN QUERY SELECT 'total_quotations'::TEXT, total_count::TEXT;
  RETURN QUERY SELECT 'legacy_quotations'::TEXT, legacy_count::TEXT;
  RETURN QUERY SELECT 'migrated_quotations'::TEXT, migrated_count::TEXT;
  RETURN QUERY SELECT 'fk_exists'::TEXT, fk_exists::TEXT;
  RETURN QUERY SELECT 'status'::TEXT, 
    CASE 
      WHEN legacy_count > 0 THEN 'MODE_MIXTE'
      WHEN NOT fk_exists THEN 'MIGRATION_DONE_FK_PENDING'
      ELSE 'STRICT_OWNERSHIP'
    END;
END;
$$;

-- ================================================================
-- DURCISSEMENT CTO : empêcher tout appel non-admin
-- ================================================================
REVOKE ALL ON FUNCTION migrate_legacy_quotations(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION migrate_legacy_quotations(uuid) FROM authenticated;

REVOKE ALL ON FUNCTION finalize_quotation_ownership() FROM PUBLIC;
REVOKE ALL ON FUNCTION finalize_quotation_ownership() FROM authenticated;

REVOKE ALL ON FUNCTION check_quotation_ownership_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION check_quotation_ownership_status() FROM authenticated;