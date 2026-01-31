-- Phase 5D : Versioning des devis

-- 1. Ajouter colonnes versioning
ALTER TABLE quotation_history
ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS parent_quotation_id UUID REFERENCES quotation_history(id),
ADD COLUMN IF NOT EXISTS root_quotation_id UUID,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft'
  CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired'));

-- 2. Migrer données existantes : was_accepted → status
UPDATE quotation_history
SET status = CASE
  WHEN was_accepted = true THEN 'accepted'
  WHEN was_accepted = false THEN 'rejected'
  ELSE 'draft'
END
WHERE status IS NULL;

-- 3. Index pour recherche par parent, root et status
CREATE INDEX IF NOT EXISTS idx_quotation_history_parent
ON quotation_history(parent_quotation_id);

CREATE INDEX IF NOT EXISTS idx_quotation_history_root
ON quotation_history(root_quotation_id);

CREATE INDEX IF NOT EXISTS idx_quotation_history_status
ON quotation_history(status);

CREATE INDEX IF NOT EXISTS idx_quotation_history_source_email_status
ON quotation_history(source_email_id, status);

-- 4. RLS minimale (Amendement 3)
DROP POLICY IF EXISTS "quotation_history_select" ON quotation_history;
DROP POLICY IF EXISTS "quotation_history_insert" ON quotation_history;
DROP POLICY IF EXISTS "quotation_history_update" ON quotation_history;
DROP POLICY IF EXISTS "quotation_history_delete" ON quotation_history;

CREATE POLICY "quotation_history_select" ON quotation_history
FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "quotation_history_insert" ON quotation_history
FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "quotation_history_update" ON quotation_history
FOR UPDATE TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "quotation_history_delete" ON quotation_history
FOR DELETE TO authenticated
USING (auth.uid() IS NOT NULL);