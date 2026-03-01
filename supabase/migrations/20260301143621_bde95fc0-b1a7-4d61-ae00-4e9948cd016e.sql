
-- Phase 18 E2E Patch A: RLS email_drafts authenticated-only + unique partial index

-- A1: Ensure RLS is enabled
ALTER TABLE public.email_drafts ENABLE ROW LEVEL SECURITY;

-- Drop existing owner-based policies
DROP POLICY IF EXISTS "email_drafts_owner_select" ON public.email_drafts;
DROP POLICY IF EXISTS "email_drafts_owner_insert" ON public.email_drafts;
DROP POLICY IF EXISTS "email_drafts_owner_update" ON public.email_drafts;
DROP POLICY IF EXISTS "email_drafts_owner_delete" ON public.email_drafts;

-- Create authenticated-only policies (mono-tenant back-office)
CREATE POLICY "email_drafts_authenticated_select" ON public.email_drafts
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "email_drafts_authenticated_insert" ON public.email_drafts
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "email_drafts_authenticated_update" ON public.email_drafts
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "email_drafts_authenticated_delete" ON public.email_drafts
  FOR DELETE TO authenticated USING (true);

-- Anti-duplication: one active draft per quotation version
CREATE UNIQUE INDEX IF NOT EXISTS email_drafts_one_per_version_active
  ON public.email_drafts (quotation_version_id)
  WHERE quotation_version_id IS NOT NULL AND status IN ('draft', 'sent');
