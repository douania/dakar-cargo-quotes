-- LOCAL preparation only. No data rewrite; v1/v2 contracts and scope OID preserved.
begin;
do $prepare$
declare v_definition text; v_grantee text; v_acl record;
begin
  if (select proowner from pg_proc where oid='public.quote_scenario_scope_violation(jsonb)'::regprocedure)
    <> (select oid from pg_roles where rolname=current_user) then raise exception 'validator owner must execute local migration'; end if;
  if to_regprocedure('public.quote_scenario_scope_v2_violation(jsonb)') is null then
    select pg_get_functiondef('public.quote_scenario_scope_violation(jsonb)'::regprocedure) into v_definition;
    if position('quote_scenario_cargo_unit_v2_violation' in v_definition) = 0 then
      raise exception 'scenario v2 prerequisite missing';
    end if;
    execute replace(v_definition, 'FUNCTION public.quote_scenario_scope_violation(', 'FUNCTION public.quote_scenario_scope_v2_violation(');
    -- New helper is internal, with no inherited default grantees. Existing entry ACL is untouched.
    for v_grantee in
      select distinct case when a.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end
      from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
      where p.oid='public.quote_scenario_scope_v2_violation(jsonb)'::regprocedure and a.grantee<>p.proowner
    loop
      execute 'revoke all on function public.quote_scenario_scope_v2_violation(jsonb) from ' || v_grantee;
    end loop;
    for v_acl in select a.* from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid='public.quote_scenario_scope_violation(jsonb)'::regprocedure and a.grantee<>p.proowner
    loop
      -- Historical entry grants are preserved, not propagated to this internal helper.
      -- Same policy as cargo v2: these roles remain forbidden regardless of v1 ACL.
      if v_acl.grantee=0 or pg_get_userbyid(v_acl.grantee) in ('anon','authenticated','service_role') then continue; end if;
      execute 'grant execute on function public.quote_scenario_scope_v2_violation(jsonb) to ' || quote_ident(pg_get_userbyid(v_acl.grantee)) ||
        case when v_acl.is_grantable then ' with grant option' else '' end;
    end loop;
    execute format('comment on function public.quote_scenario_scope_v2_violation(jsonb) is %L',
      'dcq-pad-v3-v2-body:' || (select md5(prosrc) from pg_proc where oid='public.quote_scenario_scope_v2_violation(jsonb)'::regprocedure));
  end if;
  -- A replay must never trust a pre-existing, drifted helper or broader ACL.
  if exists(select 1 from pg_proc p where p.oid='public.quote_scenario_scope_v2_violation(jsonb)'::regprocedure
    and (obj_description(p.oid,'pg_proc') is distinct from 'dcq-pad-v3-v2-body:' || md5(p.prosrc)
      or p.proowner<>(select proowner from pg_proc where oid='public.quote_scenario_scope_violation(jsonb)'::regprocedure)
      or p.prosecdef or p.provolatile<>'i')) then raise exception 'v2 helper identity/body drift'; end if;
  if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid='public.quote_scenario_scope_v2_violation(jsonb)'::regprocedure and a.grantee<>p.proowner
      and (a.grantee=0 or pg_get_userbyid(a.grantee) in ('anon','authenticated','service_role') or not exists(
        select 1 from pg_proc v cross join lateral aclexplode(coalesce(v.proacl,acldefault('f',v.proowner))) b
        where v.oid='public.quote_scenario_scope_violation(jsonb)'::regprocedure and b.grantee=a.grantee
          and b.grantor=a.grantor and b.privilege_type=a.privilege_type and (not a.is_grantable or b.is_grantable))))
    then raise exception 'v2 helper ACL drift'; end if;
end;
$prepare$;

create or replace function public.quote_scenario_scope_violation(p_snapshot jsonb)
returns text language plpgsql immutable parallel safe as $$
declare v_reason text; v_choice jsonb; v_ref text; v_refs text[] := '{}';
begin
  if (p_snapshot->'schema_version') is distinct from '3'::jsonb then
    return public.quote_scenario_scope_v2_violation(p_snapshot);
  end if;
  v_reason := public.quote_scenario_snapshot_violation(p_snapshot);
  if v_reason is not null then return v_reason; end if;
  if octet_length(p_snapshot::text)>16384 then return 'snapshot_too_large'; end if;
  if (p_snapshot->>'transport_mode') is distinct from 'MARITIME'
    or (p_snapshot->>'movement_direction') is distinct from 'IMPORT' then return 'pad_import_scope'; end if;
  if coalesce(jsonb_typeof(p_snapshot->'pad_choices'),'') <> 'array'
    or coalesce(jsonb_typeof(p_snapshot->'cargo_units'),'') <> 'array' then return 'pad_choices_count'; end if;
  if jsonb_array_length(p_snapshot->'pad_choices') <> jsonb_array_length(p_snapshot->'cargo_units') then return 'pad_choices_count'; end if;
  for v_choice in select value from jsonb_array_elements(p_snapshot->'pad_choices') loop
    if jsonb_typeof(v_choice) <> 'object' then return 'pad_choice_object'; end if;
    if not (v_choice ?& array['unit_ref','category','basis'])
      or public.quote_scenario_unknown_key(v_choice,array['unit_ref','category','basis']) is not null then return 'pad_choice_reference'; end if;
    v_ref := v_choice->>'unit_ref';
    if coalesce(jsonb_typeof(v_choice->'unit_ref'),'')<>'string' or v_ref=any(v_refs)
      or not exists(select 1 from jsonb_array_elements(p_snapshot->'cargo_units') u where u->>'unit_ref'=v_ref) then return 'pad_choice_reference'; end if;
    if (v_choice->'category') is distinct from 'null'::jsonb and
      (coalesce(jsonb_typeof(v_choice->'category'),'')<>'string' or v_choice->>'category' !~ '^(T(0[1-9]|1[0-4])|P0[1-5])$') then return 'pad_category'; end if;
    if coalesce(jsonb_typeof(v_choice->'basis'),'')<>'string' or length(v_choice->>'basis')>200
      or ((v_choice->'category') is distinct from 'null'::jsonb and length(btrim(v_choice->>'basis'))=0) then return 'pad_basis'; end if;
    v_refs := array_append(v_refs,v_ref);
  end loop;
  -- Validation projection only. Stored snapshot/hash keep v3 and every PAD choice.
  return public.quote_scenario_scope_v2_violation((p_snapshot-'pad_choices') || '{"schema_version":2}'::jsonb);
end;
$$;
commit;
