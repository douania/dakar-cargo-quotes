
-- Sprint P0 — Sécurisation RLS des tables sensibles
-- CTO validated: replace SELECT USING (true) with authenticated-only access

-- 1. contacts (already has "Deny all client access" policy, but let's ensure no public read exists)
DROP POLICY IF EXISTS "contacts_public_read" ON public.contacts;
DROP POLICY IF EXISTS "Allow public read contacts" ON public.contacts;

-- 2. emails
DROP POLICY IF EXISTS "emails_public_read" ON public.emails;
DROP POLICY IF EXISTS "Allow public read emails" ON public.emails;
CREATE POLICY "emails_authenticated_read" ON public.emails FOR SELECT TO authenticated USING (auth.role() = 'authenticated');

-- 3. email_drafts (has owner-based + public read duplicate)
DROP POLICY IF EXISTS "email_drafts_public_read" ON public.email_drafts;

-- 4. email_attachments
DROP POLICY IF EXISTS "email_attachments_public_read" ON public.email_attachments;
DROP POLICY IF EXISTS "Allow public read email_attachments" ON public.email_attachments;
CREATE POLICY "email_attachments_authenticated_read" ON public.email_attachments FOR SELECT TO authenticated USING (auth.role() = 'authenticated');

-- 5. email_threads
DROP POLICY IF EXISTS "email_threads_public_read" ON public.email_threads;
DROP POLICY IF EXISTS "Allow public read email_threads" ON public.email_threads;
CREATE POLICY "email_threads_authenticated_read" ON public.email_threads FOR SELECT TO authenticated USING (auth.role() = 'authenticated');

-- 6. known_business_contacts
DROP POLICY IF EXISTS "known_business_contacts_public_read" ON public.known_business_contacts;
CREATE POLICY "known_business_contacts_authenticated_read" ON public.known_business_contacts FOR SELECT TO authenticated USING (auth.role() = 'authenticated');

-- 7. tender_segments
DROP POLICY IF EXISTS "tender_segments_public_read" ON public.tender_segments;
DROP POLICY IF EXISTS "Allow public read tender_segments" ON public.tender_segments;
CREATE POLICY "tender_segments_authenticated_read" ON public.tender_segments FOR SELECT TO authenticated USING (auth.role() = 'authenticated');

-- 8. tender_projects
DROP POLICY IF EXISTS "tender_projects_public_read" ON public.tender_projects;
DROP POLICY IF EXISTS "Allow public read tender_projects" ON public.tender_projects;
CREATE POLICY "tender_projects_authenticated_read" ON public.tender_projects FOR SELECT TO authenticated USING (auth.role() = 'authenticated');

-- 9. tender_contingents
DROP POLICY IF EXISTS "tender_contingents_public_read" ON public.tender_contingents;

-- 10. historical_quotations
DROP POLICY IF EXISTS "historical_quotations_public_read" ON public.historical_quotations;
CREATE POLICY "historical_quotations_authenticated_read" ON public.historical_quotations FOR SELECT TO authenticated USING (auth.role() = 'authenticated');

-- 11. historical_quotation_lines
DROP POLICY IF EXISTS "historical_quotation_lines_public_read" ON public.historical_quotation_lines;
CREATE POLICY "historical_quotation_lines_authenticated_read" ON public.historical_quotation_lines FOR SELECT TO authenticated USING (auth.role() = 'authenticated');

-- 12. historical_quotation_metadata
DROP POLICY IF EXISTS "historical_quotation_metadata_public_read" ON public.historical_quotation_metadata;
CREATE POLICY "historical_quotation_metadata_authenticated_read" ON public.historical_quotation_metadata FOR SELECT TO authenticated USING (auth.role() = 'authenticated');

-- 13. security_alerts
DROP POLICY IF EXISTS "security_alerts_public_read" ON public.security_alerts;
DROP POLICY IF EXISTS "Allow public read security_alerts" ON public.security_alerts;
CREATE POLICY "security_alerts_authenticated_read" ON public.security_alerts FOR SELECT TO authenticated USING (auth.role() = 'authenticated');

-- 14. tariff_resolution_log
DROP POLICY IF EXISTS "tariff_resolution_log_public_read" ON public.tariff_resolution_log;
DROP POLICY IF EXISTS "Allow public read tariff_resolution_log" ON public.tariff_resolution_log;
CREATE POLICY "tariff_resolution_log_authenticated_read" ON public.tariff_resolution_log FOR SELECT TO authenticated USING (auth.role() = 'authenticated');

-- 15. fuel_price_tracking
DROP POLICY IF EXISTS "Allow public read fuel_price_tracking" ON public.fuel_price_tracking;
CREATE POLICY "fuel_price_tracking_authenticated_read" ON public.fuel_price_tracking FOR SELECT TO authenticated USING (auth.role() = 'authenticated');
