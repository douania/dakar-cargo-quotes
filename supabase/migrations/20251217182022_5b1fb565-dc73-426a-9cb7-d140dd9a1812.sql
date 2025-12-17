-- URGENT SECURITY FIX: Remove public access to sensitive email tables

-- Drop all overly permissive policies on email_configs
DROP POLICY IF EXISTS "email_configs_public_delete" ON public.email_configs;
DROP POLICY IF EXISTS "email_configs_public_insert" ON public.email_configs;
DROP POLICY IF EXISTS "email_configs_public_read" ON public.email_configs;
DROP POLICY IF EXISTS "email_configs_public_update" ON public.email_configs;

-- Drop all overly permissive policies on emails
DROP POLICY IF EXISTS "emails_public_delete" ON public.emails;
DROP POLICY IF EXISTS "emails_public_insert" ON public.emails;
DROP POLICY IF EXISTS "emails_public_read" ON public.emails;
DROP POLICY IF EXISTS "emails_public_update" ON public.emails;

-- Drop all overly permissive policies on email_drafts
DROP POLICY IF EXISTS "drafts_public_delete" ON public.email_drafts;
DROP POLICY IF EXISTS "drafts_public_insert" ON public.email_drafts;
DROP POLICY IF EXISTS "drafts_public_read" ON public.email_drafts;
DROP POLICY IF EXISTS "drafts_public_update" ON public.email_drafts;

-- Drop all overly permissive policies on email_attachments
DROP POLICY IF EXISTS "attachments_public_delete" ON public.email_attachments;
DROP POLICY IF EXISTS "attachments_public_insert" ON public.email_attachments;
DROP POLICY IF EXISTS "attachments_public_read" ON public.email_attachments;
DROP POLICY IF EXISTS "attachments_public_update" ON public.email_attachments;

-- email_configs: NO public access at all (only service role via edge functions)
-- RLS is enabled but no policies = no access from client

-- emails: NO public access (only service role via edge functions)
-- RLS is enabled but no policies = no access from client

-- email_drafts: NO public access (only service role via edge functions)
-- RLS is enabled but no policies = no access from client

-- email_attachments: NO public access (only service role via edge functions)
-- RLS is enabled but no policies = no access from client