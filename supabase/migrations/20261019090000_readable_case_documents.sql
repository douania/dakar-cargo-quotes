BEGIN;
-- Coverage concerns manually added case_documents. It is not an OCR success or a pricing decision.
CREATE TABLE public.case_document_analysis_runs (
 id uuid PRIMARY KEY, sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 job_id uuid UNIQUE REFERENCES public.case_puzzle_jobs(id),
 case_id uuid NOT NULL REFERENCES public.quote_cases(id), actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 mode text NOT NULL CHECK(mode IN('complete','readable')), context_hash text NOT NULL CHECK(context_hash ~ '^[a-f0-9]{32}$'),
 context jsonb NOT NULL CHECK(pg_column_size(context)<2000000), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.case_document_analysis_results (
 analysis_id uuid PRIMARY KEY REFERENCES public.case_document_analysis_runs(id),
 outcome text NOT NULL CHECK(outcome IN('complete','partial','failed')),
 result jsonb NOT NULL CHECK(pg_column_size(result)<2000000), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX case_document_analysis_case ON public.case_document_analysis_runs(case_id,sequence DESC);
ALTER TABLE public.case_document_analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_document_analysis_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.case_document_analysis_runs,public.case_document_analysis_results FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.document_analysis_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Document analysis history is append-only' USING ERRCODE='42501'; END; $$;
CREATE TRIGGER document_analysis_run_immutable BEFORE UPDATE OR DELETE ON public.case_document_analysis_runs
 FOR EACH ROW EXECUTE FUNCTION public.document_analysis_immutable();
CREATE TRIGGER document_analysis_result_immutable BEFORE UPDATE OR DELETE ON public.case_document_analysis_results
 FOR EACH ROW EXECUTE FUNCTION public.document_analysis_immutable();

CREATE FUNCTION public.document_analysis_actor(p_actor uuid,p_case uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_actor IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.app_roles a JOIN auth.users u ON u.id=a.user_id
  WHERE a.user_id=p_actor AND a.role IN('workspace_operator','role_admin') AND (u.banned_until IS NULL OR u.banned_until<=now())
 ) OR NOT EXISTS(SELECT 1 FROM public.quote_cases WHERE id=p_case)
 THEN RAISE EXCEPTION 'Document analysis forbidden' USING ERRCODE='42501'; END IF;
END; $$;

-- Same sanitation, ECMAScript trim characters and exact legacy markers as hasExtractedText.
CREATE FUNCTION public.document_analysis_has_text(p_text text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE cleaned text; controls text; whitespace text;
BEGIN
 IF p_text IS NULL THEN RETURN false; END IF;
 SELECT string_agg(chr(i),'') INTO controls FROM generate_series(1,31) i WHERE i NOT IN(9,10,13);
 SELECT string_agg(chr(i),'') INTO whitespace FROM unnest(ARRAY[9,10,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279]) i;
 cleaned:=btrim(replace(translate(p_text,controls,''),'\u0000',''),whitespace);
 RETURN cleaned<>'' AND cleaned<>ALL(ARRAY[
  '[Extraction echouee]','[OCR vide]','[PDF - extraction indisponible]',
  '[PDF détecté - extraction texte indisponible]', '[Erreur lors de l''extraction IA du PDF]',
  '[Erreur lors de la lecture du PDF]','[Erreur lors de la lecture du fichier Excel]',
  '[Format non supporté pour l''extraction de texte]','[Format non supporte pour l''extraction de texte]'
 ]);
END; $$;

CREATE FUNCTION public.document_analysis_context(p_case uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('scope','manual_case_documents','case_id',c.id,'thread_id',c.thread_id,
 'documents',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'name',d.file_name,
  'readable',public.document_analysis_has_text(d.extracted_text),
  'document_type',d.document_type,'text_hash',encode(sha256(convert_to(COALESCE(d.extracted_text,'<NULL>'),'UTF8')),'hex'),
  'source_hash',md5((to_jsonb(d)-'extracted_text')::text)) ORDER BY d.id)
  FROM public.case_documents d WHERE d.case_id=c.id),'[]'::jsonb),
 'emails',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'from_address',e.from_address,'to_addresses',e.to_addresses,
  'subject',e.subject,'sent_at',e.sent_at,'is_quotation_request',e.is_quotation_request,
  'text_hash',encode(sha256(convert_to(COALESCE(e.body_text,'<NULL>'),'UTF8')),'hex'),
  'readable',public.document_analysis_has_text(e.body_text) AND
    NOT (split_part(lower(COALESCE(e.from_address,'')),'@',2) LIKE '%sodatra.sn%' OR
         split_part(lower(COALESCE(e.from_address,'')),'@',2) LIKE '%sodatra.com%'),
  'source_hash',md5(jsonb_build_object('body',e.body_text,'subject',e.subject,'from',e.from_address,'sent_at',e.sent_at,'thread_ref',e.thread_ref)::text)) ORDER BY e.id)
  FROM public.emails e WHERE e.thread_ref=c.thread_id),'[]'::jsonb))
 FROM public.quote_cases c WHERE c.id=p_case;
$$;

CREATE FUNCTION public.case_document_analysis_inspect(p_actor uuid,p_case uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx jsonb; h public.case_document_analysis_runs; r public.case_document_analysis_results;
BEGIN
 PERFORM public.document_analysis_actor(p_actor,p_case);
 ctx:=public.document_analysis_context(p_case);
 SELECT * INTO h FROM public.case_document_analysis_runs WHERE case_id=p_case ORDER BY sequence DESC LIMIT 1;
 SELECT * INTO r FROM public.case_document_analysis_results WHERE analysis_id=h.id;
 RETURN jsonb_build_object('contract',1,'context_hash',md5(ctx::text),'scope','manual_case_documents',
  'documents',ctx->'documents',
  'readable_email_count',(SELECT count(*) FROM jsonb_array_elements(ctx->'emails') e WHERE e->'readable'='true'),
  'latest',CASE WHEN h.id IS NULL THEN NULL ELSE jsonb_build_object('id',h.id,'mode',h.mode,
   'state',COALESCE(r.outcome,'pending'),'created_at',h.created_at,'completed_at',r.created_at,
   'context_hash',h.context_hash,'sources_changed',h.context_hash IS DISTINCT FROM md5(ctx::text),
   'documents',h.context->'documents','actor_user_id',h.actor_user_id) END);
END; $$;

CREATE FUNCTION public.case_document_analysis_begin(p_actor uuid,p_case uuid,p_id uuid,p_hash text,p_mode text,p_job uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx jsonb; h public.case_document_analysis_runs; readable bigint; pending bigint;
BEGIN
 PERFORM public.document_analysis_actor(p_actor,p_case);
 -- NO KEY UPDATE serializes the dossier without blocking the source FK's KEY SHARE.
 PERFORM 1 FROM public.quote_cases WHERE id=p_case FOR NO KEY UPDATE;
 LOCK TABLE public.case_documents,public.emails IN SHARE MODE;
 PERFORM public.document_analysis_actor(p_actor,p_case);
 ctx:=public.document_analysis_context(p_case);
 IF p_id IS NULL OR p_mode NOT IN('complete','readable') OR p_mode IS NULL OR p_hash IS DISTINCT FROM md5(ctx::text)
 THEN RAISE EXCEPTION 'Document sources changed; review the sources again' USING ERRCODE='40001'; END IF;
 IF p_job IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.case_puzzle_jobs WHERE id=p_job AND case_id=p_case AND created_by=p_actor
  AND status='running' AND request_params->'document_analysis'=jsonb_build_object('mode',p_mode,'context_hash',p_hash))
 THEN RAISE EXCEPTION 'Document analysis job does not match the selected sources' USING ERRCODE='40001'; END IF;
 SELECT * INTO h FROM public.case_document_analysis_runs WHERE case_id=p_case ORDER BY sequence DESC LIMIT 1;
 IF h.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.case_document_analysis_results WHERE analysis_id=h.id)
 THEN RAISE EXCEPTION 'Document analysis is already pending; its outcome must be confirmed before retrying' USING ERRCODE='PT409'; END IF;
 SELECT count(*) FILTER(WHERE x->'readable'='true'),count(*) FILTER(WHERE x->'readable'<>'true') INTO readable,pending
 FROM jsonb_array_elements(ctx->'documents') x;
 readable:=readable+(SELECT count(*) FROM jsonb_array_elements(ctx->'emails') x WHERE x->'readable'='true');
 IF readable=0 THEN RAISE EXCEPTION 'No readable source is available' USING ERRCODE='PT409'; END IF;
 IF (p_mode='complete' AND pending<>0) OR (p_mode='readable' AND pending=0)
 THEN RAISE EXCEPTION 'Document coverage no longer matches the selected analysis mode' USING ERRCODE='40001'; END IF;
 INSERT INTO public.case_document_analysis_runs(id,job_id,case_id,actor_user_id,mode,context_hash,context)
 VALUES(p_id,p_job,p_case,p_actor,p_mode,p_hash,ctx);
 UPDATE public.quote_gaps SET is_blocking=true,priority='critical',updated_at=clock_timestamp()
 WHERE case_id=p_case AND gap_key='documents.analysis_coverage' AND status='open';
 IF NOT EXISTS(SELECT 1 FROM public.quote_gaps WHERE case_id=p_case AND gap_key='documents.analysis_coverage' AND status='open') THEN
  INSERT INTO public.quote_gaps(case_id,gap_key,gap_category,is_blocking,priority,question_fr,question_en,status)
  VALUES(p_case,'documents.analysis_coverage','documents',true,'critical',
   'La lecture de tous les documents manuels doit être confirmée par une analyse complète.',
   'Confirm all manually added documents through a complete analysis.','open');
 END IF;
 INSERT INTO public.case_timeline_events(case_id,event_type,actor_type,actor_user_id,event_data)
 VALUES(p_case,'fact_updated','user',p_actor,jsonb_build_object('source','document-analysis','analysis_id',p_id,'stage','started','mode',p_mode,
  'scope','manual_case_documents','context_hash',p_hash,'documents',ctx->'documents'));
 RETURN jsonb_build_object('id',p_id,'mode',p_mode,'context_hash',p_hash,'documents',ctx->'documents','emails',ctx->'emails');
END; $$;

-- Job rows are owner-editable. A job's completed flag is never evidence for a managed analysis.
CREATE FUNCTION public.case_document_analysis_job(p_actor uuid,p_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.case_puzzle_jobs; h public.case_document_analysis_runs; r public.case_document_analysis_results;
BEGIN
 SELECT * INTO j FROM public.case_puzzle_jobs WHERE id=p_job AND created_by=p_actor;
 IF j.id IS NULL THEN RAISE EXCEPTION 'Document job inaccessible' USING ERRCODE='42501'; END IF;
 PERFORM public.document_analysis_actor(p_actor,j.case_id);
 SELECT * INTO h FROM public.case_document_analysis_runs WHERE job_id=p_job;
 SELECT * INTO r FROM public.case_document_analysis_results WHERE analysis_id=h.id;
 RETURN jsonb_build_object('managed',h.id IS NOT NULL OR j.request_params ? 'document_analysis',
  'pending',h.id IS NOT NULL AND r.analysis_id IS NULL,
  'outcome',r.outcome,
  'result',CASE WHEN r.outcome IN('complete','partial') THEN r.result ELSE NULL END);
END; $$;

CREATE FUNCTION public.document_analysis_gap_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.gap_key='documents.analysis_coverage'
 AND EXISTS(SELECT 1 FROM public.case_document_analysis_runs WHERE case_id=OLD.case_id)
 AND current_setting('dcq.document_analysis_finish',true) IS DISTINCT FROM OLD.case_id::text
 AND (TG_OP='DELETE' OR NEW.gap_key<>'documents.analysis_coverage' OR NEW.case_id IS DISTINCT FROM OLD.case_id OR
      NEW.status IS DISTINCT FROM 'open' OR NEW.is_blocking IS DISTINCT FROM true)
 THEN RAISE EXCEPTION 'Document coverage requires a confirmed complete analysis' USING ERRCODE='PT409'; END IF;
 IF TG_OP='UPDATE' AND NEW.gap_key='documents.analysis_coverage'
 AND EXISTS(SELECT 1 FROM public.case_document_analysis_runs WHERE case_id=NEW.case_id)
 AND current_setting('dcq.document_analysis_finish',true) IS DISTINCT FROM NEW.case_id::text
 AND (NEW.status IS DISTINCT FROM 'open' OR NEW.is_blocking IS DISTINCT FROM true)
 THEN RAISE EXCEPTION 'Document coverage requires a confirmed complete analysis' USING ERRCODE='PT409'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER document_analysis_gap_guard BEFORE UPDATE OR DELETE ON public.quote_gaps
 FOR EACH ROW EXECUTE FUNCTION public.document_analysis_gap_guard();

CREATE FUNCTION public.case_document_analysis_finish(p_actor uuid,p_case uuid,p_id uuid,p_patch jsonb,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.case_document_analysis_runs; ctx jsonb; frozen boolean; current_status text; next_status text; outcome text; response jsonb; coverage jsonb;
BEGIN
 PERFORM public.document_analysis_actor(p_actor,p_case);
 SELECT status INTO current_status FROM public.quote_cases WHERE id=p_case FOR NO KEY UPDATE;
 LOCK TABLE public.case_documents,public.emails IN SHARE MODE;
 PERFORM public.document_analysis_actor(p_actor,p_case);
 SELECT * INTO h FROM public.case_document_analysis_runs WHERE id=p_id AND case_id=p_case AND actor_user_id=p_actor;
 IF h.id IS NULL OR h.id IS DISTINCT FROM (SELECT id FROM public.case_document_analysis_runs WHERE case_id=p_case ORDER BY sequence DESC LIMIT 1)
 OR EXISTS(SELECT 1 FROM public.case_document_analysis_results WHERE analysis_id=p_id)
 THEN RAISE EXCEPTION 'Document analysis attempt is no longer current' USING ERRCODE='40001'; END IF;
 ctx:=public.document_analysis_context(p_case);
 IF md5(ctx::text) IS DISTINCT FROM h.context_hash THEN RAISE EXCEPTION 'Document sources changed during analysis; review and retry' USING ERRCODE='40001'; END IF;
 IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR jsonb_typeof(p_result) IS DISTINCT FROM 'object'
 OR p_result->>'case_id' IS DISTINCT FROM p_case::text OR jsonb_typeof(p_result->'ready_to_price') IS DISTINCT FROM 'boolean'
 OR NOT(p_patch ?& ARRAY['status','request_type','facts_count','gaps_count','puzzle_completeness'])
 THEN RAISE EXCEPTION 'Invalid document analysis result'; END IF;
 outcome:=CASE WHEN h.mode='complete' THEN 'complete' ELSE 'partial' END;
 frozen:=current_status IN('DECISIONS_PENDING','DECISIONS_COMPLETE','ACK_READY_FOR_PRICING','PRICED_DRAFT','HUMAN_REVIEW','SENT','ACCEPTED','REJECTED','ARCHIVED');
 next_status:=CASE WHEN frozen THEN current_status WHEN outcome='partial' THEN 'NEED_INFO' ELSE p_patch->>'status' END;
 PERFORM set_config('dcq.document_analysis_finish',p_case::text,true);
 IF outcome='complete' THEN
  UPDATE public.quote_gaps SET status='resolved',resolved_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE case_id=p_case AND gap_key='documents.analysis_coverage' AND status IN('open','pending_response');
 END IF;
 PERFORM set_config('dcq.document_analysis_finish','',true);
 coverage:=jsonb_build_object('id',p_id,'mode',h.mode,'state',outcome,'scope','manual_case_documents','context_hash',h.context_hash,
  'documents',h.context->'documents','actor_user_id',p_actor);
 response:=p_result||jsonb_build_object('new_status',next_status,'document_analysis',coverage,
  'ready_to_price',outcome='complete' AND COALESCE((p_result->>'ready_to_price')::boolean,false));
 UPDATE public.quote_cases SET status=(jsonb_populate_record(NULL::public.quote_cases,jsonb_build_object('status',next_status))).status,
  request_type=(jsonb_populate_record(NULL::public.quote_cases,p_patch)).request_type,
  facts_count=(p_patch->>'facts_count')::integer,gaps_count=(p_patch->>'gaps_count')::integer,
  puzzle_completeness=(p_patch->>'puzzle_completeness')::integer,last_activity_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE id=p_case;
 INSERT INTO public.case_document_analysis_results(analysis_id,outcome,result) VALUES(p_id,outcome,response);
 INSERT INTO public.case_timeline_events(case_id,event_type,actor_type,actor_user_id,event_data)
 VALUES(p_case,'fact_updated','system',p_actor,jsonb_build_object('source','document-analysis','analysis_id',p_id,'stage',outcome,
  'scope','manual_case_documents','context_hash',h.context_hash,'documents',h.context->'documents'));
 RETURN response;
END; $$;

CREATE FUNCTION public.case_document_analysis_fail(p_actor uuid,p_case uuid,p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Document analysis forbidden' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.quote_cases WHERE id=p_case FOR NO KEY UPDATE;
 IF EXISTS(SELECT 1 FROM public.case_document_analysis_runs WHERE id=p_id AND case_id=p_case AND actor_user_id=p_actor)
 AND NOT EXISTS(SELECT 1 FROM public.case_document_analysis_results WHERE analysis_id=p_id) THEN
  INSERT INTO public.case_document_analysis_results(analysis_id,outcome,result)
  VALUES(p_id,'failed',jsonb_build_object('case_id',p_case,'document_analysis',jsonb_build_object('id',p_id,'state','failed','scope','manual_case_documents')));
  INSERT INTO public.case_timeline_events(case_id,event_type,actor_type,actor_user_id,event_data)
  VALUES(p_case,'fact_updated','system',p_actor,jsonb_build_object('source','document-analysis','analysis_id',p_id,'stage','failed'));
 END IF;
END; $$;

CREATE FUNCTION public.assert_case_document_analysis_complete(p_case uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.case_document_analysis_runs; r public.case_document_analysis_results;
BEGIN
 SELECT * INTO h FROM public.case_document_analysis_runs WHERE case_id=p_case ORDER BY sequence DESC LIMIT 1;
 IF h.id IS NULL THEN RETURN; END IF;
 SELECT * INTO r FROM public.case_document_analysis_results WHERE analysis_id=h.id;
 IF r.outcome IS DISTINCT FROM 'complete' OR h.context_hash IS DISTINCT FROM md5(public.document_analysis_context(p_case)::text)
 THEN RAISE EXCEPTION 'Document analysis is incomplete or sources changed; complete analysis before a new quotation' USING ERRCODE='PT409'; END IF;
END; $$;
DO $freshness$
DECLARE definition text; target regprocedure:='public.assert_quotation_run_facts_current(uuid,uuid)'::regprocedure;
BEGIN
 definition:=replace(pg_get_functiondef(target),chr(13),'');
 IF md5(definition)<>'c115d4b3520cf19b40dccb8d2e47d984' THEN RAISE EXCEPTION 'Unexpected quotation freshness guard'; END IF;
 EXECUTE replace(definition,E'BEGIN\n',E'BEGIN\n PERFORM public.assert_case_document_analysis_complete(p_case);\n');
END $freshness$;
REVOKE ALL ON FUNCTION public.document_analysis_immutable(),public.document_analysis_actor(uuid,uuid),
 public.document_analysis_has_text(text),public.document_analysis_context(uuid),public.document_analysis_gap_guard(),
 public.case_document_analysis_inspect(uuid,uuid),public.case_document_analysis_begin(uuid,uuid,uuid,text,text,uuid),public.case_document_analysis_job(uuid,uuid),
 public.case_document_analysis_finish(uuid,uuid,uuid,jsonb,jsonb),public.case_document_analysis_fail(uuid,uuid,uuid),
 public.assert_case_document_analysis_complete(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.case_document_analysis_inspect(uuid,uuid),public.case_document_analysis_begin(uuid,uuid,uuid,text,text,uuid),public.case_document_analysis_job(uuid,uuid),
 public.case_document_analysis_finish(uuid,uuid,uuid,jsonb,jsonb),public.case_document_analysis_fail(uuid,uuid,uuid),
 public.assert_case_document_analysis_complete(uuid) TO service_role;
COMMIT;
