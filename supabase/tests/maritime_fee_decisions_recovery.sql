-- P1-B regression: real RPC/constraints, synthetic fixtures, automatic ROLLBACK.
-- Manual local test only: isolated PostgreSQL at 127.0.0.1:54379,
-- database dcq_p1b_recovery_fixed with parent contracts and P1-B migration.
-- Never run against Lovable, production, or a linked Supabase project.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
 ASSERT current_database() IN ('dcq_p1b_recovery','dcq_p1b_recovery_fixed') AND inet_server_addr() = '127.0.0.1'::inet AND inet_server_port() = 54379,
 'LOCAL_TEST_TARGET_REQUIRED';
END $$;
INSERT INTO auth.users(id,email) VALUES('11000000-0000-4000-8000-000000000001','fixture@example.invalid');
INSERT INTO public.email_threads(id,subject_normalized) VALUES('11000000-0000-4000-8000-000000000002','P1B synthetic SQL probe');
INSERT INTO public.quote_cases(id,thread_id,created_by,request_type)
VALUES('11000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000001','SEA_FCL_IMPORT');
INSERT INTO public.quote_facts(case_id,fact_key,fact_category,value_text,source_type)
VALUES('11000000-0000-4000-8000-000000000003','carrier.name','cargo','SENTINEL_UNCHANGED','manual_input');
CREATE FUNCTION pg_temp.recovery_call(action text, expected_version integer, idem text, fp text)
RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.record_maritime_fee_decision(
 p_case_id=>'11000000-0000-4000-8000-000000000003'::uuid,
 p_decision_key=>'PAD_DROIT_PASSAGE',p_proposal_id=>'pad-taxe-de-port',
 p_proposal_category=>'taxe_de_port',p_decision_action=>action,
 p_suggested_amount_xof=>96780::bigint,
 p_decided_amount_xof=>CASE action WHEN 'confirm' THEN 96780::bigint WHEN 'adjust' THEN 98000::bigint ELSE NULL::bigint END,
 p_currency=>'XOF',p_evidence_level=>'official',p_source_reference=>'SOURCE_FIXTURE',
 p_decision_source=>'PIECE_FIXTURE',p_justification=>'SQL fixture only',
 p_proposal_fingerprint=>repeat('a',64),p_input_snapshot_hash=>repeat('b',64),
 p_proposal_snapshot=>jsonb_build_object('decision_key','PAD_DROIT_PASSAGE','proposal',
 jsonb_build_object('id','pad-taxe-de-port','category','taxe_de_port','currency','XOF','amount',NULL,
 'missing_confirmation',jsonb_build_array())),
 p_expected_decision_version=>expected_version,p_idempotency_key=>idem,p_request_fingerprint=>fp,
 p_actor_user_id=>'11000000-0000-4000-8000-000000000001'::uuid);
$$;
DO $$
DECLARE created jsonb; revoked jsonb; replay jsonb; old_id uuid; amount_before text;
BEGIN
 SELECT md5(string_agg(row_to_json(q)::text,'' ORDER BY id)) INTO amount_before FROM public.quote_facts q;
 created := pg_temp.recovery_call('confirm',NULL,'sql-confirm-01',repeat('1',64));
 ASSERT (created#>>'{decision,decision_version}')::int=1;
 revoked := pg_temp.recovery_call('revoke',1,'sql-revoke-confirm-01',repeat('2',64));
 ASSERT (revoked#>>'{decision,decision_version}')::int=2;
 created := pg_temp.recovery_call('adjust',NULL,'sql-adjust-01',repeat('3',64));
 revoked := pg_temp.recovery_call('revoke',3,'sql-revoke-adjust-01',repeat('4',64));
 ASSERT (revoked#>>'{decision,decision_version}')::int=4;
 created := pg_temp.recovery_call('reject',NULL,'sql-reject-01',repeat('5',64));
 old_id := (created#>>'{decision,id}')::uuid;
 revoked := pg_temp.recovery_call('revoke',5,'sql-revoke-reject-01',repeat('6',64));
 ASSERT (revoked#>>'{decision,decision_version}')::int=6;
 ASSERT (revoked#>>'{decision,supersedes_id}')::uuid=old_id;
 ASSERT revoked#>>'{decision,decided_amount_xof}' IS NULL;
 replay := pg_temp.recovery_call('revoke',5,'sql-revoke-reject-01',repeat('6',64));
 ASSERT (replay->>'idempotent_replay')::boolean;
 ASSERT replay#>>'{decision,id}'=revoked#>>'{decision,id}';
 ASSERT (SELECT count(*) FROM public.maritime_fee_decisions)=6;
 BEGIN
  PERFORM pg_temp.recovery_call('revoke',5,'sql-revoke-reject-01',repeat('7',64));
  RAISE EXCEPTION 'expected IDEMPOTENCY_CONFLICT';
 EXCEPTION WHEN unique_violation THEN ASSERT position('IDEMPOTENCY_CONFLICT' IN SQLERRM)>0; END;
 BEGIN
  PERFORM pg_temp.recovery_call('revoke',5,'sql-revoke-stale-01',repeat('8',64));
  RAISE EXCEPTION 'expected STALE_DECISION';
 EXCEPTION WHEN serialization_failure THEN ASSERT position('STALE_DECISION' IN SQLERRM)>0; END;
 BEGIN
  PERFORM pg_temp.recovery_call('revoke',6,'sql-revoke-again-01',repeat('9',64));
  RAISE EXCEPTION 'expected INVALID_STATE';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN ASSERT position('INVALID_STATE' IN SQLERRM)>0; END;
 BEGIN
  UPDATE public.maritime_fee_decisions SET justification='Mutated' WHERE id=old_id;
  RAISE EXCEPTION 'expected IMMUTABLE';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN ASSERT position('IMMUTABLE' IN SQLERRM)>0; END;
 ASSERT amount_before=(SELECT md5(string_agg(row_to_json(q)::text,'' ORDER BY id)) FROM public.quote_facts q);
 ASSERT (SELECT count(*) FROM public.maritime_fee_decisions)=6;
 RAISE NOTICE 'PASS transitions confirm/adjust/reject->revoke, idempotence/conflict/stale, immutable, facts unchanged';
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM 1 FROM public.maritime_fee_decisions;
  RAISE EXCEPTION 'expected permission denied on ledger';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.read_maritime_fee_case_context('11000000-0000-4000-8000-000000000003'::uuid);
  RAISE EXCEPTION 'expected permission denied on RPC';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS authenticated denied ledger/RPC';
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM 1 FROM public.maritime_fee_decisions;
  RAISE EXCEPTION 'expected permission denied on ledger';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS anon denied ledger';
END $$;
RESET ROLE;
ROLLBACK;
SELECT (SELECT count(*) FROM auth.users) AS users_after_rollback,
 (SELECT count(*) FROM public.email_threads) AS threads_after_rollback,
 (SELECT count(*) FROM public.quote_cases) AS cases_after_rollback,
 (SELECT count(*) FROM public.quote_facts) AS facts_after_rollback,
 (SELECT count(*) FROM public.maritime_fee_decisions) AS decisions_after_rollback;
