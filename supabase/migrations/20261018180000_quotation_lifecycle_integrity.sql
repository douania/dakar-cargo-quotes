-- New writes require the saved calculation basis. Historical snapshots remain untouched.
BEGIN;
-- Case before fact/key locks: the fact FK otherwise inverts the canonical writer.
-- Patch only the two verified definitions; signatures, guards and ACL stay intact.
DO $lock_order$
DECLARE item record; target regprocedure; definition text; prefix text;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('public.supersede_fact(uuid,text,text,text,numeric,jsonb,timestamptz,text,uuid,uuid,text,numeric)',
   '9c9143ed0dff18c70ad5f0a6260f7bae',
   '  PERFORM pg_advisory_xact_lock(hashtext(p_case_id::text || p_fact_key));'),
  ('public.promote_scenario_assumption(uuid,uuid,uuid,text,text,text,text,boolean,text,text,jsonb,boolean,uuid,uuid,text)',
   '14d9cba63287272b28f4aca3fcf62f80',
   '  perform pg_advisory_xact_lock(hashtext(''quote_fact_promotion_'' || p_case_id::text));')
 ) AS patch(signature,digest,anchor) LOOP
  target:=item.signature::regprocedure;
  definition:=replace(pg_get_functiondef(target),chr(13),'');
  IF md5(definition)<>item.digest OR length(definition)-length(replace(definition,item.anchor,''))<>length(item.anchor)
  THEN RAISE EXCEPTION 'Unexpected fact writer definition: %',item.signature; END IF;
  IF has_function_privilege('anon',target,'execute') OR has_function_privilege('authenticated',target,'execute')
   OR NOT has_function_privilege('service_role',target,'execute')
  THEN RAISE EXCEPTION 'Unexpected fact writer ACL: %',item.signature; END IF;
  prefix:=E'  -- STRUCTURAL_PATCH_ALLOWED: case before dependent locks, shared with quotation writes.\n'
   ||E'  PERFORM 1 FROM public.quote_cases WHERE id=p_case_id FOR UPDATE;\n';
  EXECUTE replace(definition,item.anchor,prefix||item.anchor);
 END LOOP;
END $lock_order$;
CREATE FUNCTION public.assert_quotation_run_facts_current(p_case uuid,p_run uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.pricing_runs; f public.quote_facts; saved jsonb; field text;
BEGIN
 SELECT * INTO r FROM public.pricing_runs WHERE id=p_run AND case_id=p_case AND status='success' FOR SHARE;
 IF r.id IS NULL OR jsonb_typeof(r.facts_snapshot) IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'Saved pricing facts are not comparable; recalculate before a new quotation' USING ERRCODE='PT409'; END IF;
 PERFORM 1 FROM public.quote_facts WHERE case_id=p_case AND is_current ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.quote_request_lines WHERE case_id=p_case ORDER BY id FOR SHARE;
 IF jsonb_array_length(r.facts_snapshot)<>(SELECT count(*) FROM public.quote_facts WHERE case_id=p_case AND is_current)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.facts_snapshot) x GROUP BY x->>'id' HAVING count(*)>1)
 THEN RAISE EXCEPTION 'Pricing facts changed; recalculate before a new quotation' USING ERRCODE='PT409'; END IF;
 FOR f IN SELECT * FROM public.quote_facts WHERE case_id=p_case AND is_current LOOP
  SELECT x INTO saved FROM jsonb_array_elements(r.facts_snapshot) x WHERE x->>'id'=f.id::text;
  IF saved IS NULL OR COALESCE(saved->>'key',saved->>'fact_key') IS DISTINCT FROM f.fact_key
  OR COALESCE(saved->>'category',saved->>'fact_category') IS DISTINCT FROM f.fact_category
  THEN RAISE EXCEPTION 'Saved pricing facts are not comparable; recalculate before a new quotation' USING ERRCODE='PT409'; END IF;
  FOREACH field IN ARRAY ARRAY['value_text','value_number','value_json','value_date','source_type'] LOOP
   IF COALESCE(saved->field,'null'::jsonb) IS DISTINCT FROM COALESCE(to_jsonb(f)->field,'null'::jsonb)
   THEN RAISE EXCEPTION 'Pricing facts changed; recalculate before a new quotation' USING ERRCODE='PT409'; END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['confidence'] LOOP
   IF saved ? field AND saved->field IS DISTINCT FROM to_jsonb(f)->field
   THEN RAISE EXCEPTION 'Pricing fact validation changed; recalculate before a new quotation' USING ERRCODE='PT409'; END IF;
  END LOOP;
  IF saved ? 'is_validated' AND saved->'is_validated' IS DISTINCT FROM to_jsonb(COALESCE(f.is_validated,false))
  THEN RAISE EXCEPTION 'Pricing fact validation changed; recalculate before a new quotation' USING ERRCODE='PT409'; END IF;
 END LOOP;
 -- Runs do not retain a full request-line snapshot: reject observed later changes.
 IF EXISTS(SELECT 1 FROM public.quote_request_lines WHERE case_id=p_case
   AND GREATEST(created_at,updated_at)>COALESCE(r.started_at,r.completed_at))
 THEN RAISE EXCEPTION 'Request lines changed; recalculate before a new quotation' USING ERRCODE='PT409'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.assert_quotation_run_facts_current(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assert_quotation_run_facts_current(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.commercial_source_context(p_case uuid,p_source uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.quotation_versions; selected_base uuid; latest_run uuid; context text;
BEGIN
 PERFORM 1 FROM public.quote_cases WHERE id=p_case FOR SHARE;
 PERFORM 1 FROM public.quote_facts WHERE case_id=p_case ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.quote_request_lines WHERE case_id=p_case ORDER BY id FOR SHARE;
 SELECT COALESCE((snapshot->'meta'->>'commercial_source_version_id')::uuid,id) INTO selected_base FROM public.quotation_versions WHERE case_id=p_case AND is_selected;
 IF selected_base IS DISTINCT FROM p_source THEN RAISE EXCEPTION 'Selected source version changed' USING ERRCODE='PT409'; END IF;
 SELECT * INTO v FROM public.quotation_versions WHERE id=p_source AND case_id=p_case AND commercial_revision_id IS NULL FOR SHARE;
 IF v.id IS NULL OR v.source_kind IS DISTINCT FROM 'canonical' OR COALESCE((v.snapshot->>'is_multi_lot')::boolean,false) OR v.snapshot->'meta' ? 'scenario_id' OR v.snapshot ? 'scenario_context'
 THEN RAISE EXCEPTION 'Canonical mono-lot source required'; END IF;
 SELECT id INTO latest_run FROM public.pricing_runs WHERE case_id=p_case AND status='success' ORDER BY run_number DESC LIMIT 1;
 IF latest_run IS DISTINCT FROM v.pricing_run_id THEN RAISE EXCEPTION 'Pricing source changed' USING ERRCODE='PT409'; END IF;
 PERFORM public.assert_quotation_run_facts_current(p_case,v.pricing_run_id);
 context := md5(COALESCE(public.air_handling_context_hash(p_case),'')||COALESCE((SELECT id::text FROM public.air_handling_selections WHERE case_id=p_case ORDER BY version DESC LIMIT 1),''));
 RETURN jsonb_build_object('source_hash',md5(v.snapshot::text),'context_hash',context,'snapshot',v.snapshot,'pricing_run_id',v.pricing_run_id);
END; $$;

-- Distinct RPC keeps the old header-only RPC compatible during a staged rollout.
CREATE FUNCTION public.create_canonical_quotation_version(p_case uuid,p_run uuid,p_actor uuid,p_snapshot jsonb,p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.quote_cases; r public.pricing_runs; old public.quotation_versions;
 vid uuid:=gen_random_uuid(); n integer; snap jsonb; line jsonb; idx integer:=0;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_actor IS NULL
 THEN RAISE EXCEPTION 'Quotation write forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.quote_cases WHERE id=p_case FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtext('qv_select_'||p_case::text));
 PERFORM pg_advisory_xact_lock(hashtext('qv_insert_'||p_case::text));
 -- Admission is checked after waiting; canonical workspace access stays shared.
 IF c.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.app_roles a JOIN auth.users u ON u.id=a.user_id
  WHERE a.user_id=p_actor AND a.role IN('workspace_operator','role_admin') AND (u.banned_until IS NULL OR u.banned_until<=now()))
 THEN RAISE EXCEPTION 'Quotation write forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.pricing_runs WHERE id=p_run AND case_id=p_case AND status='success' FOR SHARE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Successful pricing run required' USING ERRCODE='22023'; END IF;
 SELECT * INTO old FROM public.quotation_versions WHERE case_id=p_case AND pricing_run_id=p_run
  AND source_kind='canonical' AND commercial_revision_id IS NULL ORDER BY version_number DESC LIMIT 1;
 IF old.id IS NOT NULL THEN
  RETURN jsonb_build_object('version_id',old.id,'version_number',old.version_number,'snapshot',old.snapshot,'idempotent',true,'status_after',c.status);
 END IF;
 IF c.status::text NOT IN('PRICED_DRAFT','HUMAN_REVIEW','QUOTED_VERSIONED')
 THEN RAISE EXCEPTION 'Case locked' USING ERRCODE='PT409'; END IF;
 IF p_run IS DISTINCT FROM (SELECT id FROM public.pricing_runs WHERE case_id=p_case AND status='success' ORDER BY run_number DESC LIMIT 1)
 THEN RAISE EXCEPTION 'Pricing source changed' USING ERRCODE='PT409'; END IF;
 PERFORM public.assert_quotation_run_facts_current(p_case,p_run);
 IF jsonb_typeof(p_snapshot->'meta') IS DISTINCT FROM 'object'
 OR p_snapshot->'meta'->>'pricing_run_id' IS DISTINCT FROM p_run::text
 OR jsonb_typeof(p_snapshot->'lines') IS DISTINCT FROM 'array' OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
 OR jsonb_array_length(p_lines)<>jsonb_array_length(p_snapshot->'lines')
 OR p_snapshot->'meta' ? 'commercial_revision_id' OR p_snapshot->'meta' ? 'scenario_id'
 THEN RAISE EXCEPTION 'Invalid canonical snapshot' USING ERRCODE='22023'; END IF;
 SELECT COALESCE(max(version_number),0)+1 INTO n FROM public.quotation_versions WHERE case_id=p_case AND source_kind='canonical';
 snap:=jsonb_set(p_snapshot,'{meta}',(p_snapshot->'meta')||jsonb_build_object('version_id',vid,'version_number',n,'created_at',now()));
 UPDATE public.quotation_versions SET is_selected=false WHERE case_id=p_case AND is_selected;
 INSERT INTO public.quotation_versions(id,case_id,pricing_run_id,version_number,status,is_selected,snapshot,created_by)
 VALUES(vid,p_case,p_run,n,'draft',true,snap,p_actor);
 FOR line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  INSERT INTO public.quotation_version_lines(quotation_version_id,line_order,service_code,description,quantity,unit_price,amount,currency,breakdown)
  VALUES(vid,idx,line->>'service_code',line->>'description',(line->>'quantity')::numeric,(line->>'unit_price')::numeric,(line->>'amount')::numeric,line->>'currency',line->'breakdown');
  idx:=idx+1;
 END LOOP;
 UPDATE public.quote_cases SET status='QUOTED_VERSIONED',updated_at=now() WHERE id=p_case;
 INSERT INTO public.case_timeline_events(case_id,event_type,event_data,actor_type,actor_user_id)
 VALUES(p_case,'quotation_version_created',jsonb_build_object('version_id',vid,'version_number',n,'pricing_run_id',p_run,'pricing_run_number',r.run_number,
  'total_ht',snap->'totals'->'total_ht','lines_count',idx,'has_raw_lines',jsonb_array_length(snap->'raw_lines')>0,'status_after','QUOTED_VERSIONED'),'user',p_actor);
 RETURN jsonb_build_object('version_id',vid,'version_number',n,'snapshot',snap,'idempotent',false,'status_after','QUOTED_VERSIONED');
END; $$;
REVOKE ALL ON FUNCTION public.create_canonical_quotation_version(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_canonical_quotation_version(uuid,uuid,uuid,jsonb,jsonb) TO service_role;
-- Preserve the quantity already attested in unchanged inherited source lines.
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
 IF head IS DISTINCT FROM r.id OR ctx->>'source_hash' IS DISTINCT FROM r.source_hash OR ctx->>'context_hash' IS DISTINCT FROM r.context_hash THEN RAISE EXCEPTION 'Commercial source or revision changed' USING ERRCODE='PT409'; END IF;
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
  VALUES(vid,idx,line->>'service_code',line->>'description',COALESCE((line->>'quantity')::numeric,1),(line->>'unit_price')::numeric,(line->>'amount')::numeric,'XOF',jsonb_build_object('commercial',line->'commercial','source',line->'source'));
  idx:=idx+1;
 END LOOP;
 UPDATE public.quote_cases SET status='QUOTED_VERSIONED',updated_at=now() WHERE id=r.case_id;
 INSERT INTO public.case_timeline_events(case_id,event_type,event_data,actor_type,actor_user_id)
 VALUES(r.case_id,'quotation_version_created',jsonb_build_object('version_id',vid,'version_number',n,'commercial_revision_id',r.id),'user',p_actor);
 RETURN jsonb_build_object('version_id',vid,'version_number',n,'idempotent',false,'snapshot',snap,'status_after','QUOTED_VERSIONED');
END; $$;

-- Keep the six-argument legacy header RPC, with the same lock order during rollout.
CREATE OR REPLACE FUNCTION public.insert_quotation_version_atomic(
 p_id uuid,p_case_id uuid,p_pricing_run_id uuid,p_version_number integer,p_snapshot jsonb,p_created_by uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.quote_cases WHERE id=p_case_id FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtext('qv_select_'||p_case_id::text));
 PERFORM pg_advisory_xact_lock(hashtext('qv_insert_'||p_case_id::text));
 UPDATE public.quotation_versions SET is_selected=false WHERE case_id=p_case_id AND is_selected;
 INSERT INTO public.quotation_versions(id,case_id,pricing_run_id,version_number,status,is_selected,snapshot,created_by)
 VALUES(p_id,p_case_id,p_pricing_run_id,p_version_number,'draft',true,p_snapshot,p_created_by);
 RETURN p_id;
END; $$;
REVOKE ALL ON FUNCTION public.insert_quotation_version_atomic(uuid,uuid,uuid,integer,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.insert_quotation_version_atomic(uuid,uuid,uuid,integer,jsonb,uuid) TO service_role;
COMMIT;
