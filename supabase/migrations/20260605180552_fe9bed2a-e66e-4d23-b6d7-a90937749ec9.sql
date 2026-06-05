CREATE OR REPLACE FUNCTION public.reset_attachment_for_retry(p_attachment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_reset_id uuid;
BEGIN
  UPDATE email_attachments
  SET is_analyzed = false,
      analysis_claimed_at = NULL,
      extracted_text = NULL,
      extracted_data = NULL
  WHERE id = p_attachment_id
    AND is_analyzed = true
    AND extracted_data->>'type' IN ('error', 'skipped')
  RETURNING id INTO v_reset_id;

  RETURN v_reset_id;
END;
$$;