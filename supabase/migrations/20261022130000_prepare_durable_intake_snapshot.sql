-- LOCAL ONLY. No Cloud application authorized. Additive preparation; no active caller.
-- One transaction: canonical batch + immutable snapshot. No historical Railway import.
-- Source/classification are unverified intake evidence, never validated operator facts.
-- Existing SIFB whitelist, confidence, provenance and access checks are reused unchanged.
BEGIN;
DO $guard$
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'DIS_MIGRATION_OWNER_REQUIRED'; END IF;
  IF to_regprocedure('public.set_intake_facts_batch(uuid,text,text,text,text,jsonb)') IS NULL
    OR to_regprocedure('public.has_workspace_access()') IS NULL
    OR to_regprocedure('public.has_case_read_access(uuid)') IS NULL
    OR to_regprocedure('public.has_case_write_access(uuid)') IS NULL
  THEN RAISE EXCEPTION 'DIS_BASELINE_REQUIRED'; END IF;
  IF to_regclass('public.intake_snapshots') IS NOT NULL
    OR to_regprocedure('public.record_intake_snapshot(uuid,text,jsonb,jsonb,jsonb)') IS NOT NULL
  THEN RAISE EXCEPTION 'DIS_COLLISION_REVIEW_REQUIRED'; END IF;
END $guard$;

CREATE TABLE public.intake_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.quote_cases(id) ON DELETE RESTRICT,
  operation_key text NOT NULL CHECK (operation_key ~ '^intake:[A-Za-z0-9._:-]{8,120}$' AND length(operation_key) BETWEEN 16 AND 128),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  source_request jsonb NOT NULL CHECK (jsonb_typeof(source_request) = 'object'),
  classification jsonb NOT NULL CHECK (jsonb_typeof(classification) = 'object'),
  classifier_version text NOT NULL CHECK (classifier_version = 'railway-c34c6dc-native-v1'),
  evidence_status text NOT NULL DEFAULT 'heuristic_unverified' CHECK (evidence_status = 'heuristic_unverified'),
  batch_request jsonb NOT NULL CHECK (jsonb_typeof(batch_request) = 'object'),
  response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (case_id, operation_key)
);
COMMENT ON TABLE public.intake_snapshots IS 'Append-only intake evidence, linked to canonical case and JWT actor. Includes raw text/identity, unverified classifier output and canonical batch receipt. No direct client mutation. Retention/deletion needs a separately reviewed policy; case/user deletion is RESTRICTed.';
ALTER TABLE public.intake_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intake_snapshots FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.intake_snapshots TO authenticated;
CREATE POLICY intake_snapshot_read ON public.intake_snapshots FOR SELECT TO authenticated
  USING (public.has_workspace_access() AND public.has_case_read_access(case_id));

CREATE FUNCTION public.record_intake_snapshot(
  p_case_id uuid, p_operation_key text, p_source_request jsonb,
  p_classification jsonb, p_batch jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_saved public.intake_snapshots%ROWTYPE;
  v_receipt jsonb;
  v_response jsonb;
  v_snapshot_id uuid := gen_random_uuid();
  v_key text;
BEGIN
  IF v_uid IS NULL OR auth.role() IS DISTINCT FROM 'authenticated'
    OR public.has_workspace_access() IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'DIS_AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF p_case_id IS NULL OR p_operation_key IS NULL
    OR p_operation_key !~ '^intake:[A-Za-z0-9._:-]{8,120}$'
    OR length(p_operation_key) NOT BETWEEN 16 AND 128
  THEN RAISE EXCEPTION 'DIS_IDENTITY_INVALID' USING ERRCODE = '22023'; END IF;
  IF p_source_request IS NULL OR jsonb_typeof(p_source_request) IS DISTINCT FROM 'object'
    OR pg_column_size(p_source_request) > 262144
    OR jsonb_typeof(p_source_request->'source') IS DISTINCT FROM 'object'
    OR p_source_request#>>'{source,type}' IS DISTINCT FROM 'email_text'
    OR jsonb_typeof(p_source_request#>'{source,text}') IS DISTINCT FROM 'string'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_source_request) k WHERE k NOT IN ('source','client_name','client_email','customer_ref'))
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_source_request->'source') k WHERE k NOT IN ('type','text'))
  THEN RAISE EXCEPTION 'DIS_SOURCE_INVALID' USING ERRCODE = '22023'; END IF;
  FOREACH v_key IN ARRAY ARRAY['client_name','client_email','customer_ref'] LOOP
    IF p_source_request ? v_key AND jsonb_typeof(p_source_request->v_key) IS DISTINCT FROM 'string'
    THEN RAISE EXCEPTION 'DIS_IDENTITY_FIELD_INVALID' USING ERRCODE = '22023'; END IF;
  END LOOP;
  IF p_classification IS NULL OR jsonb_typeof(p_classification) IS DISTINCT FROM 'object'
    OR pg_column_size(p_classification) > 262144
    OR jsonb_typeof(p_classification->'normalized_request') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_classification->'missing_fields') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_classification->'assumptions') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_classification->'confidence') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_classification->'complexity_level') IS DISTINCT FROM 'number'
    OR (p_classification->>'confidence')::numeric NOT BETWEEN 0 AND 1
    OR p_classification->>'complexity_level' NOT IN ('1','2','3','4')
    OR p_classification->>'workflow_key' IS NULL
    OR p_classification->>'workflow_key' <> (CASE p_classification->>'complexity_level'
      WHEN '1' THEN 'WF_SIMPLE_QUOTE' WHEN '2' THEN 'WF_STANDARD_QUOTE'
      WHEN '3' THEN 'WF_PROJECT_CARGO' WHEN '4' THEN 'WF_TENDER' END)
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_classification) k WHERE k NOT IN ('normalized_request','missing_fields','assumptions','confidence','complexity_level','workflow_key'))
  THEN RAISE EXCEPTION 'DIS_CLASSIFICATION_INVALID' USING ERRCODE = '22023'; END IF;
  IF p_batch IS NULL OR jsonb_typeof(p_batch) IS DISTINCT FROM 'object'
    OR pg_column_size(p_batch) > 65536
    OR p_batch->>'case_id' IS DISTINCT FROM p_case_id::text
    OR p_batch->>'batch_key' IS DISTINCT FROM p_operation_key
    OR p_batch->>'workflow_key' IS DISTINCT FROM p_classification->>'workflow_key'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_batch) k WHERE k NOT IN ('case_id','batch_key','source_type','source_excerpt','workflow_key','facts'))
  THEN RAISE EXCEPTION 'DIS_BATCH_INVALID' USING ERRCODE = '22023'; END IF;
  -- Require the same structural shape consumed by the inactive native adapter.
  IF jsonb_typeof(p_classification#>'{normalized_request,intent}') IS DISTINCT FROM 'string'
    OR length(p_classification#>>'{normalized_request,intent}') = 0
    OR jsonb_typeof(p_classification#>'{normalized_request,modes}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_classification#>'{normalized_request,parties}') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_classification#>'{normalized_request,route}') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_classification#>'{normalized_request,cargo}') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_classification#>'{normalized_request,constraints}') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_classification#>'{normalized_request,commercial}') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_classification#>'{normalized_request,cargo,items}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_classification#>'{normalized_request,cargo,dangerous_goods}') IS DISTINCT FROM 'object'
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_classification->'assumptions') a WHERE jsonb_typeof(a) IS DISTINCT FROM 'string' OR length(a#>>'{}') = 0)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_classification->'missing_fields') m WHERE jsonb_typeof(m) IS DISTINCT FROM 'object'
      OR jsonb_typeof(m->'field') IS DISTINCT FROM 'string' OR length(m->>'field') = 0
      OR jsonb_typeof(m->'question') IS DISTINCT FROM 'string' OR length(m->>'question') = 0
      OR jsonb_typeof(m->'priority') IS DISTINCT FROM 'string' OR length(m->>'priority') = 0)
  THEN RAISE EXCEPTION 'DIS_CLASSIFICATION_INVALID' USING ERRCODE = '22023'; END IF;
  FOREACH v_key IN ARRAY ARRAY['origins','hubs','destinations','legs'] LOOP
    IF jsonb_typeof(p_classification#>ARRAY['normalized_request','route',v_key]) IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'DIS_CLASSIFICATION_INVALID' USING ERRCODE = '22023'; END IF;
  END LOOP;
  -- Same lock namespace as the existing batch RPC, before access/replay/create.
  PERFORM pg_advisory_xact_lock(hashtextextended('sifb:' || p_case_id::text, 0));
  PERFORM id FROM public.quote_cases WHERE id = p_case_id FOR UPDATE;
  IF FOUND AND public.has_case_write_access(p_case_id) IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'DIS_CASE_ACCESS_DENIED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_saved FROM public.intake_snapshots WHERE case_id = p_case_id AND operation_key = p_operation_key;
  IF FOUND THEN
    IF v_saved.actor_user_id IS DISTINCT FROM v_uid
      OR v_saved.source_request IS DISTINCT FROM p_source_request
      OR v_saved.classification IS DISTINCT FROM p_classification
      OR v_saved.batch_request IS DISTINCT FROM p_batch
    THEN RAISE EXCEPTION 'DIS_IDEMPOTENCY_CONFLICT' USING ERRCODE = '23505'; END IF;
    RETURN v_saved.response || jsonb_build_object('replayed', true, 'batch_receipt',
      (v_saved.response->'batch_receipt') || jsonb_build_object('replayed', true));
  END IF;
  -- Do not adopt a pre-existing legacy batch: it has no atomic snapshot receipt.
  IF EXISTS (SELECT 1 FROM public.intake_fact_batches WHERE case_id = p_case_id AND batch_key = p_operation_key)
  THEN RAISE EXCEPTION 'DIS_LEGACY_BATCH_COLLISION' USING ERRCODE = '23505'; END IF;
  v_receipt := public.set_intake_facts_batch(p_case_id, p_operation_key,
    p_batch->>'source_type', p_batch->>'source_excerpt', p_batch->>'workflow_key', p_batch->'facts');
  v_response := p_classification || jsonb_build_object('success', true, 'case_id', p_case_id,
    'operation_key', p_operation_key, 'status', v_receipt->>'status', 'snapshot_id', v_snapshot_id, 'replayed', false,
    'evidence_status', 'heuristic_unverified', 'batch_receipt', v_receipt);
  INSERT INTO public.intake_snapshots(id,case_id,operation_key,actor_user_id,source_request,
    classification,classifier_version,batch_request,response)
  VALUES(v_snapshot_id,p_case_id,p_operation_key,v_uid,p_source_request,p_classification,
    'railway-c34c6dc-native-v1',p_batch,v_response);
  RETURN v_response;
END $$;
REVOKE ALL ON FUNCTION public.record_intake_snapshot(uuid,text,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_intake_snapshot(uuid,text,jsonb,jsonb,jsonb) TO authenticated;
DO $verify$
DECLARE f oid := 'public.record_intake_snapshot(uuid,text,jsonb,jsonb,jsonb)'::regprocedure;
BEGIN
  IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('service_role', f, 'EXECUTE')
    OR NOT has_function_privilege('authenticated', f, 'EXECUTE')
    OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=pg_catalog'] FROM pg_proc WHERE oid=f)
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.intake_snapshots'::regclass)
    OR has_table_privilege('authenticated','public.intake_snapshots','INSERT,UPDATE,DELETE')
    OR has_table_privilege('anon','public.intake_snapshots','SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('service_role','public.intake_snapshots','SELECT,INSERT,UPDATE,DELETE')
  THEN RAISE EXCEPTION 'DIS_ACL_INVARIANT_FAILED'; END IF;
END $verify$;
COMMIT;
