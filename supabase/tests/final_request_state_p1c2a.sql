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
-- Immutable proof survives upstream source deletion. No source-table FK cascade to the ledger.
DELETE FROM public.emails WHERE id='ca200000-0000-4000-8300-000000000001';
DO $$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.final_request_source_versions WHERE case_id='ca200000-0000-4000-8200-000000000001' AND source_data->>'text'='Synthetic source'),'Lost immutable source snapshot';
END $$;
SELECT 'P1C2A_SQL_CONTRACT_PASS';
ROLLBACK;
