-- Explicit DENY policies for all sensitive tables
-- This makes it crystal clear: NO client access allowed

-- email_configs: Deny all operations for non-service-role
CREATE POLICY "Deny all client access to email_configs" ON public.email_configs
FOR ALL USING (false) WITH CHECK (false);

-- emails: Deny all operations for non-service-role
CREATE POLICY "Deny all client access to emails" ON public.emails
FOR ALL USING (false) WITH CHECK (false);

-- email_drafts: Deny all operations for non-service-role
CREATE POLICY "Deny all client access to email_drafts" ON public.email_drafts
FOR ALL USING (false) WITH CHECK (false);

-- email_attachments: Deny all operations for non-service-role
CREATE POLICY "Deny all client access to email_attachments" ON public.email_attachments
FOR ALL USING (false) WITH CHECK (false);

-- learned_knowledge: Deny all operations for non-service-role
CREATE POLICY "Deny all client access to learned_knowledge" ON public.learned_knowledge
FOR ALL USING (false) WITH CHECK (false);

-- documents: Deny all operations for non-service-role
CREATE POLICY "Deny all client access to documents" ON public.documents
FOR ALL USING (false) WITH CHECK (false);

-- expert_profiles: Deny all operations for non-service-role
CREATE POLICY "Deny all client access to expert_profiles" ON public.expert_profiles
FOR ALL USING (false) WITH CHECK (false);

-- market_intelligence: Deny all operations for non-service-role
CREATE POLICY "Deny all client access to market_intelligence" ON public.market_intelligence
FOR ALL USING (false) WITH CHECK (false);

-- surveillance_sources: Deny all operations for non-service-role
CREATE POLICY "Deny all client access to surveillance_sources" ON public.surveillance_sources
FOR ALL USING (false) WITH CHECK (false);