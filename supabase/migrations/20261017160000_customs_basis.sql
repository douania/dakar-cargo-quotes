BEGIN;
-- Scoped append-only decisions. Existing facts, rates, roles and policies are not changed.
CREATE TABLE public.quote_customs_basis (
 id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES public.quote_cases(id),
 parent_id uuid REFERENCES public.quote_customs_basis(id), revision integer NOT NULL CHECK(revision>0),
 context_hash text NOT NULL CHECK(context_hash ~ '^[a-f0-9]{32}$'), context jsonb NOT NULL,
 decision jsonb NOT NULL CHECK(jsonb_typeof(decision)='object'),
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(case_id,revision), CHECK(octet_length(context::text)<2000000), CHECK(octet_length(decision::text)<10000)
);
ALTER TABLE public.quote_customs_basis ENABLE ROW LEVEL SECURITY;
CREATE POLICY customs_basis_read ON public.quote_customs_basis FOR SELECT TO authenticated USING(public.has_case_read_access(case_id));
REVOKE ALL ON public.quote_customs_basis FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.quote_customs_basis TO authenticated;
GRANT SELECT,INSERT ON public.quote_customs_basis TO service_role;
CREATE TRIGGER customs_basis_immutable BEFORE UPDATE OR DELETE ON public.quote_customs_basis FOR EACH ROW EXECUTE FUNCTION public.commercial_immutable();

CREATE FUNCTION public.customs_basis_context(p_case uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 SELECT jsonb_build_object(
  'scope',jsonb_build_object('request_type',c.request_type,'thread_id',c.thread_id,'created_by',c.created_by,'assigned_to',c.assigned_to,
   'lot_count',(SELECT count(*) FROM public.quote_request_lines l WHERE l.case_id=c.id),
   'package',(SELECT value_text FROM public.quote_facts WHERE case_id=c.id AND is_current AND fact_key='service.package' LIMIT 1),
   'incoterm',(SELECT upper(value_text) FROM public.quote_facts WHERE case_id=c.id AND is_current AND fact_key='routing.incoterm' LIMIT 1)),
  'facts',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM public.quote_facts f WHERE f.case_id=c.id AND f.is_current),'[]'::jsonb),
  'attachments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'filename',a.filename,'extracted_data',a.extracted_data) ORDER BY a.id)
   FROM public.email_attachments a JOIN public.emails e ON e.id=a.email_id WHERE e.thread_ref=c.thread_id),'[]'::jsonb),
  'profiles',COALESCE((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.code_normalized) FROM public.hs_codes h WHERE left(h.code_normalized,6) IN (
   SELECT DISTINCT left(regexp_replace(v#>>'{}','\D','','g'),6) FROM public.email_attachments a JOIN public.emails e ON e.id=a.email_id,
    LATERAL jsonb_path_query(a.extracted_data,'$.**.hs_code') v WHERE e.thread_ref=c.thread_id AND length(regexp_replace(v#>>'{}','\D','','g'))>=6)),'[]'::jsonb),
  'regimes',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.code) FROM public.customs_regimes r WHERE r.is_active),'[]'::jsonb)
 ) INTO result FROM public.quote_cases c WHERE c.id=p_case;
 IF result IS NULL OR octet_length(result::text)>=2000000 OR jsonb_array_length(result->'attachments')>100 OR jsonb_array_length(result->'profiles')>100 THEN RAISE EXCEPTION 'Customs source unavailable or too large'; END IF;
 RETURN result;
END; $$;

CREATE FUNCTION public.customs_basis_read(p_case uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx jsonb; h public.quote_customs_basis;
BEGIN
 IF auth.role() IS DISTINCT FROM 'authenticated' OR NOT public.has_case_read_access(p_case) THEN RAISE EXCEPTION 'Customs read forbidden' USING ERRCODE='42501'; END IF;
 ctx:=public.customs_basis_context(p_case);
 SELECT * INTO h FROM public.quote_customs_basis WHERE case_id=p_case ORDER BY revision DESC LIMIT 1;
 RETURN jsonb_build_object('context',ctx,'context_hash',md5(ctx::text),'head',CASE WHEN h.id IS NULL THEN NULL ELSE to_jsonb(h)-'context' END,'can_write',public.has_case_write_access(p_case));
END; $$;

CREATE FUNCTION public.customs_basis_store(p_actor uuid,p_case uuid,p_id uuid,p_parent uuid,p_context_hash text,p_decision jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.quote_customs_basis; old public.quote_customs_basis; ctx jsonb; source_id text;
BEGIN
 PERFORM public.commercial_actor_guard(p_actor,p_case);
 PERFORM 1 FROM public.quote_cases WHERE id=p_case FOR UPDATE;
 PERFORM public.commercial_actor_guard(p_actor,p_case);
 SELECT * INTO old FROM public.quote_customs_basis WHERE id=p_id;
 IF old.id IS NOT NULL THEN
  IF old.case_id IS DISTINCT FROM p_case OR old.parent_id IS DISTINCT FROM p_parent OR old.created_by IS DISTINCT FROM p_actor OR old.context_hash IS DISTINCT FROM p_context_hash OR old.decision IS DISTINCT FROM p_decision THEN RAISE EXCEPTION 'Customs replay mismatch' USING ERRCODE='40001'; END IF;
  RETURN to_jsonb(old)-'context';
 END IF;
 IF (SELECT status::text FROM public.quote_cases WHERE id=p_case) NOT IN('NEED_INFO','FACTS_PARTIAL','READY_TO_PRICE','ACK_READY_FOR_PRICING','PRICED_DRAFT','HUMAN_REVIEW','QUOTED_VERSIONED') THEN RAISE EXCEPTION 'Case locked'; END IF;
 -- Prevent phantoms and edits between the context check and append. Short transaction only.
 LOCK TABLE public.email_attachments,public.emails,public.hs_codes,public.customs_regimes,public.quote_facts,public.quote_request_lines IN SHARE MODE;
 ctx:=public.customs_basis_context(p_case);
 IF md5(ctx::text) IS DISTINCT FROM p_context_hash THEN RAISE EXCEPTION 'Customs sources changed' USING ERRCODE='40001'; END IF;
 SELECT * INTO h FROM public.quote_customs_basis WHERE case_id=p_case ORDER BY revision DESC LIMIT 1;
 IF h.id IS DISTINCT FROM p_parent THEN RAISE EXCEPTION 'Customs decision changed' USING ERRCODE='40001'; END IF;
 IF p_id IS NULL OR ctx->'scope'->>'request_type' !~ '^AIR_IMPORT(_|$)' OR (ctx->'scope'->>'lot_count')::integer>1
 OR ctx->'scope'->>'package' IS DISTINCT FROM 'AIR_IMPORT_DDP' OR ctx->'scope'->>'incoterm' IS DISTINCT FROM 'DDP'
 OR jsonb_typeof(p_decision) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_decision))<>8
 OR NOT(p_decision ?& ARRAY['source_attachment_ids','caf_xof','valuation_basis','hs_digits','regime_code','exemptions_reviewed','commitment','note'])
 OR jsonb_typeof(p_decision->'caf_xof') IS DISTINCT FROM 'number' OR (p_decision->>'caf_xof')::numeric<=0 OR (p_decision->>'caf_xof')::numeric>=1e12
 OR jsonb_typeof(p_decision->'hs_digits') IS DISTINCT FROM 'string' OR jsonb_typeof(p_decision->'regime_code') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_decision->'commitment') IS DISTINCT FROM 'string' OR jsonb_typeof(p_decision->'valuation_basis') IS DISTINCT FROM 'string' OR jsonb_typeof(p_decision->'note') IS DISTINCT FROM 'string'
 OR round((p_decision->>'caf_xof')::numeric,2)<>(p_decision->>'caf_xof')::numeric
 OR length(btrim(p_decision->>'valuation_basis')) NOT BETWEEN 8 AND 1000 OR length(btrim(p_decision->>'note')) NOT BETWEEN 8 AND 1000
 OR p_decision->>'hs_digits' !~ '^(\d{6}|\d{8}|\d{10})$' OR p_decision->>'regime_code' !~ '^[A-Z0-9][A-Z0-9._/-]{0,31}$'
 OR p_decision->'exemptions_reviewed' IS DISTINCT FROM 'true'::jsonb OR p_decision->>'commitment' NOT IN('estimated','confirmed')
 OR (length(p_decision->>'hs_digits')<>10 AND p_decision->>'commitment'<>'estimated')
 OR jsonb_typeof(p_decision->'source_attachment_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(p_decision->'source_attachment_ids') NOT BETWEEN 1 AND 20
 THEN RAISE EXCEPTION 'Invalid customs decision'; END IF;
 IF (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_decision->'source_attachment_ids'))<>jsonb_array_length(p_decision->'source_attachment_ids') THEN RAISE EXCEPTION 'Duplicate customs source'; END IF;
 FOR source_id IN SELECT jsonb_array_elements_text(p_decision->'source_attachment_ids') LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(ctx->'attachments') a WHERE a->>'id'=source_id) THEN RAISE EXCEPTION 'Cross-case customs source'; END IF;
 END LOOP;
 INSERT INTO public.quote_customs_basis(id,case_id,parent_id,revision,context_hash,context,decision,created_by)
 VALUES(p_id,p_case,p_parent,COALESCE(h.revision,0)+1,p_context_hash,ctx,p_decision,p_actor) RETURNING * INTO old;
 INSERT INTO public.case_timeline_events(case_id,event_type,event_data,actor_type,actor_user_id)
 VALUES(p_case,'customs_basis_adopted',jsonb_build_object('basis_id',p_id,'revision',old.revision,'context_hash',p_context_hash),'user',p_actor);
 RETURN to_jsonb(old)-'context';
END; $$;

CREATE FUNCTION public.customs_basis_get(p_actor uuid,p_case uuid,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.quote_customs_basis; ctx jsonb;
BEGIN
 PERFORM public.commercial_actor_guard(p_actor,p_case);
 SELECT * INTO h FROM public.quote_customs_basis WHERE case_id=p_case ORDER BY revision DESC LIMIT 1;
 IF h.id IS DISTINCT FROM p_id THEN RAISE EXCEPTION 'Customs decision changed' USING ERRCODE='40001'; END IF;
 ctx:=public.customs_basis_context(p_case);
 IF md5(ctx::text) IS DISTINCT FROM h.context_hash THEN RAISE EXCEPTION 'Customs sources changed' USING ERRCODE='40001'; END IF;
 RETURN jsonb_build_object('head',to_jsonb(h)-'context','context',ctx);
END; $$;

CREATE FUNCTION public.customs_basis_run_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE state jsonb; b jsonb;
BEGIN
 IF TG_OP='UPDATE' AND OLD.outputs_json ? 'customs_basis' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
  RAISE EXCEPTION 'Immutable customs pricing run' USING ERRCODE='42501';
 END IF;
 IF NEW.outputs_json ? 'customs_basis' THEN
  b:=NEW.outputs_json->'customs_basis';
  PERFORM 1 FROM public.quote_cases WHERE id=NEW.case_id FOR UPDATE;
  LOCK TABLE public.email_attachments,public.emails,public.hs_codes,public.customs_regimes,public.quote_facts,public.quote_request_lines IN SHARE MODE;
  state:=public.customs_basis_get(NEW.created_by,NEW.case_id,(b->>'id')::uuid);
  IF b->>'case_id' IS DISTINCT FROM NEW.case_id::text OR b->>'context_hash' IS DISTINCT FROM state->'head'->>'context_hash'
   OR b->'decision' IS DISTINCT FROM state->'head'->'decision' OR b->>'created_by' IS DISTINCT FROM state->'head'->>'created_by'
   OR NEW.engine_request->'customs_basis_ref'->>'id' IS DISTINCT FROM b->>'id'
   OR NEW.engine_request->'customs_basis' IS DISTINCT FROM b OR NEW.engine_response->'customs_basis' IS DISTINCT FROM b
  THEN RAISE EXCEPTION 'Customs run proof mismatch' USING ERRCODE='40001'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER customs_basis_run_guard BEFORE INSERT OR UPDATE ON public.pricing_runs FOR EACH ROW EXECUTE FUNCTION public.customs_basis_run_guard();

REVOKE ALL ON FUNCTION public.customs_basis_context(uuid),public.customs_basis_run_guard(),public.customs_basis_read(uuid),public.customs_basis_store(uuid,uuid,uuid,uuid,text,jsonb),public.customs_basis_get(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.customs_basis_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customs_basis_store(uuid,uuid,uuid,uuid,text,jsonb),public.customs_basis_get(uuid,uuid,uuid) TO service_role;
COMMIT;
