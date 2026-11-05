-- Internal generation recipes: durable admission and receipts. No seed/activation.
-- Service RPCs are called only after canonical requireUser; p_actor is that user.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.has_workspace_access()') IS NULL
 OR to_regclass('public.app_roles') IS NULL OR to_regclass('public.email_drafts') IS NULL THEN
  RAISE EXCEPTION 'RECIPE_LEDGER_PREREQUISITE_MISSING';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname='quote_cases' AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts=1
 AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum=i.indkey[0] AND a.attname='thread_id')) THEN
  RAISE EXCEPTION 'RECIPE_CANONICAL_THREAD_UNIQUENESS_REQUIRED';
 END IF;
END $$;

CREATE TABLE public.generation_recipe_grants (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL, case_id uuid NOT NULL, email_id uuid NOT NULL,
 intent_hash text NOT NULL CHECK(intent_hash ~ '^[0-9a-f]{64}$'),
 starts_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(expires_at>starts_at AND expires_at-starts_at<=interval '1 hour')
);
CREATE UNIQUE INDEX generation_recipe_one_open_grant ON public.generation_recipe_grants(email_id) WHERE revoked_at IS NULL;
CREATE TABLE public.generation_recipe_attempts (
 id uuid PRIMARY KEY, grant_id uuid NOT NULL UNIQUE REFERENCES public.generation_recipe_grants(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL, case_id uuid NOT NULL, email_id uuid NOT NULL,
 intent_hash text NOT NULL CHECK(intent_hash ~ '^[0-9a-f]{64}$'), fence uuid NOT NULL,
 state text NOT NULL CHECK(state IN('running','uncertain','completed')),
 -- Deliberately not an FK: preserve existing owner-scoped draft deletion. A
 -- deleted draft never makes this immutable receipt eligible for generation.
 draft_id uuid, engine_verified boolean,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((state='completed' AND draft_id IS NOT NULL AND engine_verified IS NOT NULL)
    OR (state<>'completed' AND draft_id IS NULL AND engine_verified IS NULL))
);
CREATE UNIQUE INDEX generation_recipe_one_unresolved_email ON public.generation_recipe_attempts(email_id)
 WHERE state IN('running','uncertain');
CREATE TABLE public.generation_recipe_email_leases (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL, email_id uuid NOT NULL, fence uuid NOT NULL,
 state text NOT NULL CHECK(state IN('active','finished')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), finished_at timestamptz,
 CHECK((state='finished')=(finished_at IS NOT NULL))
);
CREATE INDEX generation_recipe_active_email_leases ON public.generation_recipe_email_leases(email_id) WHERE state='active';
-- Administrative observations only; no historical target is seeded here.
-- This does not assert the state or cancel a worker predating this migration.
CREATE TABLE public.generation_recipe_quarantines (
 email_id uuid PRIMARY KEY, case_id uuid NOT NULL, created_by uuid NOT NULL,
 reason text NOT NULL CHECK(reason='legacy_unconfirmed'), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 resolved_at timestamptz, resolution_ref text,
 CHECK((resolved_at IS NULL AND resolution_ref IS NULL) OR (resolved_at IS NOT NULL AND length(resolution_ref) BETWEEN 8 AND 500))
);
ALTER TABLE public.generation_recipe_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_recipe_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_recipe_email_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_recipe_quarantines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.generation_recipe_grants,public.generation_recipe_attempts,public.generation_recipe_email_leases,public.generation_recipe_quarantines FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.generation_recipe_assert_service() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'RECIPE_SERVICE_REQUIRED' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION public.generation_recipe_lock_actor(p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE banned timestamptz;
BEGIN
 PERFORM public.generation_recipe_assert_service();
 SELECT banned_until INTO banned FROM auth.users WHERE id=p_actor FOR SHARE;
 IF NOT FOUND OR (banned IS NOT NULL AND banned>clock_timestamp()) THEN
  RAISE EXCEPTION 'RECIPE_WORKSPACE_REQUIRED' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.app_roles WHERE user_id=p_actor AND role IN('workspace_operator','role_admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RECIPE_WORKSPACE_REQUIRED' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION public.generation_recipe_target_valid(p_case uuid,p_email uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE thread uuid; n integer; matched uuid;
BEGIN
 IF p_case IS NULL OR p_email IS NULL THEN RETURN false; END IF;
 -- A non-key thread_ref update must wait through the terminal transaction.
 SELECT thread_ref INTO thread FROM public.emails WHERE id=p_email FOR SHARE;
 IF NOT FOUND OR thread IS NULL THEN RETURN false; END IF;
 PERFORM 1 FROM public.quote_cases WHERE thread_id=thread ORDER BY id FOR SHARE;
 SELECT count(*),min(id::text)::uuid INTO n,matched FROM public.quote_cases WHERE thread_id=thread;
 RETURN n=1 AND matched=p_case;
END $$;

CREATE FUNCTION public.generation_recipe_immutable_grant() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RECIPE_GRANT_IMMUTABLE'; END IF;
 IF ROW(NEW.id,NEW.actor_id,NEW.case_id,NEW.email_id,NEW.intent_hash,NEW.starts_at,NEW.expires_at,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.actor_id,OLD.case_id,OLD.email_id,OLD.intent_hash,OLD.starts_at,OLD.expires_at,OLD.created_at)
 OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
  RAISE EXCEPTION 'RECIPE_GRANT_IMMUTABLE';
 END IF;
 IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN NEW.revoked_at=clock_timestamp(); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER generation_recipe_grant_immutable BEFORE UPDATE OR DELETE ON public.generation_recipe_grants
 FOR EACH ROW EXECUTE FUNCTION public.generation_recipe_immutable_grant();
CREATE FUNCTION public.generation_recipe_immutable_attempt() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RECIPE_ATTEMPT_IMMUTABLE'; END IF;
 IF ROW(NEW.id,NEW.grant_id,NEW.actor_id,NEW.case_id,NEW.email_id,NEW.intent_hash,NEW.fence,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.grant_id,OLD.actor_id,OLD.case_id,OLD.email_id,OLD.intent_hash,OLD.fence,OLD.created_at)
 OR OLD.state<>'running' OR NEW.state NOT IN('uncertain','completed') THEN
  RAISE EXCEPTION 'RECIPE_ATTEMPT_IMMUTABLE';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER generation_recipe_attempt_immutable BEFORE UPDATE OR DELETE ON public.generation_recipe_attempts
 FOR EACH ROW EXECUTE FUNCTION public.generation_recipe_immutable_attempt();
CREATE FUNCTION public.generation_recipe_immutable_lease() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.state='active' THEN RAISE EXCEPTION 'RECIPE_LEASE_UNRESOLVED'; END IF;
  RETURN OLD;
 END IF;
 IF ROW(NEW.id,NEW.actor_id,NEW.email_id,NEW.fence,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.actor_id,OLD.email_id,OLD.fence,OLD.created_at)
 OR OLD.state<>'active' OR NEW.state<>'finished' THEN RAISE EXCEPTION 'RECIPE_LEASE_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER generation_recipe_lease_immutable BEFORE UPDATE OR DELETE ON public.generation_recipe_email_leases
 FOR EACH ROW EXECUTE FUNCTION public.generation_recipe_immutable_lease();
CREATE FUNCTION public.generation_recipe_immutable_quarantine() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RECIPE_QUARANTINE_IMMUTABLE'; END IF;
 IF ROW(NEW.email_id,NEW.case_id,NEW.created_by,NEW.reason,NEW.created_at) IS DISTINCT FROM ROW(OLD.email_id,OLD.case_id,OLD.created_by,OLD.reason,OLD.created_at)
 OR OLD.resolved_at IS NOT NULL OR NEW.resolved_at IS NULL OR NEW.resolution_ref IS NULL THEN RAISE EXCEPTION 'RECIPE_QUARANTINE_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER generation_recipe_quarantine_immutable BEFORE UPDATE OR DELETE ON public.generation_recipe_quarantines
 FOR EACH ROW EXECUTE FUNCTION public.generation_recipe_immutable_quarantine();

CREATE FUNCTION public.register_generation_recipe_grant(p_grant uuid,p_actor uuid,p_case uuid,p_email uuid,p_hash text,p_starts timestamptz,p_expires timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g public.generation_recipe_grants;
BEGIN
 PERFORM public.generation_recipe_assert_service();
 IF p_grant IS NULL OR p_actor IS NULL OR p_case IS NULL OR p_email IS NULL OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$'
 OR p_starts IS NULL OR p_expires IS NULL OR p_expires<=p_starts OR p_expires-p_starts>interval '1 hour' THEN RETURN jsonb_build_object('kind','invalid'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('recipe-grant:'||p_grant::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('recipe-email:'||p_email::text,0));
 PERFORM public.generation_recipe_lock_actor(p_actor);
 SELECT * INTO g FROM public.generation_recipe_grants WHERE id=p_grant FOR SHARE;
 IF FOUND THEN
  IF ROW(g.actor_id,g.case_id,g.email_id,g.intent_hash,g.starts_at,g.expires_at) IS DISTINCT FROM ROW(p_actor,p_case,p_email,p_hash,p_starts,p_expires) THEN RETURN jsonb_build_object('kind','conflict'); END IF;
  RETURN jsonb_build_object('kind',CASE WHEN g.revoked_at IS NULL THEN 'registered' ELSE 'revoked' END);
 END IF;
 IF p_starts>clock_timestamp() OR p_expires<=clock_timestamp() THEN RETURN jsonb_build_object('kind','window_closed'); END IF;
 IF NOT public.generation_recipe_target_valid(p_case,p_email) THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 IF EXISTS(SELECT 1 FROM public.generation_recipe_quarantines WHERE email_id=p_email AND resolved_at IS NULL)
 OR EXISTS(SELECT 1 FROM public.generation_recipe_email_leases WHERE email_id=p_email AND state='active')
 OR EXISTS(SELECT 1 FROM public.generation_recipe_grants WHERE email_id=p_email AND revoked_at IS NULL)
 OR EXISTS(SELECT 1 FROM public.generation_recipe_attempts WHERE email_id=p_email AND state IN('running','uncertain')) THEN RETURN jsonb_build_object('kind','unresolved'); END IF;
 IF EXISTS(SELECT 1 FROM public.email_drafts WHERE original_email_id=p_email) THEN RETURN jsonb_build_object('kind','draft_exists'); END IF;
 INSERT INTO public.generation_recipe_grants(id,actor_id,case_id,email_id,intent_hash,starts_at,expires_at)
 VALUES(p_grant,p_actor,p_case,p_email,p_hash,p_starts,p_expires);
 RETURN jsonb_build_object('kind','registered');
END $$;

CREATE FUNCTION public.claim_generation_recipe_attempt(p_grant uuid,p_attempt uuid,p_actor uuid,p_hash text,p_fence uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g public.generation_recipe_grants; a public.generation_recipe_attempts;
BEGIN
 PERFORM public.generation_recipe_assert_service();
 IF p_grant IS NULL OR p_attempt IS NULL OR p_actor IS NULL OR p_fence IS NULL OR p_hash IS NULL THEN RETURN jsonb_build_object('kind','invalid'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('recipe-attempt:'||p_attempt::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('recipe-grant:'||p_grant::text,0));
 SELECT * INTO g FROM public.generation_recipe_grants WHERE id=p_grant;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('recipe-email:'||g.email_id::text,0));
 PERFORM public.generation_recipe_lock_actor(p_actor);
 SELECT * INTO g FROM public.generation_recipe_grants WHERE id=p_grant FOR SHARE;
 IF g.actor_id<>p_actor OR g.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 IF g.intent_hash<>p_hash THEN RETURN jsonb_build_object('kind','conflict'); END IF;
 SELECT * INTO a FROM public.generation_recipe_attempts WHERE id=p_attempt;
 IF FOUND AND (a.grant_id<>p_grant OR a.actor_id<>p_actor) THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 SELECT * INTO a FROM public.generation_recipe_attempts WHERE grant_id=p_grant;
 IF FOUND THEN RETURN jsonb_build_object('kind',CASE WHEN a.state='completed' THEN 'replay' ELSE 'unresolved' END); END IF;
 IF g.starts_at>clock_timestamp() OR g.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('kind','window_closed'); END IF;
 IF EXISTS(SELECT 1 FROM public.generation_recipe_quarantines WHERE email_id=g.email_id AND resolved_at IS NULL)
 OR EXISTS(SELECT 1 FROM public.generation_recipe_email_leases WHERE email_id=g.email_id AND state='active')
 OR EXISTS(SELECT 1 FROM public.generation_recipe_attempts WHERE email_id=g.email_id AND state IN('running','uncertain')) THEN RETURN jsonb_build_object('kind','unresolved'); END IF;
 IF NOT public.generation_recipe_target_valid(g.case_id,g.email_id) THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 IF EXISTS(SELECT 1 FROM public.email_drafts WHERE original_email_id=g.email_id) THEN RETURN jsonb_build_object('kind','draft_exists'); END IF;
 INSERT INTO public.generation_recipe_attempts(id,grant_id,actor_id,case_id,email_id,intent_hash,fence,state)
 VALUES(p_attempt,p_grant,p_actor,g.case_id,g.email_id,p_hash,p_fence,'running');
 RETURN jsonb_build_object('kind','started');
END $$;

CREATE FUNCTION public.finish_generation_recipe_attempt(p_attempt uuid,p_actor uuid,p_fence uuid,p_subject text,p_body text,p_to text,p_engine_verified boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.generation_recipe_attempts; g public.generation_recipe_grants; draft uuid;
BEGIN
 PERFORM public.generation_recipe_assert_service();
 IF p_attempt IS NULL OR p_actor IS NULL OR p_fence IS NULL THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('recipe-attempt:'||p_attempt::text,0));
 SELECT * INTO a FROM public.generation_recipe_attempts WHERE id=p_attempt;
 IF NOT FOUND OR a.actor_id<>p_actor OR a.fence<>p_fence THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('recipe-grant:'||a.grant_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('recipe-email:'||a.email_id::text,0));
 PERFORM public.generation_recipe_lock_actor(p_actor);
 SELECT * INTO g FROM public.generation_recipe_grants WHERE id=a.grant_id FOR SHARE;
 SELECT * INTO a FROM public.generation_recipe_attempts WHERE id=p_attempt FOR UPDATE;
 IF g.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 IF a.state='completed' THEN RETURN jsonb_build_object('kind','completed'); END IF;
 IF a.state<>'running' THEN RETURN jsonb_build_object('kind','unresolved'); END IF;
 IF g.expires_at<=clock_timestamp() THEN
  UPDATE public.generation_recipe_attempts SET state='uncertain',updated_at=clock_timestamp() WHERE id=p_attempt;
  RETURN jsonb_build_object('kind','unresolved');
 END IF;
 IF NOT public.generation_recipe_target_valid(a.case_id,a.email_id) THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 IF p_subject IS NULL OR p_body IS NULL OR p_subject NOT LIKE '[RECETTE AUTH]%' OR p_body NOT LIKE '[RECETTE AUTH — NE PAS ENVOYER]%'
 OR length(p_subject)>2000 OR length(p_body)>200000 OR p_to IS NULL OR length(p_to) NOT BETWEEN 1 AND 320 OR p_engine_verified IS NULL THEN RETURN jsonb_build_object('kind','invalid'); END IF;
 INSERT INTO public.email_drafts(original_email_id,to_addresses,subject,body_text,status,ai_generated,created_by)
 VALUES(a.email_id,ARRAY[p_to],p_subject,p_body,'draft',true,p_actor) RETURNING id INTO draft;
 IF NOT EXISTS(SELECT 1 FROM public.email_drafts WHERE id=draft AND created_by=p_actor AND original_email_id=a.email_id AND status='draft' AND sent_at IS NULL) THEN RAISE EXCEPTION 'RECIPE_DRAFT_NOT_PERSISTED'; END IF;
 UPDATE public.generation_recipe_attempts SET state='completed',draft_id=draft,engine_verified=p_engine_verified,updated_at=clock_timestamp() WHERE id=p_attempt;
 RETURN jsonb_build_object('kind','completed');
END $$;

CREATE FUNCTION public.mark_generation_recipe_uncertain(p_attempt uuid,p_actor uuid,p_fence uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.generation_recipe_attempts;
BEGIN
 PERFORM public.generation_recipe_assert_service();
 IF p_attempt IS NULL OR p_actor IS NULL OR p_fence IS NULL THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('recipe-attempt:'||p_attempt::text,0));
 SELECT * INTO a FROM public.generation_recipe_attempts WHERE id=p_attempt FOR UPDATE;
 IF NOT FOUND OR a.actor_id<>p_actor OR a.fence<>p_fence THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 -- Internal fenced audit only; no result/identity disclosure, no admission or release.
 IF a.state='running' THEN UPDATE public.generation_recipe_attempts SET state='uncertain',updated_at=clock_timestamp() WHERE id=p_attempt; END IF;
 RETURN jsonb_build_object('kind','retained');
END $$;

CREATE FUNCTION public.read_generation_recipe_receipt(p_grant uuid,p_actor uuid,p_case uuid,p_email uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g public.generation_recipe_grants; a public.generation_recipe_attempts;
BEGIN
 PERFORM public.generation_recipe_assert_service();
 PERFORM public.generation_recipe_lock_actor(p_actor);
 SELECT * INTO g FROM public.generation_recipe_grants WHERE id=p_grant;
 IF NOT FOUND OR g.actor_id IS DISTINCT FROM p_actor OR g.case_id IS DISTINCT FROM p_case OR g.email_id IS DISTINCT FROM p_email THEN RETURN jsonb_build_object('kind','not_found'); END IF;
 SELECT * INTO a FROM public.generation_recipe_attempts WHERE grant_id=p_grant;
 RETURN jsonb_build_object('kind','receipt','grant_id',g.id,'actor_id',g.actor_id,'case_id',g.case_id,'email_id',g.email_id,
  'state',coalesce(a.state,'authorized'),'attempt_id',a.id,'draft_id',a.draft_id,'engine_verified',a.engine_verified,'revoked',g.revoked_at IS NOT NULL);
END $$;
CREATE FUNCTION public.revoke_generation_recipe_grant(p_grant uuid,p_actor uuid,p_case uuid,p_email uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g public.generation_recipe_grants;
BEGIN
 PERFORM public.generation_recipe_assert_service();
 PERFORM pg_advisory_xact_lock(hashtextextended('recipe-grant:'||p_grant::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('recipe-email:'||p_email::text,0));
 PERFORM public.generation_recipe_lock_actor(p_actor);
 SELECT * INTO g FROM public.generation_recipe_grants WHERE id=p_grant FOR UPDATE;
 IF NOT FOUND OR g.actor_id IS DISTINCT FROM p_actor OR g.case_id IS DISTINCT FROM p_case OR g.email_id IS DISTINCT FROM p_email THEN RETURN jsonb_build_object('kind','not_found'); END IF;
 IF g.revoked_at IS NULL THEN UPDATE public.generation_recipe_grants SET revoked_at=clock_timestamp() WHERE id=p_grant; END IF;
 RETURN jsonb_build_object('kind','revoked');
END $$;

-- Every new ordinary/V1 email request reserves before any AI/mutation. Grant
-- registration uses the SAME email lock, closing guard->claim races. These
-- leases neither claim idempotence for normal replies nor track old workers.
CREATE FUNCTION public.begin_generation_email_lease(p_lease uuid,p_actor uuid,p_email uuid,p_fence uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM public.generation_recipe_assert_service();
 IF p_lease IS NULL OR p_actor IS NULL OR p_email IS NULL OR p_fence IS NULL THEN RETURN jsonb_build_object('kind','invalid'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('recipe-email:'||p_email::text,0));
 PERFORM public.generation_recipe_lock_actor(p_actor);
 IF NOT EXISTS(SELECT 1 FROM public.emails WHERE id=p_email) THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 IF EXISTS(SELECT 1 FROM public.generation_recipe_quarantines WHERE email_id=p_email AND resolved_at IS NULL)
 OR EXISTS(SELECT 1 FROM public.generation_recipe_grants WHERE email_id=p_email AND revoked_at IS NULL)
 OR EXISTS(SELECT 1 FROM public.generation_recipe_attempts WHERE email_id=p_email AND state IN('running','uncertain'))
 OR EXISTS(SELECT 1 FROM public.generation_recipe_email_leases WHERE email_id=p_email AND state='active') THEN RETURN jsonb_build_object('kind','unresolved'); END IF;
 INSERT INTO public.generation_recipe_email_leases(id,actor_id,email_id,fence,state) VALUES(p_lease,p_actor,p_email,p_fence,'active');
 RETURN jsonb_build_object('kind','started');
END $$;
CREATE FUNCTION public.finish_generation_email_lease(p_lease uuid,p_actor uuid,p_fence uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM public.generation_recipe_assert_service();
 IF p_lease IS NULL OR p_actor IS NULL OR p_fence IS NULL THEN RETURN jsonb_build_object('kind','forbidden'); END IF;
 UPDATE public.generation_recipe_email_leases SET state='finished',finished_at=clock_timestamp()
 WHERE id=p_lease AND actor_id=p_actor AND fence=p_fence AND state='active';
 RETURN jsonb_build_object('kind','retained');
END $$;

-- Revoke Supabase default function grants explicitly, including private helpers.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN(
 'generation_recipe_assert_service','generation_recipe_lock_actor','generation_recipe_target_valid','generation_recipe_immutable_grant','generation_recipe_immutable_attempt','generation_recipe_immutable_lease','generation_recipe_immutable_quarantine',
 'register_generation_recipe_grant','claim_generation_recipe_attempt','finish_generation_recipe_attempt','mark_generation_recipe_uncertain',
 'read_generation_recipe_receipt','revoke_generation_recipe_grant','begin_generation_email_lease','finish_generation_email_lease') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
  IF f.signature::text NOT LIKE '%generation_recipe_assert_service(%' AND f.signature::text NOT LIKE '%generation_recipe_lock_actor(%'
   AND f.signature::text NOT LIKE '%generation_recipe_target_valid(%' AND f.signature::text NOT LIKE '%generation_recipe_immutable_%' THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  END IF;
 END LOOP;
END $$;
COMMIT;
