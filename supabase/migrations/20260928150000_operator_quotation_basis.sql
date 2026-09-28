-- Cotation sur bases opérateur : adoption explicite, sans promotion de faits.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE UNIQUE INDEX pricing_runs_operator_source_unique
 ON public.pricing_runs ((outputs_json #>> '{operator_basis,source_run_id}'))
 WHERE outputs_json ? 'operator_basis';
CREATE UNIQUE INDEX pricing_runs_operator_key_unique
 ON public.pricing_runs (case_id, (outputs_json #>> '{operator_basis,idempotency_key}'))
 WHERE outputs_json ? 'operator_basis';
CREATE FUNCTION public.adopt_operator_quotation_basis(
 p_case_id uuid, p_scenario_id uuid, p_scenario_pricing_run_id uuid,
 p_expected_scope_hash text, p_idempotency_key text, p_actor_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET lock_timeout = '5s' AS $$
DECLARE
 v_run public.quote_scenario_pricing_runs%rowtype;
 v_scenario public.quote_scenarios%rowtype;
 v_fact_row public.quote_facts%rowtype;
 v_assumption_row public.quote_scenario_assumptions%rowtype;
 v_fact jsonb; v_assumption jsonb; v_count bigint;
 v_existing public.pricing_runs%rowtype;
 v_case public.quote_cases%rowtype;
 v_id uuid := gen_random_uuid(); v_number integer; v_basis jsonb; v_intent jsonb;
BEGIN
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor_user_id)
    OR p_case_id IS NULL OR p_scenario_id IS NULL OR p_scenario_pricing_run_id IS NULL
    OR p_expected_scope_hash IS NULL OR p_expected_scope_hash !~ '^[a-f0-9]{64}$'
    OR p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) NOT BETWEEN 8 AND 128 THEN
   RAISE EXCEPTION 'VALIDATION_FAILED: paramètres invalides';
 END IF;
 -- Short transaction only. Block competing writers, including legacy writers
 -- that do not take advisory locks; no network/engine call while locks are held.
 LOCK TABLE public.quote_cases, public.pricing_runs IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.quote_scenarios, public.quote_scenario_selections,
 public.quote_scenario_pricing_runs, public.quote_scenario_links,
 public.quote_scenario_assumptions, public.quote_facts, public.case_timeline_events IN SHARE MODE;
 SELECT * INTO v_case FROM public.quote_cases WHERE id=p_case_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: dossier'; END IF;
 SELECT * INTO v_existing FROM public.pricing_runs
 WHERE case_id=p_case_id AND outputs_json #>> '{operator_basis,idempotency_key}'=trim(p_idempotency_key);
 IF FOUND AND (v_existing.outputs_json #>> '{operator_basis,source_run_id}' IS DISTINCT FROM p_scenario_pricing_run_id::text
    OR v_existing.outputs_json #>> '{operator_basis,scenario_id}' IS DISTINCT FROM p_scenario_id::text
    OR v_existing.outputs_json #>> '{operator_basis,scope_hash}' IS DISTINCT FROM p_expected_scope_hash) THEN
   RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: clé déjà utilisée pour un autre calcul';
 END IF;
 SELECT * INTO v_existing FROM public.pricing_runs
 WHERE outputs_json #>> '{operator_basis,source_run_id}'=p_scenario_pricing_run_id::text;
 IF FOUND THEN
   IF v_existing.outputs_json #>> '{operator_basis,idempotency_key}' IS DISTINCT FROM trim(p_idempotency_key)
     OR v_existing.outputs_json #>> '{operator_basis,source_run_id}'<>p_scenario_pricing_run_id::text OR v_existing.case_id<>p_case_id OR v_existing.outputs_json #>> '{operator_basis,scope_hash}'<>p_expected_scope_hash
     OR v_existing.outputs_json #>> '{operator_basis,scenario_id}'<>p_scenario_id::text THEN
     RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: source différente';
   END IF;

 END IF;
 IF v_case.status::text NOT IN ('NEED_INFO','FACTS_PARTIAL','READY_TO_PRICE','ACK_READY_FOR_PRICING','PRICED_DRAFT','HUMAN_REVIEW','QUOTED_VERSIONED','SENT') THEN
   RAISE EXCEPTION 'CONFLICT_INVALID_STATE: dossier non cotable';
 END IF;
 IF EXISTS(SELECT 1 FROM public.pricing_runs WHERE case_id=p_case_id AND status='running') THEN
   RAISE EXCEPTION 'CONFLICT_INVALID_STATE: calcul en cours';
 END IF;
 SELECT event_data INTO v_intent FROM public.case_timeline_events WHERE case_id=p_case_id AND event_type='thread_intent_v1' ORDER BY created_at DESC LIMIT 1;
 IF coalesce(v_intent #>> '{intent,pricing_gate}',v_intent->>'pricing_gate')='false'
 OR coalesce(v_intent #>> '{intent,intent_type}',v_intent->>'intent_type') IN ('opportunity_check','general_inquiry','send_document') THEN
   RAISE EXCEPTION 'CONFLICT_INVALID_STATE: intention non cotable';
 END IF;
  select * into v_run from public.quote_scenario_pricing_runs
   where id = p_scenario_pricing_run_id for share;
  if not found then
    raise exception 'NOT_FOUND: run de scénario introuvable' using errcode = '22023';
  end if;
  if v_run.case_id <> p_case_id or v_run.scenario_id <> p_scenario_id then
    raise exception 'FORBIDDEN_CROSS_CASE: run/scénario/dossier incohérents'
      using errcode = '23514';
  end if;
  if v_run.status <> 'success' or v_run.qualification not in ('provisional','partial')
     or v_run.superseded_by_run_id is not null then
    raise exception 'SCENARIO_RUN_NOT_OUTPUTTABLE: seul le dernier run success non ferme est admissible'
      using errcode = '23514';
  end if;

  select * into v_scenario from public.quote_scenarios
   where id = p_scenario_id for share;
  if not found or v_scenario.case_id <> p_case_id
     or v_scenario.scope_hash <> p_expected_scope_hash
     or v_run.scenario_scope_hash <> p_expected_scope_hash
     or v_scenario.scope_snapshot is distinct from v_run.scenario_snapshot
     or v_scenario.status in ('blocked','superseded','promoted_to_final')
     or v_scenario.superseded_by_scenario_id is not null then
    raise exception 'SCENARIO_STATE_CHANGED: scénario non vivant ou périmètre modifié'
      using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.quote_scenario_selections
     where case_id = p_case_id and scenario_id = p_scenario_id and released_at is null
  ) then
    raise exception 'SCENARIO_NOT_SELECTED: le scénario doit rester explicitement sélectionné'
      using errcode = '23514';
  end if;

  -- Attestation exacte du snapshot des faits courants, identique à P1-A4.
  select count(*) into v_count from public.quote_facts
   where case_id = p_case_id and is_current = true;
  if jsonb_array_length(v_run.facts_snapshot) <> v_count then
    raise exception 'SCENARIO_STATE_CHANGED: ensemble des faits courants modifié'
      using errcode = '23514';
  end if;
  for v_fact in select value from jsonb_array_elements(v_run.facts_snapshot) loop
    select * into v_fact_row from public.quote_facts
     where id = (v_fact ->> 'id')::uuid and case_id = p_case_id and is_current = true;
    if not found
       or v_fact ->> 'fact_key' is distinct from v_fact_row.fact_key
       or coalesce(v_fact -> 'value_text', 'null'::jsonb) is distinct from coalesce(to_jsonb(v_fact_row.value_text), 'null'::jsonb)
       or coalesce(v_fact -> 'value_number', 'null'::jsonb) is distinct from coalesce(to_jsonb(v_fact_row.value_number), 'null'::jsonb)
       or coalesce(v_fact -> 'value_json', 'null'::jsonb) is distinct from coalesce(v_fact_row.value_json, 'null'::jsonb)
       or coalesce(v_fact -> 'value_date', 'null'::jsonb) is distinct from coalesce(to_jsonb(v_fact_row.value_date), 'null'::jsonb)
       or coalesce(v_fact -> 'source_type', 'null'::jsonb) is distinct from coalesce(to_jsonb(v_fact_row.source_type), 'null'::jsonb)
       or coalesce(v_fact -> 'confidence', 'null'::jsonb) is distinct from coalesce(to_jsonb(v_fact_row.confidence), 'null'::jsonb) then
      raise exception 'SCENARIO_STATE_CHANGED: fait courant % modifié', v_fact ->> 'id'
        using errcode = '23514';
    end if;
  end loop;
  if (select count(distinct value ->> 'id') from jsonb_array_elements(v_run.facts_snapshot)) <> v_count then
    raise exception 'VALIDATION_FAILED: faits dupliqués dans le snapshot'
      using errcode = '22023';
  end if;

  IF (SELECT coalesce(jsonb_agg(jsonb_build_object('code',reserve_code,'source','scenario_link','open_point_key',open_point_key) ORDER BY reserve_code,open_point_key),'[]'::jsonb)
      FROM public.quote_scenario_links WHERE scenario_id=p_scenario_id AND reserve_code IS NOT NULL)
     IS DISTINCT FROM (SELECT coalesce(jsonb_agg(r ORDER BY r->>'code',r->>'open_point_key'),'[]'::jsonb)
      FROM jsonb_array_elements(v_run.reservations) r WHERE r->>'source'='scenario_link') THEN
    RAISE EXCEPTION 'SCENARIO_STATE_CHANGED: réserves liées modifiées';
  END IF;
  -- Attestation exacte des hypothèses encore liées et vivantes.
  select count(*) into v_count
    from public.quote_scenario_links l
    join public.quote_scenario_assumptions a on a.id = l.assumption_id
   where l.scenario_id = p_scenario_id and l.assumption_id is not null;
  if jsonb_array_length(v_run.assumptions_snapshot) <> v_count then
    raise exception 'SCENARIO_STATE_CHANGED: ensemble des hypothèses liées modifié'
      using errcode = '23514';
  end if;
  for v_assumption in select value from jsonb_array_elements(v_run.assumptions_snapshot) loop
    select a.* into v_assumption_row
      from public.quote_scenario_assumptions a
      join public.quote_scenario_links l on l.assumption_id = a.id
     where a.id = (v_assumption ->> 'id')::uuid
       and a.case_id = p_case_id and l.scenario_id = p_scenario_id;
    if not found or v_assumption_row.status not in ('active','client_confirmed')
       or v_assumption ->> 'status' is distinct from v_assumption_row.status
       or coalesce(v_assumption -> 'assumption_type', 'null'::jsonb) is distinct from coalesce(to_jsonb(v_assumption_row.assumption_type), 'null'::jsonb)
       or coalesce(v_assumption -> 'assumed_fact_key', 'null'::jsonb) is distinct from coalesce(to_jsonb(v_assumption_row.assumed_fact_key), 'null'::jsonb)
       or coalesce(v_assumption -> 'assumed_value_type', 'null'::jsonb) is distinct from coalesce(to_jsonb(v_assumption_row.assumed_value_type), 'null'::jsonb)
       or coalesce(v_assumption -> 'assumed_value', 'null'::jsonb) is distinct from coalesce(v_assumption_row.assumed_value, 'null'::jsonb)
       or coalesce(v_assumption -> 'statement', 'null'::jsonb) is distinct from coalesce(to_jsonb(v_assumption_row.statement), 'null'::jsonb)
       or coalesce(v_assumption -> 'basis', 'null'::jsonb) is distinct from coalesce(to_jsonb(v_assumption_row.basis), 'null'::jsonb)
       or coalesce(v_assumption -> 'source_type', 'null'::jsonb) is distinct from coalesce(to_jsonb(v_assumption_row.source_type), 'null'::jsonb)
       or coalesce(v_assumption -> 'source_refs', 'null'::jsonb) is distinct from coalesce(v_assumption_row.source_refs, 'null'::jsonb)
       or coalesce(v_assumption -> 'risk_level', 'null'::jsonb) is distinct from coalesce(to_jsonb(v_assumption_row.risk_level), 'null'::jsonb) then
      raise exception 'SCENARIO_STATE_CHANGED: hypothèse % modifiée/non vivante',
        v_assumption ->> 'id' using errcode = '23514';
    end if;
  end loop;
  if (select count(distinct value ->> 'id') from jsonb_array_elements(v_run.assumptions_snapshot)) <> v_count then
    raise exception 'VALIDATION_FAILED: hypothèses dupliquées dans le snapshot'
      using errcode = '22023';
  end if;

  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('pricing_run_id',v_existing.id,'run_number',v_existing.run_number,'idempotent_replay',true);
  END IF;

 IF jsonb_array_length(v_run.blockers)<>0 OR jsonb_array_length(v_run.tariff_lines)=0
 OR v_run.indicative_total_ht IS NULL OR v_run.indicative_total_ttc IS NULL THEN
   RAISE EXCEPTION 'SCENARIO_RUN_NOT_OUTPUTTABLE: calcul incomplet ou bloqué';
 END IF;
 v_basis:=jsonb_build_object('schema_version',1,'idempotency_key',trim(p_idempotency_key),'source_run_id',v_run.id,'scenario_id',v_scenario.id,
 'scope_hash',v_scenario.scope_hash,'title',v_scenario.title,'revision_no',v_scenario.revision_no,
 'calculated_at',v_run.completed_at,'adopted_at',now(),'adopted_by',p_actor_user_id,
 'scope',v_run.scenario_snapshot,'assumptions',v_run.assumptions_snapshot,
 'overlay',v_run.overlay_json,'reservations',v_run.reservations,'open_points',v_scenario.open_points);
 SELECT coalesce(max(run_number),0)+1 INTO v_number FROM public.pricing_runs WHERE case_id=p_case_id;
 INSERT INTO public.pricing_runs(id,case_id,run_number,inputs_json,facts_snapshot,engine_request,engine_response,
 outputs_json,tariff_lines,total_ht,total_ttc,currency,status,tariff_sources,started_at,completed_at,duration_ms,created_by)
 VALUES(v_id,p_case_id,v_number,v_run.inputs_json,v_run.facts_snapshot,v_run.engine_request,v_run.engine_response,
 jsonb_build_object('operator_basis',v_basis,'totals',jsonb_build_object(
 'subtotal_before_sodatra_vat',v_run.indicative_total_ht,'total_payable',v_run.indicative_total_ttc,
 'honoraires_tva',v_run.indicative_total_ttc-v_run.indicative_total_ht),'quoteQualification',jsonb_build_object('level',v_run.qualification,
 'reasons',jsonb_build_array(jsonb_build_object('code','OPERATOR_QUOTATION_BASIS','message','Cotation sur bases opérateur explicites et révisables.')),
 'firmTotalPolicy','all_included')),v_run.tariff_lines,v_run.indicative_total_ht,v_run.indicative_total_ttc,
 v_run.currency,'success',v_run.tariff_sources,now(),now(),0,p_actor_user_id);
 UPDATE public.quote_cases SET status='PRICED_DRAFT',pricing_runs_count=(SELECT count(*) FROM public.pricing_runs WHERE case_id=p_case_id),updated_at=now() WHERE id=p_case_id;
 INSERT INTO public.case_timeline_events(case_id,event_type,event_data,actor_type,actor_user_id)
 VALUES(p_case_id,'pricing_completed',jsonb_build_object('pricing_run_id',v_id,'run_number',v_number,
 'source_scenario_run_id',v_run.id,'basis_revision',v_scenario.revision_no,'mode','operator_basis'),'user',p_actor_user_id);
 RETURN jsonb_build_object('pricing_run_id',v_id,'run_number',v_number,'idempotent_replay',false);
END $$;
REVOKE ALL ON FUNCTION public.adopt_operator_quotation_basis(uuid,uuid,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.adopt_operator_quotation_basis(uuid,uuid,uuid,text,text,uuid) TO service_role;
COMMIT;
