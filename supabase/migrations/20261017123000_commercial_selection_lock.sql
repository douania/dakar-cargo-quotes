-- Serialize commercial source/commit with the existing version-selection RPC.
-- No permission, source amount, tariff or engine change. The initial migration remains immutable.
BEGIN;
CREATE OR REPLACE FUNCTION public.commercial_store(p_id uuid,p_case uuid,p_source uuid,p_parent uuid,p_actor uuid,p_source_hash text,p_context_hash text,p_request jsonb,p_draft jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.quote_commercial_revisions; head public.quote_commercial_revisions; ctx jsonb;
BEGIN
 PERFORM public.commercial_actor_guard(p_actor,p_case);
 PERFORM 1 FROM public.quote_cases WHERE id=p_case FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtext('qv_select_'||p_case::text));
 PERFORM public.commercial_actor_guard(p_actor,p_case);
 SELECT * INTO old FROM public.quote_commercial_revisions WHERE id=p_id;
 IF old.id IS NOT NULL THEN
  IF old.case_id IS DISTINCT FROM p_case OR old.source_version_id IS DISTINCT FROM p_source OR old.parent_id IS DISTINCT FROM p_parent OR old.created_by IS DISTINCT FROM p_actor OR old.request IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'Operation replay mismatch' USING ERRCODE='40001'; END IF;
  RETURN to_jsonb(old);
 END IF;
 IF (SELECT status::text FROM public.quote_cases WHERE id=p_case) NOT IN('PRICED_DRAFT','HUMAN_REVIEW','QUOTED_VERSIONED') THEN RAISE EXCEPTION 'Case locked'; END IF;
 ctx:=public.commercial_source_context(p_case,p_source);
 IF ctx->>'source_hash' IS DISTINCT FROM p_source_hash OR ctx->>'context_hash' IS DISTINCT FROM p_context_hash THEN RAISE EXCEPTION 'Source context changed' USING ERRCODE='40001'; END IF;
 SELECT * INTO head FROM public.quote_commercial_revisions WHERE case_id=p_case AND source_version_id=p_source ORDER BY revision DESC LIMIT 1;
 IF head.id IS DISTINCT FROM p_parent THEN RAISE EXCEPTION 'Commercial revision changed' USING ERRCODE='40001'; END IF;
 IF p_id IS NULL OR p_draft->>'case_id' IS DISTINCT FROM p_case::text OR p_draft->>'source_version_id' IS DISTINCT FROM p_source::text
 OR p_draft->'source_snapshot' IS DISTINCT FROM ctx->'snapshot' OR jsonb_typeof(p_request) IS DISTINCT FROM 'array'
 OR jsonb_array_length(p_request) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid commercial draft'; END IF;
 INSERT INTO public.quote_commercial_revisions(id,case_id,source_version_id,parent_id,revision,created_by,source_hash,context_hash,request,draft)
 VALUES(p_id,p_case,p_source,p_parent,COALESCE(head.revision,0)+1,p_actor,p_source_hash,p_context_hash,p_request,p_draft) RETURNING * INTO old;
 RETURN to_jsonb(old);
END; $$;

CREATE OR REPLACE FUNCTION public.commercial_create_version(p_revision uuid,p_actor uuid,p_snapshot jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.quote_commercial_revisions; existing public.quotation_versions; ctx jsonb; head uuid; vid uuid:=gen_random_uuid(); n integer; snap jsonb; line jsonb; idx integer:=0;
BEGIN
 SELECT * INTO r FROM public.quote_commercial_revisions WHERE id=p_revision;
 PERFORM public.commercial_actor_guard(p_actor,r.case_id);
 PERFORM 1 FROM public.quote_cases WHERE id=r.case_id FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtext('qv_select_'||r.case_id::text));
 PERFORM public.commercial_actor_guard(p_actor,r.case_id);
 SELECT * INTO existing FROM public.quotation_versions WHERE commercial_revision_id=r.id;
 IF existing.id IS NOT NULL THEN RETURN jsonb_build_object('version_id',existing.id,'version_number',existing.version_number,'idempotent',true,'snapshot',existing.snapshot,'status_after',(SELECT status::text FROM public.quote_cases WHERE id=r.case_id)); END IF;
 IF (SELECT status::text FROM public.quote_cases WHERE id=r.case_id) NOT IN('PRICED_DRAFT','HUMAN_REVIEW','QUOTED_VERSIONED') THEN RAISE EXCEPTION 'Case locked'; END IF;
 ctx:=public.commercial_source_context(r.case_id,r.source_version_id);
 SELECT id INTO head FROM public.quote_commercial_revisions WHERE case_id=r.case_id AND source_version_id=r.source_version_id ORDER BY revision DESC LIMIT 1;
 IF head IS DISTINCT FROM r.id OR ctx->>'source_hash' IS DISTINCT FROM r.source_hash OR ctx->>'context_hash' IS DISTINCT FROM r.context_hash THEN RAISE EXCEPTION 'Commercial source or revision changed' USING ERRCODE='40001'; END IF;
 IF p_snapshot->'meta'->>'commercial_revision_id' IS DISTINCT FROM r.id::text OR p_snapshot->'meta'->>'commercial_source_version_id' IS DISTINCT FROM r.source_version_id::text
 OR jsonb_typeof(p_snapshot->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p_snapshot->'lines')>100 THEN RAISE EXCEPTION 'Invalid commercial snapshot'; END IF;
 -- Same advisory namespace as the legacy atomic insert, plus the case row lock.
 PERFORM pg_advisory_xact_lock(hashtext('qv_insert_'||r.case_id::text));
 SELECT COALESCE(max(version_number),0)+1 INTO n FROM public.quotation_versions WHERE case_id=r.case_id;
 snap:=jsonb_set(p_snapshot,'{meta}',(p_snapshot->'meta')||jsonb_build_object('version_id',vid,'version_number',n,'created_at',now()));
 UPDATE public.quotation_versions SET is_selected=false WHERE case_id=r.case_id AND is_selected;
 INSERT INTO public.quotation_versions(id,case_id,pricing_run_id,version_number,status,is_selected,snapshot,created_by,commercial_revision_id)
 VALUES(vid,r.case_id,(ctx->>'pricing_run_id')::uuid,n,'draft',true,snap,p_actor,r.id);
 PERFORM set_config('dcq.commercial_version_insert',vid::text,true);
 FOR line IN SELECT value FROM jsonb_array_elements(snap->'lines') LOOP
  INSERT INTO public.quotation_version_lines(quotation_version_id,line_order,service_code,description,quantity,unit_price,amount,currency,breakdown)
  VALUES(vid,idx,line->>'service_code',line->>'description',1,(line->>'unit_price')::numeric,(line->>'amount')::numeric,'XOF',jsonb_build_object('commercial',line->'commercial','source',line->'source'));
  idx:=idx+1;
 END LOOP;
 UPDATE public.quote_cases SET status='QUOTED_VERSIONED',updated_at=now() WHERE id=r.case_id;
 INSERT INTO public.case_timeline_events(case_id,event_type,event_data,actor_type,actor_user_id)
 VALUES(r.case_id,'quotation_version_created',jsonb_build_object('version_id',vid,'version_number',n,'commercial_revision_id',r.id),'user',p_actor);
 RETURN jsonb_build_object('version_id',vid,'version_number',n,'idempotent',false,'snapshot',snap,'status_after','QUOTED_VERSIONED');
END; $$;
COMMIT;
