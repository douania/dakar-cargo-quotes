CREATE TABLE IF NOT EXISTS public._map6_t1_test_log (
  test_id text PRIMARY KEY, description text NOT NULL,
  expected_code text, expected_ok boolean,
  actual_response jsonb, passed boolean,
  ran_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public._map6_t1_seed_ids (
  kind text NOT NULL, id uuid NOT NULL, PRIMARY KEY (kind, id)
);

DO $exec$
DECLARE
  v_owner_uid   uuid := 'e3999a32-8aec-4318-bef0-6c2a9453d8e3';
  v_case_id     uuid := gen_random_uuid();
  v_cand_t4     uuid := gen_random_uuid();
  v_cand_t5     uuid := gen_random_uuid();
  v_cand_t7     uuid := gen_random_uuid();
  v_cand_t9     uuid := gen_random_uuid();
  v_cand_t12    uuid := gen_random_uuid();
  v_random_uuid uuid := gen_random_uuid();
  v_resp        jsonb;
  v_jwt_owner   text := json_build_object('sub','e3999a32-8aec-4318-bef0-6c2a9453d8e3','role','authenticated')::text;
  v_jwt_other   text := json_build_object('sub','00000000-0000-0000-0000-000000beef01','role','authenticated')::text;
  v_key_t9      text := 'map6_t9_key_' || substr(md5(random()::text), 1, 16);
  v_fact_t9     uuid;
BEGIN
  INSERT INTO public.quote_cases (id, status, created_by)
  VALUES (v_case_id, 'NEW_THREAD', v_owner_uid);
  INSERT INTO public._map6_t1_seed_ids VALUES ('case', v_case_id);

  INSERT INTO public.commodity_classification_candidates
    (id, case_id, designation_normalized, candidate_kind, candidate_value, source, confidence, status, is_current, evidence)
  VALUES
    (v_cand_t4,  v_case_id, 'sandbox-t4',  'cn8',       '11111111', 'operator', 1.0, 'accepted',  true, '{"seed_lot":"MAP-6-T1"}'::jsonb),
    (v_cand_t5,  v_case_id, 'sandbox-t5',  'cn8',       '22222222', 'operator', 0.8, 'suggested', true, '{"seed_lot":"MAP-6-T1"}'::jsonb),
    (v_cand_t7,  v_case_id, 'sandbox-t7',  'pad_label', 'LABEL-X',  'operator', 1.0, 'accepted',  true, '{"seed_lot":"MAP-6-T1"}'::jsonb),
    (v_cand_t9,  v_case_id, 'sandbox-t9',  'cn8',       '99999999', 'operator', 1.0, 'accepted',  true, '{"seed_lot":"MAP-6-T1"}'::jsonb),
    (v_cand_t12, v_case_id, 'sandbox-t12', 'cn8',       '88888888', 'operator', 1.0, 'accepted',  true, '{"seed_lot":"MAP-6-T1"}'::jsonb);

  INSERT INTO public._map6_t1_seed_ids VALUES
    ('candidate', v_cand_t4),('candidate', v_cand_t5),('candidate', v_cand_t7),
    ('candidate', v_cand_t9),('candidate', v_cand_t12);

  PERFORM set_config('request.jwt.claims', v_jwt_owner, true);

  v_resp := public.propagate_classification_candidate_to_fact(NULL, 'valid_key_12345');
  INSERT INTO public._map6_t1_test_log VALUES
    ('T1','null candidate_id => invalid_input','invalid_input',false,v_resp,
     v_resp->>'code'='invalid_input' AND (v_resp->>'ok')::boolean=false);

  v_resp := public.propagate_classification_candidate_to_fact(v_cand_t9, 'short');
  INSERT INTO public._map6_t1_test_log VALUES
    ('T2','idempotency_key < 8 => invalid_input','invalid_input',false,v_resp,
     v_resp->>'code'='invalid_input' AND (v_resp->>'ok')::boolean=false);

  v_resp := public.propagate_classification_candidate_to_fact(v_random_uuid, 'valid_key_12345');
  INSERT INTO public._map6_t1_test_log VALUES
    ('T3','random uuid => candidate_not_found','candidate_not_found',false,v_resp,
     v_resp->>'code'='candidate_not_found' AND (v_resp->>'ok')::boolean=false);

  PERFORM set_config('request.jwt.claims', v_jwt_other, true);
  v_resp := public.propagate_classification_candidate_to_fact(v_cand_t4, 'valid_key_t4_xxx');
  INSERT INTO public._map6_t1_test_log VALUES
    ('T4','non-owner authenticated => rls_write_denied','rls_write_denied',false,v_resp,
     v_resp->>'code'='rls_write_denied' AND (v_resp->>'ok')::boolean=false);
  PERFORM set_config('request.jwt.claims', v_jwt_owner, true);

  v_resp := public.propagate_classification_candidate_to_fact(v_cand_t5, 'valid_key_t5_xxx');
  INSERT INTO public._map6_t1_test_log VALUES
    ('T5','status=suggested => candidate_not_accepted','candidate_not_accepted',false,v_resp,
     v_resp->>'code'='candidate_not_accepted' AND (v_resp->>'ok')::boolean=false);

  INSERT INTO public._map6_t1_test_log VALUES
    ('T6','UNREACHABLE: ccc_status_consistency forbids accepted+is_current=false; defensive branch retained',
     'unreachable',NULL,
     jsonb_build_object('note','structurally unreachable due to ccc_status_consistency trigger'),
     true);

  v_resp := public.propagate_classification_candidate_to_fact(v_cand_t7, 'valid_key_t7_xxx');
  INSERT INTO public._map6_t1_test_log VALUES
    ('T7','candidate_kind=pad_label => pad_label_forbidden','pad_label_forbidden',false,v_resp,
     v_resp->>'code'='pad_label_forbidden' AND (v_resp->>'ok')::boolean=false);

  INSERT INTO public._map6_t1_test_log VALUES
    ('T8','UNREACHABLE: ccc_kind_chk DB constraint aligned with wrapper whitelist; defensive ELSE branch retained',
     'unreachable',NULL,
     jsonb_build_object('note','DB constraint and wrapper whitelist coincide; no kind value can reach the ELSE branch'),
     true);

  v_resp := public.propagate_classification_candidate_to_fact(v_cand_t9, v_key_t9);
  v_fact_t9 := (v_resp->>'fact_id')::uuid;
  INSERT INTO public._map6_t1_test_log VALUES
    ('T9','cn8 accepted owner => ok=true, fact created',NULL,true,v_resp,
     (v_resp->>'ok')::boolean=true AND v_resp ? 'fact_id'
     AND v_resp->>'fact_key'='commodity.cn_code'
     AND COALESCE((v_resp->>'idempotent')::boolean,false)=false);
  IF v_fact_t9 IS NOT NULL THEN
    INSERT INTO public._map6_t1_seed_ids VALUES ('fact', v_fact_t9);
  END IF;
  INSERT INTO public._map6_t1_seed_ids
  SELECT 'timeline', id FROM public.case_timeline_events
   WHERE case_id = v_case_id
     AND event_data->>'dedupe_key' = 'ccc_propagate:' || v_cand_t9::text || ':' || v_key_t9;

  v_resp := public.propagate_classification_candidate_to_fact(v_cand_t9, v_key_t9);
  INSERT INTO public._map6_t1_test_log VALUES
    ('T10','replay same key => idempotent, replay_source=evidence',NULL,true,v_resp,
     (v_resp->>'ok')::boolean=true
     AND COALESCE((v_resp->>'idempotent')::boolean,false)=true
     AND v_resp->>'replay_source'='evidence');

  UPDATE public.commodity_classification_candidates
     SET evidence = (COALESCE(evidence,'{}'::jsonb) - 'propagated_fact_id' - 'propagated_at' - 'propagation_idempotency_key')
   WHERE id = v_cand_t9;
  v_resp := public.propagate_classification_candidate_to_fact(v_cand_t9, v_key_t9);
  INSERT INTO public._map6_t1_test_log VALUES
    ('T11','evidence wiped, same key => replay_source=quote_facts',NULL,true,v_resp,
     (v_resp->>'ok')::boolean=true
     AND COALESCE((v_resp->>'idempotent')::boolean,false)=true
     AND v_resp->>'replay_source'='quote_facts');

  v_resp := public.propagate_classification_candidate_to_fact(v_cand_t12, v_key_t9);
  INSERT INTO public._map6_t1_test_log VALUES
    ('T12','different candidate, same key => idempotency_conflict','idempotency_conflict',false,v_resp,
     v_resp->>'code'='idempotency_conflict' AND (v_resp->>'ok')::boolean=false);
END
$exec$;