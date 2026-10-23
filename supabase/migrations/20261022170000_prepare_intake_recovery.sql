-- LOCAL PREPARATION ONLY. Never applied to Cloud by this lot.
-- Draft private to origin; attested case-linked evidence follows current case rights.
-- Existing workspace Storage ACL unchanged; no purge or manual deletion added.
BEGIN;
DO $$ BEGIN
 IF current_user <> 'postgres' OR to_regprocedure('public.record_intake_snapshot(uuid,text,jsonb,jsonb,jsonb)') IS NULL
 OR to_regclass('public.manual_intake_operations') IS NOT NULL
 OR to_regclass('public.case_documents') IS NULL THEN RAISE EXCEPTION 'MIR_BASELINE_REQUIRED'; END IF;
END $$;
CREATE TABLE public.manual_intake_operations (
 id uuid PRIMARY KEY, actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 state text NOT NULL CHECK(state IN('reserved','prepared','committed','abandoned')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), draft jsonb NOT NULL,
 prepared jsonb, prepared_hash text, receipt jsonb, document_receipt jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(jsonb_typeof(draft)='object' AND octet_length(draft::text)<=1048576),
 CHECK(prepared IS NULL OR (jsonb_typeof(prepared)='object' AND octet_length(prepared::text)<=1048576)),
 CHECK((prepared IS NULL)=(prepared_hash IS NULL)), CHECK(state<>'committed' OR receipt IS NOT NULL)
);
CREATE TABLE public.manual_intake_steps (
 operation_id uuid NOT NULL REFERENCES public.manual_intake_operations(id) ON DELETE RESTRICT,
 step text NOT NULL CHECK(step IN('upload','extraction','analysis')),
 claim_id uuid NOT NULL, state text NOT NULL CHECK(state IN('running','complete','failed','unknown')),
 input jsonb NOT NULL, output jsonb, error_code text,
 PRIMARY KEY(operation_id,step), UNIQUE(operation_id,claim_id),
 CHECK(jsonb_typeof(input)='object' AND octet_length(input::text)<=1048576),
 CHECK(output IS NULL OR (jsonb_typeof(output)='object' AND octet_length(output::text)<=1048576)),
 CHECK(error_code IS NULL OR error_code ~ '^[A-Z_]{1,64}$')
);
CREATE TABLE public.manual_intake_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 operation_id uuid NOT NULL REFERENCES public.manual_intake_operations(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 action text NOT NULL, evidence jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE public.manual_intake_operations IS 'Recovery evidence: unlinked drafts origin-private, attested case-linked evidence follows case read/write. Includes source/identity. No automatic expiry/delete. RESTRICT retention requires reviewed policy. URL UUID is not authorization. Storage bytes remain in the existing team-shared private bucket.';
ALTER TABLE public.manual_intake_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_intake_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_intake_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manual_intake_operations,public.manual_intake_steps,public.manual_intake_events FROM PUBLIC,anon,authenticated,service_role;
-- All reads/mutations go through the checked RPC; no direct PII table grants.
CREATE FUNCTION public.manual_intake_assert_actor(p_actor uuid,p_service boolean DEFAULT false,p_lock boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF p_lock THEN
  PERFORM 1 FROM public.app_roles r JOIN auth.users u ON u.id=r.user_id WHERE r.user_id=p_actor AND r.role IN('workspace_operator','role_admin') ORDER BY r.role FOR SHARE OF r,u;
 END IF;
 IF p_actor IS NULL OR (p_service AND auth.role() IS DISTINCT FROM 'service_role')
 OR (NOT p_service AND (auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS DISTINCT FROM p_actor))
 OR NOT EXISTS(SELECT 1 FROM public.app_roles r JOIN auth.users u ON u.id=r.user_id
 WHERE r.user_id=p_actor AND r.role IN('workspace_operator','role_admin') AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp()))
 THEN RAISE EXCEPTION 'MIR_AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.manual_intake_assert_actor(uuid,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;
-- Admission first; operation lock is owned by the caller. Case -> admission locks
-- serialize a current assignment/revocation with release of sensitive evidence.
CREATE FUNCTION public.manual_intake_operation_access(p_id uuid,p_actor uuid,p_write boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $access$
DECLARE o public.manual_intake_operations; c public.quote_cases; s public.intake_snapshots; writable boolean;
BEGIN
 PERFORM public.manual_intake_assert_actor(p_actor,false);
 SELECT * INTO o FROM public.manual_intake_operations WHERE id=p_id;
 IF o.id IS NULL THEN RAISE EXCEPTION 'MIR_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF o.state='committed' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('sifb:'||p_id::text,0));
  IF p_write THEN SELECT * INTO c FROM public.quote_cases WHERE id=p_id FOR UPDATE;
  ELSE SELECT * INTO c FROM public.quote_cases WHERE id=p_id FOR SHARE; END IF;
  PERFORM public.manual_intake_assert_actor(p_actor,false,true);
  SELECT * INTO s FROM public.intake_snapshots WHERE case_id=p_id AND operation_key=('intake:'||p_id::text||':v1');
  IF c.id IS NULL OR s.id IS NULL OR s.actor_user_id IS DISTINCT FROM o.actor_user_id
   OR s.id::text IS DISTINCT FROM o.receipt->>'snapshot_id' OR s.response IS DISTINCT FROM o.receipt
   OR s.source_request IS DISTINCT FROM o.prepared#>'{command,p_source_request}'
   OR s.classification IS DISTINCT FROM o.prepared#>'{command,p_classification}'
   OR s.batch_request IS DISTINCT FROM o.prepared#>'{command,p_batch}'
   OR public.has_case_read_access(p_id) IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'MIR_CASE_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  writable:=public.has_case_write_access(p_id);
  IF p_write AND writable IS DISTINCT FROM true THEN RAISE EXCEPTION 'MIR_CASE_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('viewer_user_id',p_actor,'case_id',p_id,'can_write',writable);
 END IF;
 -- A matching UUID or an unrelated pre-existing case does not attach a draft.
 IF o.actor_user_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'MIR_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF NOT p_write THEN PERFORM public.manual_intake_assert_actor(p_actor,false,true); END IF;
 RETURN jsonb_build_object('viewer_user_id',p_actor,'case_id',NULL,'can_write',true);
END $access$;
REVOKE ALL ON FUNCTION public.manual_intake_operation_access(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.manual_intake_operation_view(p_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('operation_id',o.id,'actor_user_id',o.actor_user_id,'access',CASE WHEN auth.role()='authenticated' THEN public.manual_intake_operation_access(p_id,auth.uid(),false) ELSE NULL END,'state',o.state,'revision',o.revision,
 'draft',o.draft,'prepared',o.prepared,'prepared_hash',o.prepared_hash,'receipt',o.receipt,'document_receipt',o.document_receipt,
 'steps',COALESCE((SELECT jsonb_object_agg(s.step,jsonb_build_object('claim_id',s.claim_id,'state',s.state,'input',s.input,'output',s.output,'error_code',s.error_code)) FROM public.manual_intake_steps s WHERE s.operation_id=o.id),'{}'::jsonb))
 FROM public.manual_intake_operations o WHERE o.id=p_id;
$$;
REVOKE ALL ON FUNCTION public.manual_intake_operation_view(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.manual_intake_operation_impl(p_id uuid,p_action text,p_payload jsonb,p_actor uuid,p_service boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=p_actor; o public.manual_intake_operations%ROWTYPE; s public.manual_intake_steps%ROWTYPE;
 c jsonb; b jsonb; response jsonb; f jsonb; u jsonb; ex text; expected integer;
BEGIN
 PERFORM public.manual_intake_assert_actor(actor,p_service);
 IF p_service AND p_action<>'prepare' THEN RAISE EXCEPTION 'MIR_SERVER_PREPARE_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_action IS NULL OR p_action NOT IN('read','reserve','save','prepare','commit','abandon','claim','link')
 OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>1048576
 THEN RAISE EXCEPTION 'MIR_INVALID_COMMAND' USING ERRCODE='22023'; END IF;
 -- One common order: operation advisory -> operation row -> canonical sifb lock -> case row.
 PERFORM pg_advisory_xact_lock(hashtextextended('manual-intake:'||p_id::text,0));
 PERFORM public.manual_intake_assert_actor(actor,p_service); -- re-read admission after waiting
 SELECT * INTO o FROM public.manual_intake_operations WHERE id=p_id FOR UPDATE;
 IF o.id IS NOT NULL THEN
  IF p_service THEN
   IF o.actor_user_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'MIR_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
  ELSE PERFORM public.manual_intake_operation_access(p_id,actor,p_action<>'read'); END IF;
 END IF;
 IF p_action NOT IN('commit','link') THEN PERFORM public.manual_intake_assert_actor(actor,p_service,true); END IF;
 IF o.id IS NULL THEN
  IF p_action='read' THEN RETURN jsonb_build_object('found',false,'operation_id',p_id); END IF;
  IF p_action NOT IN('reserve','abandon') THEN RAISE EXCEPTION 'MIR_NOT_FOUND' USING ERRCODE='22023'; END IF;
  IF p_action='reserve' AND (jsonb_typeof(p_payload->'draft') IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k<>'draft'))
  THEN RAISE EXCEPTION 'MIR_INVALID_DRAFT' USING ERRCODE='22023'; END IF;
  INSERT INTO public.manual_intake_operations(id,actor_user_id,state,draft) VALUES(p_id,actor,CASE WHEN p_action='abandon' THEN 'abandoned' ELSE 'reserved' END,COALESCE(p_payload->'draft','{}'));
  INSERT INTO public.manual_intake_events(operation_id,actor_user_id,action,evidence) VALUES(p_id,actor,p_action,p_payload);
  RETURN public.manual_intake_operation_view(p_id)||jsonb_build_object('found',true);
 END IF;
 IF p_action='read' THEN RETURN public.manual_intake_operation_view(p_id)||jsonb_build_object('found',true); END IF;
 -- A takeover never rewrites the origin or replays SIFB under a colleague JWT.
 -- One trace per resuming actor, serialized by the operation advisory lock.
 IF o.actor_user_id IS DISTINCT FROM actor THEN
  INSERT INTO public.manual_intake_events(operation_id,actor_user_id,action,evidence)
   SELECT p_id,actor,'resume',jsonb_build_object('origin_actor_user_id',o.actor_user_id,'case_id',p_id)
   WHERE NOT EXISTS(SELECT 1 FROM public.manual_intake_events WHERE operation_id=p_id AND actor_user_id=actor AND action='resume');
 END IF;
 IF o.state='abandoned' THEN
  IF p_action='abandon' THEN RETURN public.manual_intake_operation_view(p_id)||jsonb_build_object('found',true); END IF;
  RAISE EXCEPTION 'MIR_ABANDONED' USING ERRCODE='23505';
 END IF;
 IF p_action='reserve' THEN
  IF o.draft IS DISTINCT FROM p_payload->'draft' THEN RAISE EXCEPTION 'MIR_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505'; END IF;
  RETURN public.manual_intake_operation_view(p_id)||jsonb_build_object('found',true);
 ELSIF p_action='save' THEN
  IF o.state<>'reserved' OR jsonb_typeof(p_payload->'draft') IS DISTINCT FROM 'object' OR jsonb_typeof(p_payload->'expected_revision') IS DISTINCT FROM 'number'
  THEN RAISE EXCEPTION 'MIR_FROZEN_OR_INVALID' USING ERRCODE='23505'; END IF;
  expected:=(p_payload->>'expected_revision')::integer;
  IF o.revision=expected+1 AND o.draft=p_payload->'draft' THEN RETURN public.manual_intake_operation_view(p_id)||jsonb_build_object('found',true); END IF;
  IF (o.draft->'file' IS DISTINCT FROM p_payload#>'{draft,file}') AND EXISTS(SELECT 1 FROM public.manual_intake_steps WHERE operation_id=p_id) THEN RAISE EXCEPTION 'MIR_FILE_FROZEN' USING ERRCODE='23505'; END IF;
  IF o.revision<>expected THEN RAISE EXCEPTION 'MIR_REVISION_CONFLICT' USING ERRCODE='23505'; END IF;
  UPDATE public.manual_intake_operations SET draft=p_payload->'draft',revision=revision+1,updated_at=clock_timestamp() WHERE id=p_id;
 ELSIF p_action='abandon' THEN
  IF o.state='committed' THEN RAISE EXCEPTION 'MIR_ALREADY_COMMITTED' USING ERRCODE='23505'; END IF;
  IF EXISTS(SELECT 1 FROM public.manual_intake_steps WHERE operation_id=p_id AND state IN('running','unknown')) THEN RAISE EXCEPTION 'MIR_STEP_UNCONFIRMED' USING ERRCODE='23505'; END IF;
  UPDATE public.manual_intake_operations SET state='abandoned',updated_at=clock_timestamp() WHERE id=p_id;
 ELSIF p_action='claim' THEN
  IF o.state<>'reserved' OR p_payload->>'step' IS NULL OR p_payload->>'step' NOT IN('upload','extraction','analysis')
  OR jsonb_typeof(p_payload->'input') IS DISTINCT FROM 'object' OR p_payload->>'claim_id' IS NULL
  THEN RAISE EXCEPTION 'MIR_INVALID_STEP' USING ERRCODE='22023'; END IF;
  IF o.draft->'file' IS NULL OR o.draft->'file'='null'::jsonb OR
    (p_payload->>'step'='upload' AND p_payload->'input' IS DISTINCT FROM jsonb_build_object('descriptor',o.draft->'file')) OR
    (p_payload->>'step'='extraction' AND p_payload->'input' IS DISTINCT FROM jsonb_build_object('file_sha256',o.draft#>>'{file,sha256}')) OR
    (p_payload->>'step'='analysis' AND NOT EXISTS(SELECT 1 FROM public.manual_intake_steps x WHERE x.operation_id=p_id AND x.step='extraction' AND x.state='complete' AND p_payload->'input'=jsonb_build_object('file_sha256',o.draft#>>'{file,sha256}','extraction_claim_id',x.claim_id::text,'text_sha256',encode(sha256(convert_to(x.output->>'text','UTF8')),'hex'))))
  THEN RAISE EXCEPTION 'MIR_STEP_SOURCE_CONFLICT' USING ERRCODE='23505'; END IF;
  SELECT * INTO s FROM public.manual_intake_steps WHERE operation_id=p_id AND step=p_payload->>'step';
  IF FOUND THEN
   IF s.input IS DISTINCT FROM p_payload->'input' THEN RAISE EXCEPTION 'MIR_STEP_CONFLICT' USING ERRCODE='23505'; END IF;
   -- No expiry means success. A running/unknown ticket cannot cause another provider call.
   RETURN public.manual_intake_operation_view(p_id)||jsonb_build_object('found',true,'claimed',false);
  END IF;
  IF p_payload->>'step'='extraction' AND NOT EXISTS(SELECT 1 FROM public.manual_intake_steps WHERE operation_id=p_id AND step='upload' AND state='complete')  THEN RAISE EXCEPTION 'MIR_UPLOAD_REQUIRED' USING ERRCODE='23505'; END IF;
  IF p_payload->>'step'='analysis' AND NOT EXISTS(SELECT 1 FROM public.manual_intake_steps WHERE operation_id=p_id AND step='extraction' AND state='complete')
  THEN RAISE EXCEPTION 'MIR_EXTRACTION_REQUIRED' USING ERRCODE='23505'; END IF;
  INSERT INTO public.manual_intake_steps(operation_id,step,claim_id,state,input) VALUES(p_id,p_payload->>'step',(p_payload->>'claim_id')::uuid,'running',p_payload->'input');
 ELSIF p_action='prepare' THEN
  IF jsonb_typeof(p_payload->'body') IS DISTINCT FROM 'object' OR jsonb_typeof(p_payload->'command') IS DISTINCT FROM 'object'
  OR jsonb_typeof(p_payload->'expected_revision') IS DISTINCT FROM 'number'
  OR p_payload->>'classifier_version' IS DISTINCT FROM 'railway-c34c6dc-native-v1'
  THEN RAISE EXCEPTION 'MIR_INVALID_PREPARED' USING ERRCODE='22023'; END IF;
  b:=p_payload->'body'; c:=p_payload->'command';
  IF b->>'case_id' IS DISTINCT FROM p_id::text OR c->>'p_case_id' IS DISTINCT FROM p_id::text
  OR c->>'p_operation_key' IS DISTINCT FROM ('intake:'||p_id::text||':v1')
  OR c->'p_source_request' IS DISTINCT FROM b->'request'
  OR c#>>'{p_batch,case_id}' IS DISTINCT FROM p_id::text OR c#>>'{p_batch,batch_key}' IS DISTINCT FROM c->>'p_operation_key'
  THEN RAISE EXCEPTION 'MIR_INVALID_PREPARED' USING ERRCODE='22023'; END IF;
  IF o.prepared IS NOT NULL THEN
   IF o.prepared IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'MIR_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505'; END IF;
   RETURN public.manual_intake_operation_view(p_id)||jsonb_build_object('found',true);
  END IF;
  IF o.state<>'reserved' OR o.revision<>(p_payload->>'expected_revision')::integer THEN RAISE EXCEPTION 'MIR_REVISION_CONFLICT' USING ERRCODE='23505'; END IF;
  IF (b-ARRAY['version','case_id']) IS DISTINCT FROM o.draft->'form' THEN RAISE EXCEPTION 'MIR_DRAFT_CHANGED' USING ERRCODE='23505'; END IF;
  IF EXISTS(SELECT 1 FROM public.manual_intake_steps WHERE operation_id=p_id AND state IN('running','unknown')) THEN RAISE EXCEPTION 'MIR_STEP_UNCONFIRMED' USING ERRCODE='23505'; END IF;
  f:=o.draft->'file';
  IF f IS NOT NULL AND f<>'null'::jsonb THEN
   IF NOT EXISTS(SELECT 1 FROM public.manual_intake_steps WHERE operation_id=p_id AND step='upload' AND state='complete' AND output->'descriptor'=f)
   THEN RAISE EXCEPTION 'MIR_UPLOAD_REQUIRED' USING ERRCODE='23505'; END IF;
   IF b->'has_extracted_document'='true'::jsonb AND NOT EXISTS(SELECT 1 FROM public.manual_intake_steps WHERE operation_id=p_id AND step='analysis' AND state='complete' AND output->'analysis'=b->'analysis')
   THEN RAISE EXCEPTION 'MIR_ANALYSIS_REQUIRED' USING ERRCODE='23505'; END IF;
  ELSIF b->'has_extracted_document'='true'::jsonb THEN RAISE EXCEPTION 'MIR_DOCUMENT_REQUIRED' USING ERRCODE='22023'; END IF;
  UPDATE public.manual_intake_operations SET prepared=p_payload,prepared_hash=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),state='prepared',updated_at=clock_timestamp() WHERE id=p_id;
 ELSIF p_action='commit' THEN
  IF p_payload<>'{}'::jsonb THEN RAISE EXCEPTION 'MIR_INVALID_COMMAND' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sifb:'||p_id::text,0));
  PERFORM id FROM public.quote_cases WHERE id=p_id FOR UPDATE;
  PERFORM id FROM public.quote_facts WHERE case_id=p_id ORDER BY id FOR UPDATE;
  PERFORM public.manual_intake_assert_actor(actor,false,true);
  IF o.state='committed' THEN
   -- Re-admission already checked; case write access remains mandatory on replay.
   IF public.has_case_write_access(p_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MIR_CASE_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
   RETURN public.manual_intake_operation_view(p_id)||jsonb_build_object('found',true,'replayed',true);
  END IF;
  IF o.state<>'prepared' OR o.prepared_hash IS DISTINCT FROM encode(sha256(convert_to(o.prepared::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'MIR_PREPARED_REQUIRED' USING ERRCODE='23505'; END IF;
  IF EXISTS(SELECT 1 FROM public.intake_snapshots WHERE case_id=p_id AND operation_key=('intake:'||p_id::text||':v1')) THEN RAISE EXCEPTION 'MIR_SNAPSHOT_COLLISION' USING ERRCODE='23505'; END IF;
  c:=o.prepared->'command';
  response:=public.record_intake_snapshot(p_id,c->>'p_operation_key',c->'p_source_request',c->'p_classification',c->'p_batch');
  UPDATE public.manual_intake_operations SET state='committed',receipt=response,updated_at=clock_timestamp() WHERE id=p_id;
 ELSIF p_action='link' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('sifb:'||p_id::text,0));
  PERFORM id FROM public.quote_cases WHERE id=p_id FOR UPDATE;
  PERFORM public.manual_intake_assert_actor(actor,false,true);
  IF o.state<>'committed' OR public.has_case_write_access(p_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MIR_CASE_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  IF o.document_receipt IS NOT NULL THEN RETURN public.manual_intake_operation_view(p_id)||jsonb_build_object('found',true); END IF;
  f:=o.draft->'file'; SELECT output INTO u FROM public.manual_intake_steps WHERE operation_id=p_id AND step='upload' AND state='complete';
  IF f IS NULL OR f='null'::jsonb OR u->'descriptor' IS DISTINCT FROM f THEN RAISE EXCEPTION 'MIR_UPLOAD_REQUIRED' USING ERRCODE='23505'; END IF;
  IF EXISTS(SELECT 1 FROM public.case_documents WHERE id=(f->>'document_id')::uuid) THEN RAISE EXCEPTION 'MIR_DOCUMENT_COLLISION' USING ERRCODE='23505'; END IF;
  SELECT output->>'text' INTO ex FROM public.manual_intake_steps WHERE operation_id=p_id AND step='extraction' AND state='complete';
  BEGIN
  INSERT INTO public.case_documents(id,case_id,document_type,file_name,storage_path,mime_type,file_size,uploaded_by,extracted_text)
  VALUES((f->>'document_id')::uuid,p_id,'Ordre de transit',f->>'name',f->>'path',f->>'mime',(f->>'size')::integer,o.actor_user_id,ex);
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'MIR_DOCUMENT_COLLISION' USING ERRCODE='23505'; END;
  INSERT INTO public.case_timeline_events(case_id,event_type,actor_type,actor_user_id,event_data)
  VALUES(p_id,'document_uploaded','user',actor,jsonb_build_object('document_type','Ordre de transit','file_name',f->>'name','document_id',f->>'document_id','sha256',f->>'sha256','operation_id',p_id,'uploaded_by',o.actor_user_id,'linked_by',actor));
  UPDATE public.manual_intake_operations SET document_receipt=jsonb_build_object('document_id',f->>'document_id','case_id',p_id,'storage_path',f->>'path','sha256',f->>'sha256'),updated_at=clock_timestamp() WHERE id=p_id;
 END IF;
 INSERT INTO public.manual_intake_events(operation_id,actor_user_id,action,evidence) VALUES(p_id,actor,p_action,p_payload);
 RETURN public.manual_intake_operation_view(p_id)||jsonb_build_object('found',true)||CASE WHEN p_action='claim' THEN jsonb_build_object('claimed',true) ELSE '{}'::jsonb END;
END $$;
REVOKE ALL ON FUNCTION public.manual_intake_operation_impl(uuid,text,jsonb,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.manual_intake_operation(p_id uuid,p_action text,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF p_action='prepare' THEN RAISE EXCEPTION 'MIR_SERVER_PREPARE_REQUIRED' USING ERRCODE='42501'; END IF;
 RETURN public.manual_intake_operation_impl(p_id,p_action,p_payload,auth.uid(),false);
END $$;
REVOKE ALL ON FUNCTION public.manual_intake_operation(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.manual_intake_operation(uuid,text,jsonb) TO authenticated;
CREATE FUNCTION public.manual_intake_prepare(p_id uuid,p_actor uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.manual_intake_operation_impl(p_id,'prepare',p_payload,p_actor,true);
$$;
REVOKE ALL ON FUNCTION public.manual_intake_prepare(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.manual_intake_prepare(uuid,uuid,jsonb) TO service_role;
-- Only the admitted server worker may attest an external step, never the caller.
CREATE FUNCTION public.manual_intake_finish_step(p_id uuid,p_actor uuid,p_step text,p_claim uuid,p_state text,p_output jsonb,p_error text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o public.manual_intake_operations%ROWTYPE; s public.manual_intake_steps%ROWTYPE;
BEGIN
 PERFORM public.manual_intake_assert_actor(p_actor,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('manual-intake:'||p_id::text,0));
 PERFORM public.manual_intake_assert_actor(p_actor,true);
 SELECT * INTO o FROM public.manual_intake_operations WHERE id=p_id FOR UPDATE;
 SELECT * INTO s FROM public.manual_intake_steps WHERE operation_id=p_id AND step=p_step FOR UPDATE;
 IF o.id IS NULL OR o.actor_user_id IS DISTINCT FROM p_actor OR o.state='abandoned' OR p_claim IS NULL OR p_step IS NULL OR s.operation_id IS NULL OR s.claim_id IS DISTINCT FROM p_claim
 OR p_state IS NULL OR p_state NOT IN('complete','failed','unknown') OR (p_output IS NOT NULL AND (jsonb_typeof(p_output)<>'object' OR octet_length(p_output::text)>1048576))
 OR (p_error IS NOT NULL AND p_error !~ '^[A-Z_]{1,64}$')
 THEN RAISE EXCEPTION 'MIR_STEP_CONFLICT' USING ERRCODE='23505'; END IF;
 PERFORM public.manual_intake_assert_actor(p_actor,true,true);
 IF s.state IN('complete','failed') THEN
  IF s.state IS DISTINCT FROM p_state OR s.output IS DISTINCT FROM p_output OR s.error_code IS DISTINCT FROM p_error THEN RAISE EXCEPTION 'MIR_STEP_CONFLICT' USING ERRCODE='23505'; END IF;
  RETURN public.manual_intake_operation_view(p_id)||jsonb_build_object('found',true);
 END IF;
 IF p_state='complete' AND p_output IS NULL THEN RAISE EXCEPTION 'MIR_INVALID_STEP_OUTPUT' USING ERRCODE='22023'; END IF;
 IF p_step='upload' AND s.input IS DISTINCT FROM jsonb_build_object('descriptor',o.draft->'file') THEN RAISE EXCEPTION 'MIR_STEP_SOURCE_CONFLICT' USING ERRCODE='23505'; END IF;
 IF p_state='complete' AND p_step<>'upload' AND (p_output->>'operation_id' IS DISTINCT FROM p_id::text OR p_output->>'claim_id' IS DISTINCT FROM p_claim::text OR p_output->>'file_sha256' IS DISTINCT FROM o.draft#>>'{file,sha256}') THEN RAISE EXCEPTION 'MIR_STEP_SOURCE_CONFLICT' USING ERRCODE='23505'; END IF;
 IF p_state='complete' AND p_step='extraction' AND (s.input IS DISTINCT FROM jsonb_build_object('file_sha256',o.draft#>>'{file,sha256}') OR jsonb_typeof(p_output->'text') IS DISTINCT FROM 'string' OR p_output->>'text_sha256' IS DISTINCT FROM encode(sha256(convert_to(p_output->>'text','UTF8')),'hex')) THEN RAISE EXCEPTION 'MIR_STEP_SOURCE_CONFLICT' USING ERRCODE='23505'; END IF;
 IF p_state='complete' AND p_step='analysis' AND NOT EXISTS(SELECT 1 FROM public.manual_intake_steps x WHERE x.operation_id=p_id AND x.step='extraction' AND x.state='complete' AND s.input=jsonb_build_object('file_sha256',o.draft#>>'{file,sha256}','extraction_claim_id',x.claim_id::text,'text_sha256',encode(sha256(convert_to(x.output->>'text','UTF8')),'hex')) AND p_output->>'extraction_claim_id'=x.claim_id::text AND p_output->>'text_sha256'=s.input->>'text_sha256') THEN RAISE EXCEPTION 'MIR_STEP_SOURCE_CONFLICT' USING ERRCODE='23505'; END IF;
 IF p_state='complete' AND p_step='upload' AND (p_output->'descriptor' IS DISTINCT FROM o.draft->'file') THEN RAISE EXCEPTION 'MIR_FILE_CONFLICT' USING ERRCODE='23505'; END IF;
 UPDATE public.manual_intake_steps SET state=p_state,output=p_output,error_code=p_error WHERE operation_id=p_id AND step=p_step;
 INSERT INTO public.manual_intake_events(operation_id,actor_user_id,action,evidence) VALUES(p_id,p_actor,'finish_'||p_step,jsonb_build_object('claim_id',p_claim,'state',p_state,'output',p_output,'error_code',p_error));
 RETURN public.manual_intake_operation_view(p_id)||jsonb_build_object('found',true);
END $$;
REVOKE ALL ON FUNCTION public.manual_intake_finish_step(uuid,uuid,text,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.manual_intake_finish_step(uuid,uuid,text,uuid,text,jsonb,text) TO service_role;
COMMIT;
