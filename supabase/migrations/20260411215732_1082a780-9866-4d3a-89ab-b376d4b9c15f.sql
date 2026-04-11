
-- 1. CLAIM: atomic lock with ownership + expired recovery
CREATE OR REPLACE FUNCTION public.claim_attachment_for_analysis(
  p_attachment_id uuid,
  p_claim_ts timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_claimed_id uuid;
BEGIN
  UPDATE email_attachments
  SET analysis_claimed_at = p_claim_ts
  WHERE id = p_attachment_id
    AND is_analyzed = false
    AND (analysis_claimed_at IS NULL 
         OR analysis_claimed_at < (now() - interval '15 minutes'))
  RETURNING id INTO v_claimed_id;
  
  RETURN v_claimed_id;
END;
$$;

-- 2. RELEASE: reset claim without finalization
CREATE OR REPLACE FUNCTION public.release_attachment_claim(
  p_attachment_id uuid,
  p_claim_ts timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE email_attachments
  SET analysis_claimed_at = NULL
  WHERE id = p_attachment_id
    AND is_analyzed = false
    AND analysis_claimed_at = p_claim_ts;
END;
$$;

-- 3. FINALIZE SUCCESS: mark analyzed + store results + release claim
CREATE OR REPLACE FUNCTION public.finalize_attachment_analysis(
  p_attachment_id uuid,
  p_claim_ts timestamptz,
  p_extracted_text text,
  p_extracted_data jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_finalized_id uuid;
BEGIN
  UPDATE email_attachments
  SET is_analyzed = true,
      extracted_text = p_extracted_text,
      extracted_data = p_extracted_data,
      analysis_claimed_at = NULL
  WHERE id = p_attachment_id
    AND is_analyzed = false
    AND analysis_claimed_at = p_claim_ts
  RETURNING id INTO v_finalized_id;
  
  RETURN v_finalized_id;
END;
$$;

-- 4. FINALIZE ERROR: mark analyzed with error data + release claim
CREATE OR REPLACE FUNCTION public.finalize_attachment_analysis_error(
  p_attachment_id uuid,
  p_claim_ts timestamptz,
  p_extracted_text text,
  p_extracted_data jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE email_attachments
  SET is_analyzed = true,
      extracted_text = p_extracted_text,
      extracted_data = p_extracted_data,
      analysis_claimed_at = NULL
  WHERE id = p_attachment_id
    AND is_analyzed = false
    AND analysis_claimed_at = p_claim_ts;
END;
$$;

-- Force PostgREST schema cache reload via DDL
COMMENT ON COLUMN public.email_attachments.analysis_claimed_at 
  IS 'Claim timestamp for analysis lock — managed via RPC functions';
NOTIFY pgrst, 'reload schema';
