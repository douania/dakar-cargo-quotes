-- CANDIDATE ONLY: no automatic activation/deployment/backfill, no historical price rewrite.
BEGIN;
DO $$ BEGIN IF to_regprocedure('public.supersede_fact(uuid,text,text,text,numeric,jsonb,timestamp with time zone,text,uuid,uuid,text,numeric)') IS NULL OR to_regprocedure('public.assert_case_source_revisions_resolved(uuid)') IS NULL THEN RAISE EXCEPTION 'Existing fact/source-revision prerequisites missing'; END IF; END; $$;
DO $$ BEGIN IF to_regclass('public.quote_scenario_pricing_runs') IS NULL THEN RAISE EXCEPTION 'Existing scenario ledger prerequisite missing'; END IF; END; $$;
CREATE TABLE public.air_cross_trade_plans (
 id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES public.quote_cases(id) ON DELETE CASCADE, parent_id uuid REFERENCES public.air_cross_trade_plans(id),
 revision integer NOT NULL CHECK(revision>0), created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 request_context_hash text NOT NULL, context_hash text NOT NULL, request jsonb NOT NULL, plan jsonb NOT NULL, source_snapshot jsonb NOT NULL,
 UNIQUE(case_id,revision)
);
CREATE TABLE public.air_cross_trade_pricing_receipts (
 id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES public.quote_cases(id) ON DELETE CASCADE, plan_id uuid NOT NULL REFERENCES public.air_cross_trade_plans(id),
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 context_hash text NOT NULL, source_snapshot jsonb NOT NULL, pricing_run_id uuid NOT NULL UNIQUE REFERENCES public.pricing_runs(id)
);
ALTER TABLE public.air_cross_trade_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.air_cross_trade_pricing_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.air_cross_trade_plans,public.air_cross_trade_pricing_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.air_cross_trade_plans,public.air_cross_trade_pricing_receipts TO authenticated;
CREATE POLICY air_plan_read ON public.air_cross_trade_plans FOR SELECT TO authenticated USING(public.has_case_read_access(case_id));
CREATE POLICY air_receipt_read ON public.air_cross_trade_pricing_receipts FOR SELECT TO authenticated USING(public.has_case_read_access(case_id));

CREATE FUNCTION public._air_cross_trade_actor(p_actor uuid,p_case uuid,p_write boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_actor IS NULL THEN RAISE EXCEPTION 'AIR actor required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.app_roles r JOIN auth.users u ON u.id=r.user_id
 WHERE r.user_id=p_actor AND r.role IN('workspace_operator','role_admin') FOR SHARE OF r,u;
 IF NOT EXISTS(SELECT 1 FROM public.app_roles r JOIN auth.users u ON u.id=r.user_id JOIN public.quote_cases c ON c.id=p_case
 WHERE r.user_id=p_actor AND r.role IN('workspace_operator','role_admin') AND (u.banned_until IS NULL OR u.banned_until<=now())
 AND (NOT p_write OR c.created_by=p_actor OR c.assigned_to=p_actor)) THEN RAISE EXCEPTION 'AIR access denied' USING ERRCODE='42501'; END IF;
END; $$;
-- All ordinary fact/lot writers take a compatible SHARED, non-blocking case lock.
-- Candidate plan/run transactions take EXCLUSIVE before the case row and context read.
-- This covers inserts/phantoms too, without serializing ordinary writers together.
CREATE FUNCTION public._air_cross_trade_fact_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; b uuid;
BEGIN
 IF TG_TABLE_NAME='case_timeline_events' THEN
  IF TG_OP='INSERT' AND NEW.event_type<>'thread_intent_v1' OR TG_OP='DELETE' AND OLD.event_type<>'thread_intent_v1' OR TG_OP='UPDATE' AND OLD.event_type<>'thread_intent_v1' AND NEW.event_type<>'thread_intent_v1' THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 END IF;
 a:=CASE WHEN TG_OP='INSERT' THEN NEW.case_id ELSE OLD.case_id END;
 b:=CASE WHEN TG_OP='DELETE' THEN a ELSE NEW.case_id END;
 IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('air_cross_trade:'||least(a,b)::text,0)) OR
 (a IS DISTINCT FROM b AND NOT pg_try_advisory_xact_lock_shared(hashtextextended('air_cross_trade:'||greatest(a,b)::text,0)))
 THEN RAISE EXCEPTION 'AIR context is being retained; retry after reading' USING ERRCODE='40001'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
CREATE TRIGGER air_cross_trade_fact_fence BEFORE INSERT OR UPDATE OR DELETE ON public.quote_facts FOR EACH ROW EXECUTE FUNCTION public._air_cross_trade_fact_fence();
CREATE TRIGGER air_cross_trade_lot_fence BEFORE INSERT OR UPDATE OR DELETE ON public.quote_request_lines FOR EACH ROW EXECUTE FUNCTION public._air_cross_trade_fact_fence();
CREATE TRIGGER air_cross_trade_gap_fence BEFORE INSERT OR UPDATE OR DELETE ON public.quote_gaps FOR EACH ROW EXECUTE FUNCTION public._air_cross_trade_fact_fence();
CREATE TRIGGER air_cross_trade_revision_fence BEFORE INSERT OR UPDATE OR DELETE ON public.quote_email_fact_revisions FOR EACH ROW EXECUTE FUNCTION public._air_cross_trade_fact_fence();
CREATE TRIGGER air_cross_trade_intent_fence BEFORE INSERT OR UPDATE OR DELETE ON public.case_timeline_events FOR EACH ROW EXECUTE FUNCTION public._air_cross_trade_fact_fence();

CREATE FUNCTION public._air_cross_trade_context(p_case uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('case',jsonb_build_object('id',c.id,'request_type',c.request_type,'created_by',c.created_by,'assigned_to',c.assigned_to),
 'facts',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM public.quote_facts f WHERE f.case_id=c.id AND f.is_current),'[]'::jsonb),
 'intent',(SELECT event_data FROM public.case_timeline_events e WHERE e.case_id=c.id AND e.event_type='thread_intent_v1' ORDER BY e.created_at DESC,e.id DESC LIMIT 1),
 'request_lines',COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.quote_request_lines l WHERE l.case_id=c.id),'[]'::jsonb))
 FROM public.quote_cases c WHERE c.id=p_case
$$;
CREATE FUNCTION public._air_cross_trade_sources(p_case uuid,p_request jsonb) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
 'sources',COALESCE((SELECT jsonb_agg(x ORDER BY x->>'kind',x->>'id') FROM (
   SELECT jsonb_build_object('kind','rate_card','id',r.id,'row',to_jsonb(r)) x FROM public.pricing_rate_cards r
    WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_request->'attestations','[]'::jsonb)) a WHERE a->>'source_kind'='rate_card' AND a->>'source_id'=r.id::text)
   UNION ALL
   SELECT jsonb_build_object('kind','partner_fact','id',f.id,'row',to_jsonb(f),'response',to_jsonb(e),'request',to_jsonb(q))
    FROM public.external_quote_response_facts f JOIN public.external_quote_responses e ON e.id=f.response_id JOIN public.external_quote_requests q ON q.id=f.request_id
    WHERE f.case_id=p_case AND q.case_id=p_case AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_request->'attestations','[]'::jsonb)) a WHERE a->>'source_kind'='partner_fact' AND a->>'source_id'=f.id::text)
 ) z),'[]'::jsonb),
 'fx',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM public.exchange_rates f WHERE EXISTS(
 SELECT 1 FROM jsonb_array_elements(COALESCE(p_request->'plan'->'services','[]'::jsonb)) d WHERE d->>'fx_id'=f.id::text)),'[]'::jsonb),
 'countries',COALESCE((SELECT jsonb_agg(x ORDER BY x->>'country_code',x->>'country_name') FROM (SELECT DISTINCT jsonb_build_object('country_code',country_code,'country_name',country_name) x FROM public.locations_reference WHERE is_active) q),'[]'::jsonb))
$$;
CREATE FUNCTION public._air_cross_trade_lock_sources(p_case uuid,p_request jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.pricing_rate_cards r WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_request->'attestations','[]'::jsonb)) a WHERE a->>'source_kind'='rate_card' AND a->>'source_id'=r.id::text) ORDER BY r.id FOR SHARE;
 PERFORM 1 FROM public.external_quote_requests r WHERE id IN(SELECT request_id FROM public.external_quote_response_facts f WHERE case_id=p_case AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_request->'attestations','[]'::jsonb)) a WHERE a->>'source_kind'='partner_fact' AND a->>'source_id'=f.id::text)) ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.external_quote_responses r WHERE id IN(SELECT response_id FROM public.external_quote_response_facts f WHERE case_id=p_case AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_request->'attestations','[]'::jsonb)) a WHERE a->>'source_kind'='partner_fact' AND a->>'source_id'=f.id::text)) ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.external_quote_response_facts f WHERE case_id=p_case AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_request->'attestations','[]'::jsonb)) a WHERE a->>'source_kind'='partner_fact' AND a->>'source_id'=f.id::text) ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.exchange_rates f WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_request->'plan'->'services','[]'::jsonb)) d WHERE d->>'fx_id'=f.id::text) ORDER BY id FOR SHARE;
END; $$;
CREATE FUNCTION public._air_cross_trade_requirements(p_case uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.air_cross_trade_plans; v jsonb;
BEGIN
 IF (SELECT request_type::text FROM public.quote_cases WHERE id=p_case) IS DISTINCT FROM 'AIR_CROSS_TRADE' THEN RETURN NULL; END IF;
 SELECT * INTO h FROM public.air_cross_trade_plans WHERE case_id=p_case ORDER BY revision DESC LIMIT 1;
 IF h.id IS NULL OR h.context_hash IS DISTINCT FROM md5(public._air_cross_trade_context(p_case)::text) OR h.source_snapshot IS DISTINCT FROM public._air_cross_trade_sources(p_case,h.request) THEN RETURN NULL; END IF;
 BEGIN PERFORM public.assert_case_source_revisions_resolved(p_case); EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
 SELECT value_json INTO v FROM public.quote_facts WHERE case_id=p_case AND fact_key='service.air_cross_trade_requirements' AND is_current;
 IF v->>'plan_id' IS DISTINCT FROM h.id::text OR jsonb_typeof(v->'required_fact_keys') IS DISTINCT FROM 'array' OR jsonb_typeof(v->'client_data_keys') IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
 RETURN v;
END; $$;
CREATE FUNCTION public._air_cross_trade_metadata_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE marker text:=current_setting('dcq.air_projection',true);
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.quote_cases WHERE id=OLD.case_id) THEN RETURN OLD; END IF;
 IF COALESCE(NEW.fact_key,OLD.fact_key)='service.air_cross_trade_requirements' THEN
  IF marker='invalidate' AND TG_OP='UPDATE' AND NEW.is_current=false AND to_jsonb(NEW)-ARRAY['is_current','updated_at']=to_jsonb(OLD)-ARRAY['is_current','updated_at'] THEN RETURN NEW; END IF;
  IF marker IS NULL OR marker='' OR NOT EXISTS(SELECT 1 FROM public.air_cross_trade_plans WHERE id::text=marker AND case_id=COALESCE(NEW.case_id,OLD.case_id)) THEN RAISE EXCEPTION 'AIR derived metadata requires plan transaction' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
CREATE TRIGGER air_cross_trade_metadata_guard BEFORE INSERT OR UPDATE OR DELETE ON public.quote_facts FOR EACH ROW EXECUTE FUNCTION public._air_cross_trade_metadata_guard();
CREATE FUNCTION public._air_cross_trade_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid; previous text:=current_setting('dcq.air_projection',true);
BEGIN
 IF COALESCE(previous,'')<>'' THEN RETURN NULL; END IF;
 IF TG_TABLE_NAME='quote_facts' THEN
  IF COALESCE(NEW.fact_key,OLD.fact_key)='service.air_cross_trade_requirements' THEN RETURN NULL; END IF;
 ELSIF TG_TABLE_NAME='case_timeline_events' THEN
  IF TG_OP='INSERT' AND NEW.event_type<>'thread_intent_v1' OR TG_OP='UPDATE' AND OLD.event_type<>'thread_intent_v1' AND NEW.event_type<>'thread_intent_v1' OR TG_OP='DELETE' AND OLD.event_type<>'thread_intent_v1' THEN RETURN NULL; END IF;
 END IF;
 c:=COALESCE(NEW.case_id,OLD.case_id);
 PERFORM set_config('dcq.air_projection','invalidate',true);
 -- Concurrent Cross writers refuse promptly rather than wait while holding dependent fact rows.
 BEGIN
  PERFORM 1 FROM public.quote_facts WHERE case_id=c AND fact_key='service.air_cross_trade_requirements' AND is_current FOR UPDATE NOWAIT;
  UPDATE public.quote_facts SET is_current=false,updated_at=clock_timestamp() WHERE case_id=c AND fact_key='service.air_cross_trade_requirements' AND is_current;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'AIR requirement invalidation busy; refresh' USING ERRCODE='40001'; END;
 PERFORM set_config('dcq.air_projection',COALESCE(previous,''),true);
 RETURN NULL;
END; $$;
CREATE TRIGGER air_cross_trade_invalidate_fact AFTER INSERT OR UPDATE OR DELETE ON public.quote_facts FOR EACH ROW EXECUTE FUNCTION public._air_cross_trade_invalidate();
CREATE TRIGGER air_cross_trade_invalidate_lot AFTER INSERT OR UPDATE OR DELETE ON public.quote_request_lines FOR EACH ROW EXECUTE FUNCTION public._air_cross_trade_invalidate();
CREATE TRIGGER air_cross_trade_invalidate_revision AFTER INSERT OR UPDATE OR DELETE ON public.quote_email_fact_revisions FOR EACH ROW EXECUTE FUNCTION public._air_cross_trade_invalidate();
CREATE TRIGGER air_cross_trade_invalidate_intent AFTER INSERT OR UPDATE OR DELETE ON public.case_timeline_events FOR EACH ROW EXECUTE FUNCTION public._air_cross_trade_invalidate();
CREATE FUNCTION public._air_cross_trade_gap_relevance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE req jsonb;
BEGIN
 IF NEW.gap_key='routing.destination_city' AND NEW.status IN('open','pending_response') THEN
  req:=public._air_cross_trade_requirements(NEW.case_id);
  IF req IS NOT NULL AND NOT (req->'required_fact_keys' ? 'routing.destination_city') AND NOT EXISTS(
   SELECT 1 FROM public.air_cross_trade_plans p,jsonb_array_elements(p.request->'plan'->'services') d WHERE p.id::text=req->>'plan_id' AND d->>'service_key'='ON_CARRIAGE' AND d->>'disposition'<>'excluded') THEN
   NEW.status:='resolved';NEW.is_blocking:=false;NEW.resolved_at:=clock_timestamp();NEW.resolved_by_fact_id:=NULL;
   NEW.waived_reason:='Not required for airport-only AIR plan '||(req->>'plan_id');
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER air_cross_trade_gap_relevance BEFORE INSERT OR UPDATE ON public.quote_gaps FOR EACH ROW EXECUTE FUNCTION public._air_cross_trade_gap_relevance();
CREATE FUNCTION public._air_cross_trade_question_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE req jsonb; keys jsonb; ed jsonb; rq jsonb;
BEGIN
 IF TG_TABLE_NAME='client_gap_requests' THEN
  IF NEW.status NOT IN('drafted','sent') THEN RETURN NEW; END IF;
  -- Existing request transitions and FK cleanup record history; they do not send a question.
  IF TG_OP='UPDATE' AND NEW.case_id=OLD.case_id AND NEW.gap_key=OLD.gap_key THEN RETURN NEW; END IF;
  keys:=jsonb_build_array(NEW.gap_key);
 ELSE
  IF TG_OP='UPDATE' AND NEW.case_id=OLD.case_id AND NEW.event_type=OLD.event_type AND NEW.event_data=OLD.event_data THEN RETURN NEW; END IF;
  ed:=NEW.event_data;
  IF NOT (NEW.event_type='manual_action' AND ed->>'action_code'='REQUEST_CLIENT_INFO_FOR_GAPS' AND ed->>'status'='open'
   OR NEW.event_type='output_generated' AND ed->>'source_action_dedupe_key' LIKE 'REQUEST_CLIENT_INFO_FOR_GAPS:%') THEN RETURN NEW; END IF;
  keys:=ed->'requested_gap_keys';
 END IF;
 IF (SELECT request_type::text FROM public.quote_cases WHERE id=NEW.case_id) IS DISTINCT FROM 'AIR_CROSS_TRADE' THEN RETURN NEW; END IF;
 IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('air_cross_trade:'||NEW.case_id::text,0)) THEN RAISE EXCEPTION 'AIR scope busy' USING ERRCODE='40001'; END IF;
 SELECT request INTO rq FROM public.air_cross_trade_plans WHERE case_id=NEW.case_id ORDER BY revision DESC LIMIT 1;
 PERFORM public._air_cross_trade_lock_sources(NEW.case_id,rq);
 req:=public._air_cross_trade_requirements(NEW.case_id);
 IF req IS NULL OR jsonb_typeof(keys) IS DISTINCT FROM 'array' OR jsonb_array_length(keys)=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(keys) k WHERE NOT(req->'client_data_keys' ? k)) THEN RAISE EXCEPTION 'AIR client scope requires current operator qualification' USING ERRCODE='40001'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER air_cross_trade_question_request BEFORE INSERT OR UPDATE ON public.client_gap_requests FOR EACH ROW EXECUTE FUNCTION public._air_cross_trade_question_guard();
CREATE TRIGGER air_cross_trade_question_event BEFORE INSERT OR UPDATE ON public.case_timeline_events FOR EACH ROW EXECUTE FUNCTION public._air_cross_trade_question_guard();
CREATE FUNCTION public._air_cross_trade_class_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.request_type::text='AIR_CROSS_TRADE' AND NEW.request_type IS DISTINCT FROM OLD.request_type AND EXISTS(SELECT 1 FROM public.air_cross_trade_plans WHERE case_id=OLD.id)
  AND NOT(auth.role()='authenticated' AND public.has_case_write_access(OLD.id)) THEN RAISE EXCEPTION 'AIR operator classification changed; refresh before rebuilding' USING ERRCODE='40001'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER air_cross_trade_class_guard BEFORE UPDATE OF request_type ON public.quote_cases FOR EACH ROW EXECUTE FUNCTION public._air_cross_trade_class_guard();
CREATE FUNCTION public.air_cross_trade_requirements_read(p_case uuid,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM public._air_cross_trade_actor(p_actor,p_case,false);RETURN public._air_cross_trade_requirements(p_case);END; $$;
CREATE FUNCTION public.air_cross_trade_read(p_case uuid,p_actor uuid,p_request jsonb DEFAULT NULL,p_query text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx jsonb; src jsonb; head public.air_cross_trade_plans; rq jsonb; guard boolean:=true;
BEGIN
 PERFORM public._air_cross_trade_actor(p_actor,p_case,false);
 SELECT * INTO head FROM public.air_cross_trade_plans WHERE case_id=p_case ORDER BY revision DESC LIMIT 1;
 BEGIN PERFORM public.assert_case_source_revisions_resolved(p_case); EXCEPTION WHEN SQLSTATE 'PT409' THEN guard:=false; WHEN OTHERS THEN guard:=NULL; END;
 rq:=COALESCE(p_request,head.request,'{}'::jsonb); ctx:=public._air_cross_trade_context(p_case); src:=public._air_cross_trade_sources(p_case,rq);
 RETURN ctx||src||jsonb_build_object('source_revisions_clear',guard,'requirements',public._air_cross_trade_requirements(p_case),
 'blocking_gaps',COALESCE((SELECT jsonb_agg(jsonb_build_object('gap_key',gap_key)) FROM public.quote_gaps WHERE case_id=p_case AND status IN('open','pending_response') AND is_blocking),'[]'::jsonb),
 'last_pricing_run',(SELECT to_jsonb(r) FROM public.pricing_runs r WHERE case_id=p_case AND engine_version='air_cross_trade_v1' ORDER BY run_number DESC LIMIT 1),
 'context_hash',md5(ctx::text),'sources_hash',md5(src::text),'head',CASE WHEN head.id IS NULL THEN NULL ELSE to_jsonb(head) END,
 'catalog',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT * FROM public.pricing_rate_cards WHERE status='active' AND (service_key ILIKE '%'||p_query||'%' OR COALESCE(source,'') ILIKE '%'||p_query||'%') ORDER BY service_key,id LIMIT 100) r),'[]'::jsonb),
 'catalog_has_more',(SELECT count(*)>100 FROM public.pricing_rate_cards WHERE status='active' AND (service_key ILIKE '%'||p_query||'%' OR COALESCE(source,'') ILIKE '%'||p_query||'%')),
 'partner_catalog',COALESCE((SELECT jsonb_agg(to_jsonb(f)) FROM (SELECT * FROM public.external_quote_response_facts WHERE case_id=p_case AND validation_status='validated' ORDER BY id LIMIT 100) f),'[]'::jsonb),
 'fx_catalog',COALESCE((SELECT jsonb_agg(to_jsonb(f)) FROM public.exchange_rates f),'[]'::jsonb),
 'can_write',EXISTS(SELECT 1 FROM public.quote_cases WHERE id=p_case AND (created_by=p_actor OR assigned_to=p_actor)));
END; $$;
CREATE FUNCTION public._air_cross_trade_lock(p_case uuid,p_actor uuid,p_request jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public._air_cross_trade_actor(p_actor,p_case,true);
 IF NOT pg_try_advisory_xact_lock(hashtextextended('air_cross_trade:'||p_case::text,0)) THEN RAISE EXCEPTION 'AIR context busy' USING ERRCODE='40001'; END IF;
 PERFORM 1 FROM public.quote_cases WHERE id=p_case FOR UPDATE;
 PERFORM public._air_cross_trade_actor(p_actor,p_case,true);
 PERFORM 1 FROM public.quote_facts WHERE case_id=p_case ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.quote_request_lines WHERE case_id=p_case ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.pricing_rate_cards r WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_request->'attestations','[]'::jsonb)) a WHERE a->>'source_kind'='rate_card' AND a->>'source_id'=r.id::text) ORDER BY r.id FOR SHARE;
 PERFORM 1 FROM public.external_quote_requests r WHERE id IN(SELECT request_id FROM public.external_quote_response_facts f WHERE case_id=p_case AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_request->'attestations','[]'::jsonb)) a WHERE a->>'source_kind'='partner_fact' AND a->>'source_id'=f.id::text)) ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.external_quote_responses r WHERE id IN(SELECT response_id FROM public.external_quote_response_facts f WHERE case_id=p_case AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_request->'attestations','[]'::jsonb)) a WHERE a->>'source_kind'='partner_fact' AND a->>'source_id'=f.id::text)) ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.external_quote_response_facts f WHERE case_id=p_case AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_request->'attestations','[]'::jsonb)) a WHERE a->>'source_kind'='partner_fact' AND a->>'source_id'=f.id::text) ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.exchange_rates f WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_request->'plan'->'services','[]'::jsonb)) d WHERE d->>'fx_id'=f.id::text) ORDER BY id FOR SHARE;
END; $$;
CREATE FUNCTION public.air_cross_trade_store_plan(p_id uuid,p_case uuid,p_actor uuid,p_parent uuid,p_context text,p_sources text,p_request jsonb,p_plan jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.air_cross_trade_plans; head public.air_cross_trade_plans; ctx jsonb; src jsonb; n integer; f public.quote_facts; target jsonb; req jsonb; prev text;
BEGIN
 PERFORM public._air_cross_trade_lock(p_case,p_actor,p_request);
 IF EXISTS(SELECT 1 FROM public.air_cross_trade_pricing_receipts WHERE id=p_id) THEN RAISE EXCEPTION 'AIR operation id reused' USING ERRCODE='40001'; END IF;
 SELECT * INTO old FROM public.air_cross_trade_plans WHERE id=p_id;
 IF old.id IS NOT NULL THEN
  IF old.case_id IS DISTINCT FROM p_case OR old.parent_id IS DISTINCT FROM p_parent OR old.created_by IS DISTINCT FROM p_actor OR old.request IS DISTINCT FROM p_request OR old.request_context_hash IS DISTINCT FROM p_context OR md5(old.source_snapshot::text) IS DISTINCT FROM p_sources THEN RAISE EXCEPTION 'AIR replay mismatch' USING ERRCODE='40001'; END IF;
  RETURN to_jsonb(old);
 END IF;
 IF (SELECT status::text FROM public.quote_cases WHERE id=p_case) NOT IN('INTAKE','FACTS_PARTIAL','NEED_INFO','READY_TO_PRICE','DECISIONS_PENDING','DECISIONS_COMPLETE','ACK_READY_FOR_PRICING','PRICED_DRAFT','HUMAN_REVIEW','QUOTED_VERSIONED') THEN RAISE EXCEPTION 'AIR case locked' USING ERRCODE='40001'; END IF;
 SELECT * INTO head FROM public.air_cross_trade_plans WHERE case_id=p_case ORDER BY revision DESC LIMIT 1;
 ctx:=public._air_cross_trade_context(p_case); src:=public._air_cross_trade_sources(p_case,p_request);
 IF head.id IS DISTINCT FROM p_parent OR md5(ctx::text) IS DISTINCT FROM p_context OR md5(src::text) IS DISTINCT FROM p_sources THEN RAISE EXCEPTION 'AIR context/source changed' USING ERRCODE='40001'; END IF;
 IF p_id IS NULL OR jsonb_typeof(p_request->'attestations') IS DISTINCT FROM 'array' OR p_plan->>'case_id' IS DISTINCT FROM p_case::text OR p_plan->>'actor_id' IS DISTINCT FROM p_actor::text OR p_plan->'plan' IS DISTINCT FROM p_request->'plan' THEN RAISE EXCEPTION 'Invalid AIR plan'; END IF;
 n:=COALESCE(head.revision,0)+1;
 IF jsonb_typeof(p_plan->'requirements'->'required_fact_keys') IS DISTINCT FROM 'array' OR jsonb_typeof(p_plan->'requirements'->'client_data_keys') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'AIR requirements missing'; END IF;
 INSERT INTO public.air_cross_trade_plans(id,case_id,parent_id,revision,created_by,request_context_hash,context_hash,request,plan,source_snapshot)
 VALUES(p_id,p_case,p_parent,n,p_actor,p_context,p_context,p_request,p_plan,src);
 prev:=current_setting('dcq.air_projection',true);PERFORM set_config('dcq.air_projection',p_id::text,true);
 target:=jsonb_build_object('add',COALESCE((SELECT jsonb_agg(d->>'service_key' ORDER BY d->>'service_key') FROM jsonb_array_elements(p_request->'plan'->'services') d WHERE d->>'disposition'<>'excluded'),'[]'::jsonb),'remove','[]'::jsonb);
 FOR f IN SELECT * FROM public.quote_facts WHERE case_id=p_case AND is_current AND fact_key IN('service.package','service.overrides') LOOP
  IF (f.fact_key='service.package' AND f.value_text IS DISTINCT FROM 'AIR_CROSS_TRADE' OR f.fact_key='service.overrides' AND f.value_json IS DISTINCT FROM target)
   AND (f.is_validated OR f.source_type IN('operator','manual_input','operator_correction')) AND NOT(COALESCE(p_request->'acknowledged_scope_fact_ids','[]'::jsonb) ? f.id::text)
  THEN RAISE EXCEPTION 'Existing operator scope requires explicit acknowledgement' USING ERRCODE='40001'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM public.quote_facts WHERE case_id=p_case AND is_current AND fact_key='service.package' AND value_text='AIR_CROSS_TRADE') THEN
  PERFORM public.supersede_fact(p_case,'service.package','service',p_value_text=>'AIR_CROSS_TRADE',p_source_type=>'operator',p_source_excerpt=>'AIR plan '||p_id::text);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.quote_facts WHERE case_id=p_case AND is_current AND fact_key='service.overrides' AND value_json=target) THEN
  PERFORM public.supersede_fact(p_case,'service.overrides','service',p_value_json=>target,p_source_type=>'operator',p_source_excerpt=>'AIR plan '||p_id::text);
 END IF;
 req:=(p_plan->'requirements')||jsonb_build_object('plan_id',p_id);
 PERFORM public.supersede_fact(p_case,'service.air_cross_trade_requirements','service',p_value_json=>req,p_source_type=>'quotation_engine',p_source_excerpt=>'Derived requirements of AIR plan '||p_id::text);
 UPDATE public.quote_cases SET request_type='AIR_CROSS_TRADE',status='DECISIONS_PENDING' WHERE id=p_case;
 ctx:=public._air_cross_trade_context(p_case);
 p_plan:=p_plan||jsonb_build_object('id',p_id,'revision',n,'context_fingerprint',md5(ctx::text));
 UPDATE public.air_cross_trade_plans SET context_hash=md5(ctx::text),plan=p_plan WHERE id=p_id RETURNING * INTO old;
 -- Same orphan rule as build-case-puzzle, restricted here to legacy city; no fact-city is created.
 UPDATE public.quote_gaps SET status=status WHERE case_id=p_case AND gap_key='routing.destination_city' AND status IN('open','pending_response');
 PERFORM set_config('dcq.air_projection',COALESCE(prev,''),true);
 RETURN to_jsonb(old);
END; $$;
CREATE FUNCTION public._air_cross_trade_bound(p_text text,p_end boolean) RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN p_text IS NULL THEN CASE WHEN p_end THEN 'infinity'::timestamptz ELSE '-infinity'::timestamptz END
 WHEN length(p_text)=10 THEN (p_text::date::timestamp AT TIME ZONE 'UTC')+CASE WHEN p_end THEN interval '1 day' - interval '1 microsecond' ELSE interval '0' END
 ELSE p_text::timestamptz END
$$;
-- Mixed-version defence: an old import worker cannot append a new run after Cross qualification.
CREATE FUNCTION public._air_cross_trade_run_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.air_cross_trade_plans;
BEGIN
 IF (SELECT request_type::text FROM public.quote_cases WHERE id=NEW.case_id)='AIR_CROSS_TRADE' THEN
  SELECT * INTO h FROM public.air_cross_trade_plans WHERE case_id=NEW.case_id ORDER BY revision DESC LIMIT 1;
  IF h.id IS NULL OR NEW.engine_version IS DISTINCT FROM 'air_cross_trade_v1' OR current_setting('dcq.air_pricing_plan',true) IS DISTINCT FROM h.id::text
  THEN RAISE EXCEPTION 'Use retained AIR operator pricing' USING ERRCODE='40001'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER air_cross_trade_run_fence BEFORE INSERT ON public.pricing_runs FOR EACH ROW EXECUTE FUNCTION public._air_cross_trade_fact_fence();
CREATE TRIGGER air_cross_trade_run_guard BEFORE INSERT ON public.pricing_runs FOR EACH ROW EXECUTE FUNCTION public._air_cross_trade_run_guard();
CREATE FUNCTION public.air_cross_trade_commit_pricing(p_id uuid,p_case uuid,p_actor uuid,p_plan uuid,p_context text,p_sources text,p_pricing jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE head public.air_cross_trade_plans; old public.air_cross_trade_pricing_receipts; ctx jsonb; src jsonb; run_id uuid:=gen_random_uuid(); n integer; a jsonb; prev text;
BEGIN
 SELECT * INTO head FROM public.air_cross_trade_plans WHERE id=p_plan AND case_id=p_case;
 IF head.id IS NULL THEN RAISE EXCEPTION 'AIR plan missing' USING ERRCODE='40001'; END IF;
 PERFORM public._air_cross_trade_lock(p_case,p_actor,head.request);
 IF EXISTS(SELECT 1 FROM public.air_cross_trade_plans WHERE id=p_id) THEN RAISE EXCEPTION 'AIR operation id reused' USING ERRCODE='40001'; END IF;
 SELECT * INTO old FROM public.air_cross_trade_pricing_receipts WHERE id=p_id;
 IF old.id IS NOT NULL THEN
  IF old.case_id IS DISTINCT FROM p_case OR old.plan_id IS DISTINCT FROM p_plan OR old.created_by IS DISTINCT FROM p_actor OR old.context_hash IS DISTINCT FROM p_context OR md5(old.source_snapshot::text) IS DISTINCT FROM p_sources THEN RAISE EXCEPTION 'AIR pricing replay mismatch' USING ERRCODE='40001'; END IF;
  RETURN to_jsonb(old);
 END IF;
 IF (SELECT id FROM public.air_cross_trade_plans WHERE case_id=p_case ORDER BY revision DESC LIMIT 1) IS DISTINCT FROM p_plan THEN RAISE EXCEPTION 'AIR plan changed' USING ERRCODE='40001'; END IF;
 PERFORM public.assert_case_source_revisions_resolved(p_case);
 IF EXISTS(SELECT 1 FROM public.quote_gaps WHERE case_id=p_case AND status IN('open','pending_response') AND is_blocking) THEN RAISE EXCEPTION 'AIR blocking gaps remain' USING ERRCODE='40001'; END IF;
 ctx:=public._air_cross_trade_context(p_case); src:=public._air_cross_trade_sources(p_case,head.request);
 IF md5(ctx::text) IS DISTINCT FROM p_context OR md5(src::text) IS DISTINCT FROM p_sources OR head.context_hash IS DISTINCT FROM p_context THEN RAISE EXCEPTION 'AIR pricing context/source changed' USING ERRCODE='40001'; END IF;
 IF COALESCE((ctx->'intent'->'intent'->>'pricing_gate')::boolean,(ctx->'intent'->>'pricing_gate')::boolean,true)=false OR COALESCE(ctx->'intent'->'intent'->>'intent_type',ctx->'intent'->>'intent_type','') IN('opportunity_check','general_inquiry','send_document') THEN RAISE EXCEPTION 'AIR pricing blocked by intent' USING ERRCODE='40001'; END IF;
 IF (SELECT status::text FROM public.quote_cases WHERE id=p_case) NOT IN('DECISIONS_PENDING','DECISIONS_COMPLETE','READY_TO_PRICE','ACK_READY_FOR_PRICING','PRICED_DRAFT','HUMAN_REVIEW','QUOTED_VERSIONED') THEN RAISE EXCEPTION 'AIR pricing case locked' USING ERRCODE='40001'; END IF;
 IF (ctx->'case'->>'request_type') IS DISTINCT FROM 'AIR_CROSS_TRADE' OR p_pricing->'facts_snapshot' IS DISTINCT FROM ctx->'facts'
 OR p_pricing->>'currency' IS DISTINCT FROM 'XOF' OR jsonb_typeof(p_pricing->'tariff_lines') IS DISTINCT FROM 'array'
 OR jsonb_array_length(p_pricing->'tariff_lines')<1 OR p_pricing->'outputs_json'->'air_cross_trade'->'plan' IS DISTINCT FROM head.plan
 THEN RAISE EXCEPTION 'Invalid AIR pricing'; END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(head.request->'attestations') LOOP
  IF public._air_cross_trade_bound(a->>'effective_from',false)>clock_timestamp() OR public._air_cross_trade_bound(a->>'effective_to',true)<clock_timestamp()
  THEN RAISE EXCEPTION 'AIR source validity changed during calculation' USING ERRCODE='40001'; END IF;
 END LOOP;
 FOR a IN SELECT value FROM jsonb_array_elements(src->'fx') LOOP
  IF public._air_cross_trade_bound(a->>'valid_from',false)>clock_timestamp() OR public._air_cross_trade_bound(a->>'valid_until',true)<clock_timestamp()
  THEN RAISE EXCEPTION 'AIR FX expired during calculation' USING ERRCODE='40001'; END IF;
 END LOOP;
 SELECT COALESCE(max(run_number),0)+1 INTO n FROM public.pricing_runs WHERE case_id=p_case;
 prev:=current_setting('dcq.air_pricing_plan',true);PERFORM set_config('dcq.air_pricing_plan',p_plan::text,true);
 INSERT INTO public.pricing_runs(id,case_id,run_number,status,currency,created_by,started_at,completed_at,facts_snapshot,inputs_json,outputs_json,tariff_lines,tariff_sources,total_ht,total_ttc,engine_version)
 VALUES(run_id,p_case,n,'success','XOF',p_actor,clock_timestamp(),clock_timestamp(),ctx->'facts',p_pricing->'inputs_json',p_pricing->'outputs_json',p_pricing->'tariff_lines',p_pricing->'tariff_sources',(p_pricing->>'total_ht')::numeric,(p_pricing->>'total_ttc')::numeric,'air_cross_trade_v1');
 UPDATE public.quote_cases SET status='PRICED_DRAFT',pricing_runs_count=n WHERE id=p_case;
 INSERT INTO public.air_cross_trade_pricing_receipts(id,case_id,plan_id,created_by,context_hash,source_snapshot,pricing_run_id)
 VALUES(p_id,p_case,p_plan,p_actor,p_context,src,run_id) RETURNING * INTO old;
 PERFORM set_config('dcq.air_pricing_plan',COALESCE(prev,''),true);
 RETURN to_jsonb(old);
END; $$;
CREATE FUNCTION public.air_cross_trade_operation(p_case uuid,p_actor uuid,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public._air_cross_trade_actor(p_actor,p_case,false);
 RETURN jsonb_build_object('plan',(SELECT to_jsonb(p)||jsonb_build_object('sources_hash',md5(p.source_snapshot::text)) FROM public.air_cross_trade_plans p WHERE case_id=p_case AND id=p_id),
 'pricing',(SELECT to_jsonb(r)||jsonb_build_object('sources_hash',md5(r.source_snapshot::text)) FROM public.air_cross_trade_pricing_receipts r WHERE case_id=p_case AND id=p_id));
END; $$;
-- Close the legacy scenario path too, including an import worker already in flight.
-- EXCLUSIVE prevents a new current-package fact (phantom) from racing this check.
-- It is non-blocking: a competing plan/fact/scenario operation must be refreshed.
CREATE FUNCTION public._air_cross_trade_assert_legacy_scenario(p_case uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_type text;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('air_cross_trade:'||p_case::text,0)) THEN
  RAISE EXCEPTION 'AIR scenario context busy; read before resuming' USING ERRCODE='40001';
 END IF;
 SELECT request_type::text INTO current_type FROM public.quote_cases WHERE id=p_case FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AIR scenario case missing' USING ERRCODE='23503'; END IF;
 IF current_type='AIR_CROSS_TRADE' OR EXISTS(
  SELECT 1 FROM public.quote_facts WHERE case_id=p_case AND is_current AND fact_key='service.package'
   AND upper(btrim(COALESCE(value_text,CASE WHEN jsonb_typeof(value_json)='string' THEN value_json#>>'{}' END,'')))='AIR_CROSS_TRADE'
 ) THEN RAISE EXCEPTION 'AIR legacy scenario requires a different workflow; retained plan cannot be bypassed' USING ERRCODE='40001'; END IF;
END; $$;
CREATE FUNCTION public._air_cross_trade_scenario_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM public._air_cross_trade_assert_legacy_scenario(NEW.case_id); RETURN NEW; END; $$;
CREATE TRIGGER air_cross_trade_scenario_guard BEFORE INSERT ON public.quote_scenario_pricing_runs FOR EACH ROW EXECUTE FUNCTION public._air_cross_trade_scenario_guard();

CREATE FUNCTION public._air_cross_trade_version_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE head uuid; retained uuid; engine text;
BEGIN
 IF NEW.source_kind='scenario' THEN PERFORM public._air_cross_trade_assert_legacy_scenario(NEW.case_id); RETURN NEW; END IF;
 IF NEW.source_kind IS DISTINCT FROM 'canonical' THEN RETURN NEW; END IF;
 SELECT engine_version INTO engine FROM public.pricing_runs WHERE id=NEW.pricing_run_id;
 IF engine='air_cross_trade_v1' OR (SELECT request_type::text FROM public.quote_cases WHERE id=NEW.case_id)='AIR_CROSS_TRADE' THEN
  SELECT id INTO head FROM public.air_cross_trade_plans WHERE case_id=NEW.case_id ORDER BY revision DESC LIMIT 1;
  SELECT plan_id INTO retained FROM public.air_cross_trade_pricing_receipts WHERE case_id=NEW.case_id AND pricing_run_id=NEW.pricing_run_id;
  IF head IS NULL OR head IS DISTINCT FROM retained THEN RAISE EXCEPTION 'AIR plan changed since pricing' USING ERRCODE='40001'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER air_cross_trade_version_guard BEFORE INSERT ON public.quotation_versions FOR EACH ROW EXECUTE FUNCTION public._air_cross_trade_version_guard();
-- Close custom default ACL grantees too. Only service_role calls these bounded RPCs.
DO $$ DECLARE f record; g record; BEGIN
 FOR g IN SELECT DISTINCT table_name,grantee FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name IN('air_cross_trade_plans','air_cross_trade_pricing_receipts') AND grantee NOT IN('postgres','authenticated','service_role') LOOP
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',g.table_name,g.grantee);
 END LOOP;
 FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'air_cross_trade_%' OR p.proname LIKE '_air_cross_trade_%') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.sig);
  FOR g IN SELECT DISTINCT grantee FROM information_schema.routine_privileges WHERE routine_schema='public' AND specific_name=(SELECT proname||'_'||oid FROM pg_proc WHERE oid=f.sig::oid) AND grantee NOT IN('postgres','service_role') LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.sig,g.grantee);
  END LOOP;
 END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION public.air_cross_trade_requirements_read(uuid,uuid),public.air_cross_trade_operation(uuid,uuid,uuid),public.air_cross_trade_read(uuid,uuid,jsonb,text),public.air_cross_trade_store_plan(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb),public.air_cross_trade_commit_pricing(uuid,uuid,uuid,uuid,text,text,jsonb) TO service_role;
COMMIT;
