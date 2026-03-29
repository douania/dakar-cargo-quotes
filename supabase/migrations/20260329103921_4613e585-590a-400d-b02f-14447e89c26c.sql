
-- Bloc 1: Fix DENY ALL on documents and learned_knowledge
-- Drop the DENY ALL policies that block all client access
DROP POLICY IF EXISTS "Deny all client access to documents" ON public.documents;
DROP POLICY IF EXISTS "Deny all client access to learned_knowledge" ON public.learned_knowledge;

-- documents: add SELECT + DELETE for authenticated (INSERT goes via parse-document service_role)
CREATE POLICY "documents_select_authenticated" ON public.documents
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "documents_delete_authenticated" ON public.documents
  FOR DELETE TO authenticated USING (true);

-- learned_knowledge: add SELECT for authenticated (writes go via data-admin service_role)
CREATE POLICY "learned_knowledge_select_authenticated" ON public.learned_knowledge
  FOR SELECT TO authenticated USING (true);
