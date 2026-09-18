-- Local preparation. Commercial reconciliation never rewrites a client fact.
begin;
create table public.pad_weight_reconciliations (
 id uuid primary key default gen_random_uuid(),
 case_id uuid not null references public.quote_cases(id),
 context_hash text not null check(context_hash ~ '^[a-f0-9]{64}$'),
 confirmation_heads jsonb not null check(jsonb_typeof(confirmation_heads)='array'),
 original_fact jsonb not null check(jsonb_typeof(original_fact)='object'),
 total_weight_kg numeric not null check(total_weight_kg>0 and total_weight_kg<=1000000000000),
 action text not null check(action in ('retain','revoke')),
 justification text not null check(length(btrim(justification)) between 10 and 2000),
 reservation text not null check(length(btrim(reservation)) between 10 and 2000),
 decided_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 decision_version integer not null check(decision_version>0),
 idempotency_key uuid not null,
 request_fingerprint text not null,
 unique(case_id,decision_version), unique(case_id,idempotency_key)
);
alter table public.pad_weight_reconciliations enable row level security;

-- Keep the original context hash byte-for-byte: adding a reconciliation does
-- not invalidate category decisions. Its own head is checked separately.
create function public.read_pad_weight_context(p_case_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select public.read_pad_group_context(p_case_id) || jsonb_build_object(
  'weight_facts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'number',value_number,'text',value_text,
    'source_type',source_type,'source_email_id',source_email_id) order by id)
    from public.quote_facts where case_id=p_case_id and is_current and fact_key='cargo.weight_kg'),'[]'::jsonb),
  'weight_reconciliation',(select to_jsonb(r)-'request_fingerprint'-'idempotency_key'
    from public.pad_weight_reconciliations r where case_id=p_case_id order by decision_version desc limit 1));
$$;

create function public.record_pad_weight_reconciliation(p_case_id uuid,p_actor uuid,p_request jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare ctx jsonb; old public.pad_weight_reconciliations%rowtype;
 replay public.pad_weight_reconciliations%rowtype; created public.pad_weight_reconciliations%rowtype;
 fp text; u jsonb; h jsonb; w numeric; total numeric:=0; fact jsonb; seen text[]:='{}';
begin
 if p_case_id is null or p_actor is null or jsonb_typeof(p_request) is distinct from 'object' then
  raise exception 'PAD_WEIGHT_REQUEST_INVALID' using errcode='22023'; end if;
 if exists(select 1 from jsonb_object_keys(p_request) k where k not in
  ('action','expected_context_hash','expected_heads','expected_head_id','idempotency_key','justification','reservation'))
  or not p_request ?& array['action','expected_context_hash','expected_heads','expected_head_id','idempotency_key','justification','reservation']
  or coalesce(p_request->>'action','') not in ('retain','revoke')
  or coalesce(p_request->>'expected_context_hash','') !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(p_request->'expected_heads') is distinct from 'array'
  or jsonb_typeof(p_request->'justification') is distinct from 'string'
  or jsonb_typeof(p_request->'reservation') is distinct from 'string'
  or length(btrim(coalesce(p_request->>'justification',''))) not between 10 and 2000
  or length(btrim(coalesce(p_request->>'reservation',''))) not between 10 and 2000
  or p_request->>'idempotency_key' is null then
  raise exception 'PAD_WEIGHT_REQUEST_INVALID' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('pad_group:'||p_case_id::text,0));
 perform 1 from public.quote_cases where id=p_case_id and status::text not in ('SENT','ACCEPTED','REJECTED','ARCHIVED','PRICING_RUNNING') for update;
 if not found then raise exception 'PAD_CASE_LOCKED' using errcode='22023'; end if;
 fp:=encode(sha256(convert_to(jsonb_build_object('actor',p_actor,'request',p_request)::text,'UTF8')),'hex');
 select * into replay from public.pad_weight_reconciliations where case_id=p_case_id and idempotency_key=(p_request->>'idempotency_key')::uuid;
 if found then
  if replay.request_fingerprint<>fp then raise exception 'PAD_IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
  return to_jsonb(replay)-'request_fingerprint'-'idempotency_key';
 end if;
 ctx:=public.read_pad_weight_context(p_case_id);
 if ctx is null or ctx->>'context_hash' is distinct from p_request->>'expected_context_hash'
  or (select coalesce(jsonb_agg(entry.value->'id' order by entry.value->>'id'),'[]'::jsonb) from jsonb_array_elements(ctx->'heads') entry(value))
     is distinct from p_request->'expected_heads' then
  raise exception 'PAD_CONTEXT_CHANGED' using errcode='40001'; end if;
 select * into old from public.pad_weight_reconciliations where case_id=p_case_id order by decision_version desc limit 1;
 if old.id is distinct from (p_request->>'expected_head_id')::uuid then raise exception 'PAD_HEAD_CHANGED' using errcode='40001'; end if;
 if p_request->>'action'='retain' then
  if ctx#>>'{scenario,scope_snapshot,schema_version}' is distinct from '3'
   or ctx#>>'{scenario,scope_snapshot,transport_mode}' is distinct from 'MARITIME'
   or ctx#>>'{scenario,scope_snapshot,movement_direction}' is distinct from 'IMPORT'
   or ctx#>>'{scenario,superseded_by_scenario_id}' is not null
   or ctx#>>'{scenario,status}' in ('blocked','superseded','promoted_to_final')
   or (ctx->>'request_count')::integer>1 or jsonb_array_length(ctx->'weight_facts')<>1 then
   raise exception 'PAD_WEIGHT_SCOPE_UNSUPPORTED' using errcode='22023'; end if;
  fact:=ctx#>'{weight_facts,0}';
  -- Only an extracted total can be superseded commercially here. A client or
  -- operator-confirmed contradictory total needs its own source investigation.
  if fact->>'source_type' is distinct from 'ai_extraction'
   or coalesce((fact->>'number')::numeric,(fact->>'text')::numeric,0)<=0 then
   raise exception 'PAD_WEIGHT_SOURCE_UNSUPPORTED' using errcode='22023'; end if;
  for u in select * from jsonb_array_elements(ctx#>'{scenario,scope_snapshot,cargo_units}') loop
   if u->>'unit_kind' is distinct from 'CONTAINER' or u->>'unit_ref'=any(seen) then
    raise exception 'PAD_WEIGHT_GROUP_INVALID' using errcode='22023'; end if;
   seen:=array_append(seen,u->>'unit_ref');
   select x into h from jsonb_array_elements(ctx->'heads') x where x->>'unit_ref'=u->>'unit_ref';
   w:=case u->>'weight_basis' when 'per_unit' then (u->>'gross_weight_kg')::numeric*(u->>'quantity')::numeric
     when 'total' then (u->>'gross_weight_kg')::numeric else null end;
   if h is null or h->>'action' is distinct from 'confirm' or h->>'context_hash' is distinct from ctx->>'context_hash'
    or h->>'scenario_id' is distinct from ctx#>>'{scenario,id}' or h->>'scope_hash' is distinct from ctx#>>'{scenario,scope_hash}'
    or w is null or w<=0 or (h->>'total_weight_kg')::numeric is distinct from w then
    raise exception 'PAD_WEIGHT_CONFIRMATIONS_REQUIRED' using errcode='22023'; end if;
   total:=total+w;
  end loop;
  if cardinality(seen)=0 or jsonb_array_length(ctx->'heads')<>cardinality(seen)
   or total=coalesce((fact->>'number')::numeric,(fact->>'text')::numeric) then
   raise exception 'PAD_WEIGHT_RECONCILIATION_UNNECESSARY' using errcode='22023'; end if;
 else
  if old.id is null or old.action<>'retain' then raise exception 'PAD_NOTHING_TO_REVOKE' using errcode='22023'; end if;
  fact:=old.original_fact; total:=old.total_weight_kg;
 end if;
 insert into public.pad_weight_reconciliations(case_id,context_hash,confirmation_heads,original_fact,total_weight_kg,action,
  justification,reservation,decided_by,decision_version,idempotency_key,request_fingerprint)
 values(p_case_id,ctx->>'context_hash',ctx->'heads',fact,total,p_request->>'action',p_request->>'justification',p_request->>'reservation',
  p_actor,coalesce(old.decision_version,0)+1,(p_request->>'idempotency_key')::uuid,fp) returning * into created;
 return to_jsonb(created)-'request_fingerprint'-'idempotency_key';
end;
$$;

-- Serialize reconciliation changes with the existing PAD finalizers. The caller
-- pins even a null head, so a concurrent new decision cannot be overlooked.
create function public.assert_pad_weight_head(p_case_id uuid,p_weight_head_id uuid,p_require_valid boolean default true) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare ctx jsonb; d jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('pad_group:'||p_case_id::text,0));
 if (select id from public.pad_weight_reconciliations where case_id=p_case_id order by decision_version desc limit 1)
  is distinct from p_weight_head_id then raise exception 'PAD_WEIGHT_HEAD_CHANGED' using errcode='40001'; end if;
 ctx:=public.read_pad_weight_context(p_case_id); d:=ctx->'weight_reconciliation';
 if p_require_valid and d->>'action'='retain' and d->>'context_hash'=ctx->>'context_hash' and d->'confirmation_heads'=ctx->'heads'
  and (jsonb_array_length(ctx->'weight_facts')<>1 or d->'original_fact' is distinct from ctx#>'{weight_facts,0}') then
  raise exception 'PAD_WEIGHT_SOURCE_CHANGED' using errcode='40001'; end if;
end;
$$;
create function public.sync_pad_weight_gap(p_case_id uuid,p_context_hash text,p_heads jsonb,p_ready boolean,p_question text,p_weight_head_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 perform public.assert_pad_weight_head(p_case_id,p_weight_head_id,p_ready is distinct from false);
 perform public.sync_pad_group_gap(p_case_id,p_context_hash,p_heads,p_ready,p_question);
end;
$$;
create function public.complete_pad_weight_pricing(p_case_id uuid,p_run_id uuid,p_context_hash text,p_heads jsonb,p_result jsonb,p_weight_head_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 perform public.assert_pad_weight_head(p_case_id,p_weight_head_id);
 perform public.complete_pad_group_pricing(p_case_id,p_run_id,p_context_hash,p_heads,p_result);
end;
$$;
-- Strip inherited default ACLs as well; never grant browser access.
do $acl$
declare o record; a record; target text;
begin
 for a in select * from aclexplode(coalesce((select relacl from pg_class where oid='public.pad_weight_reconciliations'::regclass),acldefault('r',(select relowner from pg_class where oid='public.pad_weight_reconciliations'::regclass)))) where grantee<>(select relowner from pg_class where oid='public.pad_weight_reconciliations'::regclass) loop
  target:=case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end;
  execute 'revoke all on public.pad_weight_reconciliations from '||target;
 end loop;
 for o in select p.oid,p.proowner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in ('read_pad_weight_context','record_pad_weight_reconciliation','assert_pad_weight_head','sync_pad_weight_gap','complete_pad_weight_pricing') loop
  for a in select * from aclexplode(coalesce((select proacl from pg_proc where oid=o.oid),acldefault('f',o.proowner))) where grantee<>o.proowner loop
   target:=case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end;
   execute 'revoke all on function '||o.oid::regprocedure||' from '||target;
  end loop;
 end loop;
end;
$acl$;
grant select on public.pad_weight_reconciliations to service_role;
grant execute on function public.read_pad_weight_context(uuid),public.record_pad_weight_reconciliation(uuid,uuid,jsonb),
 public.sync_pad_weight_gap(uuid,text,jsonb,boolean,text,uuid),public.complete_pad_weight_pricing(uuid,uuid,text,jsonb,jsonb,uuid) to service_role;
commit;
