-- Phase 5D : Ownership individuel sur quotation_history
-- Adaptation : backfill avec UUID système pour données legacy

-- 1. Ajouter colonne created_by avec DEFAULT immédiat
ALTER TABLE quotation_history
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) DEFAULT NULL;

-- 2. Créer un UUID système pour les données legacy (pas de FK vers auth.users)
-- On retire temporairement la FK pour permettre le backfill
ALTER TABLE quotation_history 
DROP CONSTRAINT IF EXISTS quotation_history_created_by_fkey;

-- 3. Backfill avec un UUID système fixe pour traçabilité
UPDATE quotation_history
SET created_by = '00000000-0000-0000-0000-000000000000'::uuid
WHERE created_by IS NULL;

-- 4. NOT NULL + DEFAULT
ALTER TABLE quotation_history
ALTER COLUMN created_by SET NOT NULL;

ALTER TABLE quotation_history
ALTER COLUMN created_by SET DEFAULT auth.uid();

-- 5. Index pour performance RLS
CREATE INDEX IF NOT EXISTS idx_quotation_history_created_by
ON quotation_history(created_by);

-- 6. RLS stricte ownership sur quotation_history
DROP POLICY IF EXISTS "quotation_history_select" ON quotation_history;
DROP POLICY IF EXISTS "quotation_history_insert" ON quotation_history;
DROP POLICY IF EXISTS "quotation_history_update" ON quotation_history;
DROP POLICY IF EXISTS "quotation_history_delete" ON quotation_history;
DROP POLICY IF EXISTS "quotation_history_service_access" ON quotation_history;

-- Policy spéciale : les données legacy (UUID système) sont visibles par tous les authenticated
-- Les nouvelles données sont filtrées par ownership strict
CREATE POLICY "quotation_history_owner_select"
ON quotation_history FOR SELECT TO authenticated
USING (
  auth.uid() = created_by 
  OR created_by = '00000000-0000-0000-0000-000000000000'::uuid
);

CREATE POLICY "quotation_history_owner_insert"
ON quotation_history FOR INSERT TO authenticated
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "quotation_history_owner_update"
ON quotation_history FOR UPDATE TO authenticated
USING (
  auth.uid() = created_by 
  OR created_by = '00000000-0000-0000-0000-000000000000'::uuid
);

CREATE POLICY "quotation_history_owner_delete"
ON quotation_history FOR DELETE TO authenticated
USING (auth.uid() = created_by);

-- 7. Alignement RLS quotation_documents (ownership strict)
DROP POLICY IF EXISTS "quotation_documents_select" ON quotation_documents;
DROP POLICY IF EXISTS "quotation_documents_insert" ON quotation_documents;

CREATE POLICY "quotation_documents_owner_select"
ON quotation_documents FOR SELECT TO authenticated
USING (auth.uid() = created_by);

CREATE POLICY "quotation_documents_owner_insert"
ON quotation_documents FOR INSERT TO authenticated
WITH CHECK (auth.uid() = created_by);

-- 8. Vue SAFE avec security_invoker
CREATE OR REPLACE VIEW v_quotation_documents_safe
WITH (security_invoker = true)
AS
SELECT
  id,
  quotation_id,
  root_quotation_id,
  version,
  status,
  document_type,
  file_size,
  created_at
FROM quotation_documents;