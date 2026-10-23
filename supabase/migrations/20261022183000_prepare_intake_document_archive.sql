-- LOCAL CANDIDATE ONLY. No Cloud application by this lot.
-- Unlinked evidence origin-private; attested linked evidence follows approved case rights.
-- No TTL, purge, third-party access or manual deletion added.
BEGIN;
DO $$ BEGIN IF current_user<>'postgres' OR to_regclass('public.manual_intake_steps') IS NULL OR to_regclass('public.manual_intake_document_archives') IS NOT NULL THEN RAISE EXCEPTION 'MIA_BASELINE_REQUIRED'; END IF; END $$;
CREATE FUNCTION public.manual_intake_utf16_length(t text) RETURNS integer LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$ SELECT 2*char_length(t)-char_length(regexp_replace(t,'['||chr(65536)||'-'||chr(1114111)||']','','g')); $$;
REVOKE ALL ON FUNCTION public.manual_intake_utf16_length(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.manual_intake_case_projection_valid(t text,c text,p jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE((c IS NOT NULL AND public.manual_intake_utf16_length(c)=LEAST(public.manual_intake_utf16_length(t),200000) AND left(t,char_length(c))=c)
 OR (c IS NULL AND p->>'case_text_status'='legacy_prefix_invalid_utf16' AND public.manual_intake_utf16_length(t)>200000 AND jsonb_typeof(p->'case_text_prefix')='string' AND public.manual_intake_utf16_length(p->>'case_text_prefix')=199999 AND left(t,char_length(p->>'case_text_prefix'))=p->>'case_text_prefix' AND ascii(substring(t FROM char_length(p->>'case_text_prefix')+1 FOR 1))>65535),false);
$$;
REVOKE ALL ON FUNCTION public.manual_intake_case_projection_valid(text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE public.manual_intake_document_dispatches (
 operation_id uuid NOT NULL,step text NOT NULL CHECK(step IN('extraction','analysis')),claim_id uuid NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 input jsonb NOT NULL,file_sha256 text NOT NULL,authorized_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(operation_id,step),UNIQUE(operation_id,claim_id),
 FOREIGN KEY(operation_id,claim_id) REFERENCES public.manual_intake_steps(operation_id,claim_id) ON DELETE RESTRICT
);
CREATE TABLE public.manual_intake_document_archives (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),operation_id uuid NOT NULL,step text NOT NULL CHECK(step IN('extraction','analysis')),claim_id uuid NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 file_sha256 text NOT NULL,text_sha256 text,payload_sha256 text NOT NULL,
 content_text text,case_text text,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(operation_id,step),UNIQUE(operation_id,claim_id),
 FOREIGN KEY(operation_id,claim_id) REFERENCES public.manual_intake_document_dispatches(operation_id,claim_id) ON DELETE RESTRICT,
 CHECK(jsonb_typeof(payload)='object'),
 CHECK((step='extraction' AND content_text IS NOT NULL AND public.manual_intake_utf16_length(content_text)<=2000000 AND public.manual_intake_case_projection_valid(content_text,case_text,payload) AND text_sha256 IS NOT NULL)
 OR (step='analysis' AND content_text IS NULL AND case_text IS NULL AND jsonb_typeof(payload->'analysis')='object'))
);
COMMENT ON TABLE public.manual_intake_document_archives IS 'Protected intake evidence; linked case readers may read via checked RPC; origin provenance preserved. Preserves legacy standalone text up to2M characters and original metadata. Not duplicated in operation/event JSON. Existing recovery retention: RESTRICT, no automatic expiry or purge. Only admitted readers of the attested case; no unrelated audience.';
ALTER TABLE public.manual_intake_document_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_intake_document_archives ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manual_intake_document_dispatches,public.manual_intake_document_archives FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.manual_intake_document_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'MIA_IMMUTABLE' USING ERRCODE='23505'; END $$;
REVOKE ALL ON FUNCTION public.manual_intake_document_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER manual_intake_archive_immutable BEFORE UPDATE OR DELETE ON public.manual_intake_document_archives FOR EACH ROW EXECUTE FUNCTION public.manual_intake_document_immutable();
CREATE TRIGGER manual_intake_dispatch_immutable BEFORE UPDATE OR DELETE ON public.manual_intake_document_dispatches FOR EACH ROW EXECUTE FUNCTION public.manual_intake_document_immutable();
CREATE OR REPLACE FUNCTION public.manual_intake_operation_view(p_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('operation_id',o.id,'actor_user_id',o.actor_user_id,'access',CASE WHEN auth.role()='authenticated' THEN public.manual_intake_operation_access(p_id,auth.uid(),false) ELSE NULL END,'state',o.state,'revision',o.revision,'draft',o.draft,'prepared',o.prepared,'prepared_hash',o.prepared_hash,'receipt',o.receipt,'document_receipt',o.document_receipt,
 'steps',COALESCE((SELECT jsonb_object_agg(s.step,jsonb_build_object('claim_id',s.claim_id,'state',s.state,'input',s.input,'output',s.output,'error_code',s.error_code,'dispatch_authorized',EXISTS(SELECT 1 FROM public.manual_intake_document_dispatches d WHERE d.operation_id=s.operation_id AND d.claim_id=s.claim_id))) FROM public.manual_intake_steps s WHERE s.operation_id=o.id),'{}'::jsonb)) FROM public.manual_intake_operations o WHERE o.id=p_id;
$$;
CREATE FUNCTION public.manual_intake_document_begin(p_id uuid,p_actor uuid,p_step text,p_claim uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o public.manual_intake_operations; s public.manual_intake_steps; BEGIN
 PERFORM public.manual_intake_assert_actor(p_actor,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('manual-intake:'||p_id::text,0));
 SELECT * INTO o FROM public.manual_intake_operations WHERE id=p_id FOR UPDATE;
 SELECT * INTO s FROM public.manual_intake_steps WHERE operation_id=p_id AND step=p_step FOR UPDATE;
 PERFORM public.manual_intake_assert_actor(p_actor,true,true);
 IF o.id IS NULL OR o.actor_user_id IS DISTINCT FROM p_actor OR p_step IS NULL OR p_step NOT IN('extraction','analysis') OR s.claim_id IS DISTINCT FROM p_claim OR p_claim IS NULL THEN RAISE EXCEPTION 'MIA_OWNER_OR_TICKET_REQUIRED' USING ERRCODE='42501'; END IF;
 IF o.state<>'reserved' OR s.state<>'running' OR EXISTS(SELECT 1 FROM public.manual_intake_document_dispatches WHERE operation_id=p_id AND step=p_step) THEN RETURN jsonb_build_object('started',false,'operation',public.manual_intake_operation_view(p_id)||jsonb_build_object('found',true)); END IF;
 IF s.input->>'file_sha256' IS DISTINCT FROM o.draft#>>'{file,sha256}' OR NOT EXISTS(SELECT 1 FROM public.manual_intake_steps WHERE operation_id=p_id AND step='upload' AND state='complete' AND output->'descriptor'=o.draft->'file') THEN RAISE EXCEPTION 'MIA_SOURCE_CHANGED' USING ERRCODE='23505'; END IF;
 IF p_step='analysis' AND NOT EXISTS(SELECT 1 FROM public.manual_intake_document_archives a JOIN public.manual_intake_steps x ON x.operation_id=a.operation_id AND x.claim_id=a.claim_id AND x.state='complete' AND x.output->>'archive_id'=a.id::text WHERE a.operation_id=p_id AND a.step='extraction' AND s.input->>'extraction_claim_id'=a.claim_id::text AND s.input->>'text_sha256'=a.text_sha256) THEN RAISE EXCEPTION 'MIA_EXTRACTION_REQUIRED' USING ERRCODE='23505'; END IF;
 INSERT INTO public.manual_intake_document_dispatches(operation_id,step,claim_id,actor_user_id,input,file_sha256) VALUES(p_id,p_step,p_claim,p_actor,s.input,o.draft#>>'{file,sha256}');
 -- Possible launch, not proof of execution or charge. No timeout/reset/retry.
 UPDATE public.manual_intake_steps SET state='unknown',error_code='PROVIDER_RESULT_UNCONFIRMED' WHERE operation_id=p_id AND step=p_step;
 INSERT INTO public.manual_intake_events(operation_id,actor_user_id,action,evidence) VALUES(p_id,p_actor,'authorize_'||p_step,jsonb_build_object('claim_id',p_claim,'file_sha256',o.draft#>>'{file,sha256}'));
 RETURN jsonb_build_object('started',true,'operation',public.manual_intake_operation_view(p_id)||jsonb_build_object('found',true));
END $$;
REVOKE ALL ON FUNCTION public.manual_intake_document_begin(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.manual_intake_document_begin(uuid,uuid,text,uuid) TO service_role;
CREATE FUNCTION public.manual_intake_document_complete(p_id uuid,p_actor uuid,p_step text,p_claim uuid,p_text text,p_case_text text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o public.manual_intake_operations;s public.manual_intake_steps;d public.manual_intake_document_dispatches;a public.manual_intake_document_archives;out jsonb;th text;ph text; BEGIN
 PERFORM public.manual_intake_assert_actor(p_actor,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('manual-intake:'||p_id::text,0));
 SELECT * INTO o FROM public.manual_intake_operations WHERE id=p_id FOR UPDATE;
 SELECT * INTO s FROM public.manual_intake_steps WHERE operation_id=p_id AND step=p_step FOR UPDATE;
 SELECT * INTO d FROM public.manual_intake_document_dispatches WHERE operation_id=p_id AND step=p_step;
 PERFORM public.manual_intake_assert_actor(p_actor,true,true);
 IF o.id IS NULL OR o.actor_user_id IS DISTINCT FROM p_actor OR d.actor_user_id IS DISTINCT FROM p_actor OR d.claim_id IS DISTINCT FROM p_claim OR s.claim_id IS DISTINCT FROM p_claim OR p_claim IS NULL OR d.operation_id IS NULL OR d.input IS DISTINCT FROM s.input OR d.file_sha256 IS DISTINCT FROM o.draft#>>'{file,sha256}' THEN RAISE EXCEPTION 'MIA_OWNER_OR_TICKET_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR (p_step='extraction' AND (p_text IS NULL OR public.manual_intake_utf16_length(p_text)>2000000 OR public.manual_intake_case_projection_valid(p_text,p_case_text,p_payload) IS DISTINCT FROM true OR p_payload->>'extraction_contract' IS DISTINCT FROM '1' OR p_payload->>'text_length' IS DISTINCT FROM public.manual_intake_utf16_length(p_text)::text OR jsonb_typeof(p_payload->'tags') IS DISTINCT FROM 'array' OR (jsonb_typeof(p_payload->'extracted_data') IS DISTINCT FROM 'object' AND jsonb_typeof(p_payload->'extracted_data') IS DISTINCT FROM 'null'))) OR (p_step='analysis' AND (p_text IS NOT NULL OR p_case_text IS NOT NULL OR jsonb_typeof(p_payload->'analysis') IS DISTINCT FROM 'object' OR p_payload->>'extraction_claim_id' IS DISTINCT FROM s.input->>'extraction_claim_id' OR p_payload->>'text_sha256' IS DISTINCT FROM s.input->>'text_sha256')) THEN RAISE EXCEPTION 'MIA_INVALID_OUTPUT' USING ERRCODE='22023'; END IF;
 th:=CASE WHEN p_step='extraction' THEN encode(sha256(convert_to(p_text,'UTF8')),'hex') ELSE s.input->>'text_sha256' END;ph:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 SELECT * INTO a FROM public.manual_intake_document_archives WHERE operation_id=p_id AND step=p_step;
 IF FOUND THEN
  IF a.claim_id IS DISTINCT FROM p_claim OR a.content_text IS DISTINCT FROM p_text OR a.case_text IS DISTINCT FROM p_case_text OR a.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'MIA_ARCHIVE_CONFLICT' USING ERRCODE='23505'; END IF;
  RETURN public.manual_intake_operation_view(p_id)||jsonb_build_object('found',true);
 END IF;
 IF o.state<>'reserved' OR s.state<>'unknown' THEN RAISE EXCEPTION 'MIA_STATE_CONFLICT' USING ERRCODE='23505'; END IF;
 INSERT INTO public.manual_intake_document_archives(operation_id,step,claim_id,actor_user_id,file_sha256,text_sha256,payload_sha256,content_text,case_text,payload) VALUES(p_id,p_step,p_claim,p_actor,d.file_sha256,th,ph,p_text,p_case_text,p_payload) RETURNING * INTO a;
 out:=jsonb_build_object('archive_id',a.id,'operation_id',p_id,'claim_id',p_claim,'file_sha256',d.file_sha256,'text_sha256',th,'payload_sha256',ph);
 IF p_step='extraction' THEN out:=out||jsonb_build_object('extraction_contract',1,'text_length',p_payload->'text_length','case_text_status',COALESCE(p_payload->'case_text_status','"available"'::jsonb)); ELSE out:=out||jsonb_build_object('extraction_claim_id',s.input->>'extraction_claim_id'); END IF;
 UPDATE public.manual_intake_steps SET state='complete',output=out,error_code=NULL WHERE operation_id=p_id AND step=p_step;
 INSERT INTO public.manual_intake_events(operation_id,actor_user_id,action,evidence) VALUES(p_id,p_actor,'archive_'||p_step,out);
 RETURN public.manual_intake_operation_view(p_id)||jsonb_build_object('found',true);
END $$;
REVOKE ALL ON FUNCTION public.manual_intake_document_complete(uuid,uuid,text,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.manual_intake_document_complete(uuid,uuid,text,uuid,text,text,jsonb) TO service_role;
CREATE FUNCTION public.manual_intake_document_step_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.manual_intake_document_archives;expected jsonb; BEGIN
 IF NEW.state='complete' AND EXISTS(SELECT 1 FROM public.manual_intake_document_dispatches d WHERE d.operation_id=NEW.operation_id AND d.claim_id=NEW.claim_id) THEN
  SELECT * INTO a FROM public.manual_intake_document_archives WHERE operation_id=NEW.operation_id AND claim_id=NEW.claim_id AND step=NEW.step;
  IF a.id IS NULL THEN RAISE EXCEPTION 'MIA_ARCHIVE_REQUIRED' USING ERRCODE='23505'; END IF;
  expected:=jsonb_build_object('archive_id',a.id,'operation_id',a.operation_id,'claim_id',a.claim_id,'file_sha256',a.file_sha256,'text_sha256',a.text_sha256,'payload_sha256',a.payload_sha256)||CASE WHEN a.step='extraction' THEN jsonb_build_object('extraction_contract',1,'text_length',a.payload->'text_length','case_text_status',COALESCE(a.payload->'case_text_status','"available"'::jsonb)) ELSE jsonb_build_object('extraction_claim_id',a.payload->'extraction_claim_id') END;
  IF NEW.output IS DISTINCT FROM expected THEN RAISE EXCEPTION 'MIA_ARCHIVE_REFERENCE_CHANGED' USING ERRCODE='23505'; END IF;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.manual_intake_document_step_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER manual_intake_document_step_guard BEFORE INSERT OR UPDATE ON public.manual_intake_steps FOR EACH ROW EXECUTE FUNCTION public.manual_intake_document_step_guard();
CREATE FUNCTION public.manual_intake_document_source(p_id uuid,p_actor uuid,p_step text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o public.manual_intake_operations;a public.manual_intake_document_archives;BEGIN
 PERFORM public.manual_intake_assert_actor(p_actor,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('manual-intake:'||p_id::text,0));
 SELECT * INTO o FROM public.manual_intake_operations WHERE id=p_id FOR SHARE;
 PERFORM public.manual_intake_assert_actor(p_actor,true,true);
 IF o.actor_user_id IS DISTINCT FROM p_actor OR o.id IS NULL THEN RAISE EXCEPTION 'MIA_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT a0.* INTO a FROM public.manual_intake_document_archives a0 JOIN public.manual_intake_steps s ON s.operation_id=a0.operation_id AND s.claim_id=a0.claim_id AND s.state='complete' AND s.output->>'archive_id'=a0.id::text WHERE a0.operation_id=p_id AND a0.step=p_step;
 IF a.id IS NULL THEN RAISE EXCEPTION 'MIA_RESULT_UNCONFIRMED' USING ERRCODE='23505'; END IF;
 RETURN jsonb_build_object('archive_id',a.id,'operation_id',p_id,'claim_id',a.claim_id,'file_sha256',a.file_sha256,'text_sha256',a.text_sha256,'text',a.content_text,'payload',a.payload);
END $$;
REVOKE ALL ON FUNCTION public.manual_intake_document_source(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.manual_intake_document_source(uuid,uuid,text) TO service_role;
CREATE FUNCTION public.manual_intake_document_result(p_id uuid,p_step text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=auth.uid();o public.manual_intake_operations;a public.manual_intake_document_archives;BEGIN
 PERFORM public.manual_intake_assert_actor(actor,false);
 PERFORM pg_advisory_xact_lock(hashtextextended('manual-intake:'||p_id::text,0));
 SELECT * INTO o FROM public.manual_intake_operations WHERE id=p_id FOR SHARE;
 PERFORM public.manual_intake_operation_access(p_id,actor,false);
 SELECT a0.* INTO a FROM public.manual_intake_document_archives a0 JOIN public.manual_intake_steps s ON s.operation_id=a0.operation_id AND s.claim_id=a0.claim_id AND s.state='complete' AND s.output->>'archive_id'=a0.id::text WHERE a0.operation_id=p_id AND a0.step=p_step;
 IF a.id IS NULL THEN RAISE EXCEPTION 'MIA_RESULT_UNCONFIRMED' USING ERRCODE='23505'; END IF;
 RETURN jsonb_build_object('archive_id',a.id,'operation_id',p_id,'claim_id',a.claim_id,'file_sha256',a.file_sha256,'text_sha256',a.text_sha256,'payload_sha256',a.payload_sha256)||CASE WHEN p_step='extraction' THEN jsonb_build_object('text_preview',a.payload->'text_preview','tags',a.payload->'tags','detected_type',a.payload->'detected_type','text_length',a.payload->'text_length','case_text_status',COALESCE(a.payload->'case_text_status','"available"'::jsonb)) ELSE jsonb_build_object('analysis',a.payload->'analysis','extraction_claim_id',a.payload->'extraction_claim_id') END;
END $$;
REVOKE ALL ON FUNCTION public.manual_intake_document_result(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.manual_intake_document_result(uuid,text) TO authenticated;
CREATE FUNCTION public.manual_intake_archive_read(p_id uuid,p_step text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=auth.uid();o public.manual_intake_operations;a public.manual_intake_document_archives;BEGIN
 PERFORM public.manual_intake_assert_actor(actor,false);
 PERFORM pg_advisory_xact_lock(hashtextextended('manual-intake:'||p_id::text,0));
 SELECT * INTO o FROM public.manual_intake_operations WHERE id=p_id FOR SHARE;
 PERFORM public.manual_intake_operation_access(p_id,actor,false);
 SELECT a0.* INTO a FROM public.manual_intake_document_archives a0 JOIN public.manual_intake_steps s ON s.operation_id=a0.operation_id AND s.claim_id=a0.claim_id AND s.state='complete' AND s.output->>'archive_id'=a0.id::text WHERE a0.operation_id=p_id AND a0.step=p_step;
 IF a.id IS NULL THEN RAISE EXCEPTION 'MIA_RESULT_UNCONFIRMED' USING ERRCODE='23505'; END IF;
 RETURN jsonb_build_object('archive_id',a.id,'operation_id',p_id,'claim_id',a.claim_id,'file_sha256',a.file_sha256,'text_sha256',a.text_sha256,'payload_sha256',a.payload_sha256,
  'origin_actor_user_id',o.actor_user_id,'archive_actor_user_id',a.actor_user_id,'content_text',a.content_text,'case_text',a.case_text,'payload',a.payload);
END $$;
REVOKE ALL ON FUNCTION public.manual_intake_archive_read(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.manual_intake_archive_read(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.manual_intake_operation_impl(p_id uuid,p_action text,p_payload jsonb,p_actor uuid,p_service boolean)
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
    (p_payload->>'step'='analysis' AND NOT EXISTS(SELECT 1 FROM public.manual_intake_steps x WHERE x.operation_id=p_id AND x.step='extraction' AND x.state='complete' AND p_payload->'input'=jsonb_build_object('file_sha256',o.draft#>>'{file,sha256}','extraction_claim_id',x.claim_id::text,'text_sha256',COALESCE(x.output->>'text_sha256',encode(sha256(convert_to(x.output->>'text','UTF8')),'hex')))))
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
   IF b->'has_extracted_document'='true'::jsonb AND NOT EXISTS(SELECT 1 FROM public.manual_intake_steps WHERE operation_id=p_id AND step='analysis' AND state='complete' AND (output->'analysis'=b->'analysis' OR EXISTS(SELECT 1 FROM public.manual_intake_document_archives a WHERE a.operation_id=p_id AND a.step='analysis' AND a.claim_id=manual_intake_steps.claim_id AND a.id::text=manual_intake_steps.output->>'archive_id' AND a.payload->'analysis'=b->'analysis')))
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
  SELECT COALESCE(st.output->>'text',a.case_text) INTO ex FROM public.manual_intake_steps st LEFT JOIN public.manual_intake_document_archives a ON a.operation_id=st.operation_id AND a.step=st.step AND a.claim_id=st.claim_id AND a.id::text=st.output->>'archive_id' WHERE st.operation_id=p_id AND st.step='extraction' AND st.state='complete';
  BEGIN
  INSERT INTO public.case_documents(id,case_id,document_type,file_name,storage_path,mime_type,file_size,uploaded_by,extracted_text)
  VALUES((f->>'document_id')::uuid,p_id,'Ordre de transit',f->>'name',f->>'path',f->>'mime',(f->>'size')::integer,o.actor_user_id,ex);
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'MIR_DOCUMENT_COLLISION' USING ERRCODE='23505'; END;
  INSERT INTO public.case_timeline_events(case_id,event_type,actor_type,actor_user_id,event_data)
  VALUES(p_id,'document_uploaded','user',actor,jsonb_build_object('document_type','Ordre de transit','file_name',f->>'name','document_id',f->>'document_id','sha256',f->>'sha256','operation_id',p_id,'uploaded_by',o.actor_user_id,'linked_by',actor));
  UPDATE public.manual_intake_operations SET document_receipt=jsonb_build_object('document_id',f->>'document_id','case_id',p_id,'storage_path',f->>'path','sha256',f->>'sha256','extraction_status',CASE WHEN ex IS NOT NULL THEN 'extracted' WHEN EXISTS(SELECT 1 FROM public.manual_intake_document_archives a WHERE a.operation_id=p_id AND a.step='extraction' AND a.payload->>'case_text_status'='legacy_prefix_invalid_utf16') THEN 'unconfirmed_legacy_prefix_utf16' ELSE 'not_requested' END),updated_at=clock_timestamp() WHERE id=p_id;
 END IF;
 INSERT INTO public.manual_intake_events(operation_id,actor_user_id,action,evidence) VALUES(p_id,actor,p_action,p_payload);
 RETURN public.manual_intake_operation_view(p_id)||jsonb_build_object('found',true)||CASE WHEN p_action='claim' THEN jsonb_build_object('claimed',true) ELSE '{}'::jsonb END;
END $$;
-- The original canonical function body is preserved except archive-aware source
-- hash, analysis provenance and case_text lookup above. No tariff/business change.
COMMIT;
