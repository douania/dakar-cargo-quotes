
-- MAP-8B-EXEC-MIGRATION
-- Modifie uniquement public.propagate_classification_candidate_to_fact(uuid,text)
-- - Branche pad_category : crée AUSSI cargo.pad_rate_fcfa_per_ton à partir de port_tariffs PAD/DROIT_PASSAGE/IMPORT/CONTENEUR
-- - Bypass étapes 8/9 pour pad_category afin de garantir les 2 facts
-- - Garde scope cargo.containers (current, non vide) sinon unsupported_pad_rate_scope
-- - Réutilisation rate fact si même montant (already_current_same_amount)
-- - Replay strict v_existing_pad_cat_fact avec is_current=true
-- - Variables scalaires (pas de record)
-- - Garde-fou timeline : pas de nouvel INSERT si replay complet
-- Aucune modification des branches hs10_uemoa / pad_label / cn8 / hs6 / nhm / nst2007 / nstr.
-- Aucune modification de supersede_fact, GRANTs, autres fonctions.

CREATE OR REPLACE FUNCTION public.propagate_classification_candidate_to_fact(p_candidate_id uuid, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_candidate              record;
  v_case_id                uuid;
  v_fact_key               text;
  v_fact_category          text;
  v_scheme                 text;
  v_value                  text;
  v_existing_fact_id       uuid;
  v_new_fact_id            uuid;
  v_dummy                  integer;
  v_value_json             jsonb;
  -- MAP-8B
  v_pad_amount             numeric;
  v_pad_unit               text;
  v_pad_count              integer;
  v_existing_rate_id       uuid;
  v_existing_rate_number   numeric;
  v_rate_fact_id           uuid;
  v_rate_fact_status       text;
  v_containers_present     boolean;
  v_existing_pad_cat_fact  uuid;
  v_is_full_replay         boolean;
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

  v_case_id := v_candidate.case_id;

  IF NOT public.has_case_write_access(v_case_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rls_write_denied');
  END IF;

  IF v_candidate.status <> 'accepted' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'candidate_not_accepted',
      'details', jsonb_build_object('current_status', v_candidate.status));
  END IF;
  IF v_candidate.is_current = false THEN
    RETURN jsonb_build_object('ok', false, 'code', 'candidate_not_current');
  END IF;

  -- 7. Whitelist (inchangé)
  CASE v_candidate.candidate_kind
    WHEN 'pad_category' THEN
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

  -- 8. Niveau A (evidence) — bypassé pour pad_category (MAP-8B)
  IF v_candidate.candidate_kind <> 'pad_category'
     AND (v_candidate.evidence ? 'propagated_fact_id')
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

  -- 9. Niveau B (quote_facts) — bypassé pour pad_category (MAP-8B)
  IF v_candidate.candidate_kind <> 'pad_category' THEN
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
  END IF;

  -- 10. Conflit clé idempotence (autre candidat) — global, inchangé
  SELECT 1 INTO v_dummy
  FROM public.quote_facts
  WHERE case_id = v_case_id
    AND value_json->>'propagation_idempotency_key' = p_idempotency_key
    AND value_json->>'candidate_id' <> p_candidate_id::text
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  END IF;

  -- ===== MAP-8B : bloc spécifique pad_category =====
  IF v_candidate.candidate_kind = 'pad_category' THEN

    -- B. Garde scope CONTENEUR
    SELECT EXISTS (
      SELECT 1 FROM public.quote_facts qf
      WHERE qf.case_id = v_case_id
        AND qf.fact_key = 'cargo.containers'
        AND qf.is_current = true
        AND (
          (jsonb_typeof(qf.value_json) = 'array' AND jsonb_array_length(qf.value_json) >= 1)
          OR (qf.value_text IS NOT NULL AND btrim(qf.value_text) NOT IN ('', '[]'))
        )
    ) INTO v_containers_present;

    IF NOT v_containers_present THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_input',
        'details', jsonb_build_object('reason','unsupported_pad_rate_scope',
                                      'expected','cargo.containers fact current and non-empty',
                                      'pad_category', v_value));
    END IF;

    -- C. Lookup tarif PAD
    SELECT count(*) INTO v_pad_count
    FROM public.port_tariffs
    WHERE provider='PAD' AND category='DROIT_PASSAGE'
      AND operation_type='IMPORT' AND cargo_type='CONTENEUR'
      AND classification = v_value AND is_active = true;

    IF v_pad_count = 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_input',
        'details', jsonb_build_object('reason','pad_rate_not_found','pad_category', v_value));
    END IF;
    IF v_pad_count > 1 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_input',
        'details', jsonb_build_object('reason','pad_rate_ambiguous',
                                      'pad_category', v_value, 'matches', v_pad_count));
    END IF;

    SELECT amount, unit INTO v_pad_amount, v_pad_unit
    FROM public.port_tariffs
    WHERE provider='PAD' AND category='DROIT_PASSAGE'
      AND operation_type='IMPORT' AND cargo_type='CONTENEUR'
      AND classification = v_value AND is_active = true;

    -- D. Replay pad_category strictement current
    SELECT id INTO v_existing_pad_cat_fact
    FROM public.quote_facts
    WHERE case_id = v_case_id
      AND fact_key = 'cargo.pad_category'
      AND is_current = true
      AND value_json->>'candidate_id' = p_candidate_id::text
      AND value_json->>'propagation_idempotency_key' = p_idempotency_key
    LIMIT 1;

    -- E. Propagation cargo.pad_category (créer si absent, sinon réutiliser)
    v_value_json := jsonb_build_object(
      'origin', 'MAP-7B',
      'previous_map6_design', 'commodity/pricing keys deprecated',
      'propagated_from', 'commodity_classification_candidates',
      'candidate_id', p_candidate_id,
      'propagation_idempotency_key', p_idempotency_key,
      'operator_validated', true,
      'scheme', NULL,
      'map8b_emits_rate', true
    );

    IF v_existing_pad_cat_fact IS NULL THEN
      SELECT public.supersede_fact(
        p_case_id        := v_case_id,
        p_fact_key       := 'cargo.pad_category',
        p_fact_category  := 'cargo',
        p_value_text     := v_value,
        p_value_json     := v_value_json,
        p_source_type    := 'manual_input',
        p_source_excerpt := '[MAP-7B/8B] propagate candidate ' || p_candidate_id::text,
        p_confidence     := 1.0
      ) INTO v_new_fact_id;

      UPDATE public.commodity_classification_candidates
      SET evidence = COALESCE(evidence, '{}'::jsonb) || jsonb_build_object(
            'propagated_fact_id', v_new_fact_id,
            'propagated_at', now(),
            'propagation_idempotency_key', p_idempotency_key
          )
      WHERE id = p_candidate_id;
    ELSE
      v_new_fact_id := v_existing_pad_cat_fact;
    END IF;

    -- F. Rate fact lookup (scalaires)
    SELECT id, value_number INTO v_existing_rate_id, v_existing_rate_number
    FROM public.quote_facts
    WHERE case_id = v_case_id
      AND fact_key = 'cargo.pad_rate_fcfa_per_ton'
      AND is_current = true
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_existing_rate_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.quote_facts
        WHERE id = v_existing_rate_id
          AND value_json->>'derived_from_candidate_id' = p_candidate_id::text
          AND value_json->>'idempotency_key' = p_idempotency_key
      ) THEN
        v_rate_fact_id := v_existing_rate_id;
        v_rate_fact_status := 'replayed_idempotency';

      ELSIF v_existing_rate_number = v_pad_amount THEN
        v_rate_fact_id := v_existing_rate_id;
        v_rate_fact_status := 'already_current_same_amount';

      ELSE
        SELECT public.supersede_fact(
          p_case_id        := v_case_id,
          p_fact_key       := 'cargo.pad_rate_fcfa_per_ton',
          p_fact_category  := 'cargo',
          p_value_text     := v_pad_amount::text,
          p_value_number   := v_pad_amount,
          p_value_json     := jsonb_build_object(
            'origin','MAP-8B',
            'derived_from_candidate_id', p_candidate_id,
            'derived_from_fact_key','cargo.pad_category',
            'pad_category', v_value,
            'tariff_source', jsonb_build_object(
              'table','port_tariffs','provider','PAD','category','DROIT_PASSAGE',
              'operation_type','IMPORT','cargo_type','CONTENEUR',
              'classification', v_value, 'unit', v_pad_unit, 'amount', v_pad_amount),
            'idempotency_key', p_idempotency_key,
            'previous_amount', v_existing_rate_number),
          p_source_type    := 'manual_input',
          p_source_excerpt := '[MAP-8B] derived from pad_category ' || p_candidate_id::text,
          p_confidence     := 1.0
        ) INTO v_rate_fact_id;
        v_rate_fact_status := 'superseded_amount_changed';
      END IF;
    ELSE
      SELECT public.supersede_fact(
        p_case_id        := v_case_id,
        p_fact_key       := 'cargo.pad_rate_fcfa_per_ton',
        p_fact_category  := 'cargo',
        p_value_text     := v_pad_amount::text,
        p_value_number   := v_pad_amount,
        p_value_json     := jsonb_build_object(
          'origin','MAP-8B',
          'derived_from_candidate_id', p_candidate_id,
          'derived_from_fact_key','cargo.pad_category',
          'pad_category', v_value,
          'tariff_source', jsonb_build_object(
            'table','port_tariffs','provider','PAD','category','DROIT_PASSAGE',
            'operation_type','IMPORT','cargo_type','CONTENEUR',
            'classification', v_value, 'unit', v_pad_unit, 'amount', v_pad_amount),
          'idempotency_key', p_idempotency_key),
        p_source_type    := 'manual_input',
        p_source_excerpt := '[MAP-8B] derived from pad_category ' || p_candidate_id::text,
        p_confidence     := 1.0
      ) INTO v_rate_fact_id;
      v_rate_fact_status := 'created';
    END IF;

    -- Garde-fou final timeline : skip si replay complet
    v_is_full_replay := (v_existing_pad_cat_fact IS NOT NULL
                         AND v_rate_fact_status IN ('replayed_idempotency','already_current_same_amount'));

    IF NOT v_is_full_replay THEN
      INSERT INTO public.case_timeline_events (
        case_id, event_type, actor_type, actor_user_id, event_data
      ) VALUES (
        v_case_id, 'manual_action', 'operator', auth.uid(),
        jsonb_build_object(
          'action_code',  'CCC_PROPAGATED_TO_FACTS',
          'dedupe_key',   'ccc_propagate:' || p_candidate_id::text || ':' || p_idempotency_key,
          'candidate_id', p_candidate_id,
          'fact_key',     'cargo.pad_category',
          'fact_id',      v_new_fact_id,
          'rate_fact_id', v_rate_fact_id,
          'rate_fact_status', v_rate_fact_status,
          'status',       'done')
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'fact_id', v_new_fact_id,
      'rate_fact_id', v_rate_fact_id,
      'rate_fact_status', v_rate_fact_status,
      'candidate_id', p_candidate_id,
      'fact_key', 'cargo.pad_category',
      'idempotent', v_is_full_replay
    );
  END IF;
  -- ===== fin bloc pad_category =====

  -- 11. Branches non-pad_category (hs10_uemoa) — flux original inchangé
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

  UPDATE public.commodity_classification_candidates
  SET evidence = COALESCE(evidence, '{}'::jsonb) || jsonb_build_object(
        'propagated_fact_id', v_new_fact_id,
        'propagated_at', now(),
        'propagation_idempotency_key', p_idempotency_key
      )
  WHERE id = p_candidate_id;

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

  RETURN jsonb_build_object(
    'ok', true,
    'fact_id', v_new_fact_id,
    'candidate_id', p_candidate_id,
    'fact_key', v_fact_key,
    'idempotent', false
  );
END;
$function$;
