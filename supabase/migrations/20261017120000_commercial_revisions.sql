BEGIN;
CREATE TABLE public.quote_commercial_revisions (
 id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES public.quote_cases(id),
 source_version_id uuid NOT NULL REFERENCES public.quotation_versions(id),
 parent_id uuid REFERENCES public.quote_commercial_revisions(id), revision integer NOT NULL CHECK(revision>0),
 source_hash text NOT NULL, context_hash text NOT NULL, request jsonb NOT NULL, draft jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(case_id,source_version_id,revision), CHECK(jsonb_typeof(draft->'lines')='array'),
 CHECK(jsonb_array_length(draft->'lines')<=100), CHECK(octet_length(draft::text)<2000000)
);
ALTER TABLE public.quote_commercial_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY commercial_revision_read ON public.quote_commercial_revisions FOR SELECT TO authenticated
 USING(public.has_case_read_access(case_id));
REVOKE ALL ON public.quote_commercial_revisions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.quote_commercial_revisions TO authenticated;
GRANT SELECT,INSERT ON public.quote_commercial_revisions TO service_role;
CREATE FUNCTION public.commercial_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Append-only commercial history'; END; $$;
CREATE TRIGGER commercial_immutable BEFORE UPDATE OR DELETE ON public.quote_commercial_revisions FOR EACH ROW EXECUTE FUNCTION public.commercial_immutable();
REVOKE ALL ON FUNCTION public.commercial_immutable() FROM PUBLIC,anon,authenticated;

ALTER TABLE public.quotation_versions ADD COLUMN commercial_revision_id uuid REFERENCES public.quote_commercial_revisions(id);
CREATE UNIQUE INDEX quotation_commercial_revision_unique ON public.quotation_versions(commercial_revision_id) WHERE commercial_revision_id IS NOT NULL;
-- The immutable snapshot and line table both retain unknown amounts as NULL.
ALTER TABLE public.quotation_version_lines ALTER COLUMN amount DROP NOT NULL;
ALTER TABLE public.quotation_version_lines ALTER COLUMN unit_price DROP NOT NULL;

CREATE FUNCTION public.commercial_version_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.commercial_revision_id IS NOT NULL THEN RAISE EXCEPTION 'Immutable commercial version'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='INSERT' AND NEW.commercial_revision_id IS NOT NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Commercial version requires server' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND OLD.commercial_revision_id IS NOT NULL AND
  (NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.commercial_revision_id IS DISTINCT FROM OLD.commercial_revision_id OR NEW.case_id IS DISTINCT FROM OLD.case_id OR NEW.pricing_run_id IS DISTINCT FROM OLD.pricing_run_id)
 THEN RAISE EXCEPTION 'Immutable commercial version'; END IF;
 IF TG_OP='UPDATE' AND (NEW.commercial_revision_id IS NOT NULL OR OLD.commercial_revision_id IS NOT NULL) AND auth.role() IS DISTINCT FROM 'service_role' AND
  NOT (auth.role()='authenticated' AND public.has_case_write_access(OLD.case_id) AND (to_jsonb(NEW)-'is_selected')=(to_jsonb(OLD)-'is_selected'))
 THEN RAISE EXCEPTION 'Commercial version requires server' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER commercial_version_guard BEFORE INSERT OR UPDATE OR DELETE ON public.quotation_versions FOR EACH ROW EXECUTE FUNCTION public.commercial_version_guard();
REVOKE ALL ON FUNCTION public.commercial_version_guard() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.commercial_line_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE parent uuid;
BEGIN
 parent:=CASE WHEN TG_OP='DELETE' THEN OLD.quotation_version_id ELSE NEW.quotation_version_id END;
 IF EXISTS(SELECT 1 FROM public.quotation_versions WHERE id=parent AND commercial_revision_id IS NOT NULL)
 OR (TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.quotation_versions WHERE id=OLD.quotation_version_id AND commercial_revision_id IS NOT NULL)) THEN
  IF TG_OP<>'INSERT' OR auth.role() IS DISTINCT FROM 'service_role' OR current_setting('dcq.commercial_version_insert',true) IS DISTINCT FROM parent::text
  THEN RAISE EXCEPTION 'Immutable commercial version lines' USING ERRCODE='42501'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER commercial_line_guard BEFORE INSERT OR UPDATE OR DELETE ON public.quotation_version_lines FOR EACH ROW EXECUTE FUNCTION public.commercial_line_guard();
REVOKE ALL ON FUNCTION public.commercial_line_guard() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.commercial_actor_guard(p_actor uuid,p_case uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_actor IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.app_roles r JOIN auth.users u ON u.id=r.user_id JOIN public.quote_cases c ON c.id=p_case
  WHERE r.user_id=p_actor AND r.role IN('workspace_operator','role_admin') AND (u.banned_until IS NULL OR u.banned_until<=now())
   AND (c.created_by=p_actor OR c.assigned_to=p_actor)
 ) THEN RAISE EXCEPTION 'Commercial write forbidden' USING ERRCODE='42501'; END IF;
END; $$;

-- Source, selected base, current successful run and facts/selection are one pinned context.
CREATE FUNCTION public.commercial_source_context(p_case uuid,p_source uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.quotation_versions; selected_base uuid; latest_run uuid; context text;
BEGIN
 PERFORM 1 FROM public.quote_facts WHERE case_id=p_case ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.quote_request_lines WHERE case_id=p_case ORDER BY id FOR SHARE;
 SELECT COALESCE((snapshot->'meta'->>'commercial_source_version_id')::uuid,id) INTO selected_base FROM public.quotation_versions WHERE case_id=p_case AND is_selected;
 IF selected_base IS DISTINCT FROM p_source THEN RAISE EXCEPTION 'Selected source version changed' USING ERRCODE='40001'; END IF;
 SELECT * INTO v FROM public.quotation_versions WHERE id=p_source AND case_id=p_case AND commercial_revision_id IS NULL FOR SHARE;
 IF v.id IS NULL OR v.source_kind IS DISTINCT FROM 'canonical' OR COALESCE((v.snapshot->>'is_multi_lot')::boolean,false) OR v.snapshot->'meta' ? 'scenario_id' OR v.snapshot ? 'scenario_context'
 THEN RAISE EXCEPTION 'Canonical mono-lot source required'; END IF;
 SELECT id INTO latest_run FROM public.pricing_runs WHERE case_id=p_case AND status='success' ORDER BY run_number DESC LIMIT 1;
 IF latest_run IS DISTINCT FROM v.pricing_run_id THEN RAISE EXCEPTION 'Pricing source changed' USING ERRCODE='40001'; END IF;
 context := md5(COALESCE(public.air_handling_context_hash(p_case),'')||COALESCE((SELECT id::text FROM public.air_handling_selections WHERE case_id=p_case ORDER BY version DESC LIMIT 1),''));
 RETURN jsonb_build_object('source_hash',md5(v.snapshot::text),'context_hash',context,'snapshot',v.snapshot,'pricing_run_id',v.pricing_run_id);
END; $$;

CREATE FUNCTION public.commercial_read(p_case_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid uuid; ctx jsonb; head public.quote_commercial_revisions;
BEGIN
 IF auth.role() IS DISTINCT FROM 'authenticated' OR NOT public.has_case_read_access(p_case_id) THEN RAISE EXCEPTION 'Commercial read forbidden' USING ERRCODE='42501'; END IF;
 SELECT COALESCE((snapshot->'meta'->>'commercial_source_version_id')::uuid,id) INTO sid FROM public.quotation_versions WHERE case_id=p_case_id AND is_selected;
 IF sid IS NULL THEN RETURN jsonb_build_object('available',false); END IF;
 ctx:=public.commercial_source_context(p_case_id,sid);
 SELECT * INTO head FROM public.quote_commercial_revisions WHERE case_id=p_case_id AND source_version_id=sid ORDER BY revision DESC LIMIT 1;
 RETURN ctx||jsonb_build_object('available',true,'source_version_id',sid,'head_id',head.id,'draft',head.draft,'can_write',public.has_case_write_access(p_case_id),
 'case_status',(SELECT status FROM public.quote_cases WHERE id=p_case_id));
END; $$;

CREATE FUNCTION public.commercial_store(p_id uuid,p_case uuid,p_source uuid,p_parent uuid,p_actor uuid,p_source_hash text,p_context_hash text,p_request jsonb,p_draft jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.quote_commercial_revisions; head public.quote_commercial_revisions; ctx jsonb;
BEGIN
 PERFORM public.commercial_actor_guard(p_actor,p_case);
 PERFORM 1 FROM public.quote_cases WHERE id=p_case FOR UPDATE;
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

CREATE FUNCTION public.commercial_create_version(p_revision uuid,p_actor uuid,p_snapshot jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.quote_commercial_revisions; existing public.quotation_versions; ctx jsonb; head uuid; vid uuid:=gen_random_uuid(); n integer; snap jsonb; line jsonb; idx integer:=0;
BEGIN
 SELECT * INTO r FROM public.quote_commercial_revisions WHERE id=p_revision;
 PERFORM public.commercial_actor_guard(p_actor,r.case_id);
 PERFORM 1 FROM public.quote_cases WHERE id=r.case_id FOR UPDATE;
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
REVOKE ALL ON FUNCTION public.commercial_actor_guard(uuid,uuid),public.commercial_source_context(uuid,uuid),public.commercial_read(uuid),public.commercial_store(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb),public.commercial_create_version(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commercial_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commercial_actor_guard(uuid,uuid),public.commercial_source_context(uuid,uuid),public.commercial_store(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb),public.commercial_create_version(uuid,uuid,jsonb) TO service_role;
COMMIT;
