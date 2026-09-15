-- LOCAL preparation. Separate explicit Cloud GO required. Never erase the ledger.
-- Caller supplies reviewed dcq.pad_v3_rollback_ack, dcq.pad_v3_scope_sha256,
-- and dcq.pad_v3_helper_sha256 before executing; never refresh pins automatically.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
do $rollback$
declare v_entry oid; v_helper oid; v_definition text; v_table record; v_column record; v_found boolean;
begin
  if current_setting('dcq.pad_v3_rollback_ack',true) is distinct from 'REVIEWED_PAD_V3_ROLLBACK' then
    raise exception 'PAD_V3_ROLLBACK_ACK_REQUIRED'; end if;
  v_entry := to_regprocedure('public.quote_scenario_scope_violation(jsonb)');
  v_helper := to_regprocedure('public.quote_scenario_scope_v2_violation(jsonb)');
  if v_entry is null or v_helper is null then raise exception 'PAD_V3_ROLLBACK_HELPER_REQUIRED'; end if;
  if (select proowner from pg_proc where oid=v_entry)<>(select oid from pg_roles where rolname=current_user)
    or (select proowner from pg_proc where oid=v_helper)<>(select proowner from pg_proc where oid=v_entry)
    then raise exception 'PAD_V3_ROLLBACK_OWNER'; end if;
  if encode(sha256(convert_to(pg_get_functiondef(v_entry),'UTF8')),'hex') is distinct from current_setting('dcq.pad_v3_scope_sha256',true)
    or encode(sha256(convert_to(pg_get_functiondef(v_helper),'UTF8')),'hex') is distinct from current_setting('dcq.pad_v3_helper_sha256',true)
    then raise exception 'PAD_V3_ROLLBACK_CATALOG_DRIFT'; end if;
  if (select obj_description(oid,'pg_proc') is distinct from 'dcq-pad-v3-v2-body:' || md5(prosrc) from pg_proc where oid=v_helper)
    then raise exception 'PAD_V3_ROLLBACK_HELPER_DRIFT'; end if;
  -- Freeze all scenario ledgers and output snapshots until the validator is restored.
  for v_table in select c.oid,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and
      (c.relname like 'quote_scenario%' or c.relname='quotation_versions') order by c.relname
  loop
    execute format('lock table public.%I in access exclusive mode',v_table.relname);
  end loop;
  -- Include historical/revised scopes, pricing and output/mutation JSON snapshots.
  for v_column in select c.relname,a.attname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    where n.nspname='public' and c.relkind in ('r','p') and a.atttypid='jsonb'::regtype and
      (c.relname like 'quote_scenario%' or c.relname='quotation_versions')
  loop
    execute format('select exists(select 1 from public.%I where jsonb_path_exists(%I, %L::jsonpath))',
      v_column.relname,v_column.attname,'$.**.schema_version ? (@ == 3)') into v_found;
    if v_found then raise exception 'PAD_V3_ROWS_PRESENT'; end if;
  end loop;
  v_definition := pg_get_functiondef(v_helper);
  if position('quote_scenario_cargo_unit_v2_violation' in v_definition)=0 then raise exception 'PAD_V3_ROLLBACK_NOT_V2'; end if;
  execute replace(v_definition,'FUNCTION public.quote_scenario_scope_v2_violation(', 'FUNCTION public.quote_scenario_scope_violation(');
  if to_regprocedure('public.quote_scenario_scope_violation(jsonb)')::oid<>v_entry then raise exception 'PAD_V3_ROLLBACK_OID_CHANGED'; end if;
  drop function public.quote_scenario_scope_v2_violation(jsonb) restrict;
end;
$rollback$;
commit;
