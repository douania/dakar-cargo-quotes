\set ON_ERROR_STOP on
-- Synthetic local contract suite only; NEVER run on Lovable or a shared application DB.
-- Intended companion: the isolated PostgreSQL harness documented in the roadmap.
BEGIN;
DO $$ BEGIN
 IF current_database() IS DISTINCT FROM 'dcq_p1c2a' OR inet_server_port() IS DISTINCT FROM 54380 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
 THEN RAISE EXCEPTION 'LOCAL_P1C2A_SANDBOX_ONLY'; END IF;
END $$;
CREATE FUNCTION pg_temp.frs_expect(q text, expected_state text, expected_fragment text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE actual_state text; actual_message text;
BEGIN
 BEGIN EXECUTE q;
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS actual_state=RETURNED_SQLSTATE,actual_message=MESSAGE_TEXT;
  IF actual_state<>expected_state OR position(expected_fragment IN actual_message)=0 THEN
   RAISE EXCEPTION 'WRONG_REJECTION expected % / %, actual % / %',expected_state,expected_fragment,actual_state,actual_message;
  END IF;
  RETURN;
 END;
 RAISE EXCEPTION 'EXPECTED_REJECTION_NOT_RAISED: %',expected_fragment;
END $$;

DO $$ DECLARE t record; role_name text; f record; n integer;
BEGIN
 SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
 WHERE ns.nspname='public' AND c.relkind='r' AND c.relname LIKE 'final_request_%';
 ASSERT n=8,'Expected exactly eight P1-C2-A tables';
 FOR t IN SELECT c.oid,c.relname,c.relrowsecurity,pg_get_userbyid(c.relowner) owner_name FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
  WHERE ns.nspname='public' AND c.relkind='r' AND c.relname LIKE 'final_request_%' LOOP
  ASSERT t.relrowsecurity AND t.owner_name='postgres','RLS/owner mismatch';
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   ASSERT NOT has_table_privilege(role_name,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'Unexpected direct ledger privilege';
  END LOOP;
 END LOOP;
 FOR f IN SELECT p.oid,p.proname,p.proconfig,p.prosecdef,pg_get_userbyid(p.proowner) owner_name FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
  WHERE ns.nspname='public' AND p.proname LIKE 'frs_%' LOOP
  ASSERT f.owner_name='postgres' AND f.proconfig @> ARRAY['search_path=pg_catalog'],'Function owner/search_path mismatch';
  ASSERT NOT has_function_privilege('anon',f.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',f.oid,'EXECUTE'),'User RPC escape';
  ASSERT has_function_privilege('service_role',f.oid,'EXECUTE')=(f.proname IN ('frs_mutate','frs_read')),'Service helper escape';
 END LOOP;
 ASSERT public.frs_instant('2026-02-28T23:59:59.123Z');
 ASSERT public.frs_utf16_length('中文🚢')=4,'UTF-16 parity mismatch';
 ASSERT public.frs_text(to_jsonb(repeat('🚢',250)),500),'Valid UTF-16 boundary rejected';
 ASSERT NOT public.frs_text(to_jsonb(repeat('🚢',251)),500),'UTF-16 overflow accepted';
 ASSERT NOT public.frs_instant('2026-02-30T10:00:00Z');
 ASSERT NOT public.frs_instant('2026-08-01T24:00:00Z');
 ASSERT NOT public.frs_instant('2026-08-01T10:00:00+14:01');
 ASSERT NOT public.frs_instant('2026-08-01T10:00:00.123456Z');
 ASSERT NOT public.frs_instant('infinity');
 ASSERT public.frs_hash('{"n":1}')<>public.frs_hash('{"n":1.0}'),'Opaque hash representation contract changed';
 ASSERT '{"n":1}'::jsonb='{"n":1.0}'::jsonb,'Semantic JSONB equality needed for command replay';
END $$;

-- Review regression: an unresolved lifecycle journal must not support a resolved cancellation.
DO $$ DECLARE i jsonb; r jsonb;
BEGIN
 i:='{"caseId":"sql-fixture","sources":[{"id":"s1","sentAt":"2026-08-01T10:00:00Z"}],"protectedFacts":[],"assertions":[{"id":"a1","sourceId":"s1","scope":"case","operation":"cancel_request","excerpt":"cancel"}]}';
 r:='{"schemaVersion":1,"caseId":"sql-fixture","kind":"cancelled","protectedFacts":[],"fields":[],"quoteResponses":[],"requestStatus":{"state":"cancelled","sourceId":"s1","assertionId":"a1","sentAt":"2026-08-01T10:00:00Z","excerpt":"cancel"},"journal":[{"assertionId":"a1","sourceId":"s1","scope":"case","operation":"cancel_request","excerpt":"cancel","outcome":"conflict","reason":"Unattested source"}]}';
 ASSERT NOT public.frs_result_valid(r,i),'Unresolved lifecycle accepted as resolved';
END $$;

INSERT INTO auth.users(id,email) VALUES('ca200000-0000-4000-8000-000000000001','sql-only@sandbox.invalid');
INSERT INTO public.email_threads(id,subject_normalized) VALUES('ca200000-0000-4000-8100-000000000001','Synthetic P1-C2-A SQL');
INSERT INTO public.quote_cases(id,thread_id) VALUES('ca200000-0000-4000-8200-000000000001','ca200000-0000-4000-8100-000000000001');
INSERT INTO public.emails(id,message_id,from_address,to_addresses,body_text,sent_at,thread_ref,body_capture_mode)
VALUES('ca200000-0000-4000-8300-000000000001','sql@sandbox.invalid','client@sandbox.invalid',ARRAY['operator@sandbox.invalid'],'Synthetic source',now(),'ca200000-0000-4000-8100-000000000001','full_sanitized');
SELECT public.frs_admin_set_reviewer('ca200000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000001',true,'Local SQL fixture only');
SET LOCAL ROLE service_role;
SELECT public.frs_mutate('ca200000-0000-4000-8000-000000000001','ca200000-0000-4000-8200-000000000001','sql-test-capture','capture',NULL,0,'{}')->>'generation';
RESET ROLE;
DO $$ DECLARE r jsonb; ref jsonb; raw_source jsonb;
BEGIN
 SELECT response INTO r FROM public.final_request_commands
 WHERE case_id='ca200000-0000-4000-8200-000000000001' AND request_key='sql-test-capture';
 ASSERT jsonb_array_length(r->'sourceAttestationRefs')=1,'Missing bounded source attestation reference';
 ref:=r->'sourceAttestationRefs'->0;
 raw_source:=r->'inventory'->'sources'->0;
 ASSERT public.frs_keys(ref,ARRAY['originKind','originId','sourceHash']),'Attestation reference contract is not closed';
 ASSERT ref->>'originKind'=raw_source->>'kind' AND ref->>'originId'=raw_source->>'id','Attestation reference points to another source';
 ASSERT ref->>'sourceHash'=public.frs_hash(raw_source),'Attestation reference is not the PostgreSQL source hash';
 ASSERT r->'pricingAuthorized'='false'::jsonb,'Capture authorized pricing';
END $$;
SET LOCAL ROLE service_role;
SELECT pg_temp.frs_expect($q$SELECT public.frs_mutate('ca200000-0000-4000-8000-000000000001','ca200000-0000-4000-8200-000000000001','sql-stale-capture','capture',NULL,0,'{}')$q$,'40001','FRS_STALE_HEAD');
SELECT pg_temp.frs_expect($q$SELECT public.frs_mutate('ca200000-0000-4000-8000-000000000001','ca200000-0000-4000-8200-000000000001','sql-invalid-action',NULL,NULL,1,'{}')$q$,'22023','FRS_COMMAND_INVALID');
SELECT pg_temp.frs_expect($q$SELECT public.frs_mutate('ca200000-0000-4000-8000-000000000001','ca200000-0000-4000-8200-000000000001','sql-forged-capture','capture',NULL,1,'{"roleVerified":true}')$q$,'22023','FRS_CAPTURE_PAYLOAD');
SELECT pg_temp.frs_expect($q$SELECT public.frs_admin_set_reviewer('ca200000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000001',true,'Self escalation forbidden')$q$,'42501','permission denied');
SELECT pg_temp.frs_expect('SELECT * FROM public.final_request_revisions','42501','permission denied');
SELECT pg_temp.frs_expect('TRUNCATE public.final_request_commands','42501','permission denied');
SELECT pg_temp.frs_expect('DELETE FROM public.final_request_heads','42501','permission denied');
SELECT pg_temp.frs_expect('UPDATE public.final_request_reviewer_grants SET active=true','42501','permission denied');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.frs_expect($q$SELECT public.frs_read('ca200000-0000-4000-8000-000000000001','ca200000-0000-4000-8200-000000000001',NULL)$q$,'42501','permission denied');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.frs_expect($q$SELECT public.frs_mutate('ca200000-0000-4000-8000-000000000001','ca200000-0000-4000-8200-000000000001','direct-user-call','capture',NULL,1,'{}')$q$,'42501','permission denied');
RESET ROLE;
SELECT pg_temp.frs_expect($q$UPDATE public.final_request_commands SET response='{}' WHERE case_id='ca200000-0000-4000-8200-000000000001'$q$,'42501','FRS_APPEND_ONLY');
SELECT pg_temp.frs_expect($q$DELETE FROM public.final_request_source_versions WHERE case_id='ca200000-0000-4000-8200-000000000001'$q$,'42501','FRS_APPEND_ONLY');
SELECT pg_temp.frs_expect('TRUNCATE public.final_request_grant_events','42501','FRS_APPEND_ONLY');
SELECT pg_temp.frs_expect($q$DELETE FROM public.quote_cases WHERE id='ca200000-0000-4000-8200-000000000001'$q$,'23503','foreign key');
SELECT pg_temp.frs_expect($q$INSERT INTO public.final_request_source_versions(id,case_id,origin_kind,origin_id,version_number,previous_id,source_data,source_hash,created_by)
 VALUES('ca200000-0000-4000-8400-000000000001','ca200000-0000-4000-8200-000000000001','email','ca200000-0000-4000-8300-000000000001',2,'ca200000-0000-4000-8400-000000000001','{}',repeat('a',64),'ca200000-0000-4000-8000-000000000001')$q$,'23514','FRS_SOURCE_CHAIN');
-- P1-C2-H1 — la complétude attestée d'une pièce jointe / d'un document.
-- Fuseau figé : frs_instant n'accepte qu'un offset ISO borné, la date de source
-- ne doit pas dépendre du fuseau de la machine qui exécute la suite.
SET LOCAL TIME ZONE 'UTC';
-- Deuxième email dédié : la suppression finale ne porte que sur le premier.
INSERT INTO public.emails(id,message_id,from_address,to_addresses,body_text,sent_at,thread_ref,body_capture_mode)
VALUES('ca200000-0000-4000-8300-000000000002','sql2@sandbox.invalid','client@sandbox.invalid',ARRAY['operator@sandbox.invalid'],
 'Voir pièce jointe','2026-08-01T10:00:00Z','ca200000-0000-4000-8100-000000000001','full_sanitized');
INSERT INTO public.email_attachments(id,email_id,filename,extracted_text)
VALUES('ca200000-0000-4000-8500-000000000001','ca200000-0000-4000-8300-000000000002','instructions.pdf','Instructions jointes lisibles');
INSERT INTO public.case_documents(id,case_id,file_name,document_type,extracted_text,storage_path,uploaded_by) VALUES
 ('ca200000-0000-4000-8600-000000000001','ca200000-0000-4000-8200-000000000001','partiel.pdf','instruction','Extraction partielle','p/1','ca200000-0000-4000-8000-000000000001'),
 ('ca200000-0000-4000-8600-000000000002','ca200000-0000-4000-8200-000000000001','volumineux.pdf','instruction',repeat('x',10001),'p/2','ca200000-0000-4000-8000-000000000001'),
 ('ca200000-0000-4000-8600-000000000003','ca200000-0000-4000-8200-000000000001','jamais_atteste.pdf','instruction','Extraction jamais attestée','p/3','ca200000-0000-4000-8000-000000000001'),
 ('ca200000-0000-4000-8600-000000000004','ca200000-0000-4000-8200-000000000001','autonome.pdf','instruction','Instructions autonomes lisibles','p/4','ca200000-0000-4000-8000-000000000001');
DO $h1$
DECLARE cap jsonb; lim jsonb; res jsonb; bad jsonb; st text; msg text; ok boolean; i integer:=0;
 mail_v uuid; att_v uuid; doc_v uuid; big_v uuid; legacy_v uuid; att_v2 uuid; auto_v uuid; auto_v2 uuid;
 h_att text; h_doc text; h_big text; h_mail text; h_auto text;
 c_actor uuid:='ca200000-0000-4000-8000-000000000001'; c_case uuid:='ca200000-0000-4000-8200-000000000001';
 c_att uuid:='ca200000-0000-4000-8500-000000000001'; c_doc uuid:='ca200000-0000-4000-8600-000000000001';
 c_big uuid:='ca200000-0000-4000-8600-000000000002'; c_mail uuid:='ca200000-0000-4000-8300-000000000002';
 c_auto uuid:='ca200000-0000-4000-8600-000000000004';
BEGIN
 cap:=public.frs_mutate(c_actor,c_case,'sql-h1-capture-1','capture',NULL,1,'{}');
 ASSERT cap->'pricingAuthorized'='false'::jsonb,'H1 capture authorized pricing';
 lim:=cap->'capture'->'limitations';
 SELECT id INTO att_v FROM public.final_request_source_versions WHERE case_id=c_case AND origin_kind='attachment' AND origin_id=c_att ORDER BY version_number DESC LIMIT 1;
 SELECT id INTO doc_v FROM public.final_request_source_versions WHERE case_id=c_case AND origin_kind='document' AND origin_id=c_doc ORDER BY version_number DESC LIMIT 1;
 SELECT id INTO big_v FROM public.final_request_source_versions WHERE case_id=c_case AND origin_kind='document' AND origin_id=c_big ORDER BY version_number DESC LIMIT 1;
 SELECT id INTO legacy_v FROM public.final_request_source_versions WHERE case_id=c_case AND origin_kind='document' AND origin_id='ca200000-0000-4000-8600-000000000003' ORDER BY version_number DESC LIMIT 1;
 SELECT id INTO mail_v FROM public.final_request_source_versions WHERE case_id=c_case AND origin_kind='email' AND origin_id=c_mail ORDER BY version_number DESC LIMIT 1;
 -- Avant toute attestation, chaque source non-email reste bloquée exactement comme avant P1-C2-H1.
 ASSERT lim @> jsonb_build_array('SOURCE_TRUNCATED:'||att_v),'Attachment not truncated by default';
 ASSERT lim @> jsonb_build_array('SOURCE_TRUNCATED:'||doc_v),'Document not truncated by default';
 ASSERT lim @> jsonb_build_array('SOURCE_TRUNCATED:'||legacy_v),'Legacy document not truncated by default';
 ASSERT NOT (lim @> jsonb_build_array('SOURCE_TRUNCATED:'||mail_v)),'full_sanitized email wrongly truncated';
 -- Un document autonome n'a aucune date en amont : frs_inventory le date à null.
 SELECT id INTO auto_v FROM public.final_request_source_versions WHERE case_id=c_case AND origin_kind='document' AND origin_id=c_auto ORDER BY version_number DESC LIMIT 1;
 ASSERT lim @> jsonb_build_array('SOURCE_TRUNCATED:'||auto_v),'Standalone document not truncated by default';
 ASSERT lim @> jsonb_build_array('SOURCE_DATE_UNKNOWN:'||auto_v),'Standalone document silently dated';
 ASSERT (SELECT count(*) FROM public.final_request_source_versions WHERE case_id=c_case AND completeness IS NOT NULL)=0,'Completeness deduced without attestation';

 SELECT value->>'sourceHash' INTO h_att FROM jsonb_array_elements(cap->'sourceAttestationRefs') WHERE value->>'originKind'='attachment' AND value->>'originId'=c_att::text;
 SELECT value->>'sourceHash' INTO h_doc FROM jsonb_array_elements(cap->'sourceAttestationRefs') WHERE value->>'originKind'='document' AND value->>'originId'=c_doc::text;
 SELECT value->>'sourceHash' INTO h_big FROM jsonb_array_elements(cap->'sourceAttestationRefs') WHERE value->>'originKind'='document' AND value->>'originId'=c_big::text;
 SELECT value->>'sourceHash' INTO h_mail FROM jsonb_array_elements(cap->'sourceAttestationRefs') WHERE value->>'originKind'='email' AND value->>'originId'=c_mail::text;
 SELECT value->>'sourceHash' INTO h_auto FROM jsonb_array_elements(cap->'sourceAttestationRefs') WHERE value->>'originKind'='document' AND value->>'originId'=c_auto::text;

 -- Attestations non-email sans complétude fermée, et tentative de contournement email : toutes refusées.
 FOR bad IN SELECT * FROM (VALUES
  (jsonb_build_object('originKind','attachment','originId',c_att,'expectedSourceHash',h_att,'authorRole','client','contentClass','current','reason','Sans complétude')),
  (jsonb_build_object('originKind','attachment','originId',c_att,'expectedSourceHash',h_att,'authorRole','client','contentClass','current','reason','Vide','completeness','')),
  (jsonb_build_object('originKind','attachment','originId',c_att,'expectedSourceHash',h_att,'authorRole','client','contentClass','current','reason','Inconnue','completeness','unknown')),
  (jsonb_build_object('originKind','attachment','originId',c_att,'expectedSourceHash',h_att,'authorRole','client','contentClass','current','reason','Nulle','completeness',NULL)),
  (jsonb_build_object('originKind','attachment','originId',c_att,'expectedSourceHash',h_att,'authorRole','client','contentClass','current','reason','Booléenne','completeness',true)),
  (jsonb_build_object('originKind','document','originId',c_doc,'expectedSourceHash',h_doc,'authorRole','client','contentClass','current','reason','Sans complétude')),
  (jsonb_build_object('originKind','email','originId',c_mail,'expectedSourceHash',h_mail,'authorRole','client','contentClass','current','reason','Contournement email','completeness','complete'))
 ) v(p) LOOP
  i:=i+1; ok:=false;
  BEGIN
   PERFORM public.frs_mutate(c_actor,c_case,'sql-h1-refuse-'||i,'attest_source',NULL,2,bad);
  EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS st=RETURNED_SQLSTATE,msg=MESSAGE_TEXT;
   ok:=(st='22023' AND position('FRS_ATTESTATION_INVALID' IN msg)>0);
  END;
  ASSERT ok,'Attestation completeness contract not fail-closed: '||bad::text;
 END LOOP;
 -- Le nouveau champ ne relâche ni le CAS ni le hash de source.
 ok:=false;
 BEGIN PERFORM public.frs_mutate(c_actor,c_case,'sql-h1-stale','attest_source',NULL,7,
  jsonb_build_object('originKind','attachment','originId',c_att,'expectedSourceHash',h_att,'authorRole','client','contentClass','current','reason','CAS périmé','completeness','complete'));
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS st=RETURNED_SQLSTATE,msg=MESSAGE_TEXT; ok:=(st='40001' AND position('FRS_STALE_HEAD' IN msg)>0); END;
 ASSERT ok,'Completeness bypassed the head CAS';
 ok:=false;
 BEGIN PERFORM public.frs_mutate(c_actor,c_case,'sql-h1-forged','attest_source',NULL,2,
  jsonb_build_object('originKind','attachment','originId',c_att,'expectedSourceHash',repeat('a',64),'authorRole','client','contentClass','current','reason','Hash forgé','completeness','complete'));
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS st=RETURNED_SQLSTATE,msg=MESSAGE_TEXT; ok:=(st='40001' AND position('FRS_STALE_SOURCE' IN msg)>0); END;
 ASSERT ok,'Completeness bypassed the source hash binding';

 -- Attestations humaines explicites : complete borné, partial, complete sur texte > 10k.
 res:=public.frs_mutate(c_actor,c_case,'sql-h1-attest-att','attest_source',NULL,2,
  jsonb_build_object('originKind','attachment','originId',c_att,'expectedSourceHash',h_att,'authorRole','client','contentClass','current','reason','Original PDF consulté','completeness','complete'));
 ASSERT res->'pricingAuthorized'='false'::jsonb,'Attestation authorized pricing';
 att_v2:=(res->>'sourceVersionId')::uuid;
 -- Idempotence : rejeu identique, puis conflit sur une complétude différente.
 ASSERT public.frs_mutate(c_actor,c_case,'sql-h1-attest-att','attest_source',NULL,2,
  jsonb_build_object('originKind','attachment','originId',c_att,'expectedSourceHash',h_att,'authorRole','client','contentClass','current','reason','Original PDF consulté','completeness','complete'))=res,'Attestation replay diverged';
 ok:=false;
 BEGIN PERFORM public.frs_mutate(c_actor,c_case,'sql-h1-attest-att','attest_source',NULL,2,
  jsonb_build_object('originKind','attachment','originId',c_att,'expectedSourceHash',h_att,'authorRole','client','contentClass','current','reason','Original PDF consulté','completeness','partial'));
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS st=RETURNED_SQLSTATE,msg=MESSAGE_TEXT; ok:=(st='23505' AND position('FRS_IDEMPOTENCY_CONFLICT' IN msg)>0); END;
 ASSERT ok,'Completeness escaped the idempotency fingerprint';
 PERFORM public.frs_mutate(c_actor,c_case,'sql-h1-attest-doc','attest_source',NULL,3,
  jsonb_build_object('originKind','document','originId',c_doc,'expectedSourceHash',h_doc,'authorRole','client','contentClass','current','reason','Extraction non vérifiée','completeness','partial'));
 PERFORM public.frs_mutate(c_actor,c_case,'sql-h1-attest-big','attest_source',NULL,4,
  jsonb_build_object('originKind','document','originId',c_big,'expectedSourceHash',h_big,'authorRole','client','contentClass','current','reason','Original consulté mais très long','completeness','complete'));
 PERFORM public.frs_mutate(c_actor,c_case,'sql-h1-attest-mail','attest_source',NULL,5,
  jsonb_build_object('originKind','email','originId',c_mail,'expectedSourceHash',h_mail,'authorRole','client','contentClass','current','reason','Email client identifié'));
 ASSERT (SELECT completeness FROM public.final_request_source_versions WHERE id=att_v2)='complete','Completeness not stored';
 ASSERT (SELECT count(*) FROM public.final_request_source_versions WHERE case_id=c_case AND origin_kind='email' AND completeness IS NOT NULL)=0,'Email stored a human completeness';

 -- Document autonome : complétude ET date attestées par l'opérateur, jamais déduites.
 res:=public.frs_mutate(c_actor,c_case,'sql-h1-attest-auto','attest_source',NULL,6,
  jsonb_build_object('originKind','document','originId',c_auto,'expectedSourceHash',h_auto,'authorRole','client','contentClass','current',
   'completeness','complete','sentAt','2026-08-02T09:30:00.000Z','reason','Original consulté, date relevée sur le document'));
 auto_v2:=(res->>'sourceVersionId')::uuid;
 ASSERT res->'pricingAuthorized'='false'::jsonb,'Dated attestation authorized pricing';
 ASSERT (SELECT sent_at FROM public.final_request_source_versions WHERE id=auto_v2)='2026-08-02T09:30:00Z'::timestamptz,'Attested date not stored';

 -- Nouvelle capture : seule la source attestée complete et <=10k perd SOURCE_TRUNCATED.
 cap:=public.frs_mutate(c_actor,c_case,'sql-h1-capture-2','capture',NULL,7,'{}');
 lim:=cap->'capture'->'limitations';
 ASSERT (SELECT id FROM public.final_request_source_versions WHERE case_id=c_case AND origin_kind='attachment' AND origin_id=c_att ORDER BY version_number DESC LIMIT 1)=att_v2,'Attested version was superseded';
 ASSERT NOT (lim @> jsonb_build_array('SOURCE_TRUNCATED:'||att_v2)),'Attested complete attachment still truncated';
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(lim) AS t(l) WHERE t.l LIKE '%'||att_v2::text),'Attested complete attachment still blocked';
 SELECT id INTO doc_v FROM public.final_request_source_versions WHERE case_id=c_case AND origin_kind='document' AND origin_id=c_doc ORDER BY version_number DESC LIMIT 1;
 SELECT id INTO big_v FROM public.final_request_source_versions WHERE case_id=c_case AND origin_kind='document' AND origin_id=c_big ORDER BY version_number DESC LIMIT 1;
 SELECT id INTO mail_v FROM public.final_request_source_versions WHERE case_id=c_case AND origin_kind='email' AND origin_id=c_mail ORDER BY version_number DESC LIMIT 1;
 ASSERT lim @> jsonb_build_array('SOURCE_TRUNCATED:'||doc_v),'Explicit partial document unblocked';
 ASSERT lim @> jsonb_build_array('SOURCE_TRUNCATED:'||big_v),'Complete but oversized document unblocked';
 ASSERT lim @> jsonb_build_array('SOURCE_TRUNCATED:'||legacy_v),'Legacy null completeness unblocked';
 ASSERT NOT (lim @> jsonb_build_array('SOURCE_TRUNCATED:'||mail_v)),'Attested full_sanitized email truncated';
 -- Le document autonome attesté complete ET daté ne porte plus aucune limitation.
 ASSERT (SELECT id FROM public.final_request_source_versions WHERE case_id=c_case AND origin_kind='document' AND origin_id=c_auto ORDER BY version_number DESC LIMIT 1)=auto_v2,'Dated version was superseded';
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(lim) AS t(l) WHERE t.l LIKE '%'||auto_v2::text),'Attested dated document still blocked';
 ASSERT (SELECT value->>'sentAt' FROM jsonb_array_elements(cap->'capture'->'baseInput'->'sources') WHERE value->>'id'=auto_v2::text)='2026-08-02T09:30:00+00:00','Attested date not exposed to C1';

 -- Une modification amont recrée une version sans complétude : le blocage revient seul.
 UPDATE public.email_attachments SET extracted_text='Instructions jointes modifiées' WHERE id=c_att;
 cap:=public.frs_mutate(c_actor,c_case,'sql-h1-capture-3','capture',NULL,8,'{}');
 SELECT id INTO att_v FROM public.final_request_source_versions WHERE case_id=c_case AND origin_kind='attachment' AND origin_id=c_att ORDER BY version_number DESC LIMIT 1;
 ASSERT att_v<>att_v2,'Changed attachment reused the attested version';
 ASSERT (SELECT completeness FROM public.final_request_source_versions WHERE id=att_v) IS NULL,'New version inherited a completeness';
 ASSERT cap->'capture'->'limitations' @> jsonb_build_array('SOURCE_TRUNCATED:'||att_v),'Changed attachment stayed unblocked';

 -- Aucun fait, run de pricing, devis, brouillon ou tarif n'a été écrit par ce lot.
 ASSERT (SELECT count(*) FROM public.quote_facts)=0,'Facts written';
 ASSERT (SELECT count(*) FROM public.quotation_versions)=0,'Quotations written';
 ASSERT (SELECT count(*) FROM public.cargo_lines)+(SELECT count(*) FROM public.quote_request_lines)=0,'Lot lines written';
 ASSERT (SELECT count(*) FROM public.final_request_revisions)=0,'A revision was committed';
 ASSERT (SELECT count(*) FROM public.final_request_review_events)=0,'A review event was written';
 ASSERT NOT EXISTS(SELECT 1 FROM public.final_request_commands WHERE case_id=c_case AND response->'pricingAuthorized' IS DISTINCT FROM 'false'::jsonb),'A command authorized pricing';
END $h1$;
-- La contrainte de stockage refuse seule un email complété ou une complétude non attestée.
SELECT pg_temp.frs_expect($q$INSERT INTO public.final_request_source_versions(case_id,origin_kind,origin_id,version_number,source_data,source_hash,author_role,content_class,attested_by,reason,created_by,completeness)
 VALUES('ca200000-0000-4000-8200-000000000001','email','ca200000-0000-4000-8300-000000000009',1,'{}',repeat('b',64),'client','current','ca200000-0000-4000-8000-000000000001','Contournement','ca200000-0000-4000-8000-000000000001','complete')$q$,'23514','final_request_source_versions_completeness_check');
SELECT pg_temp.frs_expect($q$INSERT INTO public.final_request_source_versions(case_id,origin_kind,origin_id,version_number,source_data,source_hash,created_by,completeness)
 VALUES('ca200000-0000-4000-8200-000000000001','document','ca200000-0000-4000-8600-000000000009',1,'{}',repeat('c',64),'ca200000-0000-4000-8000-000000000001','complete')$q$,'23514','final_request_source_versions_completeness_check');
SELECT pg_temp.frs_expect($q$INSERT INTO public.final_request_source_versions(case_id,origin_kind,origin_id,version_number,source_data,source_hash,author_role,content_class,attested_by,reason,created_by,completeness)
 VALUES('ca200000-0000-4000-8200-000000000001','document','ca200000-0000-4000-8600-000000000009',1,'{}',repeat('d',64),'client','current','ca200000-0000-4000-8000-000000000001','Valeur libre','ca200000-0000-4000-8000-000000000001','full')$q$,'23514','final_request_source_versions_completeness_check');
SELECT pg_temp.frs_expect($q$UPDATE public.final_request_source_versions SET completeness='complete' WHERE case_id='ca200000-0000-4000-8200-000000000001'$q$,'42501','FRS_APPEND_ONLY');

-- Immutable proof survives upstream source deletion. No source-table FK cascade to the ledger.
DELETE FROM public.emails WHERE id='ca200000-0000-4000-8300-000000000001';
DO $$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.final_request_source_versions WHERE case_id='ca200000-0000-4000-8200-000000000001' AND source_data->>'text'='Synthetic source'),'Lost immutable source snapshot';
END $$;
SELECT 'P1C2A_SQL_CONTRACT_PASS';
ROLLBACK;
