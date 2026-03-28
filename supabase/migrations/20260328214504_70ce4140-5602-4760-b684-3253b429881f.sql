
-- B1-A: Harden email_drafts RLS from shared authenticated to owner-scoped
-- Legacy drafts (created_by IS NULL) remain visible/deletable in transition
-- but NOT modifiable. New drafts are strictly owner-scoped.

-- Drop existing permissive policies
DROP POLICY IF EXISTS "email_drafts_authenticated_select" ON email_drafts;
DROP POLICY IF EXISTS "email_drafts_authenticated_insert" ON email_drafts;
DROP POLICY IF EXISTS "email_drafts_authenticated_update" ON email_drafts;
DROP POLICY IF EXISTS "email_drafts_authenticated_delete" ON email_drafts;

-- SELECT: owner + legacy visible (transition)
CREATE POLICY "email_drafts_owner_select" ON email_drafts
  FOR SELECT TO authenticated
  USING (auth.uid() = created_by OR created_by IS NULL);

-- INSERT: owner strict
CREATE POLICY "email_drafts_owner_insert" ON email_drafts
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

-- UPDATE: owner strict (legacy NOT modifiable — CTO directive)
CREATE POLICY "email_drafts_owner_update" ON email_drafts
  FOR UPDATE TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- DELETE: owner + legacy deletable (transition cleanup)
CREATE POLICY "email_drafts_owner_delete" ON email_drafts
  FOR DELETE TO authenticated
  USING (auth.uid() = created_by OR created_by IS NULL);
