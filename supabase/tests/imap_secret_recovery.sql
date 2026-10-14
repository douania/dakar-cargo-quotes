-- Local fake-Vault fixture only. Driver must install the actual IMAP migrations.
BEGIN;
DO $$ BEGIN
  IF current_setting('dcq.synthetic_fixture', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'LOCAL_SYNTHETIC_FIXTURE_REQUIRED';
  END IF;
END $$;
CREATE FUNCTION pg_temp.check_recovery(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'RECOVERY_ASSERT: %', message; END IF; END $$;

INSERT INTO public.email_configs(id,name,host,username,password_encrypted)
  VALUES ('11111111-1111-4111-8111-111111111111','fixture','imap.invalid','fixture@example.invalid',NULL);
INSERT INTO public.emails(id,email_config_id,subject) VALUES
  ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','fixture history');
INSERT INTO public.email_attachments(id,email_id,storage_path) VALUES
  ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','synthetic/path.pdf');
INSERT INTO public.quote_cases(id,source_email_id) VALUES
  ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222');
CREATE TEMP TABLE recovery_history AS SELECT row_to_json(e)::text AS data FROM public.emails e
  UNION ALL SELECT row_to_json(a)::text FROM public.email_attachments a
  UNION ALL SELECT row_to_json(c)::text FROM public.quote_cases c;
CREATE TEMP TABLE recovery_config AS SELECT to_jsonb(c) - 'password_secret_id' - 'password_encrypted' AS data FROM public.email_configs c;

-- NULL reference; create fresh even though every fake decrypted-view access fails.
SET LOCAL ROLE service_role;
SELECT public.replace_mailbox_secret('11111111-1111-4111-8111-111111111111',' synthetic "first\\ password ');
RESET ROLE;
SELECT pg_temp.check_recovery((SELECT count(*)=1 FROM vault.secrets), 'absent reference creates one secret');
SELECT pg_temp.check_recovery((SELECT s.secret=' synthetic "first\\ password ' FROM public.email_configs c JOIN vault.secrets s ON s.id=c.password_secret_id), 'literal credential preserved');
CREATE TEMP TABLE recovery_sid AS SELECT password_secret_id AS id FROM public.email_configs;

-- Healthy existing reference, followed by a simulated indéchiffrable old row.
SET LOCAL ROLE service_role;
SELECT public.replace_mailbox_secret('11111111-1111-4111-8111-111111111111','synthetic-second');
RESET ROLE;
SELECT pg_temp.check_recovery((SELECT c.password_secret_id<>s.id FROM public.email_configs c CROSS JOIN recovery_sid s), 'healthy reference replaced');
SELECT pg_temp.check_recovery((SELECT count(*)=1 FROM vault.secrets), 'previous secret cleaned without orphan');
UPDATE vault.secrets SET secret='synthetic-corrupt-row';
SET LOCAL ROLE service_role;
SELECT public.replace_mailbox_secret('11111111-1111-4111-8111-111111111111','synthetic-third');
RESET ROLE;
SELECT pg_temp.check_recovery((SELECT s.secret='synthetic-third' FROM public.email_configs c JOIN vault.secrets s ON s.id=c.password_secret_id), 'indéchiffrable simulation replaced without read');

-- Orphaned non-NULL UUID possible in a damaged/partial restoration.
ALTER TABLE public.email_configs DROP CONSTRAINT email_configs_password_secret_id_fkey;
UPDATE public.email_configs SET password_secret_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
DELETE FROM vault.secrets;
SET LOCAL ROLE service_role;
SELECT public.replace_mailbox_secret('11111111-1111-4111-8111-111111111111','synthetic-orphan-repaired');
RESET ROLE;
ALTER TABLE public.email_configs ADD CONSTRAINT email_configs_password_secret_id_fkey FOREIGN KEY(password_secret_id) REFERENCES vault.secrets(id);
SELECT pg_temp.check_recovery((SELECT count(*)=1 FROM vault.secrets), 'absent referenced row repaired');

-- Refusals and failures must roll back both the new row and reference switch.
DO $$ DECLARE before_config jsonb; before_secrets jsonb; candidate text; failed boolean;
BEGIN
  SELECT to_jsonb(c) INTO before_config FROM public.email_configs c;
  SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) INTO before_secrets FROM vault.secrets s;
  FOREACH candidate IN ARRAY ARRAY['synthetic-encrypt-fail','synthetic-update-fail','synthetic-cleanup-fail'] LOOP
    PERFORM set_config('dcq.failure',candidate,true);
    failed := false;
    BEGIN
      PERFORM public.replace_mailbox_secret('11111111-1111-4111-8111-111111111111',candidate);
    EXCEPTION WHEN OTHERS THEN
      failed := true;
      PERFORM pg_temp.check_recovery(SQLERRM='IMAP_SECRET_REPLACE_FAILED','raw error scrubbed');
    END;
    PERFORM pg_temp.check_recovery(failed,'injected failure rejected');
    PERFORM pg_temp.check_recovery((SELECT to_jsonb(c)=before_config FROM public.email_configs c),'config rollback');
    PERFORM pg_temp.check_recovery((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)=before_secrets FROM vault.secrets s),'secret rollback, no orphan');
  END LOOP;
  PERFORM set_config('dcq.failure','',true);
  FOREACH candidate IN ARRAY ARRAY['',repeat('x',1025),E'fake\nLOGIN',E'fake\rLOGIN'] LOOP
    failed := false;
    BEGIN PERFORM public.replace_mailbox_secret('11111111-1111-4111-8111-111111111111',candidate);
    EXCEPTION WHEN OTHERS THEN failed := true; END;
    PERFORM pg_temp.check_recovery(failed,'invalid credential refused');
  END LOOP;
  failed := false;
  BEGIN PERFORM public.replace_mailbox_secret('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','synthetic-missing-config');
  EXCEPTION WHEN OTHERS THEN failed := true; END;
  PERFORM pg_temp.check_recovery(failed,'missing config never creates a replacement');
  PERFORM pg_temp.check_recovery((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)=before_secrets FROM vault.secrets s),'invalid inputs leave no orphan');
END $$;

SELECT pg_temp.check_recovery(NOT has_function_privilege('anon','public.replace_mailbox_secret(uuid,text)','EXECUTE'), 'anonymous RPC denied');
SELECT pg_temp.check_recovery(NOT has_function_privilege('authenticated','public.replace_mailbox_secret(uuid,text)','EXECUTE'), 'authenticated RPC denied');
SELECT pg_temp.check_recovery(has_function_privilege('service_role','public.replace_mailbox_secret(uuid,text)','EXECUTE'), 'server RPC allowed');
SELECT pg_temp.check_recovery((SELECT proconfig=ARRAY['search_path=""']::text[] FROM pg_proc WHERE oid='public.replace_mailbox_secret(uuid,text)'::regprocedure), 'definer search path locked');
SELECT pg_temp.check_recovery((SELECT bool_and((to_jsonb(c)-'password_secret_id'-'password_encrypted')=b.data) FROM public.email_configs c CROSS JOIN recovery_config b), 'UUID and config metadata preserved');
SELECT pg_temp.check_recovery(NOT EXISTS ((SELECT row_to_json(e)::text FROM public.emails e UNION ALL SELECT row_to_json(a)::text FROM public.email_attachments a UNION ALL SELECT row_to_json(c)::text FROM public.quote_cases c) EXCEPT SELECT data FROM recovery_history), 'emails attachments business links unchanged');
SELECT pg_temp.check_recovery(NOT EXISTS (SELECT data FROM recovery_history EXCEPT (SELECT row_to_json(e)::text FROM public.emails e UNION ALL SELECT row_to_json(a)::text FROM public.email_attachments a UNION ALL SELECT row_to_json(c)::text FROM public.quote_cases c)), 'no historical row deleted');
SELECT pg_temp.check_recovery((SELECT count(*)=3 FROM recovery_history), 'three linked historical fixture rows');
SELECT pg_temp.check_recovery((SELECT (SELECT count(*) FROM public.emails)+(SELECT count(*) FROM public.email_attachments)+(SELECT count(*) FROM public.quote_cases)=3), 'three current historical rows retained');
SELECT pg_temp.check_recovery((SELECT password_encrypted IS NULL FROM public.email_configs), 'no plaintext fallback');

SAVEPOINT transitional_legacy;
ALTER TABLE public.email_configs DROP CONSTRAINT imap_no_new_plaintext;
INSERT INTO public.email_configs(id,name,host,username,password_encrypted) VALUES
  ('99999999-9999-4999-8999-999999999999','legacy fixture','imap.invalid','fixture@example.invalid','synthetic-legacy-only');
ALTER TABLE public.email_configs ADD CONSTRAINT imap_no_new_plaintext CHECK(password_encrypted IS NULL) NOT VALID;
SET LOCAL ROLE service_role;
SELECT public.replace_mailbox_secret('99999999-9999-4999-8999-999999999999','synthetic-reentered');
RESET ROLE;
SELECT pg_temp.check_recovery((SELECT password_encrypted IS NULL AND password_secret_id IS NOT NULL FROM public.email_configs WHERE id='99999999-9999-4999-8999-999999999999'), 'transitional legacy row repaired without reading legacy');
ROLLBACK TO SAVEPOINT transitional_legacy;

SAVEPOINT unavailable_vault;
CREATE TEMP TABLE recovery_before_unavailable AS SELECT to_jsonb(c) AS data FROM public.email_configs c;
DROP FUNCTION vault.create_secret(text,text,text,uuid);
DO $$ DECLARE failed boolean := false;
BEGIN
  BEGIN PERFORM public.replace_mailbox_secret('11111111-1111-4111-8111-111111111111','synthetic-no-engine');
  EXCEPTION WHEN OTHERS THEN
    failed := true; PERFORM pg_temp.check_recovery(SQLERRM='IMAP_SECRET_REPLACE_FAILED','missing Vault error scrubbed');
  END;
  PERFORM pg_temp.check_recovery(failed,'missing encryption API rejected');
  PERFORM pg_temp.check_recovery((SELECT to_jsonb(c)=b.data FROM public.email_configs c CROSS JOIN recovery_before_unavailable b),'missing engine leaves reference intact');
  PERFORM pg_temp.check_recovery((SELECT count(*)=1 FROM vault.secrets),'missing engine leaves old secret intact');
END $$;
ROLLBACK TO SAVEPOINT unavailable_vault;
ROLLBACK;
