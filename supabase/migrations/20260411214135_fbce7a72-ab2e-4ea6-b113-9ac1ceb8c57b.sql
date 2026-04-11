-- Force PostgREST to reload its schema cache so that
-- the analysis_claimed_at column on email_attachments becomes visible.
NOTIFY pgrst, 'reload schema';