-- Drop the restrictive policies that deny all client access
DROP POLICY IF EXISTS "Deny all client access to emails" ON emails;
DROP POLICY IF EXISTS "Deny all client access to email_drafts" ON email_drafts;

-- Create policies to allow public read access (for back-office admin app)
CREATE POLICY "emails_public_read" ON emails FOR SELECT USING (true);
CREATE POLICY "email_drafts_public_read" ON email_drafts FOR SELECT USING (true);

-- Also allow insert/update on email_drafts for the quotation workflow
CREATE POLICY "email_drafts_public_insert" ON email_drafts FOR INSERT WITH CHECK (true);
CREATE POLICY "email_drafts_public_update" ON email_drafts FOR UPDATE USING (true);