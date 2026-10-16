-- Correct live quote_request_type enum comparison; no tariff or monetary rule change.
BEGIN;
CREATE OR REPLACE FUNCTION public.air_handling_select(p_id uuid,p_case_id uuid,p_expected_id uuid,p_profile_id uuid,p_source_reference text,p_warehouse_bracket_confirmed boolean,p_context_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.quote_cases; head public.air_handling_selections; prior public.air_handling_selections; context text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_workspace_access() THEN RAISE EXCEPTION 'Workspace admission required' USING ERRCODE='42501'; END IF;
  -- Current case portfolio is shared among admitted operators; retain that contract.
  SELECT * INTO c FROM public.quote_cases WHERE id=p_case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Case inaccessible' USING ERRCODE='42501'; END IF;
  SELECT * INTO prior FROM public.air_handling_selections WHERE id=p_id;
  IF FOUND THEN
    IF prior.case_id=p_case_id AND prior.profile_id IS NOT DISTINCT FROM p_profile_id AND prior.source_reference=p_source_reference
      AND prior.warehouse_bracket_confirmed=p_warehouse_bracket_confirmed AND prior.context_hash=p_context_hash AND prior.created_by=auth.uid() THEN RETURN p_id; END IF;
    RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='40001';
  END IF;
  IF NOT public.has_case_write_access(p_case_id) OR c.status::text NOT IN ('INTAKE','FACTS_PARTIAL','NEED_INFO','READY_TO_PRICE','DECISIONS_PENDING','DECISIONS_COMPLETE','ACK_READY_FOR_PRICING','PRICED_DRAFT','QUOTED_VERSIONED') THEN RAISE EXCEPTION 'Case not editable' USING ERRCODE='40001'; END IF;
  IF c.request_type::text !~ '^AIR_IMPORT(_|$)' OR (SELECT count(*) FROM public.quote_request_lines WHERE case_id=p_case_id)>=2 THEN RAISE EXCEPTION 'AIR import mono-lot only'; END IF;
  SELECT * INTO head FROM public.air_handling_selections WHERE case_id=p_case_id ORDER BY version DESC LIMIT 1;
  IF head.id IS DISTINCT FROM p_expected_id THEN RAISE EXCEPTION 'Case selection changed' USING ERRCODE='40001'; END IF;
  context:=public.air_handling_context_hash(p_case_id);
  IF context IS DISTINCT FROM p_context_hash THEN RAISE EXCEPTION 'Case context changed' USING ERRCODE='40001'; END IF;
  IF p_profile_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.air_handling_profiles WHERE id=p_profile_id AND effective_from<=CURRENT_DATE AND (effective_to IS NULL OR effective_to>=CURRENT_DATE)) THEN RAISE EXCEPTION 'Profile not current'; END IF;
  INSERT INTO public.air_handling_selections(id,case_id,version,profile_id,source_reference,warehouse_bracket_confirmed,context_hash,created_by)
    VALUES(p_id,p_case_id,COALESCE(head.version,0)+1,p_profile_id,p_source_reference,p_warehouse_bracket_confirmed,context,auth.uid());
  RETURN p_id;
END; $$;
COMMIT;
