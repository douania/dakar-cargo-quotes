-- Synthetic LOCAL PostgreSQL only. Requires v2 validators. All test rows rolled back.
-- Optional upgrade proof from v2: psql -v ON_ERROR_STOP=1 -v scenario_v3_upgrade_test=1 -f this_file
\if :{?scenario_v3_upgrade_test}
create temporary table pad_v3_catalog_before as select oid,proowner,proacl,prosecdef,provolatile,proconfig
  from pg_proc where oid='public.quote_scenario_scope_violation(jsonb)'::regprocedure;
create temporary table pad_v3_legacy_check(snapshot jsonb check(public.quote_scenario_scope_violation(snapshot) is null));
insert into pad_v3_legacy_check values ('{"schema_version":2,"transport_mode":"MARITIME","movement_direction":"IMPORT","terminal_operation_mode":null,"cargo_units":[{"unit_ref":"a","unit_kind":"CONTAINER","equipment_code":"20hq","packaging":"unknown","quantity":2,"gross_weight_kg":18000,"chargeable_weight_kg":null,"volume_dm3":null,"temperature_control_required":false,"temperature_setpoint_celsius":null,"classification_status":"unknown","destination_ref":null,"dangerous_goods":null,"required_attachment_status":"not_required","ownership":"SOC","un_number":null,"imo_class":null,"weight_basis":"per_unit","scenario_basis":"Synthetic hypothesis"}]}');
create temporary table pad_v3_rows_before as select snapshot,md5(snapshot::text) as hash,
  public.quote_scenario_derive_open_points(snapshot) as points from pad_v3_legacy_check;
\ir ../migrations/20260915150000_scenario_pad_v3.sql
\ir ../migrations/20260915150000_scenario_pad_v3.sql
do $$
begin
  if exists(select 1 from pad_v3_catalog_before b left join pg_proc p on p.oid=b.oid where p.oid is null
    or row(p.proowner,p.proacl,p.prosecdef,p.provolatile,p.proconfig) is distinct from row(b.proowner,b.proacl,b.prosecdef,b.provolatile,b.proconfig))
    then raise exception 'validator identity, ACL or execution properties changed'; end if;
  if exists(select 1 from pad_v3_legacy_check c cross join pad_v3_rows_before b where c.snapshot<>b.snapshot
    or md5(c.snapshot::text)<>b.hash or public.quote_scenario_derive_open_points(c.snapshot)<>b.points)
    then raise exception 'legacy rows/hash/open points changed'; end if;
  insert into pad_v3_legacy_check select snapshot || '{"schema_version":3,"pad_choices":[{"unit_ref":"a","category":"T02","basis":"Synthetic review"}]}'::jsonb from pad_v3_rows_before;
  raise notice 'v3 upgrade/replay: existing CHECK, OID/ACL/properties and v2 row/hash/open points PASS';
end;
$$;
\endif
begin;
create temporary table pad_v3_check(snapshot jsonb check(public.quote_scenario_scope_violation(snapshot) is null));
do $$
declare
  v_unit jsonb := '{"unit_ref":"a","unit_kind":"CONTAINER","equipment_code":"20hq","packaging":"unknown","quantity":2,"gross_weight_kg":18000,"chargeable_weight_kg":null,"volume_dm3":null,"temperature_control_required":false,"temperature_setpoint_celsius":null,"classification_status":"unknown","destination_ref":null,"dangerous_goods":null,"required_attachment_status":"not_required","ownership":"SOC","un_number":null,"imo_class":null,"weight_basis":"per_unit","scenario_basis":"Synthetic operator hypothesis"}';
  v_v2 jsonb; v_v3 jsonb; v_bad jsonb;
begin
  v_v2 := jsonb_build_object('schema_version',2,'transport_mode','MARITIME','movement_direction','IMPORT','terminal_operation_mode',null,'cargo_units',jsonb_build_array(v_unit));
  v_v3 := v_v2 || '{"schema_version":3,"pad_choices":[{"unit_ref":"a","category":"T02","basis":"Synthetic operator choice"}]}'::jsonb;
  if public.quote_scenario_scope_violation(v_v2) is not null then raise exception 'v2 regression'; end if;
  if public.quote_scenario_scope_violation(v_v3) is not null then raise exception 'v3 rejected: %', public.quote_scenario_scope_violation(v_v3); end if;
  insert into pad_v3_check values(v_v2),(v_v3);
  for v_bad in select value from jsonb_array_elements(jsonb_build_array(
    v_v3 || '{"pad_choices":[]}', v_v3 || '{"pad_choices":null}',
    jsonb_set(v_v3,'{pad_choices,0,category}','"T99"'),
    jsonb_set(v_v3,'{pad_choices,0,basis}','""'),
    jsonb_set(v_v3,'{pad_choices,0,basis}','null'),
    jsonb_set(v_v3,'{pad_choices,0,unit_ref}','"other"'),
    jsonb_set(v_v3,'{pad_choices,0,amount}','100'),
    jsonb_set(v_v3,'{transport_mode}','"AIR"'),
    jsonb_set(v_v3,'{movement_direction}','"TRANSIT"'),
    jsonb_set(v_v3,'{pad_choices,0,category}','2'),
    v_v3 || '{"unexpected":1}')) loop
    if public.quote_scenario_scope_violation(v_bad) is null then raise exception 'invalid accepted: %',v_bad; end if;
  end loop;
  if public.quote_scenario_scope_violation(jsonb_set(v_v3,'{pad_choices,0,category}','null')) is not null then raise exception 'unknown category rejected'; end if;
  raise notice 'v3 PAD: v2 compatibility, v3 valid, 11 invalid cases, unknown category PASS';
end;
$$;
rollback;
