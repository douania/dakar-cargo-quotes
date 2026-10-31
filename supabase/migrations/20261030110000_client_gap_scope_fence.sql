-- CANDIDATE LOCAL ONLY. No existing data rewritten, no table grants/RLS changed.
-- Scope = ids/keys/blocking of OPEN gaps; not source-email text or pricing approval.
-- Fail-fast serialization is imposed by DB triggers even for old direct writers.
BEGIN;
CREATE FUNCTION public.client_gap_lock_v1(p_case uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_case IS NOT NULL AND NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('client_gap_scope:'||p_case::text,0)) THEN
  RAISE EXCEPTION 'CLIENT_GAP_SCOPE_BUSY' USING ERRCODE='PT409';
 END IF;
END $$;
CREATE FUNCTION public.client_gap_snapshot_v1(p_case uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id::text,'key',g.gap_key,'blocking',coalesce(g.is_blocking,false)) ORDER BY g.id),'[]'::jsonb)
 FROM public.quote_gaps g WHERE g.case_id=p_case AND g.status='open'
$$;
CREATE FUNCTION public.client_gap_scope_matches_v1(p_data jsonb,p_case uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(p_data->'client_question_policy_version'='4'::jsonb
   AND p_data#>'{client_gap_guard,version}'='1'::jsonb
   AND jsonb_typeof(p_data#>'{client_gap_guard,scope}')='array'
   AND p_data#>'{client_gap_guard,scope}'=public.client_gap_snapshot_v1(p_case),false)
$$;
CREATE FUNCTION public.client_gap_current_guard_v1(p_data jsonb,p_case uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(p_data->'client_gap_fence_version'='1'::jsonb AND public.client_gap_scope_matches_v1(p_data,p_case),false)
$$;
CREATE FUNCTION public.client_gap_lock_row_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_case uuid; new_case uuid; c uuid; d jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN old_case:=OLD.case_id; END IF;
 IF TG_OP<>'DELETE' THEN new_case:=NEW.case_id; END IF;
 IF TG_TABLE_NAME='case_timeline_events' THEN
  d:=CASE WHEN TG_OP='DELETE' THEN OLD.event_data ELSE NEW.event_data END;
  IF NOT coalesce((coalesce(d->>'action_code','')='REQUEST_CLIENT_INFO_FOR_GAPS'
    OR coalesce(d->>'source_action_dedupe_key','') LIKE 'REQUEST_CLIENT_INFO_FOR_GAPS:%'
    OR (d->>'kind'='reply_draft_v1' AND jsonb_typeof(d->'requested_gap_keys')='array' AND d->'requested_gap_keys'<>'[]'::jsonb)),false) THEN
   IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
 END IF;
 FOR c IN SELECT DISTINCT x FROM unnest(ARRAY[old_case,new_case]) x WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM public.client_gap_lock_v1(c);
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE FUNCTION public.client_gap_request_fence_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source_data jsonb; source_case uuid; intent_headers jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN
  -- State transitions already implied by the actual writers; prevent late regressions.
  IF OLD.status IS DISTINCT FROM NEW.status AND NOT(
    (OLD.status='drafted' AND NEW.status IN('sent','answered','cancelled')) OR
    (OLD.status='sent' AND NEW.status='answered') OR
    (OLD.status='answered' AND NEW.status='validated')) THEN
   RAISE EXCEPTION 'CLIENT_GAP_STALE_TRANSITION' USING ERRCODE='PT409';
  END IF;
  -- ON DELETE SET NULL stays legal; no new retention or deletion policy.
  IF OLD.status='answered' AND NEW.status='answered' AND OLD.response_email_id IS NOT NULL AND NEW.response_email_id IS NOT NULL
    AND OLD.response_email_id IS DISTINCT FROM NEW.response_email_id THEN
   RAISE EXCEPTION 'CLIENT_GAP_ANSWER_ALREADY_RECORDED' USING ERRCODE='PT409';
  END IF;
  IF OLD.status='validated' AND NEW.status='validated' AND OLD.validated_fact_id IS NOT NULL AND NEW.validated_fact_id IS NOT NULL
    AND OLD.validated_fact_id IS DISTINCT FROM NEW.validated_fact_id THEN
   RAISE EXCEPTION 'CLIENT_GAP_VALIDATION_ALREADY_RECORDED' USING ERRCODE='PT409';
  END IF;
  IF OLD.status='drafted' AND NEW.status='sent' THEN
   SELECT e.event_data INTO source_data FROM public.case_timeline_events e
    WHERE e.id=OLD.source_timeline_event_id AND e.case_id=OLD.case_id;
   IF source_data->'client_question_policy_version'='4'::jsonb AND source_data->'client_gap_fence_version'='1'::jsonb THEN
    -- PostgREST transaction metadata, not a new right or secret. Old callers
    -- cannot acknowledge a newer draft merely by looking up its gap key.
    intent_headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
    IF intent_headers->>'x-dcq-client-gap-request-id' IS DISTINCT FROM OLD.id::text
      OR intent_headers->>'x-dcq-client-gap-source-id' IS DISTINCT FROM OLD.source_timeline_event_id::text THEN
     RAISE EXCEPTION 'CLIENT_GAP_EXPECTED_SOURCE_REQUIRED' USING ERRCODE='PT409';
    END IF;
   END IF;
  END IF;
  IF OLD.status='drafted' AND NEW.status='cancelled' THEN
   SELECT e.event_data INTO source_data FROM public.case_timeline_events e
    WHERE e.id=OLD.source_timeline_event_id AND e.case_id=OLD.case_id;
   IF public.client_gap_current_guard_v1(source_data,OLD.case_id) THEN
    RAISE EXCEPTION 'CLIENT_GAP_CURRENT_DRAFT_PROTECTED' USING ERRCODE='PT409';
   END IF;
  END IF;
 END IF;
 IF TG_OP='INSERT' AND NEW.status IN('drafted','sent','answered') AND NOT EXISTS(SELECT 1 FROM public.quote_gaps g WHERE g.case_id=NEW.case_id AND g.gap_key=NEW.gap_key AND g.status='open') THEN
  RAISE EXCEPTION 'CLIENT_GAP_SCOPE_CHANGED' USING ERRCODE='PT409';
 END IF;
 IF TG_OP='INSERT' OR NEW.source_timeline_event_id IS DISTINCT FROM OLD.source_timeline_event_id THEN
  SELECT e.event_data,e.case_id INTO source_data,source_case FROM public.case_timeline_events e WHERE e.id=NEW.source_timeline_event_id;
  IF source_data->'client_question_policy_version'='4'::jsonb THEN
   IF source_case IS DISTINCT FROM NEW.case_id OR NOT public.client_gap_current_guard_v1(source_data,NEW.case_id)
     OR source_data->>'kind' IS DISTINCT FROM 'reply_draft_v1' OR jsonb_typeof(source_data->'requested_gap_keys') IS DISTINCT FROM 'array'
     OR NOT coalesce(source_data->'requested_gap_keys' ? NEW.gap_key,false) THEN
    RAISE EXCEPTION 'CLIENT_GAP_SCOPE_CHANGED' USING ERRCODE='PT409';
   END IF;
  ELSIF TG_OP='INSERT' AND NEW.status IN('drafted','sent','answered') THEN
   -- An old worker cannot bind a late legacy message over protected newer work.
   IF EXISTS(SELECT 1 FROM public.case_timeline_events e WHERE e.case_id=NEW.case_id
      AND e.event_data->>'kind'='reply_draft_v1' AND e.event_data->'requested_gap_keys' ? NEW.gap_key
      AND public.client_gap_current_guard_v1(e.event_data,NEW.case_id))
     OR EXISTS(SELECT 1 FROM public.client_gap_requests r JOIN public.case_timeline_events e ON e.id=r.source_timeline_event_id AND e.case_id=r.case_id
       WHERE r.case_id=NEW.case_id AND r.gap_key=NEW.gap_key AND r.status<>'cancelled' AND e.event_data->'client_question_policy_version'='4'::jsonb) THEN
    RAISE EXCEPTION 'CLIENT_GAP_LEGACY_WRITE_BLOCKED' USING ERRCODE='PT409';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.client_gap_event_fence_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d jsonb:=NEW.event_data; current_action boolean;
BEGIN
 IF d->'client_question_policy_version'='4'::jsonb AND
   ((NEW.event_type='manual_action' AND d->>'status'='open') OR (NEW.event_type='output_generated' AND d->>'kind'='reply_draft_v1')) THEN
  IF jsonb_typeof(d->'requested_gap_keys') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'CLIENT_GAP_INVALID_SCOPE' USING ERRCODE='PT409';
  END IF;
  IF jsonb_array_length(d->'requested_gap_keys')=0 OR EXISTS(
    SELECT 1 FROM jsonb_array_elements_text(d->'requested_gap_keys') k
    WHERE NOT EXISTS(SELECT 1 FROM public.quote_gaps g WHERE g.case_id=NEW.case_id AND g.gap_key=k AND g.status='open' AND g.is_blocking=true)) THEN
   RAISE EXCEPTION 'CLIENT_GAP_INVALID_SCOPE' USING ERRCODE='PT409';
  END IF;
 END IF;
 IF NEW.event_type='manual_action' AND d->>'action_code'='REQUEST_CLIENT_INFO_FOR_GAPS' THEN
  IF d->>'status'='done' AND NEW.actor_type='system' THEN
   -- The old worker may have copied an UNTAGGED earlier event with the same key.
   SELECT EXISTS(SELECT 1 FROM (
     SELECT DISTINCT ON(e.event_data->>'dedupe_key') e.event_data
     FROM public.case_timeline_events e WHERE e.case_id=NEW.case_id AND e.event_type='manual_action'
       AND e.event_data->>'action_code'='REQUEST_CLIENT_INFO_FOR_GAPS'
     ORDER BY e.event_data->>'dedupe_key',e.created_at DESC,e.id DESC
    ) x WHERE x.event_data->>'dedupe_key'=d->>'dedupe_key' AND x.event_data->>'status'='open'
      AND public.client_gap_current_guard_v1(x.event_data,NEW.case_id)) INTO current_action;
   IF current_action OR public.client_gap_current_guard_v1(d,NEW.case_id) OR EXISTS(
    SELECT 1 FROM public.client_gap_requests r JOIN public.case_timeline_events e ON e.id=r.source_timeline_event_id AND e.case_id=r.case_id
    WHERE r.case_id=NEW.case_id AND r.status IN('drafted','sent','answered')
      AND e.event_data->>'source_action_dedupe_key'=d->>'dedupe_key' AND public.client_gap_current_guard_v1(e.event_data,NEW.case_id)) THEN
    RAISE EXCEPTION 'CLIENT_GAP_CURRENT_ACTION_PROTECTED' USING ERRCODE='PT409';
   END IF;
  ELSIF d->>'status'='open' THEN
   IF d->'client_question_policy_version'='4'::jsonb THEN
    IF NOT public.client_gap_scope_matches_v1(d,NEW.case_id) THEN
     RAISE EXCEPTION 'CLIENT_GAP_SCOPE_CHANGED' USING ERRCODE='PT409';
    END IF;
   ELSIF EXISTS(SELECT 1 FROM (
     SELECT DISTINCT ON(e.event_data->>'dedupe_key') e.event_data FROM public.case_timeline_events e
     WHERE e.case_id=NEW.case_id AND e.event_type='manual_action' AND e.event_data->>'action_code'='REQUEST_CLIENT_INFO_FOR_GAPS'
     ORDER BY e.event_data->>'dedupe_key',e.created_at DESC,e.id DESC
    ) x WHERE x.event_data->>'status'='open' AND public.client_gap_current_guard_v1(x.event_data,NEW.case_id)) OR EXISTS(
     SELECT 1 FROM public.client_gap_requests r JOIN public.case_timeline_events e ON e.id=r.source_timeline_event_id AND e.case_id=r.case_id
     WHERE r.case_id=NEW.case_id AND r.status IN('drafted','sent','answered') AND public.client_gap_current_guard_v1(e.event_data,NEW.case_id)) THEN
    RAISE EXCEPTION 'CLIENT_GAP_LEGACY_ACTION_BLOCKED' USING ERRCODE='PT409';
   END IF;
  END IF;
 ELSIF NEW.event_type='output_generated' AND d->>'kind'='reply_draft_v1' AND d->'client_question_policy_version'='4'::jsonb THEN
  IF NOT public.client_gap_scope_matches_v1(d,NEW.case_id) THEN
   RAISE EXCEPTION 'CLIENT_GAP_SCOPE_CHANGED' USING ERRCODE='PT409';
  END IF;
 END IF;
 IF d->'client_question_policy_version'='4'::jsonb AND ((NEW.event_type='manual_action' AND d->>'status'='open') OR (NEW.event_type='output_generated' AND d->>'kind'='reply_draft_v1')) THEN
  NEW.event_data:=jsonb_set(NEW.event_data,'{client_gap_fence_version}','1'::jsonb,true);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.client_gap_lock_v1(uuid),public.client_gap_snapshot_v1(uuid),public.client_gap_scope_matches_v1(jsonb,uuid),public.client_gap_current_guard_v1(jsonb,uuid),
 public.client_gap_lock_row_v1(),public.client_gap_request_fence_v1(),public.client_gap_event_fence_v1() FROM PUBLIC, anon, authenticated, service_role;
-- Also close grants inherited for custom roles through ALTER DEFAULT PRIVILEGES.
-- Only these seven NEW functions are touched, never existing functions or default ACLs.
DO $private_helpers$
DECLARE grant_row record;
BEGIN
 FOR grant_row IN
  SELECT p.oid,r.rolname FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  JOIN pg_catalog.pg_roles r ON r.oid=a.grantee
  WHERE a.grantee<>p.proowner AND p.oid=ANY(ARRAY[
   'public.client_gap_lock_v1(uuid)'::regprocedure::oid,'public.client_gap_snapshot_v1(uuid)'::regprocedure::oid,
   'public.client_gap_scope_matches_v1(jsonb,uuid)'::regprocedure::oid,'public.client_gap_current_guard_v1(jsonb,uuid)'::regprocedure::oid,
   'public.client_gap_lock_row_v1()'::regprocedure::oid,'public.client_gap_request_fence_v1()'::regprocedure::oid,
   'public.client_gap_event_fence_v1()'::regprocedure::oid])
 LOOP
  EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM %I',grant_row.oid::regprocedure,grant_row.rolname);
 END LOOP;
END $private_helpers$;
-- No grants to anon/authenticated/service_role: these helpers are trigger-only.
CREATE TRIGGER a0_client_gap_scope_lock BEFORE INSERT OR UPDATE OR DELETE ON public.quote_gaps FOR EACH ROW EXECUTE FUNCTION public.client_gap_lock_row_v1();
CREATE TRIGGER a0_client_gap_scope_lock BEFORE INSERT OR UPDATE OR DELETE ON public.client_gap_requests FOR EACH ROW EXECUTE FUNCTION public.client_gap_lock_row_v1();
CREATE TRIGGER a1_client_gap_request_fence BEFORE INSERT OR UPDATE ON public.client_gap_requests FOR EACH ROW EXECUTE FUNCTION public.client_gap_request_fence_v1();
CREATE TRIGGER a0_client_gap_scope_lock BEFORE INSERT OR UPDATE OR DELETE ON public.case_timeline_events FOR EACH ROW EXECUTE FUNCTION public.client_gap_lock_row_v1();
CREATE TRIGGER a1_client_gap_event_fence BEFORE INSERT ON public.case_timeline_events FOR EACH ROW EXECUTE FUNCTION public.client_gap_event_fence_v1();
COMMIT;
