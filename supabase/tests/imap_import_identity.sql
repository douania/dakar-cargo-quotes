-- Local disposable fixture ONLY. Never run against a mailbox-connected database.
-- The harness supplies minimal empty tables and the prepared migration.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
CREATE TEMP TABLE identity_test_results(name text PRIMARY KEY);
CREATE FUNCTION pg_temp.check_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;
CREATE FUNCTION pg_temp.account() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('host','fixture.invalid','port',143,'username','mailbox@example.invalid','use_ssl',true)
$$;
CREATE FUNCTION pg_temp.messages() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('uid',101+i,'message_id',CASE WHEN i=0 THEN '<root@example.invalid>' ELSE '<reply-'||i||'@example.invalid>' END,
    'root_message_id','<root@example.invalid>','subject','Fixture quotation','from_address','sender@example.invalid',
    'to_addresses',jsonb_build_array('mailbox@example.invalid'),'body_text','Fetched replacement','body_html','<p>Replacement</p>',
    'sent_at','2026-01-01T12:00:00Z','is_quotation_request',true,'extracted_data',jsonb_build_object('new',true)) ORDER BY i)
  FROM generate_series(0,3) i
$$;
CREATE FUNCTION pg_temp.seed() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  TRUNCATE public.email_imap_identities, public.email_attachments, public.quote_cases, public.emails, public.email_threads, public.email_configs;
  INSERT INTO public.email_configs(id,host,port,username,folder,use_ssl,is_active)
    VALUES('11111111-1111-4111-8111-111111111111','fixture.invalid',143,'mailbox@example.invalid','INBOX',true,true),
          ('22222222-2222-4222-8222-222222222222','other.invalid',143,'other@example.invalid','INBOX',true,true);
  INSERT INTO public.email_threads(id,root_message_id,subject_normalized,status,email_count,participants,project_name,is_quotation_thread)
    VALUES('33333333-3333-4333-8333-333333333333','<root@example.invalid>','Operator label','quoted',4,'[{"email":"operator@example.invalid","role":"owner"}]','Preserve project',true),
          ('44444444-4444-4444-8444-444444444444','<other@example.invalid>','Other legitimate conversation','active',0,'[]','Other project',false);
  INSERT INTO public.emails(id,email_config_id,message_id,thread_id,thread_ref,subject,from_address,to_addresses,body_text,body_html,sent_at,extracted_data,is_read)
    SELECT ('00000000-0000-4000-8000-'||lpad((101+i)::text,12,'0'))::uuid,'11111111-1111-4111-8111-111111111111',
      '<'||(101+i)||'@imported>',CASE WHEN i=0 THEN 'In-Reply-To:' ELSE '<root@example.invalid>' END,
      '33333333-3333-4333-8333-333333333333','Stored subject','sender@example.invalid',ARRAY['mailbox@example.invalid'],
      'Original body '||i,'<p>Original '||i||'</p>','2026-01-01T12:00:00Z',jsonb_build_object('operator',i),true FROM generate_series(0,3) i;
  INSERT INTO public.email_attachments(id,email_id,filename,storage_path)
    VALUES('55555555-5555-4555-8555-555555555555','00000000-0000-4000-8000-000000000101','fixture.pdf','private/preserved.pdf');
  INSERT INTO public.quote_cases(id,thread_id,status)
    VALUES('66666666-6666-4666-8666-666666666666','33333333-3333-4333-8333-333333333333','NEED_INFO');
END $$;
CREATE FUNCTION pg_temp.proofs() RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.email_imap_identities(email_id,config_id,account,mailbox,uid_validity,imap_uid,message_id,root_message_id,source,legacy_message_id,evidence_ref)
  SELECT ('00000000-0000-4000-8000-'||lpad((101+i)::text,12,'0'))::uuid,'11111111-1111-4111-8111-111111111111',pg_temp.account(),'INBOX',77,101+i,
    CASE WHEN i=0 THEN '<root@example.invalid>' ELSE '<reply-'||i||'@example.invalid>' END,'<root@example.invalid>',
    'reviewed_legacy','<'||(101+i)||'@imported>','fixture-only-reviewed-header-identity' FROM generate_series(0,3) i
$$;
CREATE FUNCTION pg_temp.snapshot() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('emails',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.emails e),
    'threads',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.email_threads t),
    'proofs',(SELECT jsonb_agg(to_jsonb(i) ORDER BY email_id) FROM public.email_imap_identities i),
    'attachments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.email_attachments a),
    'cases',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.quote_cases c))
$$;
CREATE FUNCTION pg_temp.run_batch(messages jsonb DEFAULT pg_temp.messages(), validity bigint DEFAULT 77, mailbox text DEFAULT 'INBOX', account jsonb DEFAULT pg_temp.account())
RETURNS jsonb LANGUAGE sql AS $$ SELECT public.persist_imap_import_batch('11111111-1111-4111-8111-111111111111',account,mailbox,validity,'<root@example.invalid>',messages) $$;
CREATE FUNCTION pg_temp.expect_conflict(label text, expected text, messages jsonb DEFAULT pg_temp.messages(), validity bigint DEFAULT 77, mailbox text DEFAULT 'INBOX', account jsonb DEFAULT pg_temp.account())
RETURNS void LANGUAGE plpgsql AS $$
DECLARE original jsonb := pg_temp.snapshot(); caught boolean := false;
BEGIN
  BEGIN PERFORM pg_temp.run_batch(messages,validity,mailbox,account);
  EXCEPTION WHEN OTHERS THEN
    caught := true; PERFORM pg_temp.check_true(SQLERRM = expected, label || ': expected ' || expected || ', received ' || SQLERRM);
  END;
  PERFORM pg_temp.check_true(caught,label || ': conflict required');
  PERFORM pg_temp.check_true(pg_temp.snapshot() = original,label || ': no mutation after failure');
  INSERT INTO identity_test_results VALUES(label);
END $$;

DO $$ DECLARE original jsonb; after_adoption jsonb; result jsonb;
BEGIN
  PERFORM pg_temp.seed();
  PERFORM pg_temp.expect_conflict('legacy without reviewed proof refuses insertion','LEGACY_ADOPTION_REQUIRED');
  PERFORM pg_temp.seed(); PERFORM pg_temp.proofs(); original := pg_temp.snapshot(); result := pg_temp.run_batch();
  PERFORM pg_temp.check_true((SELECT count(*)=4 FROM public.emails),'adoption no duplicates');
  PERFORM pg_temp.check_true((SELECT bool_and(message_id !~ '@imported>' AND thread_id='<root@example.invalid>') FROM public.emails),'canonical identities/root repaired');
  PERFORM pg_temp.check_true((SELECT jsonb_agg(to_jsonb(e)-ARRAY['message_id','thread_id'] ORDER BY id) FROM public.emails e)=
    (SELECT jsonb_agg(e-ARRAY['message_id','thread_id'] ORDER BY e->>'id') FROM jsonb_array_elements(original->'emails') e),'UUIDs bodies fields links preserved');
  PERFORM pg_temp.check_true((pg_temp.snapshot()->'attachments')=original->'attachments' AND (pg_temp.snapshot()->'cases')=original->'cases','attachments/case preserved');
  PERFORM pg_temp.check_true((SELECT status='quoted' AND project_name='Preserve project' AND participants='[{"email":"operator@example.invalid","role":"owner"}]'::jsonb FROM public.email_threads WHERE id='33333333-3333-4333-8333-333333333333'),'operator thread metadata preserved');
  INSERT INTO identity_test_results VALUES('reviewed adoption preserves four UUIDs bodies attachments case and operator metadata');
  after_adoption := pg_temp.snapshot(); PERFORM pg_temp.run_batch();
  PERFORM pg_temp.check_true(pg_temp.snapshot()=after_adoption,'replay byte-identical rows');
  INSERT INTO identity_test_results VALUES('adoption replay is idempotent');

  PERFORM pg_temp.seed(); PERFORM pg_temp.proofs(); UPDATE public.emails SET thread_ref=NULL;
  result:=pg_temp.run_batch();
  PERFORM pg_temp.check_true((SELECT bool_and(thread_ref='33333333-3333-4333-8333-333333333333') FROM public.emails),'all existing linked');
  INSERT INTO identity_test_results VALUES('all existing NULL links attach to exact root while case stays');
  PERFORM pg_temp.seed(); PERFORM pg_temp.proofs(); UPDATE public.emails SET thread_ref='44444444-4444-4444-8444-444444444444' WHERE message_id='<104@imported>';
  PERFORM pg_temp.expect_conflict('legitimate other thread refused with entire batch rollback','LEGITIMATE_THREAD_CONFLICT');
  PERFORM pg_temp.seed(); PERFORM pg_temp.proofs(); UPDATE public.email_threads SET root_message_id=NULL WHERE id='33333333-3333-4333-8333-333333333333';
  PERFORM pg_temp.expect_conflict('rootless legacy thread never adopted by subject','LEGITIMATE_THREAD_CONFLICT');
  PERFORM pg_temp.seed();
  UPDATE public.emails SET message_id='<root@example.invalid>',thread_id='<other@example.invalid>',thread_ref=NULL WHERE message_id='<101@imported>';
  PERFORM pg_temp.expect_conflict('canonical real root without thread_ref must never be overwritten','LEGITIMATE_ROOT_CONFLICT',jsonb_build_array(pg_temp.messages()->0));
  PERFORM pg_temp.seed();
  UPDATE public.emails SET message_id='<root@example.invalid>',thread_ref=NULL WHERE message_id='<101@imported>';
  PERFORM pg_temp.expect_conflict('malformed canonical root requires explicit reviewed proof','LEGACY_ROOT_ADOPTION_REQUIRED',jsonb_build_array(pg_temp.messages()->0));

  PERFORM pg_temp.seed(); PERFORM pg_temp.proofs();
  PERFORM pg_temp.expect_conflict('UID reused in another generation refuses legacy','LEGACY_ADOPTION_REQUIRED',pg_temp.messages(),78);
  PERFORM pg_temp.seed(); PERFORM pg_temp.proofs(); UPDATE public.email_configs SET folder='Archive' WHERE id='11111111-1111-4111-8111-111111111111';
  PERFORM pg_temp.expect_conflict('same UID another folder refuses legacy','LEGACY_ADOPTION_REQUIRED',pg_temp.messages(),77,'Archive');
  PERFORM pg_temp.seed(); PERFORM pg_temp.proofs(); UPDATE public.email_configs SET host='changed.invalid' WHERE id='11111111-1111-4111-8111-111111111111';
  PERFORM pg_temp.expect_conflict('same config changed account refuses old proof','IDENTITY_SCOPE_CONFLICT',pg_temp.messages(),77,'INBOX',pg_temp.account()||'{"host":"changed.invalid"}');
  PERFORM pg_temp.seed(); PERFORM pg_temp.proofs(); UPDATE public.email_imap_identities SET root_message_id='<other@example.invalid>' WHERE imap_uid=104;
  PERFORM pg_temp.expect_conflict('proof root mismatch rolls back adoption','IDENTITY_SCOPE_CONFLICT');
  PERFORM pg_temp.seed(); PERFORM pg_temp.proofs(); UPDATE public.email_imap_identities SET email_id='00000000-0000-4000-8000-000000000102' WHERE imap_uid=101;
  PERFORM pg_temp.expect_conflict('stale proof never adopts another UUID','STALE_IDENTITY_PROOF');

  PERFORM pg_temp.seed(); PERFORM pg_temp.proofs();
  INSERT INTO public.emails(email_config_id,message_id,from_address,to_addresses) VALUES('11111111-1111-4111-8111-111111111111','<root@example.invalid>','other@example.invalid','{}');
  PERFORM pg_temp.expect_conflict('canonical plus synthetic rows refuse automatic merge','AMBIGUOUS_LEGACY_IDENTITY');
  PERFORM pg_temp.seed();
  INSERT INTO public.emails(email_config_id,message_id,from_address,to_addresses) VALUES('22222222-2222-4222-8222-222222222222','<root@example.invalid>','other@example.invalid','{}');
  PERFORM pg_temp.expect_conflict('canonical Message-ID from another config refuses','MESSAGE_CONFIG_CONFLICT');

  PERFORM pg_temp.seed(); PERFORM pg_temp.proofs(); PERFORM pg_temp.run_batch();
  UPDATE public.email_imap_identities SET mailbox='Archive';
  PERFORM pg_temp.expect_conflict('canonical ID with another stored folder refuses','MESSAGE_MAILBOX_CONFLICT');
  PERFORM pg_temp.seed(); UPDATE public.emails SET email_config_id='22222222-2222-4222-8222-222222222222',thread_ref=NULL;
  result:=pg_temp.run_batch(jsonb_build_array(pg_temp.messages()->0));
  PERFORM pg_temp.check_true((SELECT count(*)=5 FROM public.emails),'other config synthetic UID preserved separately');
  PERFORM pg_temp.check_true((SELECT count(*)=4 FROM public.emails WHERE email_config_id='22222222-2222-4222-8222-222222222222' AND message_id~'@imported>'),'other config untouched');
  INSERT INTO identity_test_results VALUES('same UID other config does not reuse legacy UUID');

  PERFORM pg_temp.seed(); PERFORM pg_temp.proofs(); PERFORM pg_temp.run_batch();
  result:=pg_temp.run_batch(jsonb_build_array(pg_temp.messages()->0, (pg_temp.messages()->1)||'{"uid":105,"message_id":"<new@example.invalid>"}'));
  PERFORM pg_temp.check_true((SELECT count(*)=5 FROM public.emails),'mixed only one insert');
  PERFORM pg_temp.check_true((SELECT count(*)=1 FROM public.emails WHERE message_id='<new@example.invalid>' AND body_text='Fetched replacement' AND thread_ref='33333333-3333-4333-8333-333333333333'),'new ingestion retains body and correct link');
  INSERT INTO identity_test_results VALUES('mixed new plus existing reuses UUID and inserts one');
  original:=pg_temp.snapshot(); PERFORM pg_temp.run_batch(jsonb_build_array(pg_temp.messages()->0, (pg_temp.messages()->1)||'{"uid":105,"message_id":"<new@example.invalid>"}'));
  PERFORM pg_temp.check_true(pg_temp.snapshot()=original,'mixed replay stable');
  INSERT INTO identity_test_results VALUES('mixed replay no duplicate or content rewrite');

  PERFORM pg_temp.seed();
  PERFORM pg_temp.expect_conflict('late legacy refusal rolls back first new message','LEGACY_ADOPTION_REQUIRED',
    jsonb_build_array((pg_temp.messages()->0)||'{"uid":200,"message_id":"<new-first@example.invalid>"}',pg_temp.messages()->3));
  PERFORM pg_temp.seed();
  PERFORM pg_temp.expect_conflict('duplicate UIDs refused before write','AMBIGUOUS_IMPORT_BATCH',jsonb_build_array(pg_temp.messages()->0,pg_temp.messages()->0));
  PERFORM pg_temp.seed();
  PERFORM pg_temp.expect_conflict('mixed header roots refuse with rollback','INVALID_MESSAGE_IDENTITY',jsonb_build_array(pg_temp.messages()->0,(pg_temp.messages()->1)||'{"root_message_id":"<other@example.invalid>"}'));

  PERFORM pg_temp.check_true(NOT has_table_privilege('anon','public.email_imap_identities','SELECT') AND
    NOT has_table_privilege('authenticated','public.email_imap_identities','INSERT'),'private proof table ACL');
  PERFORM pg_temp.check_true(NOT has_function_privilege('anon','public.persist_imap_import_batch(uuid,jsonb,text,bigint,text,jsonb)','EXECUTE') AND
    NOT has_function_privilege('authenticated','public.persist_imap_import_batch(uuid,jsonb,text,bigint,text,jsonb)','EXECUTE'),'service-only RPC ACL');
  INSERT INTO identity_test_results VALUES('proof table and RPC deny anonymous/authenticated access');
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM pg_temp.expect_conflict('RPC service guard refuses non-service claim','SERVICE_ROLE_REQUIRED');
  PERFORM set_config('request.jwt.claim.role','service_role',true);
END $$;
SELECT name FROM identity_test_results ORDER BY name;
ROLLBACK;
