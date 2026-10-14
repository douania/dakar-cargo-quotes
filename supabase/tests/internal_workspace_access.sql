-- À exécuter seulement dans une base de recette autorisée, après les deux migrations.
-- Données fictives, transaction intégralement annulée ; aucun accès IMAP.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST_FAILED: %', label; END IF; END $$;

INSERT INTO auth.users(id,email,banned_until) VALUES
 ('a7000000-0000-4000-8000-000000000001','workspace-operator@example.invalid',NULL),
 ('a7000000-0000-4000-8000-000000000002','workspace-admin@example.invalid',NULL),
 ('a7000000-0000-4000-8000-000000000003','workspace-external@example.invalid',NULL),
 ('a7000000-0000-4000-8000-000000000004','workspace-banned@example.invalid',now()+interval '1 day');
INSERT INTO public.app_roles(user_id,role) VALUES
 ('a7000000-0000-4000-8000-000000000001','workspace_operator'),
 ('a7000000-0000-4000-8000-000000000002','role_admin'),
 ('a7000000-0000-4000-8000-000000000004','role_admin');

-- Comparaison de cardinalité seulement : aucune valeur métier n'est restituée.
SELECT set_config('test.emails_count',(SELECT count(*)::text FROM public.emails),true);
SELECT set_config('test.cases_count',(SELECT count(*)::text FROM public.quote_cases),true);
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.read_mailbox_secret(uuid)','EXECUTE'),'anon secret ACL');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.read_mailbox_secret(uuid)','EXECUTE'),'operator secret ACL');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.select_quotation_version(uuid,uuid)','EXECUTE'),'anon version ACL');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.claim_attachment_for_analysis(uuid,timestamptz)','EXECUTE'),'claim server-only');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.finalize_attachment_analysis(uuid,timestamptz,text,jsonb)','EXECUTE'),'finalize server-only');
SELECT pg_temp.assert_true(NOT has_schema_privilege('authenticated','vault','USAGE'),'Vault schema server-only');
SELECT pg_temp.assert_true(NOT (SELECT public FROM storage.buckets WHERE id='quotation-attachments'),'private bucket');
SELECT pg_temp.assert_true((SELECT count(*)=4 FROM storage.buckets
  WHERE id IN ('documents','case-documents','quotation-attachments','database_export_15_09_26')
    AND public IS FALSE),'all protected buckets private');
SELECT pg_temp.assert_true((SELECT count(*)=50 FROM pg_policies
  WHERE schemaname='public' AND policyname='workspace_members_only'
    AND permissive='RESTRICTIVE' AND cmd='ALL' AND with_check IS NOT NULL),'50 restrictive read/write policies');
DO $$ DECLARE signature text; BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.commit_decision_atomic(uuid,text,text,uuid,text,text,text,text,text,uuid)',
    'public.insert_quotation_version_atomic(uuid,uuid,uuid,integer,jsonb,uuid)',
    'public.insert_historical_quotation_atomic(jsonb,jsonb,jsonb)',
    'public.get_next_pricing_run_number(uuid)',
    'public.get_next_quotation_version_number(uuid)',
    'public.migrate_legacy_quotations(uuid)',
    'public.finalize_quotation_ownership()',
    'public.check_quotation_ownership_status()',
    'public.claim_attachment_for_analysis(uuid,timestamptz)',
    'public.release_attachment_claim(uuid,timestamptz)',
    'public.finalize_attachment_analysis(uuid,timestamptz,text,jsonb)',
    'public.finalize_attachment_analysis_error(uuid,timestamptz,text,jsonb)',
    'public.set_mailbox_secret(uuid,text)',
    'public.read_mailbox_secret(uuid)',
    'public.create_mailbox_config(jsonb,text)',
    'public.migrate_legacy_imap_secrets()'
  ] LOOP
    PERFORM pg_temp.assert_true(NOT has_function_privilege('anon',signature,'EXECUTE'),'anon denied: '||signature);
    PERFORM pg_temp.assert_true(NOT has_function_privilege('authenticated',signature,'EXECUTE'),'client denied: '||signature);
    PERFORM pg_temp.assert_true(has_function_privilege('service_role',signature,'EXECUTE'),'service retained: '||signature);
  END LOOP;
END $$;


SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role','anon',true),set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.assert_true(NOT public.has_workspace_access(),'anonymous not admitted');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.emails),'anonymous emails denied');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM storage.objects),'anonymous files denied');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','a7000000-0000-4000-8000-000000000003',true);
SELECT pg_temp.assert_true(NOT public.has_workspace_access(),'authenticated outsider not admitted');
-- Chaque policy créée est réellement exécutée, malgré les anciens grants/policies.
DO $$ DECLARE t record; n bigint; BEGIN
  FOR t IN SELECT tablename FROM pg_policies WHERE schemaname='public' AND policyname='workspace_members_only' LOOP
    EXECUTE format('SELECT count(*) FROM public.%I',t.tablename) INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'OUTSIDER_READ: %',t.tablename; END IF;
    BEGIN
      EXECUTE format('DELETE FROM public.%I',t.tablename);
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n <> 0 THEN RAISE EXCEPTION 'OUTSIDER_DELETE: %',t.tablename; END IF;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  BEGIN
    INSERT INTO public.app_roles(user_id,role) VALUES ('a7000000-0000-4000-8000-000000000003','workspace_operator');
    RAISE EXCEPTION 'SELF_ADMISSION_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.reset_attachment_for_retry('a7000000-0000-4000-8000-000000000010');
    RAISE EXCEPTION 'OUTSIDER_RESET_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.select_quotation_version('a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-000000000010');
    RAISE EXCEPTION 'OUTSIDER_VERSION_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM storage.objects),'outsider files denied');

SELECT set_config('request.jwt.claim.sub','a7000000-0000-4000-8000-000000000001',true);
SELECT pg_temp.assert_true(public.has_workspace_access(),'operator admitted');
SELECT pg_temp.assert_true((SELECT count(*)::text=current_setting('test.emails_count') FROM public.emails),'operator shared mailbox preserved');
SELECT pg_temp.assert_true((SELECT count(*)::text=current_setting('test.cases_count') FROM public.quote_cases),'operator shared cases preserved');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.app_roles(user_id,role) VALUES ('a7000000-0000-4000-8000-000000000003','workspace_operator');
    RAISE EXCEPTION 'OPERATOR_ROLE_ADMIN_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claim.sub','a7000000-0000-4000-8000-000000000004',true);
SELECT pg_temp.assert_true(NOT public.has_workspace_access(),'banned role_admin denied');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.app_roles(user_id,role) VALUES ('a7000000-0000-4000-8000-000000000003','workspace_operator');
    RAISE EXCEPTION 'BANNED_ROLE_ADMIN_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claim.sub','a7000000-0000-4000-8000-000000000002',true);
SELECT pg_temp.assert_true(public.has_workspace_access(),'role_admin admitted');
INSERT INTO public.app_roles(user_id,role) VALUES ('a7000000-0000-4000-8000-000000000003','workspace_operator');
DELETE FROM public.app_roles WHERE user_id='a7000000-0000-4000-8000-000000000003';
RESET ROLE;

-- Révocation prise en compte immédiatement, même avec le même sub/JWT.
DELETE FROM public.app_roles WHERE user_id='a7000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a7000000-0000-4000-8000-000000000001',true);
SELECT pg_temp.assert_true(NOT public.has_workspace_access(),'removed member denied');
RESET ROLE;

-- Échec atomique, conservation littérale du secret, aucun résultat en clair.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$ DECLARE c jsonb; cid uuid; baseline integer; BEGIN
  SELECT count(*) INTO baseline FROM public.email_configs;
  BEGIN
    PERFORM public.create_mailbox_config('{"name":"test","host":"imap.invalid","username":"test@example.invalid"}', '');
    RAISE EXCEPTION 'EMPTY_SECRET_ALLOWED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'IMAP_CONFIG_STORE_FAILED' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.email_configs) <> baseline THEN RAISE EXCEPTION 'PARTIAL_CONFIG_INSERT'; END IF;
  c := public.create_mailbox_config('{"name":"test","host":"imap.invalid","username":"test@example.invalid"}', ' synthetic credential ');
  cid := (c->>'id')::uuid;
  IF c ? 'password_secret_id' OR c->>'password_encrypted' <> '********' THEN RAISE EXCEPTION 'SECRET_METADATA_EXPOSED'; END IF;
  IF public.read_mailbox_secret(cid) <> ' synthetic credential ' THEN RAISE EXCEPTION 'SECRET_ALTERED'; END IF;
  IF (SELECT password_encrypted FROM public.email_configs WHERE id=cid) IS NOT NULL THEN RAISE EXCEPTION 'PLAINTEXT_STORED'; END IF;
  PERFORM public.set_mailbox_secret(cid,'replacement synthetic credential');
  IF public.read_mailbox_secret(cid) <> 'replacement synthetic credential' THEN RAISE EXCEPTION 'SECRET_REPLACEMENT_FAILED'; END IF;
  DELETE FROM public.email_configs WHERE id=cid;
END $$;
RESET ROLE;
ROLLBACK;
