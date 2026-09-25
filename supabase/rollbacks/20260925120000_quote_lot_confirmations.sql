-- Rollback of 20260925120000 (MULTI-LOT-TERMINAL-1). LOCAL preparation; ledger not rewritten.
-- Deploy the previous Edge Functions (run-pricing, manage-pad-group-confirmation, and remove
-- manage-lot-confirmation) BEFORE this script: they never call the functions dropped here.
-- Operator decisions are never erased. A non-empty registry is archived under a dated name,
-- with its indexes, so that a later redelivery starts from an empty registry and can never
-- reactivate an old decision; an empty registry is simply dropped.
begin;
do $$ begin
 if current_setting('dcq.lot_rollback_ack', true) is distinct from 'REVIEWED_LOT_ROLLBACK' then
   raise exception 'LOT_ROLLBACK_ACK_REQUIRED';
 end if;
end $$;
lock table public.quote_lot_confirmations in access exclusive mode;
lock table public.pad_group_confirmations in share row exclusive mode;

-- PAD writer restored exactly as in 20260917180000 (multi-lot refused again). PAD decisions
-- recorded meanwhile on multi-lot dossiers stay in their table and become inert.
create or replace function public.record_pad_group_confirmation(p_case_id uuid, p_actor uuid, p_request jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
 ctx jsonb; sc jsonb; u jsonb; old public.pad_group_confirmations%rowtype;
 replay public.pad_group_confirmations%rowtype; created public.pad_group_confirmations%rowtype;
 fp text; w numeric; matches integer;
begin
 if p_case_id is null or p_actor is null or jsonb_typeof(p_request) is distinct from 'object' then
   raise exception 'PAD_REQUEST_INVALID' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_object_keys(p_request) k where k not in
   ('unit_ref','action','category','source_reference','weight_source_reference','expected_context_hash','expected_head_id','idempotency_key','weight_basis','weight_reservation'))
   or not p_request ?& array['unit_ref','action','category','source_reference','weight_source_reference','expected_context_hash','expected_head_id','idempotency_key']
   or coalesce(p_request->>'action','') not in ('confirm','revoke')
   or coalesce(p_request->>'expected_context_hash','') !~ '^[a-f0-9]{64}$'
   or coalesce(p_request->>'unit_ref','') !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
   or length(btrim(coalesce(p_request->>'source_reference',''))) not between 3 and 2000
   or length(btrim(coalesce(p_request->>'weight_source_reference',''))) not between 3 and 2000
   or p_request->>'idempotency_key' is null then
   raise exception 'PAD_REQUEST_INVALID' using errcode='22023';
 end if;
 if coalesce(p_request->>'weight_basis','confirmed') not in ('confirmed','provisional')
   or (coalesce(p_request->>'weight_basis','confirmed')='confirmed' and coalesce(p_request->>'weight_reservation','')<>'')
   or (p_request->>'weight_basis'='provisional' and (p_request->>'action'<>'confirm'
     or jsonb_typeof(p_request->'weight_reservation') is distinct from 'string'
     or length(btrim(coalesce(p_request->>'weight_reservation',''))) not between 10 and 2000)) then
   raise exception 'PAD_WEIGHT_BASIS_INVALID' using errcode='22023';
 end if;
 -- Serialize all confirmations for this dossier; no unrelated writer is assumed
 -- to use this lock. Freshness is always checked again by pricing before use.
 perform pg_advisory_xact_lock(hashtextextended('pad_group:'||p_case_id::text,0));
 perform 1 from public.quote_cases where id=p_case_id and status::text not in ('SENT','ACCEPTED','REJECTED','ARCHIVED','PRICING_RUNNING') for update;
 if not found then raise exception 'PAD_CASE_LOCKED' using errcode='22023'; end if;
 fp:=encode(sha256(convert_to(jsonb_build_object('actor',p_actor,'request',p_request)::text,'UTF8')),'hex');
 select * into replay from public.pad_group_confirmations where case_id=p_case_id and idempotency_key=(p_request->>'idempotency_key')::uuid;
 if found then
   if replay.request_fingerprint<>fp then raise exception 'PAD_IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
   return to_jsonb(replay)-'request_fingerprint'-'idempotency_key';
 end if;
 ctx:=public.read_pad_group_context(p_case_id); sc:=ctx->'scenario';
 if ctx is null or ctx->>'context_hash' is distinct from p_request->>'expected_context_hash' then
   raise exception 'PAD_CONTEXT_CHANGED' using errcode='40001';
 end if;
 if coalesce((ctx->>'request_count')::integer,0)>1 or sc is null or sc='null'::jsonb
   or sc->>'superseded_by_scenario_id' is not null or sc->>'status' in ('blocked','superseded','promoted_to_final')
   or sc#>>'{scope_snapshot,schema_version}' is distinct from '3'
   or sc#>>'{scope_snapshot,transport_mode}' is distinct from 'MARITIME'
   or sc#>>'{scope_snapshot,movement_direction}' is distinct from 'IMPORT' then
   raise exception 'PAD_GROUP_SCOPE_UNSUPPORTED' using errcode='22023';
 end if;
 select count(*) into matches from jsonb_array_elements(sc#>'{scope_snapshot,cargo_units}') v where v->>'unit_ref'=p_request->>'unit_ref';
 if matches<>1 then raise exception 'PAD_GROUP_INVALID' using errcode='22023'; end if;
 select v into u from jsonb_array_elements(sc#>'{scope_snapshot,cargo_units}') v where v->>'unit_ref'=p_request->>'unit_ref';
 if u->>'unit_kind' is distinct from 'CONTAINER' then raise exception 'PAD_GROUP_INVALID' using errcode='22023'; end if;
 select * into old from public.pad_group_confirmations where case_id=p_case_id and unit_ref=p_request->>'unit_ref' order by decision_version desc limit 1;
 if old.id is distinct from (p_request->>'expected_head_id')::uuid then raise exception 'PAD_HEAD_CHANGED' using errcode='40001'; end if;
 if p_request->>'action'='confirm' then
   if coalesce(p_request->>'category','') !~ '^(T0[1-9]|T1[0-4]|P0[1-5])$' then raise exception 'PAD_CATEGORY_INVALID' using errcode='22023'; end if;
   w:=case u->>'weight_basis' when 'per_unit' then (u->>'gross_weight_kg')::numeric*(u->>'quantity')::numeric when 'total' then (u->>'gross_weight_kg')::numeric else null end;
   if w is null or w<=0 or w>1000000000000 then raise exception 'PAD_WEIGHT_REQUIRED' using errcode='22023'; end if;
 elsif old.id is null then raise exception 'PAD_NOTHING_TO_REVOKE' using errcode='22023';
 end if;
 insert into public.pad_group_confirmations(case_id,scenario_id,scope_hash,context_hash,unit_ref,action,category,total_weight_kg,
   source_reference,weight_source_reference,decided_by,decision_version,idempotency_key,request_fingerprint,weight_basis,weight_reservation)
 values(p_case_id,(sc->>'id')::uuid,sc->>'scope_hash',ctx->>'context_hash',p_request->>'unit_ref',p_request->>'action',
   case when p_request->>'action'='confirm' then p_request->>'category' else null end,w,
   p_request->>'source_reference',p_request->>'weight_source_reference',p_actor,coalesce(old.decision_version,0)+1,(p_request->>'idempotency_key')::uuid,fp,coalesce(p_request->>'weight_basis','confirmed'),coalesce(p_request->>'weight_reservation',''))
 returning * into created;
 return to_jsonb(created)-'request_fingerprint'-'idempotency_key';
end;
$$;

drop function public.complete_lot_pricing(uuid, uuid, text, jsonb, jsonb, uuid, jsonb);
drop function public.record_lot_confirmation(uuid, uuid, jsonb);
drop function public.read_lot_confirmation_context(uuid);
drop function public.quote_request_line_fingerprint(text, text, text, jsonb);

do $$
declare suffix text := to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISS'); i record;
begin
 if not exists (select 1 from public.quote_lot_confirmations) then
   drop table public.quote_lot_confirmations;
   return;
 end if;
 -- Index names are schema-wide: rename them too, so a redelivery can recreate the table.
 for i in select c.relname from pg_index x join pg_class c on c.oid = x.indexrelid
     where x.indrelid = 'public.quote_lot_confirmations'::regclass loop
   execute format('alter index public.%I rename to %I', i.relname, left('qlc_archived_' || suffix || '_' || i.relname, 63));
 end loop;
 execute format('alter table public.quote_lot_confirmations rename to %I', 'quote_lot_confirmations_archived_' || suffix);
end $$;
commit;
