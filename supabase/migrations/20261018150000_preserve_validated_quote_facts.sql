-- STRUCTURAL_PATCH_ALLOWED: preserve current operator/validated facts before an automatic supersession.
-- Existing weekend technical mandate; justification in fact-preservation-20261018 before execution.
-- Signature, grants, source CHECK and historical rows unchanged. Explicit manual path remains append-only.
BEGIN;
DO $preflight$ DECLARE target regprocedure := 'public.supersede_fact(uuid,text,text,text,numeric,jsonb,timestamp with time zone,text,uuid,uuid,text,numeric)'::regprocedure; BEGIN
 IF md5(replace(pg_get_functiondef(target),chr(13),'')) NOT IN ('805ac331ce27ce3f5b1d770dc66d9c24','9c9143ed0dff18c70ad5f0a6260f7bae') THEN
  RAISE EXCEPTION 'Unexpected supersede_fact definition; review before migration';
 END IF;
 IF has_function_privilege('anon',target,'execute') OR has_function_privilege('authenticated',target,'execute')
    OR NOT has_function_privilege('service_role',target,'execute') THEN
  RAISE EXCEPTION 'Unexpected supersede_fact ACL; no grant changed';
 END IF;
END $preflight$;
CREATE OR REPLACE FUNCTION public.supersede_fact(p_case_id uuid, p_fact_key text, p_fact_category text, p_value_text text DEFAULT NULL::text, p_value_number numeric DEFAULT NULL::numeric, p_value_json jsonb DEFAULT NULL::jsonb, p_value_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_source_type text DEFAULT 'ai_extraction'::text, p_source_email_id uuid DEFAULT NULL::uuid, p_source_attachment_id uuid DEFAULT NULL::uuid, p_source_excerpt text DEFAULT NULL::text, p_confidence numeric DEFAULT 0.80)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  old_fact_id UUID;
  old_fact_source_type TEXT;
  old_fact_validated BOOLEAN;
  new_fact_id UUID;
BEGIN
  -- Lock to prevent concurrent supersessions on same fact_key
  PERFORM pg_advisory_xact_lock(hashtext(p_case_id::text || p_fact_key));

  -- Find and deactivate old fact
  SELECT id, source_type, is_validated
  INTO old_fact_id, old_fact_source_type, old_fact_validated
  FROM quote_facts
  WHERE case_id = p_case_id AND fact_key = p_fact_key AND is_current = true
  FOR UPDATE;

  -- STRUCTURAL_PATCH_ALLOWED: preserve an operator decision under the existing case/key lock.
  IF old_fact_id IS NOT NULL
     AND (old_fact_validated IS TRUE OR old_fact_source_type IN ('operator','manual_input','operator_correction'))
     AND (p_source_type IS NULL OR p_source_type NOT IN ('operator','manual_input','operator_correction')) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROTECTED_FACT_REQUIRES_OPERATOR';
  END IF;

  IF old_fact_id IS NOT NULL THEN
    UPDATE quote_facts
    SET is_current = false, updated_at = now()
    WHERE id = old_fact_id;
  END IF;

  -- Insert new fact
  INSERT INTO quote_facts (
    case_id, fact_key, fact_category,
    value_text, value_number, value_json, value_date,
    source_type, source_email_id, source_attachment_id, source_excerpt,
    confidence, is_current, supersedes_fact_id
  ) VALUES (
    p_case_id, p_fact_key, p_fact_category,
    p_value_text, p_value_number, p_value_json, p_value_date,
    p_source_type, p_source_email_id, p_source_attachment_id, p_source_excerpt,
    p_confidence, true, old_fact_id
  )
  RETURNING id INTO new_fact_id;

  RETURN new_fact_id;
END;
$function$;
COMMIT;
