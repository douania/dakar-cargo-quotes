-- LOCAL restored-schema fixture. Standalone invocation always rolls back.
-- Reuses identities inside SQL only; no client values or identifiers are emitted.
begin;
do $test$
declare v_case uuid; v_actor uuid; v_scope jsonb; v_v2 jsonb; v_created jsonb; v_replay jsonb;
  v_selected jsonb; v_result jsonb; v_run jsonb; v_facts jsonb; v_role text; v_revision jsonb;
begin
  select id into strict v_case from public.quote_cases order by id limit 1;
  select id into strict v_actor from auth.users order by id limit 1;
  v_scope := '{"schema_version":3,"transport_mode":"MARITIME","movement_direction":"IMPORT","terminal_operation_mode":null,"cargo_units":[{"unit_ref":"synthetic-a","unit_kind":"CONTAINER","equipment_code":"20hq","packaging":"unknown","quantity":2,"gross_weight_kg":18000,"chargeable_weight_kg":null,"volume_dm3":null,"temperature_control_required":false,"temperature_setpoint_celsius":null,"classification_status":"unknown","destination_ref":null,"dangerous_goods":null,"required_attachment_status":"not_required","ownership":"SOC","un_number":null,"imo_class":null,"weight_basis":"per_unit","scenario_basis":"Synthetic local integration hypothesis"}],"pad_choices":[{"unit_ref":"synthetic-a","category":"T02","basis":"Synthetic local review"}]}';
  v_v2 := (v_scope-'pad_choices') || '{"schema_version":2}'::jsonb;
  select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]') into v_facts from public.quote_facts f where case_id=v_case and is_current;
  if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid='public.quote_scenario_scope_v2_violation(jsonb)'::regprocedure and a.grantee=0)
    then raise exception 'helper PUBLIC execute'; end if;
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_function_privilege(v_role,'public.quote_scenario_scope_v2_violation(jsonb)','EXECUTE')
      or has_table_privilege(v_role,'public.quote_scenarios','INSERT,UPDATE,DELETE')
      or has_table_privilege(v_role,'public.quote_scenario_pricing_runs','INSERT,UPDATE,DELETE')
      then raise exception 'helper/table write access granted to forbidden role'; end if;
  end loop;
  foreach v_role in array array['anon','authenticated'] loop
    if has_function_privilege(v_role,'public.manage_quote_scenario(uuid,text,uuid,text,text,uuid,text,jsonb,jsonb,jsonb,text,text,text)','EXECUTE')
      or has_function_privilege(v_role,'public.record_quote_scenario_pricing_run(uuid,uuid,text,text,text,uuid,jsonb)','EXECUTE')
      or has_table_privilege(v_role,'public.quote_scenarios','INSERT')
      or has_table_privilege(v_role,'public.quote_scenario_pricing_runs','INSERT') then raise exception 'unsafe operator privileges'; end if;
  end loop;
  execute 'set local role service_role';
  perform public.manage_quote_scenario(v_case,'create',v_actor,'pad-v3-test-legacy',repeat('1',64),p_title=>'SYNTHETIC LOCAL v2',p_scope_snapshot=>v_v2);
  v_created := public.manage_quote_scenario(v_case,'create',v_actor,'pad-v3-test-create',repeat('2',64),p_title=>'SYNTHETIC LOCAL v3',p_scope_snapshot=>v_scope);
  v_replay := public.manage_quote_scenario(v_case,'create',v_actor,'pad-v3-test-create',repeat('2',64),p_title=>'SYNTHETIC LOCAL v3',p_scope_snapshot=>v_scope);
  if v_replay->>'scenario_id'<>v_created->>'scenario_id' or v_replay->'idempotent_replay'<>'true'::jsonb then raise exception 'create replay failed'; end if;
  begin
    perform public.manage_quote_scenario(v_case,'create',v_actor,'pad-v3-test-create',repeat('3',64),p_title=>'SYNTHETIC LOCAL conflict',p_scope_snapshot=>v_scope);
    raise exception 'idempotency conflict not rejected';
  exception when unique_violation then null; end;
  begin
    perform public.manage_quote_scenario(v_case,'create',v_actor,'pad-v3-test-invalid',repeat('4',64),p_title=>'SYNTHETIC LOCAL invalid',p_scope_snapshot=>jsonb_set(v_scope,'{pad_choices,0,amount}','100'));
    raise exception 'monetary injection not rejected';
  exception when invalid_parameter_value then null; end;
  v_selected := public.manage_quote_scenario(v_case,'select',v_actor,'pad-v3-test-select',repeat('5',64),p_scenario_id=>(v_created->>'scenario_id')::uuid);
  v_result := jsonb_build_object('status','success','qualification','partial','blockers','[]'::jsonb,'scenario_snapshot',v_scope,'inputs_json','{}'::jsonb,
    'facts_snapshot',v_facts,'assumptions_snapshot','[]'::jsonb,'overlay_json','[]'::jsonb,'reservations','[{"code":"SYNTHETIC_LOCAL_ONLY"}]'::jsonb,
    'tariff_lines','[{"id":"synthetic-pad","amount":null,"source":{"type":"TO_CONFIRM"}}]'::jsonb,'tariff_sources','[]'::jsonb,
    'firm_total_ht',0,'firm_total_ttc',0,'indicative_total_ht',0,'indicative_total_ttc',0,'currency','XOF','duration_ms',1);
  v_run := public.record_quote_scenario_pricing_run(v_case,(v_created->>'scenario_id')::uuid,v_created->>'scope_hash','pad-v3-test-pricing',repeat('6',64),v_actor,v_result);
  v_replay := public.record_quote_scenario_pricing_run(v_case,(v_created->>'scenario_id')::uuid,v_created->>'scope_hash','pad-v3-test-pricing',repeat('6',64),v_actor,v_result);
  if v_replay->>'pricing_run_id'<>v_run->>'pricing_run_id' or v_replay->'idempotent_replay'<>'true'::jsonb then raise exception 'pricing replay failed'; end if;
  begin
    perform public.record_quote_scenario_pricing_run(v_case,(v_created->>'scenario_id')::uuid,repeat('f',64),'pad-v3-test-stale',repeat('7',64),v_actor,v_result);
    raise exception 'stale hash not rejected';
  exception when check_violation then null; end;
  v_revision := public.manage_quote_scenario(v_case,'revise',v_actor,'pad-v3-test-revise',repeat('8',64),
    p_scenario_id=>(v_created->>'scenario_id')::uuid,p_title=>'SYNTHETIC LOCAL revision',
    p_scope_snapshot=>jsonb_set(v_scope,'{pad_choices,0,category}','"T03"'),p_revision_reason=>'Synthetic local correction');
  execute 'reset role';
  if v_revision->>'scenario_id'=v_created->>'scenario_id' or (v_revision->>'revision_no')::int<>2
    or (select scope_snapshot from public.quote_scenarios where id=(v_created->>'scenario_id')::uuid) is distinct from v_scope
    or (select scope_snapshot from public.quote_scenarios where id=(v_revision->>'scenario_id')::uuid)
       is distinct from jsonb_set(v_scope,'{pad_choices,0,category}','"T03"') then raise exception 'scenario revision/history invalid'; end if;
  if (select scenario_snapshot from public.quote_scenario_pricing_runs where id=(v_run->>'pricing_run_id')::uuid) is distinct from v_scope
    then raise exception 'historical pricing snapshot changed'; end if;
  raise notice 'PASS full-schema service_role RPCs: v2/v3 create, idempotence, conflict, monetary rejection, select, pricing replay, stale hash, revision/history, operator write restrictions';
end;
$test$;
rollback;
