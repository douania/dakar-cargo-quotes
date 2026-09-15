-- Local PostgreSQL only, after 20260914120000. Synthetic, transaction rolled back.
-- No Cloud execution authorized by this lot.
-- Optional upgrade/replay proof: psql -v ON_ERROR_STOP=1 -v scenario_v2_upgrade_test=1 -f this_file
-- Requires the original P1-A2 validators and their original privileges, NOT v2.
\if :{?scenario_v2_upgrade_test}
create temporary table scenario_cargo_v2_upgrade_check (
  snapshot jsonb not null check (public.quote_scenario_scope_violation(snapshot) is null)
);
create temporary table scenario_cargo_v2_catalog_before as
  select oid, proname, proacl, proowner, prosecdef, provolatile,
    case when proname <> 'quote_scenario_scope_violation' then prosrc end as unchanged_body
  from pg_proc where pronamespace = 'public'::regnamespace and proname like 'quote_scenario_%';
insert into scenario_cargo_v2_upgrade_check values ('{"schema_version":1,"transport_mode":"MARITIME","movement_direction":"IMPORT","terminal_operation_mode":"LOLO","cargo_units":[{"unit_ref":"legacy-a","unit_kind":"CONTAINER","equipment_code":"20hq","packaging":"unknown","quantity":4,"gross_weight_kg":19000,"chargeable_weight_kg":null,"volume_dm3":null,"temperature_control_required":false,"temperature_setpoint_celsius":null,"classification_status":"unknown","destination_ref":null,"dangerous_goods":false,"required_attachment_status":"not_required"}]}');
create temporary table scenario_cargo_v2_rows_before as
  select snapshot, encode(sha256(convert_to(snapshot::text,'UTF8')),'hex') as scope_hash,
    public.quote_scenario_derive_open_points(snapshot) as open_points
  from scenario_cargo_v2_upgrade_check;
\ir ../migrations/20260914120000_scenario_cargo_v2.sql
\ir ../migrations/20260914120000_scenario_cargo_v2.sql
do $$
declare v_snapshot jsonb;
begin
  if exists (select 1 from scenario_cargo_v2_catalog_before b left join pg_proc p on p.oid=b.oid
    where p.oid is null or p.proacl is distinct from b.proacl or p.proowner<>b.proowner
      or p.prosecdef<>b.prosecdef or p.provolatile<>b.provolatile
      or (b.unchanged_body is not null and p.prosrc<>b.unchanged_body)) then raise exception 'existing validator identity/ACL/body changed'; end if;
  if exists (select 1 from scenario_cargo_v2_upgrade_check c cross join scenario_cargo_v2_rows_before b
    where c.snapshot<>b.snapshot or encode(sha256(convert_to(c.snapshot::text,'UTF8')),'hex')<>b.scope_hash
      or public.quote_scenario_derive_open_points(c.snapshot)<>b.open_points) then raise exception 'legacy snapshot/hash/open points changed'; end if;
  select jsonb_set(snapshot,'{schema_version}','2') into v_snapshot from scenario_cargo_v2_rows_before;
  v_snapshot := jsonb_set(v_snapshot,'{cargo_units,0}',(v_snapshot #> '{cargo_units,0}') || '{"dangerous_goods":null,"ownership":null,"un_number":null,"imo_class":null,"weight_basis":"unknown","scenario_basis":"Synthetic assumption"}');
  -- This CHECK was compiled before the migration: verifies preserved function OID.
  insert into scenario_cargo_v2_upgrade_check values (v_snapshot);
  raise notice 'scenario cargo v2 upgrade/replay/OID/ACL/history PASS';
end;
$$;
drop table scenario_cargo_v2_upgrade_check, scenario_cargo_v2_catalog_before, scenario_cargo_v2_rows_before;
\endif

begin;
create temporary table scenario_cargo_v2_check_test (
  snapshot jsonb not null check (public.quote_scenario_scope_violation(snapshot) is null)
) on commit drop;

do $$
declare
  v_unit jsonb := '{"unit_ref":"synthetic-a","unit_kind":"CONTAINER","equipment_code":"20hq","packaging":"unknown","quantity":4,"gross_weight_kg":19000,"chargeable_weight_kg":null,"volume_dm3":null,"temperature_control_required":false,"temperature_setpoint_celsius":null,"classification_status":"unknown","destination_ref":null,"dangerous_goods":false,"required_attachment_status":"not_required"}';
  v_v1 jsonb;
  v_v2 jsonb;
  v_bad jsonb;
  v_key text;
  v_reason text;
  v_rejected boolean;
begin
  v_v1 := jsonb_build_object('schema_version',1,'transport_mode','MARITIME','movement_direction','IMPORT','terminal_operation_mode','LOLO','cargo_units',jsonb_build_array(v_unit));
  if public.quote_scenario_scope_violation(v_v1) is not null then raise exception 'v1 regression'; end if;
  insert into scenario_cargo_v2_check_test values (v_v1);

  v_v2 := jsonb_set(v_v1, '{schema_version}', '2');
  v_v2 := jsonb_set(v_v2, '{cargo_units,0}', v_unit || '{"dangerous_goods":null,"ownership":null,"un_number":null,"imo_class":null,"weight_basis":"unknown","scenario_basis":"Synthetic operator assumption"}');
  v_reason := public.quote_scenario_scope_violation(v_v2);
  if v_reason is not null then raise exception 'v2 unknown rejected: %', v_reason; end if;
  insert into scenario_cargo_v2_check_test values (v_v2);
  if (select snapshot from scenario_cargo_v2_check_test where snapshot -> 'schema_version' = '1') is distinct from v_v1 then raise exception 'legacy snapshot changed'; end if;
  if (select snapshot #> '{cargo_units,0,dangerous_goods}' from scenario_cargo_v2_check_test where snapshot -> 'schema_version' = '2') is distinct from 'null'::jsonb then raise exception 'unknown coerced to false'; end if;

  foreach v_key in array array['ownership','un_number','imo_class','weight_basis','scenario_basis','dangerous_goods'] loop
    v_bad := jsonb_set(v_v2, '{cargo_units,0}', (v_v2 #> '{cargo_units,0}') - v_key);
    if public.quote_scenario_scope_violation(v_bad) is null then raise exception 'missing key accepted: %', v_key; end if;
  end loop;
  for v_bad in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_set(v_v2,'{schema_version}','3'),
    jsonb_set(v_v2,'{cargo_units,0,ownership}','"BOTH"'),
    jsonb_set(v_v2,'{cargo_units,0,weight_basis}','"guess"'),
    jsonb_set(v_v2,'{cargo_units,0,weight_basis}','["per_unit"]'),
    jsonb_set(v_v2,'{cargo_units,0,un_number}','"UN3536"'),
    jsonb_set(v_v2,'{cargo_units,0,imo_class}','9'),
    jsonb_set(v_v2,'{cargo_units,0,rogue}','true'),
    jsonb_set(v_v2,'{cargo_units,0,quantity}','1.5'),
    jsonb_set(v_v2,'{cargo_units,0,unit_ref}','"11111111-1111-4111-8111-111111111111"'),
    jsonb_set(v_v2,'{cargo_units,0,amount}','100')
  )) loop
    if public.quote_scenario_scope_violation(v_bad) is null then raise exception 'invalid v2 accepted: %', v_bad; end if;
    v_rejected := false;
    begin
      insert into scenario_cargo_v2_check_test values (v_bad);
    exception when check_violation then v_rejected := true;
    end;
    if not v_rejected then raise exception 'CHECK bypass'; end if;
  end loop;
  v_v2 := jsonb_set(v_v2, '{cargo_units,0}', (v_v2 #> '{cargo_units,0}') || '{"dangerous_goods":true,"ownership":"SOC","un_number":"UN3536","imo_class":"9","weight_basis":"per_unit"}');
  if public.quote_scenario_scope_violation(v_v2) is not null then raise exception 'valid DG rejected'; end if;
  if has_function_privilege('anon', 'public.quote_scenario_cargo_unit_v2_violation(jsonb,text)', 'execute') then raise exception 'anonymous execute granted'; end if;
  if has_function_privilege('authenticated', 'public.quote_scenario_cargo_unit_v2_violation(jsonb,text)', 'execute') then raise exception 'authenticated execute granted'; end if;
  if has_function_privilege('service_role', 'public.quote_scenario_cargo_unit_v2_violation(jsonb,text)', 'execute') then raise exception 'service_role execute granted'; end if;
  raise notice 'scenario cargo v2 SQL assertions PASS';
end;
$$;
rollback;

-- Optional integration on a rebuilt LOCAL application schema, never Cloud.
-- Exercises real RPCs/triggers/RLS with a SYNTHETIC pricing result, not the Edge engine.
\if :{?scenario_v2_rpc_test}
begin;
do $$
declare
  v_actor uuid := gen_random_uuid(); v_case uuid := gen_random_uuid(); v_other uuid := gen_random_uuid();
  v_scenario uuid; v_run uuid; v_version uuid; v_hash text;
  v_created jsonb; v_replay jsonb; v_result jsonb; v_output jsonb; v_denied boolean;
  v_snapshot jsonb := '{"schema_version":2,"transport_mode":"MARITIME","movement_direction":"IMPORT","terminal_operation_mode":"LOLO","cargo_units":[{"unit_ref":"synthetic-a","unit_kind":"CONTAINER","equipment_code":"20hq","packaging":"unknown","quantity":4,"gross_weight_kg":19000,"chargeable_weight_kg":null,"volume_dm3":null,"temperature_control_required":false,"temperature_setpoint_celsius":null,"classification_status":"unknown","destination_ref":null,"dangerous_goods":true,"required_attachment_status":"not_required","ownership":"SOC","un_number":"UN3536","imo_class":null,"weight_basis":"per_unit","scenario_basis":"Synthetic local simulation"}]}';
begin
  insert into auth.users(id,email) values (v_actor,'scenario-review-'||v_actor::text||'@invalid.local');
  insert into public.quote_cases(id,created_by) values (v_case,v_actor),(v_other,v_actor);
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  set local role service_role;
  v_created := public.manage_quote_scenario(v_case,'create',v_actor,'review-create',repeat('a',64),p_title=>'Synthetic local review',p_scope_snapshot=>v_snapshot);
  v_scenario := (v_created->>'scenario_id')::uuid; v_hash := v_created->>'scope_hash';
  v_replay := public.manage_quote_scenario(v_case,'create',v_actor,'review-create',repeat('a',64),p_title=>'Synthetic local review',p_scope_snapshot=>v_snapshot);
  assert v_replay->>'scenario_id'=v_scenario::text and (v_replay->>'idempotent_replay')::boolean, 'create replay failed';
  perform public.manage_quote_scenario(v_case,'select',v_actor,'review-select',repeat('b',64),p_scenario_id=>v_scenario);
  v_result := jsonb_build_object('status','success','qualification','partial','blockers','[]'::jsonb,'scenario_snapshot',v_snapshot,'inputs_json','{}'::jsonb,
    'facts_snapshot','[]'::jsonb,'assumptions_snapshot','[]'::jsonb,'overlay_json','[]'::jsonb,
    'reservations','[{"code":"SCENARIO_CARGO_GROUP_ASSUMPTION","message":"Lot synthetic-a : synthetic local simulation, not a client fact"}]'::jsonb,
    'tariff_lines','[{"id":"synthetic-line","description":"Synthetic test amount","category":"Transport","bloc":"operationnel","amount":1000,"currency":"XOF","source":{"type":"OFFICIAL"},"scenario_provenance":{"assumption_dependent":true,"dependency_keys":["scenario.cargo_units"],"firm_eligible":false}}]'::jsonb,
    'tariff_sources','[]'::jsonb,'firm_total_ht',0,'firm_total_ttc',0,'indicative_total_ht',1000,'indicative_total_ttc',1000,'currency','XOF','duration_ms',0);
  v_replay := public.record_quote_scenario_pricing_run(v_case,v_scenario,v_hash,'review-pricing',repeat('c',64),v_actor,v_result);
  v_run := (v_replay->>'pricing_run_id')::uuid;
  v_replay := public.record_quote_scenario_pricing_run(v_case,v_scenario,v_hash,'review-pricing',repeat('c',64),v_actor,v_result);
  assert (v_replay->>'idempotent_replay')::boolean and (v_replay->>'pricing_run_id')::uuid=v_run, 'pricing replay failed';
  v_denied := false;
  begin
    perform public.record_quote_scenario_pricing_run(v_other,v_scenario,v_hash,'review-cross-case',repeat('d',64),v_actor,v_result);
  exception when check_violation then v_denied := SQLERRM like 'FORBIDDEN_CROSS_CASE:%'; end;
  assert v_denied, 'cross-case pricing accepted';
  v_denied := false;
  begin
    perform public.record_quote_scenario_pricing_run(v_case,v_scenario,repeat('0',64),'review-stale',repeat('e',64),v_actor,v_result);
  exception when check_violation then v_denied := SQLERRM like 'SCENARIO_STATE_CHANGED:%'; end;
  assert v_denied, 'stale hash accepted';
  v_output := public.create_scenario_quotation_version(v_case,v_scenario,v_run,v_hash,'review-version',v_actor);
  v_version := (v_output->>'version_id')::uuid;
  v_replay := public.create_scenario_quotation_version(v_case,v_scenario,v_run,v_hash,'review-version',v_actor);
  assert (v_replay->>'idempotent_replay')::boolean and (v_replay->>'version_id')::uuid=v_version, 'output replay failed';
  reset role;
  assert (select status='NEW_THREAD' from public.quote_cases where id=v_case), 'case state changed';
  assert not exists (select 1 from public.quote_facts where case_id=v_case), 'canonical facts created';
  assert not exists (select 1 from public.pricing_runs where case_id=v_case), 'canonical pricing created';
  assert not exists (select 1 from public.email_drafts where quotation_version_id=v_version), 'email draft created';
  assert (select source_kind='scenario' and status='draft' and not is_selected and pricing_run_id is null
    and snapshot #>> '{totals,firm_total_ht}'='0' and snapshot #>> '{totals,indicative_total_ht}'='1000'
    and (snapshot #> '{scenario,reservations}')::text like '%synthetic-a%'
    from public.quotation_versions where id=v_version), 'output provenance or totals lost';
  set local role authenticated;
  assert (select count(*)=1 from public.quote_scenarios where id=v_scenario), 'operator read denied';
  v_denied := false;
  begin
    perform public.manage_quote_scenario(v_case,'select',v_actor,'review-direct',repeat('f',64),p_scenario_id=>v_scenario);
  exception when insufficient_privilege then v_denied:=true; end;
  assert v_denied, 'direct operator RPC allowed';
  v_denied := false;
  begin
    update public.quote_scenarios set title='forged' where id=v_scenario;
  exception when insufficient_privilege then v_denied:=true; end;
  assert v_denied, 'direct operator write allowed';
  reset role;
  raise notice 'scenario v2 real RPC chain/create/select/pricing/output/replay/isolation/RLS PASS (synthetic result)';
end;
$$;
rollback;
\endif
