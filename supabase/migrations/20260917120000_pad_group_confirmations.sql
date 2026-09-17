-- Local preparation only: explicit PAD decisions, no client facts/tariff writes.
-- Same service-only registry pattern as maritime_fee_decisions. Existing RLS unchanged.
begin;
create table public.pad_group_confirmations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.quote_cases(id) on delete cascade,
  scenario_id uuid not null references public.quote_scenarios(id),
  scope_hash text not null check (scope_hash ~ '^[a-f0-9]{64}$'),
  context_hash text not null check (context_hash ~ '^[a-f0-9]{64}$'),
  unit_ref text not null check (unit_ref ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  action text not null check (action in ('confirm','revoke')),
  category text check (category ~ '^(T0[1-9]|T1[0-4]|P0[1-5])$'),
  total_weight_kg numeric check (total_weight_kg > 0 and total_weight_kg <= 1000000000000),
  source_reference text not null check (length(btrim(source_reference)) between 3 and 2000),
  weight_source_reference text not null check (length(btrim(weight_source_reference)) between 3 and 2000),
  decided_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  decision_version integer not null check (decision_version > 0),
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  check (action <> 'confirm' or (category is not null and total_weight_kg is not null)),
  unique (case_id, unit_ref, decision_version),
  unique (case_id, idempotency_key)
);
alter table public.pad_group_confirmations enable row level security;
revoke all on public.pad_group_confirmations from public, anon, authenticated;
grant select, insert on public.pad_group_confirmations to service_role;

-- Single server-generated snapshot: includes source text, current facts and request
-- lines. Changing any of them invalidates decisions, rather than silently reusing them.
create function public.read_pad_group_context(p_case_id uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
 with c as (
   select q.id, q.thread_id, q.request_type, t.client_email
   from public.quote_cases q left join public.email_threads t on t.id=q.thread_id
   where q.id=p_case_id
 ), s as (
   select sc.id, sc.scope_hash, sc.scope_snapshot, sc.status, sc.superseded_by_scenario_id
   from public.quote_scenario_selections sel join public.quote_scenarios sc on sc.id=sel.scenario_id and sc.case_id=sel.case_id
   where sel.case_id=p_case_id and sel.released_at is null
 ), payload as (
   select jsonb_build_object('case', to_jsonb(c), 'scenario', (select to_jsonb(s) from s),
    'facts', coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'key',f.fact_key,'text',f.value_text,'number',f.value_number,'json',f.value_json) order by f.id)
      from public.quote_facts f where f.case_id=p_case_id and f.is_current), '[]'::jsonb),
    'emails', coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'from',e.from_address,'subject',e.subject,'body',e.body_text,'sent_at',e.sent_at) order by e.id)
      from public.emails e where e.thread_ref=c.thread_id), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.quote_request_lines r where r.case_id=p_case_id), '[]'::jsonb),
    'tariffs', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.port_tariffs t where t.provider='PAD' and t.category='DROIT_PASSAGE' and t.operation_type='IMPORT' and t.cargo_type='CONTENEUR'), '[]'::jsonb)
   ) j from c
 )
 select jsonb_build_object('case_id',p_case_id,'case_status',(select status from public.quote_cases where id=p_case_id),'scenario',(select to_jsonb(s) from s),
   'context_hash',encode(sha256(convert_to(j::text,'UTF8')),'hex'),
   'facts',j->'facts','request_count',jsonb_array_length(j->'requests'),
   'heads',coalesce((select jsonb_agg(to_jsonb(d) - 'request_fingerprint' - 'idempotency_key' order by d.unit_ref) from (
     select distinct on (unit_ref) * from public.pad_group_confirmations where case_id=p_case_id
     order by unit_ref, decision_version desc
   ) d), '[]'::jsonb)) from payload;
$$;
revoke all on function public.read_pad_group_context(uuid) from public, anon, authenticated;
grant execute on function public.read_pad_group_context(uuid) to service_role;

-- Edge must prove has_case_write_access under the caller JWT before invoking this
-- service-only RPC, and supply the authenticated actor (never the browser's actor).
create function public.record_pad_group_confirmation(p_case_id uuid, p_actor uuid, p_request jsonb)
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
   ('unit_ref','action','category','source_reference','weight_source_reference','expected_context_hash','expected_head_id','idempotency_key'))
   or not p_request ?& array['unit_ref','action','category','source_reference','weight_source_reference','expected_context_hash','expected_head_id','idempotency_key']
   or coalesce(p_request->>'action','') not in ('confirm','revoke')
   or coalesce(p_request->>'expected_context_hash','') !~ '^[a-f0-9]{64}$'
   or coalesce(p_request->>'unit_ref','') !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
   or length(btrim(coalesce(p_request->>'source_reference',''))) not between 3 and 2000
   or length(btrim(coalesce(p_request->>'weight_source_reference',''))) not between 3 and 2000
   or p_request->>'idempotency_key' is null then
   raise exception 'PAD_REQUEST_INVALID' using errcode='22023';
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
   source_reference,weight_source_reference,decided_by,decision_version,idempotency_key,request_fingerprint)
 values(p_case_id,(sc->>'id')::uuid,sc->>'scope_hash',ctx->>'context_hash',p_request->>'unit_ref',p_request->>'action',
   case when p_request->>'action'='confirm' then p_request->>'category' else null end,w,
   p_request->>'source_reference',p_request->>'weight_source_reference',p_actor,coalesce(old.decision_version,0)+1,(p_request->>'idempotency_key')::uuid,fp)
 returning * into created;
 return to_jsonb(created)-'request_fingerprint'-'idempotency_key';
end;
$$;
revoke all on function public.record_pad_group_confirmation(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.record_pad_group_confirmation(uuid,uuid,jsonb) to service_role;

create function public.sync_pad_group_gap(p_case_id uuid, p_context_hash text, p_heads jsonb, p_ready boolean, p_question text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare ctx jsonb; changed integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('pad_group:'||p_case_id::text,0));
 ctx:=public.read_pad_group_context(p_case_id);
 if ctx is null or ctx->>'context_hash' is distinct from p_context_hash
   or ctx->'heads' is distinct from p_heads or p_ready is null then
   raise exception 'PAD_CONTEXT_CHANGED' using errcode='40001';
 end if;
 if p_ready then
   update public.quote_gaps set status='resolved',resolved_at=now()
    where case_id=p_case_id and gap_key='pricing.pad_category' and status='open';
   get diagnostics changed=row_count;
   update public.client_gap_requests set status='cancelled'
    where case_id=p_case_id and gap_key='pricing.pad_category' and status='drafted';
   if changed>0 then
     insert into public.case_timeline_events(case_id,event_type,event_data,actor_type)
      values(p_case_id,'gap_resolved',jsonb_build_object('gap_key','pricing.pad_category','reason','pad_groups_confirmed','context_hash',p_context_hash),'system');
   end if;
 else
   if length(btrim(coalesce(p_question,'')))<3 then raise exception 'PAD_QUESTION_REQUIRED'; end if;
   update public.quote_gaps set is_blocking=true,priority='high',question_fr=p_question
    where case_id=p_case_id and gap_key='pricing.pad_category' and status='open';
   get diagnostics changed=row_count;
   if changed=0 then
     insert into public.quote_gaps(case_id,gap_key,gap_category,question_fr,priority,is_blocking,status)
      values(p_case_id,'pricing.pad_category','pricing',p_question,'high',true,'open');
   end if;
 end if;
end;
$$;
revoke all on function public.sync_pad_group_gap(uuid,text,jsonb,boolean,text) from public,anon,authenticated;

-- A concurrent confirmation/revocation cannot be interleaved between the final
-- PAD check and recording a successful run. Original engine output is preserved.
create function public.complete_pad_group_pricing(p_case_id uuid,p_run_id uuid,p_context_hash text,p_heads jsonb,p_result jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare ctx jsonb; r public.pricing_runs%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('pad_group:'||p_case_id::text,0));
 ctx:=public.read_pad_group_context(p_case_id);
 if ctx is null or ctx->>'context_hash' is distinct from p_context_hash or ctx->'heads' is distinct from p_heads then
   raise exception 'PAD_CONTEXT_CHANGED' using errcode='40001';
 end if;
 if jsonb_typeof(p_result) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_result) k where k not in
   ('status','engine_request','engine_response','outputs_json','tariff_lines','total_ht','total_ttc','currency','tariff_sources','completed_at','duration_ms'))
   or p_result->>'status' is distinct from 'success' then raise exception 'PAD_RESULT_INVALID' using errcode='22023'; end if;
 r:=jsonb_populate_record(null::public.pricing_runs,p_result);
 update public.pricing_runs set status=r.status,engine_request=r.engine_request,engine_response=r.engine_response,
   outputs_json=r.outputs_json,tariff_lines=r.tariff_lines,total_ht=r.total_ht,total_ttc=r.total_ttc,currency=r.currency,
   tariff_sources=r.tariff_sources,completed_at=r.completed_at,duration_ms=r.duration_ms
   where id=p_run_id and case_id=p_case_id and status='running';
 if not found then raise exception 'PAD_RUN_CHANGED' using errcode='40001'; end if;
end;
$$;
revoke all on function public.complete_pad_group_pricing(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;

-- Remove inherited grants too (Lovable may configure additional default grantees).
do $acl$
declare o record; a record; target text;
begin
 for o in select c.oid,c.relowner owner from pg_class c where c.oid='public.pad_group_confirmations'::regclass loop
   for a in select * from aclexplode(coalesce((select relacl from pg_class where oid=o.oid),acldefault('r',o.owner))) where grantee<>o.owner loop
     target:=case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end;
     execute 'revoke all on public.pad_group_confirmations from '||target;
   end loop;
 end loop;
 for o in select p.oid,p.proowner owner from pg_proc p where p.oid in ('public.read_pad_group_context(uuid)'::regprocedure,'public.record_pad_group_confirmation(uuid,uuid,jsonb)'::regprocedure,'public.sync_pad_group_gap(uuid,text,jsonb,boolean,text)'::regprocedure,'public.complete_pad_group_pricing(uuid,uuid,text,jsonb,jsonb)'::regprocedure) loop
   for a in select * from aclexplode(coalesce((select proacl from pg_proc where oid=o.oid),acldefault('f',o.owner))) where grantee<>o.owner loop
     target:=case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end;
     execute 'revoke all on function '||o.oid::regprocedure||' from '||target;
   end loop;
 end loop;
end;
$acl$;
grant select, insert on public.pad_group_confirmations to service_role;
grant execute on function public.read_pad_group_context(uuid), public.record_pad_group_confirmation(uuid,uuid,jsonb) to service_role;
grant execute on function public.sync_pad_group_gap(uuid,text,jsonb,boolean,text) to service_role;
grant execute on function public.complete_pad_group_pricing(uuid,uuid,text,jsonb,jsonb) to service_role;
commit;
