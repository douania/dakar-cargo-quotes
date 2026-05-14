
CREATE OR REPLACE FUNCTION public.propagate_classification_candidate_to_fact(p_candidate_id uuid, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_candidate         record;
  v_case_id           uuid;
  v_fact_key          text;
  v_fact_category     text;
  v_scheme            text;
  v_value             text;
  v_existing_fact_id  uuid;
  v_new_fact_id       uuid;
  v_dummy             integer;
  v_value_json        jsonb;
BEGIN
  -- 1. Validation entrée
  IF p_candidate_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_input',
      'details', jsonb_build_object('reason', 'p_candidate_id_null'));
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 OR length(p_idempotency_key) > 128 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_input',
      'details', jsonb_build_object('reason', 'p_idempotency_key_invalid'));
  END IF;

  -- 2. Lock idempotent par candidat
  PERFORM pg_advisory_xact_lock(hashtext('map6_propagate_' || p_candidate_id::text));

  -- 3. Charger candidat avec verrou ligne
  SELECT id, case_id, candidate_kind, candidate_value, status, is_current, evidence, confidence
    INTO v_candidate
  FROM public.commodity_classification_candidates
  WHERE id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'candidate_not_found');
  END IF;

  -- 4. case_id dérivé du candidat
  v_case_id := v_candidate.case_id;

  -- 5. RLS write check APRÈS chargement
  IF NOT public.has_case_write_access(v_case_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rls_write_denied');
  END IF;

  -- 6. État candidat
  IF v_candidate.status <> 'accepted' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'candidate_not_accepted',
      'details', jsonb_build_object('current_status', v_candidate.status));
  END IF;
  IF v_candidate.is_current = false THEN
    RETURN jsonb_build_object('ok', false, 'code', 'candidate_not_current');
  END IF;

  -- 7. Whitelist MAP-7B → clés runtime canoniques (cargo.*) consommées par run-pricing
  CASE v_candidate.candidate_kind
    WHEN 'pad_category' THEN
      -- MAP-7B-FIX#5 v3 : NULL/empty + regex stricte ^[TPC][0-9]{2}$
      IF v_candidate.candidate_value IS NULL OR btrim(v_candidate.candidate_value) = '' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_input',
          'details', jsonb_build_object('reason', 'invalid_pad_category',
                                        'candidate_value', v_candidate.candidate_value));
      END IF;
      v_value := btrim(v_candidate.candidate_value);
      IF v_value !~ '^[TPC][0-9]{2}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_input',
          'details', jsonb_build_object('reason', 'invalid_pad_category',
                                        'candidate_value', v_candidate.candidate_value));
      END IF;
      v_fact_key := 'cargo.pad_category';
      v_fact_category := 'cargo';
      v_scheme := NULL;

    WHEN 'hs10_uemoa' THEN
      IF v_candidate.candidate_value IS NULL OR btrim(v_candidate.candidate_value) = '' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_input',
          'details', jsonb_build_object('reason', 'invalid_hs10_uemoa',
                                        'candidate_value', v_candidate.candidate_value));
      END IF;
      v_value := btrim(v_candidate.candidate_value);
      IF v_value !~ '^\d{10}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_input',
          'details', jsonb_build_object('reason', 'invalid_hs10_uemoa',
                                        'candidate_value', v_candidate.candidate_value));
      END IF;
      v_fact_key := 'cargo.hs_code';
      v_fact_category := 'cargo';
      v_scheme := 'hs10_uemoa';

    WHEN 'pad_label' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'pad_label_forbidden');

    WHEN 'cn8', 'hs6', 'nhm', 'nst2007', 'nstr' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'candidate_kind_not_whitelisted',
        'details', jsonb_build_object(
          'candidate_kind', v_candidate.candidate_kind,
          'reason', 'not_consumed_by_pricing',
          'deferred_to', 'MAPPING-TAX-CHAIN-0'
        ));

    ELSE
      RETURN jsonb_build_object('ok', false, 'code', 'candidate_kind_not_whitelisted',
        'details', jsonb_build_object('candidate_kind', v_candidate.candidate_kind));
  END CASE;

  -- 8. Idempotence Niveau A — evidence
  IF (v_candidate.evidence ? 'propagated_fact_id')
     AND (v_candidate.evidence->>'propagation_idempotency_key' = p_idempotency_key) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'fact_id', (v_candidate.evidence->>'propagated_fact_id')::uuid,
      'candidate_id', p_candidate_id,
      'fact_key', v_fact_key,
      'idempotent', true,
      'replay_source', 'evidence'
    );
  END IF;

  -- 9. Replay Niveau B — quote_facts (pas de filtre is_current)
  SELECT id INTO v_existing_fact_id
  FROM public.quote_facts
  WHERE case_id = v_case_id
    AND fact_key = v_fact_key
    AND value_json->>'candidate_id' = p_candidate_id::text
    AND value_json->>'propagation_idempotency_key' = p_idempotency_key
  LIMIT 1;

  IF v_existing_fact_id IS NOT NULL THEN
    UPDATE public.commodity_classification_candidates
    SET evidence = COALESCE(evidence, '{}'::jsonb) || jsonb_build_object(
          'propagated_fact_id', v_existing_fact_id,
          'propagated_at', now(),
          'propagation_idempotency_key', p_idempotency_key
        )
    WHERE id = p_candidate_id;

    RETURN jsonb_build_object(
      'ok', true,
      'fact_id', v_existing_fact_id,
      'candidate_id', p_candidate_id,
      'fact_key', v_fact_key,
      'idempotent', true,
      'replay_source', 'quote_facts'
    );
  END IF;

  -- 10. Conflit clé idempotence (autre candidat)
  SELECT 1 INTO v_dummy
  FROM public.quote_facts
  WHERE case_id = v_case_id
    AND value_json->>'propagation_idempotency_key' = p_idempotency_key
    AND value_json->>'candidate_id' <> p_candidate_id::text
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  END IF;

  -- 11. Appel interne supersede_fact
  v_value_json := jsonb_build_object(
    'origin', 'MAP-7B',
    'previous_map6_design', 'commodity/pricing keys deprecated',
    'propagated_from', 'commodity_classification_candidates',
    'candidate_id', p_candidate_id,
    'propagation_idempotency_key', p_idempotency_key,
    'operator_validated', true,
    'scheme', v_scheme
  );

  SELECT public.supersede_fact(
    p_case_id              := v_case_id,
    p_fact_key             := v_fact_key,
    p_fact_category        := v_fact_category,
    p_value_text           := v_value,
    p_value_json           := v_value_json,
    p_source_type          := 'manual_input',
    p_source_excerpt       := '[MAP-7B] propagate candidate ' || p_candidate_id::text,
    p_confidence           := 1.0
  ) INTO v_new_fact_id;

  -- 12. Update candidate.evidence
  UPDATE public.commodity_classification_candidates
  SET evidence = COALESCE(evidence, '{}'::jsonb) || jsonb_build_object(
        'propagated_fact_id', v_new_fact_id,
        'propagated_at', now(),
        'propagation_idempotency_key', p_idempotency_key
      )
  WHERE id = p_candidate_id;

  -- 13. Timeline event
  INSERT INTO public.case_timeline_events (
    case_id, event_type, actor_type, actor_user_id, event_data
  ) VALUES (
    v_case_id,
    'manual_action',
    'operator',
    auth.uid(),
    jsonb_build_object(
      'action_code',  'CCC_PROPAGATED_TO_FACTS',
      'dedupe_key',   'ccc_propagate:' || p_candidate_id::text || ':' || p_idempotency_key,
      'candidate_id', p_candidate_id,
      'fact_key',     v_fact_key,
      'fact_id',      v_new_fact_id,
      'status',       'done'
    )
  );

  -- 14. Retour
  RETURN jsonb_build_object(
    'ok', true,
    'fact_id', v_new_fact_id,
    'candidate_id', p_candidate_id,
    'fact_key', v_fact_key,
    'idempotent', false
  );
END;
$function$;
