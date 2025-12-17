-- Sécuriser les nouvelles tables: accès uniquement via service role (edge functions)

-- Drop existing permissive policies
DROP POLICY IF EXISTS "Allow all operations on market_intelligence" ON public.market_intelligence;
DROP POLICY IF EXISTS "Allow all operations on expert_profiles" ON public.expert_profiles;
DROP POLICY IF EXISTS "Allow all operations on surveillance_sources" ON public.surveillance_sources;

-- Also secure learned_knowledge and documents which may have public policies
DROP POLICY IF EXISTS "learned_public_delete" ON public.learned_knowledge;
DROP POLICY IF EXISTS "learned_public_insert" ON public.learned_knowledge;
DROP POLICY IF EXISTS "learned_public_read" ON public.learned_knowledge;
DROP POLICY IF EXISTS "learned_public_update" ON public.learned_knowledge;

DROP POLICY IF EXISTS "documents_public_delete" ON public.documents;
DROP POLICY IF EXISTS "documents_public_insert" ON public.documents;
DROP POLICY IF EXISTS "documents_public_read" ON public.documents;
DROP POLICY IF EXISTS "documents_public_update" ON public.documents;

-- No policies = no client access (service role only via edge functions)