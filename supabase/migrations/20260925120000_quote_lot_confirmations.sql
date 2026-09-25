-- MULTI-LOT-TERMINAL-1 (GO CTO 2026-09-25, local preparation).
-- Explicit per-lot operator decisions for multi-lot dossiers: the binding of a lot of the
-- selected scenario to one current request line, and its terminal operation mode.
-- Same service-only pattern as pad_group_confirmations: append-only, sourced, versioned,
-- idempotent, compare-and-set on the global PAD context hash. No client fact, tariff, gap,
-- status or scenario write. The global terminal fact never satisfies a per-lot requirement.
begin;

-- Business content of one request line. Technical identifiers, positions, timestamps,
-- confidence, hints and metadata are excluded on purpose: two lines with the same
-- business content are indiscernible and must be clarified, never assigned by position.
create function public.quote_request_line_fingerprint(
  p_line_label text, p_source_excerpt text, p_segment_text text, p_extracted_facts jsonb)
returns text language sql stable set search_path = pg_catalog, public as $$
 select encode(sha256(convert_to(jsonb_build_object(
   'v', 1,
   'line_label', coalesce(p_line_label, ''),
   'source_excerpt', p_source_excerpt,
   'segment_text', p_segment_text,
   'extracted_facts', case when jsonb_typeof(p_extracted_facts) = 'array'
     then coalesce((select jsonb_agg(e order by e::text) from jsonb_array_elements(p_extracted_facts) e), '[]'::jsonb)
     else coalesce(p_extracted_facts, 'null'::jsonb) end
 )::text, 'UTF8')), 'hex');
$$;

create table public.quote_lot_confirmations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.quote_cases(id) on delete cascade,
  scenario_id uuid not null references public.quote_scenarios(id),
  scope_hash text not null check (scope_hash ~ '^[a-f0-9]{64}$'),
  context_hash text not null check (context_hash ~ '^[a-f0-9]{64}$'),
  unit_ref text not null check (unit_ref ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  decision_kind text not null check (decision_kind in ('line_binding', 'terminal_mode')),
  action text not null check (action in ('confirm', 'revoke')),
  line_fingerprint text check (line_fingerprint ~ '^[a-f0-9]{64}$'),
  terminal_mode text check (terminal_mode in ('LOLO', 'RORO', 'CONRO')),
  source_reference text not null check (length(btrim(source_reference)) between 3 and 2000),
  decided_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  decision_version integer not null check (decision_version > 0),
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint quote_lot_confirmations_payload_check check (
    (decision_kind = 'line_binding' and terminal_mode is null and ((action = 'revoke') = (line_fingerprint is null)))
    or (decision_kind = 'terminal_mode' and line_fingerprint is null and ((action = 'revoke') = (terminal_mode is null)))
  ),
  unique (case_id, unit_ref, decision_kind, decision_version),
  unique (case_id, idempotency_key)
);
alter table public.quote_lot_confirmations enable row level security;

-- One snapshot for readers and writers. The context hash is the existing global PAD hash
-- (facts, e-mails, request lines, selected scenario, PAD tariffs): any change, including a
-- re-analysis that recreates the lines, makes every decision stale. Heads are the latest
-- decision per lot and kind; they are compared separately, like the PAD heads.
create function public.read_lot_confirmation_context(p_case_id uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
 with base as (select public.read_pad_group_context(p_case_id) ctx)
 select jsonb_build_object(
   'case_id', p_case_id,
   'case_status', ctx->'case_status',
   'context_hash', ctx->'context_hash',
   'request_count', ctx->'request_count',
   'scenario', ctx->'scenario',
   'pad_heads', ctx->'heads',
   'weight_head_id', (select w.id from public.pad_weight_reconciliations w where w.case_id = p_case_id order by w.decision_version desc limit 1),
   'lines', coalesce((select jsonb_agg(jsonb_build_object(
       'id', r.id, 'line_index', r.line_index, 'line_label', r.line_label, 'request_type_hint', r.request_type_hint,
       'extracted_facts', r.extracted_facts_json,
       'fingerprint', public.quote_request_line_fingerprint(r.line_label, r.source_excerpt, r.segment_text, r.extracted_facts_json))
     order by r.line_index, r.id) from public.quote_request_lines r where r.case_id = p_case_id), '[]'::jsonb),
   'heads', coalesce((select jsonb_agg(to_jsonb(d) - 'request_fingerprint' - 'idempotency_key' order by d.unit_ref, d.decision_kind)
     from (select distinct on (unit_ref, decision_kind) * from public.quote_lot_confirmations
           where case_id = p_case_id order by unit_ref, decision_kind, decision_version desc) d), '[]'::jsonb))
 from base where ctx is not null;
$$;

-- Edge proves has_case_write_access under the caller JWT before invoking this service-only
-- RPC and passes the authenticated actor. A revocation never depends on the current
-- scenario, lines or sources: it only needs the current context hash and the head it replaces.
-- created_at is taken under the dossier lock: dependent decisions are ordered as serialized.
create function public.record_lot_confirmation(p_case_id uuid, p_actor uuid, p_request jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
 ctx jsonb; sc jsonb; old public.quote_lot_confirmations%rowtype;
 replay public.quote_lot_confirmations%rowtype; created public.quote_lot_confirmations%rowtype;
 fp text; kind text; act text; unit text; line_fp text; mode text; matches integer;
begin
 if p_case_id is null or p_actor is null or jsonb_typeof(p_request) is distinct from 'object' then
   raise exception 'LOT_REQUEST_INVALID' using errcode = '22023';
 end if;
 if exists (select 1 from jsonb_object_keys(p_request) k where k not in
     ('unit_ref', 'decision_kind', 'action', 'line_fingerprint', 'terminal_mode', 'source_reference',
      'expected_context_hash', 'expected_head_id', 'idempotency_key'))
   or not p_request ?& array['unit_ref', 'decision_kind', 'action', 'line_fingerprint', 'terminal_mode',
      'source_reference', 'expected_context_hash', 'expected_head_id', 'idempotency_key']
   or coalesce(p_request->>'decision_kind', '') not in ('line_binding', 'terminal_mode')
   or coalesce(p_request->>'action', '') not in ('confirm', 'revoke')
   or coalesce(p_request->>'expected_context_hash', '') !~ '^[a-f0-9]{64}$'
   or coalesce(p_request->>'unit_ref', '') !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
   or jsonb_typeof(p_request->'source_reference') is distinct from 'string'
   or length(btrim(p_request->>'source_reference')) not between 3 and 2000
   or jsonb_typeof(p_request->'idempotency_key') is distinct from 'string'
   or jsonb_typeof(p_request->'expected_head_id') not in ('string', 'null')
   or jsonb_typeof(p_request->'line_fingerprint') not in ('string', 'null')
   or jsonb_typeof(p_request->'terminal_mode') not in ('string', 'null') then
   raise exception 'LOT_REQUEST_INVALID' using errcode = '22023';
 end if;
 kind := p_request->>'decision_kind'; act := p_request->>'action'; unit := p_request->>'unit_ref';
 line_fp := p_request->>'line_fingerprint'; mode := p_request->>'terminal_mode';
 if (kind = 'line_binding' and (mode is not null or (act = 'confirm') <> (coalesce(line_fp, '') ~ '^[a-f0-9]{64}$')
       or (act = 'revoke' and line_fp is not null)))
   or (kind = 'terminal_mode' and (line_fp is not null or (act = 'confirm') <> (coalesce(mode, '') in ('LOLO', 'RORO', 'CONRO'))
       or (act = 'revoke' and mode is not null))) then
   raise exception 'LOT_REQUEST_INVALID' using errcode = '22023';
 end if;
 -- Same dossier lock as every PAD writer and finalizer: decisions and pricing completion
 -- are serialized, so a run can never be completed against decisions it did not read.
 perform pg_advisory_xact_lock(hashtextextended('pad_group:' || p_case_id::text, 0));
 perform 1 from public.quote_cases where id = p_case_id
   and status::text not in ('SENT', 'ACCEPTED', 'REJECTED', 'ARCHIVED', 'PRICING_RUNNING') for update;
 if not found then raise exception 'LOT_CASE_LOCKED' using errcode = '22023'; end if;
 fp := encode(sha256(convert_to(jsonb_build_object('actor', p_actor, 'request', p_request)::text, 'UTF8')), 'hex');
 select * into replay from public.quote_lot_confirmations
  where case_id = p_case_id and idempotency_key = (p_request->>'idempotency_key')::uuid;
 if found then
   if replay.request_fingerprint <> fp then raise exception 'LOT_IDEMPOTENCY_CONFLICT' using errcode = '40001'; end if;
   return to_jsonb(replay) - 'request_fingerprint' - 'idempotency_key';
 end if;
 ctx := public.read_lot_confirmation_context(p_case_id); sc := ctx->'scenario';
 if ctx is null or ctx->>'context_hash' is distinct from p_request->>'expected_context_hash' then
   raise exception 'LOT_CONTEXT_CHANGED' using errcode = '40001';
 end if;
 select * into old from public.quote_lot_confirmations
  where case_id = p_case_id and unit_ref = unit and decision_kind = kind order by decision_version desc limit 1;
 if old.id is distinct from (p_request->>'expected_head_id')::uuid then
   raise exception 'LOT_HEAD_CHANGED' using errcode = '40001';
 end if;
 if act = 'revoke' then
   if old.id is null or old.action <> 'confirm' then raise exception 'LOT_NOTHING_TO_REVOKE' using errcode = '22023'; end if;
   insert into public.quote_lot_confirmations(case_id, scenario_id, scope_hash, context_hash, unit_ref, decision_kind, action,
     line_fingerprint, terminal_mode, source_reference, decided_by, decision_version, idempotency_key, request_fingerprint, created_at)
   values (p_case_id, old.scenario_id, old.scope_hash, ctx->>'context_hash', unit, kind, 'revoke', null, null,
     btrim(p_request->>'source_reference'), p_actor, old.decision_version + 1, (p_request->>'idempotency_key')::uuid, fp, clock_timestamp())
   returning * into created;
   return to_jsonb(created) - 'request_fingerprint' - 'idempotency_key';
 end if;
 if coalesce((ctx->>'request_count')::integer, 0) < 2 or sc is null or sc = 'null'::jsonb
   or sc->>'superseded_by_scenario_id' is not null or sc->>'status' in ('blocked', 'superseded', 'promoted_to_final')
   or coalesce(sc#>>'{scope_snapshot,schema_version}', '') not in ('2', '3')
   or jsonb_typeof(sc#>'{scope_snapshot,cargo_units}') is distinct from 'array' then
   raise exception 'LOT_SCOPE_UNSUPPORTED' using errcode = '22023';
 end if;
 select count(*) into matches from jsonb_array_elements(sc#>'{scope_snapshot,cargo_units}') v where v->>'unit_ref' = unit;
 if matches <> 1 then raise exception 'LOT_UNIT_INVALID' using errcode = '22023'; end if;
 if kind = 'line_binding' then
   select count(*) into matches from jsonb_array_elements(ctx->'lines') l where l->>'fingerprint' = line_fp;
   if matches = 0 then raise exception 'LOT_LINE_CHANGED' using errcode = '22023'; end if;
   -- Indiscernible lines are never assigned: the operator must obtain a clarification.
   if matches > 1 then raise exception 'LOT_LINE_AMBIGUOUS' using errcode = '22023'; end if;
   if exists (select 1 from jsonb_array_elements(ctx->'heads') h where h->>'decision_kind' = 'line_binding'
       and h->>'action' = 'confirm' and h->>'unit_ref' <> unit and h->>'line_fingerprint' = line_fp
       and h->>'context_hash' = ctx->>'context_hash' and h->>'scenario_id' = sc->>'id') then
     raise exception 'LOT_LINE_ALREADY_BOUND' using errcode = '22023';
   end if;
 elsif not exists (select 1 from jsonb_array_elements(ctx->'heads') h where h->>'decision_kind' = 'line_binding'
     and h->>'unit_ref' = unit and h->>'action' = 'confirm' and h->>'context_hash' = ctx->>'context_hash'
     and h->>'scenario_id' = sc->>'id' and h->>'scope_hash' = sc->>'scope_hash'
     and (select count(*) from jsonb_array_elements(ctx->'lines') l where l->>'fingerprint' = h->>'line_fingerprint') = 1) then
   raise exception 'LOT_BINDING_REQUIRED' using errcode = '22023';
 end if;
 insert into public.quote_lot_confirmations(case_id, scenario_id, scope_hash, context_hash, unit_ref, decision_kind, action,
   line_fingerprint, terminal_mode, source_reference, decided_by, decision_version, idempotency_key, request_fingerprint, created_at)
 values (p_case_id, (sc->>'id')::uuid, sc->>'scope_hash', ctx->>'context_hash', unit, kind, 'confirm',
   case when kind = 'line_binding' then line_fp end, case when kind = 'terminal_mode' then mode end,
   btrim(p_request->>'source_reference'), p_actor, coalesce(old.decision_version, 0) + 1,
   (p_request->>'idempotency_key')::uuid, fp, clock_timestamp())
 returning * into created;
 return to_jsonb(created) - 'request_fingerprint' - 'idempotency_key';
end;
$$;

-- Multi-lot completion: the lot decisions read by the run and the global context are
-- rechecked under the dossier lock, then the existing PAD finalizer rechecks PAD heads,
-- the weight head and performs the unchanged run update. Nothing is recorded otherwise.
create function public.complete_lot_pricing(p_case_id uuid, p_run_id uuid, p_context_hash text,
  p_pad_heads jsonb, p_lot_heads jsonb, p_weight_head_id uuid, p_result jsonb)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare ctx jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('pad_group:' || p_case_id::text, 0));
 ctx := public.read_lot_confirmation_context(p_case_id);
 if ctx is null or ctx->>'context_hash' is distinct from p_context_hash or ctx->'heads' is distinct from p_lot_heads then
   raise exception 'LOT_CONTEXT_CHANGED' using errcode = '40001';
 end if;
 perform public.complete_pad_weight_pricing(p_case_id, p_run_id, p_context_hash, p_pad_heads, p_result, p_weight_head_id);
end;
$$;

-- Named change to the existing PAD writer (body of 20260917180000 otherwise unchanged):
-- the blanket multi-lot refusal is replaced by an explicit requirement. In a multi-lot
-- dossier a group may be confirmed only while it is bound, by a fresh operator decision,
-- to exactly one current request line. Revocations keep their existing rules. The decision
-- time is taken under the dossier lock (clock_timestamp), so "binding before PAD decision"
-- follows the real order of the serialized writers, not transaction start times.
create or replace function public.record_pad_group_confirmation(p_case_id uuid, p_actor uuid, p_request jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
 ctx jsonb; sc jsonb; u jsonb; old public.pad_group_confirmations%rowtype;
 replay public.pad_group_confirmations%rowtype; created public.pad_group_confirmations%rowtype;
 fp text; w numeric; matches integer; lots jsonb;
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
 if sc is null or sc='null'::jsonb
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
 if coalesce((ctx->>'request_count')::integer,0)>1 and p_request->>'action'='confirm' then
   lots:=public.read_lot_confirmation_context(p_case_id);
   if lots is null or lots->>'context_hash' is distinct from ctx->>'context_hash'
     or not exists(select 1 from jsonb_array_elements(lots->'heads') h where h->>'decision_kind'='line_binding'
       and h->>'unit_ref'=p_request->>'unit_ref' and h->>'action'='confirm' and h->>'context_hash'=ctx->>'context_hash'
       and h->>'scenario_id'=sc->>'id' and h->>'scope_hash'=sc->>'scope_hash'
       and (select count(*) from jsonb_array_elements(lots->'lines') l where l->>'fingerprint'=h->>'line_fingerprint')=1) then
     raise exception 'PAD_LOT_BINDING_REQUIRED' using errcode='22023';
   end if;
 end if;
 select * into old from public.pad_group_confirmations where case_id=p_case_id and unit_ref=p_request->>'unit_ref' order by decision_version desc limit 1;
 if old.id is distinct from (p_request->>'expected_head_id')::uuid then raise exception 'PAD_HEAD_CHANGED' using errcode='40001'; end if;
 if p_request->>'action'='confirm' then
   if coalesce(p_request->>'category','') !~ '^(T0[1-9]|T1[0-4]|P0[1-5])$' then raise exception 'PAD_CATEGORY_INVALID' using errcode='22023'; end if;
   w:=case u->>'weight_basis' when 'per_unit' then (u->>'gross_weight_kg')::numeric*(u->>'quantity')::numeric when 'total' then (u->>'gross_weight_kg')::numeric else null end;
   if w is null or w<=0 or w>1000000000000 then raise exception 'PAD_WEIGHT_REQUIRED' using errcode='22023'; end if;
 elsif old.id is null then raise exception 'PAD_NOTHING_TO_REVOKE' using errcode='22023';
 end if;
 insert into public.pad_group_confirmations(case_id,scenario_id,scope_hash,context_hash,unit_ref,action,category,total_weight_kg,
   source_reference,weight_source_reference,decided_by,decision_version,idempotency_key,request_fingerprint,weight_basis,weight_reservation,created_at)
 values(p_case_id,(sc->>'id')::uuid,sc->>'scope_hash',ctx->>'context_hash',p_request->>'unit_ref',p_request->>'action',
   case when p_request->>'action'='confirm' then p_request->>'category' else null end,w,
   p_request->>'source_reference',p_request->>'weight_source_reference',p_actor,coalesce(old.decision_version,0)+1,(p_request->>'idempotency_key')::uuid,fp,coalesce(p_request->>'weight_basis','confirmed'),coalesce(p_request->>'weight_reservation',''),clock_timestamp())
 returning * into created;
 return to_jsonb(created)-'request_fingerprint'-'idempotency_key';
end;
$$;
-- CREATE OR REPLACE preserves the PAD writer's owner and execute ACL.

-- Strip inherited default ACLs (Lovable may configure additional default grantees);
-- never grant browser access. The registry is never updated or deleted by any role.
do $acl$
declare o record; a record; target text;
begin
 for a in select * from aclexplode(coalesce((select relacl from pg_class where oid = 'public.quote_lot_confirmations'::regclass),
     acldefault('r', (select relowner from pg_class where oid = 'public.quote_lot_confirmations'::regclass))))
   where grantee <> (select relowner from pg_class where oid = 'public.quote_lot_confirmations'::regclass) loop
   target := case when a.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end;
   execute 'revoke all on public.quote_lot_confirmations from ' || target;
 end loop;
 for o in select p.oid, p.proowner from pg_proc p where p.oid in (
     'public.quote_request_line_fingerprint(text,text,text,jsonb)'::regprocedure,
     'public.read_lot_confirmation_context(uuid)'::regprocedure,
     'public.record_lot_confirmation(uuid,uuid,jsonb)'::regprocedure,
     'public.complete_lot_pricing(uuid,uuid,text,jsonb,jsonb,uuid,jsonb)'::regprocedure) loop
   for a in select * from aclexplode(coalesce((select proacl from pg_proc where oid = o.oid), acldefault('f', o.proowner)))
     where grantee <> o.proowner loop
     target := case when a.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end;
     execute 'revoke all on function ' || o.oid::regprocedure || ' from ' || target;
   end loop;
 end loop;
end;
$acl$;
grant select, insert on public.quote_lot_confirmations to service_role;
grant execute on function public.read_lot_confirmation_context(uuid), public.record_lot_confirmation(uuid, uuid, jsonb),
  public.complete_lot_pricing(uuid, uuid, text, jsonb, jsonb, uuid, jsonb) to service_role;
commit;
