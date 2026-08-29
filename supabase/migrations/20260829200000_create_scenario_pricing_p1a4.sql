-- P1-A4 — pricing isolé par scénario, voie additive et fail-closed.
--
-- Garanties :
--   * aucun écrit dans quote_facts, quote_gaps, quote_cases, pricing_runs,
--     quote_service_pricing, quotation_versions ou case_timeline_events ;
--   * qualification limitée à provisional | partial | blocked (jamais firm) ;
--   * snapshots de faits/hypothèses attestés dans la transaction d'écriture ;
--   * mutation uniquement par RPC SECURITY DEFINER service_role-only ;
--   * idempotence forte et supersession linéaire par scénario.

create table if not exists public.quote_scenario_pricing_runs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.quote_cases(id) on delete cascade,
  scenario_id uuid not null references public.quote_scenarios(id),
  scenario_scope_hash text not null
    constraint quote_scenario_pricing_scope_hash_sha256
      check (scenario_scope_hash ~ '^[0-9a-f]{64}$'),
  run_seq integer not null check (run_seq > 0),

  status text not null
    constraint quote_scenario_pricing_status_check
      check (status in ('success','blocked','failed','superseded')),
  qualification text not null
    constraint quote_scenario_pricing_qualification_check
      check (qualification in ('provisional','partial','blocked')),
  blockers jsonb not null default '[]'::jsonb
    constraint quote_scenario_pricing_blockers_array
      check (jsonb_typeof(blockers) = 'array'),

  scenario_snapshot jsonb not null
    constraint quote_scenario_pricing_scenario_snapshot_object
      check (jsonb_typeof(scenario_snapshot) = 'object'),
  inputs_json jsonb not null
    constraint quote_scenario_pricing_inputs_object
      check (jsonb_typeof(inputs_json) = 'object'),
  facts_snapshot jsonb not null
    constraint quote_scenario_pricing_facts_array
      check (jsonb_typeof(facts_snapshot) = 'array'),
  assumptions_snapshot jsonb not null
    constraint quote_scenario_pricing_assumptions_array
      check (jsonb_typeof(assumptions_snapshot) = 'array'),
  overlay_json jsonb not null
    constraint quote_scenario_pricing_overlay_array
      check (jsonb_typeof(overlay_json) = 'array'),
  reservations jsonb not null default '[]'::jsonb
    constraint quote_scenario_pricing_reservations_array
      check (jsonb_typeof(reservations) = 'array'),

  engine_request jsonb null
    constraint quote_scenario_pricing_engine_request_object
      check (engine_request is null or jsonb_typeof(engine_request) = 'object'),
  engine_response jsonb null
    constraint quote_scenario_pricing_engine_response_object
      check (engine_response is null or jsonb_typeof(engine_response) = 'object'),
  tariff_lines jsonb not null default '[]'::jsonb
    constraint quote_scenario_pricing_lines_array
      check (jsonb_typeof(tariff_lines) = 'array'),
  tariff_sources jsonb not null default '[]'::jsonb
    constraint quote_scenario_pricing_sources_array
      check (jsonb_typeof(tariff_sources) = 'array'),

  firm_total_ht numeric null,
  firm_total_ttc numeric null,
  indicative_total_ht numeric null,
  indicative_total_ttc numeric null,
  currency text not null default 'XOF'
    constraint quote_scenario_pricing_currency_check
      check (currency ~ '^[A-Z]{3,5}$'),

  request_fingerprint text not null
    constraint quote_scenario_pricing_fingerprint_sha256
      check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_by uuid not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  superseded_by_run_id uuid null,

  constraint quote_scenario_pricing_totals_non_negative check (
    (firm_total_ht is null or firm_total_ht >= 0)
    and (firm_total_ttc is null or firm_total_ttc >= 0)
    and (indicative_total_ht is null or indicative_total_ht >= 0)
    and (indicative_total_ttc is null or indicative_total_ttc >= 0)
  ),
  constraint quote_scenario_pricing_firm_lte_indicative check (
    (firm_total_ht is null or indicative_total_ht is null or firm_total_ht <= indicative_total_ht)
    and (firm_total_ttc is null or indicative_total_ttc is null or firm_total_ttc <= indicative_total_ttc)
  ),
  constraint quote_scenario_pricing_success_totals check (
    status <> 'success'
    or (
      qualification in ('provisional','partial')
      and firm_total_ht is not null and firm_total_ttc is not null
      and indicative_total_ht is not null and indicative_total_ttc is not null
    )
  ),
  constraint quote_scenario_pricing_blocked_qualification check (
    status not in ('blocked','failed') or qualification = 'blocked'
  ),
  constraint quote_scenario_pricing_supersession_shape check (
    (status = 'superseded' and superseded_by_run_id is not null)
    or (status <> 'superseded' and superseded_by_run_id is null)
  )
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.quote_scenario_pricing_runs'::regclass
       and conname = 'quote_scenario_pricing_superseded_by_fkey'
  ) then
    alter table public.quote_scenario_pricing_runs
      add constraint quote_scenario_pricing_superseded_by_fkey
      foreign key (superseded_by_run_id)
      references public.quote_scenario_pricing_runs(id)
      deferrable initially immediate;
  end if;
end $$;

create unique index if not exists uq_quote_scenario_pricing_run_seq
  on public.quote_scenario_pricing_runs (scenario_id, run_seq);
create index if not exists idx_quote_scenario_pricing_case
  on public.quote_scenario_pricing_runs (case_id);

create table if not exists public.quote_scenario_pricing_mutations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.quote_cases(id) on delete cascade,
  scenario_id uuid not null references public.quote_scenarios(id),
  pricing_run_id uuid not null references public.quote_scenario_pricing_runs(id),
  outcome text not null
    constraint quote_scenario_pricing_mutation_outcome_check
      check (outcome in ('applied','no_op')),
  idempotency_key text not null
    constraint quote_scenario_pricing_mutation_key_len
      check (length(idempotency_key) between 8 and 128),
  request_fingerprint text not null
    constraint quote_scenario_pricing_mutation_fingerprint_sha256
      check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid not null,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_quote_scenario_pricing_mutation_idem
  on public.quote_scenario_pricing_mutations (case_id, idempotency_key);
create index if not exists idx_quote_scenario_pricing_mutation_scenario
  on public.quote_scenario_pricing_mutations (scenario_id);

create or replace function public.quote_scenario_pricing_run_invariants()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case uuid;
  v_hash text;
  v_successor public.quote_scenario_pricing_runs%rowtype;
begin
  if tg_op = 'INSERT' then
    select case_id, scope_hash into v_case, v_hash
      from quote_scenarios where id = new.scenario_id;
    if v_case is null then
      raise exception 'NOT_FOUND: scénario % introuvable', new.scenario_id using errcode = '23514';
    end if;
    if v_case <> new.case_id then
      raise exception 'FORBIDDEN_CROSS_CASE: scénario % appartient au dossier %, pas au dossier %',
        new.scenario_id, v_case, new.case_id using errcode = '23514';
    end if;
    if v_hash <> new.scenario_scope_hash then
      raise exception 'SCENARIO_STATE_CHANGED: scope_hash attendu %, courant %',
        new.scenario_scope_hash, v_hash using errcode = '23514';
    end if;
    return new;
  end if;

  if new.status <> 'superseded' or old.status = 'superseded'
     or new.superseded_by_run_id is null then
    raise exception 'CONFLICT_INVALID_STATE: un run de scénario est immuable hors supersession linéaire'
      using errcode = '23514';
  end if;
  if (to_jsonb(new) - 'status' - 'superseded_by_run_id')
       <> (to_jsonb(old) - 'status' - 'superseded_by_run_id') then
    raise exception 'CONFLICT_INVALID_STATE: seule la supersession du run précédent est autorisée'
      using errcode = '23514';
  end if;
  select * into v_successor from quote_scenario_pricing_runs where id = new.superseded_by_run_id;
  if v_successor.id is null or v_successor.scenario_id <> old.scenario_id
     or v_successor.run_seq <> old.run_seq + 1 then
    raise exception 'CONFLICT_INVALID_STATE: successeur de run incohérent' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger quote_scenario_pricing_run_invariants
  before insert or update on public.quote_scenario_pricing_runs
  for each row execute function public.quote_scenario_pricing_run_invariants();

create or replace function public.quote_scenario_pricing_mutation_invariants()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case uuid;
  v_scenario uuid;
begin
  if tg_op = 'UPDATE' then
    raise exception 'CONFLICT_INVALID_STATE: registre de pricing scénario append-only'
      using errcode = '23514';
  end if;
  select case_id, scenario_id into v_case, v_scenario
    from quote_scenario_pricing_runs where id = new.pricing_run_id;
  if v_case is null or v_case <> new.case_id or v_scenario <> new.scenario_id then
    raise exception 'FORBIDDEN_CROSS_CASE: mutation et run de scénario incohérents'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger quote_scenario_pricing_mutation_invariants
  before insert or update on public.quote_scenario_pricing_mutations
  for each row execute function public.quote_scenario_pricing_mutation_invariants();

create or replace function public.record_quote_scenario_pricing_run(
  p_case_id uuid,
  p_scenario_id uuid,
  p_expected_scope_hash text,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_actor_user_id uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scenario public.quote_scenarios%rowtype;
  v_replay public.quote_scenario_pricing_mutations%rowtype;
  v_run public.quote_scenario_pricing_runs%rowtype;
  v_previous public.quote_scenario_pricing_runs%rowtype;
  v_run_id uuid := gen_random_uuid();
  v_run_seq integer;
  v_status text;
  v_qualification text;
  v_currency text;
  v_duration integer;
  v_firm_ht numeric;
  v_firm_ttc numeric;
  v_indicative_ht numeric;
  v_indicative_ttc numeric;
  v_fact jsonb;
  v_fact_row public.quote_facts%rowtype;
  v_assumption jsonb;
  v_assumption_row public.quote_scenario_assumptions%rowtype;
  v_count integer;
  v_unknown text;
begin
  if p_case_id is null or p_scenario_id is null or p_actor_user_id is null then
    raise exception 'VALIDATION_FAILED: identités obligatoires' using errcode = '22023';
  end if;
  if p_expected_scope_hash !~ '^[0-9a-f]{64}$'
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION_FAILED: empreinte SHA-256 invalide' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 128 then
    raise exception 'VALIDATION_FAILED: idempotency_key invalide' using errcode = '22023';
  end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception 'VALIDATION_FAILED: result doit être un objet JSON' using errcode = '22023';
  end if;

  select key into v_unknown
    from jsonb_object_keys(p_result) key
   where key not in (
     'status','qualification','blockers','scenario_snapshot','inputs_json',
     'facts_snapshot','assumptions_snapshot','overlay_json','reservations',
     'engine_request','engine_response','tariff_lines','tariff_sources',
     'firm_total_ht','firm_total_ttc','indicative_total_ht','indicative_total_ttc',
     'currency','duration_ms'
   ) limit 1;
  if v_unknown is not null then
    raise exception 'VALIDATION_FAILED: champ result inconnu %', v_unknown using errcode = '22023';
  end if;

  v_status := p_result ->> 'status';
  v_qualification := p_result ->> 'qualification';
  v_currency := upper(btrim(coalesce(p_result ->> 'currency', 'XOF')));
  if v_status is null or v_status not in ('success','blocked','failed') then
    raise exception 'VALIDATION_FAILED: status de run invalide' using errcode = '22023';
  end if;
  if v_qualification is null or v_qualification not in ('provisional','partial','blocked') then
    raise exception 'VALIDATION_FAILED: qualification invalide' using errcode = '22023';
  end if;
  if v_status = 'success' and v_qualification = 'blocked' then
    raise exception 'VALIDATION_FAILED: success ne peut pas être blocked' using errcode = '22023';
  end if;
  if v_status in ('blocked','failed') and v_qualification <> 'blocked' then
    raise exception 'VALIDATION_FAILED: blocked/failed exige qualification blocked' using errcode = '22023';
  end if;
  if v_currency !~ '^[A-Z]{3,5}$' then
    raise exception 'VALIDATION_FAILED: currency invalide' using errcode = '22023';
  end if;

  foreach v_unknown in array array[
    'blockers','facts_snapshot','assumptions_snapshot','overlay_json',
    'reservations','tariff_lines','tariff_sources'
  ] loop
    if jsonb_typeof(p_result -> v_unknown) is distinct from 'array' then
      raise exception 'VALIDATION_FAILED: %. doit être un tableau JSON', v_unknown using errcode = '22023';
    end if;
  end loop;
  foreach v_unknown in array array['scenario_snapshot','inputs_json'] loop
    if jsonb_typeof(p_result -> v_unknown) is distinct from 'object' then
      raise exception 'VALIDATION_FAILED: %. doit être un objet JSON', v_unknown using errcode = '22023';
    end if;
  end loop;
  if p_result ? 'engine_request'
     and p_result -> 'engine_request' <> 'null'::jsonb
     and jsonb_typeof(p_result -> 'engine_request') <> 'object' then
    raise exception 'VALIDATION_FAILED: engine_request invalide' using errcode = '22023';
  end if;
  if p_result ? 'engine_response'
     and p_result -> 'engine_response' <> 'null'::jsonb
     and jsonb_typeof(p_result -> 'engine_response') <> 'object' then
    raise exception 'VALIDATION_FAILED: engine_response invalide' using errcode = '22023';
  end if;

  if v_status = 'success' then
    foreach v_unknown in array array[
      'firm_total_ht','firm_total_ttc','indicative_total_ht','indicative_total_ttc'
    ] loop
      if jsonb_typeof(p_result -> v_unknown) is distinct from 'number' then
        raise exception 'VALIDATION_FAILED: total % absent ou non numérique', v_unknown using errcode = '22023';
      end if;
    end loop;
    v_firm_ht := (p_result ->> 'firm_total_ht')::numeric;
    v_firm_ttc := (p_result ->> 'firm_total_ttc')::numeric;
    v_indicative_ht := (p_result ->> 'indicative_total_ht')::numeric;
    v_indicative_ttc := (p_result ->> 'indicative_total_ttc')::numeric;
    if least(v_firm_ht, v_firm_ttc, v_indicative_ht, v_indicative_ttc) < 0
       or v_firm_ht > v_indicative_ht or v_firm_ttc > v_indicative_ttc then
      raise exception 'VALIDATION_FAILED: totaux scénario incohérents' using errcode = '22023';
    end if;
  else
    v_firm_ht := null;
    v_firm_ttc := null;
    v_indicative_ht := null;
    v_indicative_ttc := null;
  end if;
  if jsonb_typeof(p_result -> 'duration_ms') is distinct from 'number'
     or (p_result ->> 'duration_ms')::numeric < 0
     or (p_result ->> 'duration_ms')::numeric > 2147483647 then
    raise exception 'VALIDATION_FAILED: duration_ms invalide' using errcode = '22023';
  end if;
  v_duration := (p_result ->> 'duration_ms')::integer;

  perform pg_advisory_xact_lock(hashtextextended('scenario-pricing:' || p_scenario_id::text, 0));

  select * into v_replay
    from quote_scenario_pricing_mutations
   where case_id = p_case_id and idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_replay.request_fingerprint <> p_request_fingerprint
       or v_replay.scenario_id <> p_scenario_id then
      raise exception 'IDEMPOTENCY_CONFLICT: même clé, contenu ou scénario différent'
        using errcode = '23505';
    end if;
    select * into v_run from quote_scenario_pricing_runs where id = v_replay.pricing_run_id;
    return jsonb_build_object(
      'pricing_run_id', v_run.id,
      'scenario_id', v_run.scenario_id,
      'run_seq', v_run.run_seq,
      'status', v_run.status,
      'qualification', v_run.qualification,
      'firm_total_ht', v_run.firm_total_ht,
      'firm_total_ttc', v_run.firm_total_ttc,
      'indicative_total_ht', v_run.indicative_total_ht,
      'indicative_total_ttc', v_run.indicative_total_ttc,
      'currency', v_run.currency,
      'idempotent_replay', true
    );
  end if;

  select * into v_scenario from quote_scenarios where id = p_scenario_id for share;
  if not found then
    raise exception 'NOT_FOUND: scénario % introuvable', p_scenario_id using errcode = '22023';
  end if;
  if v_scenario.case_id <> p_case_id then
    raise exception 'FORBIDDEN_CROSS_CASE: scénario % appartient au dossier %, pas au dossier %',
      p_scenario_id, v_scenario.case_id, p_case_id using errcode = '23514';
  end if;
  if v_scenario.scope_hash <> p_expected_scope_hash
     or v_scenario.status in ('superseded','promoted_to_final') then
    raise exception 'SCENARIO_STATE_CHANGED: scénario remplacé/finalisé ou scope_hash différent'
      using errcode = '23514';
  end if;
  if p_result -> 'scenario_snapshot' is distinct from v_scenario.scope_snapshot then
    raise exception 'SCENARIO_STATE_CHANGED: snapshot de scénario différent' using errcode = '23514';
  end if;

  select count(*) into v_count from quote_facts
   where case_id = p_case_id and is_current = true;
  if jsonb_array_length(p_result -> 'facts_snapshot') <> v_count then
    raise exception 'SCENARIO_STATE_CHANGED: ensemble des faits courants modifié'
      using errcode = '23514';
  end if;
  for v_fact in select value from jsonb_array_elements(p_result -> 'facts_snapshot') loop
    if coalesce(v_fact ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'VALIDATION_FAILED: fact snapshot sans UUID' using errcode = '22023';
    end if;
    select * into v_fact_row from quote_facts
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
  if (select count(distinct value ->> 'id') from jsonb_array_elements(p_result -> 'facts_snapshot')) <> v_count then
    raise exception 'VALIDATION_FAILED: faits dupliqués dans le snapshot' using errcode = '22023';
  end if;

  select count(*) into v_count
    from quote_scenario_links l
    join quote_scenario_assumptions a on a.id = l.assumption_id
   where l.scenario_id = p_scenario_id and l.assumption_id is not null;
  if jsonb_array_length(p_result -> 'assumptions_snapshot') <> v_count then
    raise exception 'SCENARIO_STATE_CHANGED: ensemble des hypothèses liées modifié'
      using errcode = '23514';
  end if;
  for v_assumption in select value from jsonb_array_elements(p_result -> 'assumptions_snapshot') loop
    if coalesce(v_assumption ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'VALIDATION_FAILED: assumption snapshot sans UUID' using errcode = '22023';
    end if;
    select a.* into v_assumption_row
      from quote_scenario_assumptions a
      join quote_scenario_links l on l.assumption_id = a.id
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
      raise exception 'SCENARIO_STATE_CHANGED: hypothèse liée % modifiée/non vivante',
        v_assumption ->> 'id' using errcode = '23514';
    end if;
  end loop;
  if (select count(distinct value ->> 'id') from jsonb_array_elements(p_result -> 'assumptions_snapshot')) <> v_count then
    raise exception 'VALIDATION_FAILED: hypothèses dupliquées dans le snapshot' using errcode = '22023';
  end if;

  select coalesce(max(run_seq), 0) + 1 into v_run_seq
    from quote_scenario_pricing_runs where scenario_id = p_scenario_id;
  select * into v_previous from quote_scenario_pricing_runs
   where scenario_id = p_scenario_id and status <> 'superseded'
   order by run_seq desc limit 1 for update;

  insert into quote_scenario_pricing_runs (
    id, case_id, scenario_id, scenario_scope_hash, run_seq,
    status, qualification, blockers, scenario_snapshot, inputs_json,
    facts_snapshot, assumptions_snapshot, overlay_json, reservations,
    engine_request, engine_response, tariff_lines, tariff_sources,
    firm_total_ht, firm_total_ttc, indicative_total_ht, indicative_total_ttc,
    currency, request_fingerprint, created_by, duration_ms
  ) values (
    v_run_id, p_case_id, p_scenario_id, p_expected_scope_hash, v_run_seq,
    v_status, v_qualification, p_result -> 'blockers', p_result -> 'scenario_snapshot', p_result -> 'inputs_json',
    p_result -> 'facts_snapshot', p_result -> 'assumptions_snapshot', p_result -> 'overlay_json', p_result -> 'reservations',
    nullif(p_result -> 'engine_request', 'null'::jsonb), nullif(p_result -> 'engine_response', 'null'::jsonb),
    p_result -> 'tariff_lines', p_result -> 'tariff_sources',
    v_firm_ht, v_firm_ttc, v_indicative_ht, v_indicative_ttc,
    v_currency, p_request_fingerprint, p_actor_user_id, v_duration
  );

  if v_previous.id is not null then
    update quote_scenario_pricing_runs
       set status = 'superseded', superseded_by_run_id = v_run_id
     where id = v_previous.id;
  end if;

  insert into quote_scenario_pricing_mutations (
    case_id, scenario_id, pricing_run_id, outcome, idempotency_key,
    request_fingerprint, actor_user_id
  ) values (
    p_case_id, p_scenario_id, v_run_id, 'applied', btrim(p_idempotency_key),
    p_request_fingerprint, p_actor_user_id
  );

  return jsonb_build_object(
    'pricing_run_id', v_run_id,
    'scenario_id', p_scenario_id,
    'run_seq', v_run_seq,
    'status', v_status,
    'qualification', v_qualification,
    'firm_total_ht', v_firm_ht,
    'firm_total_ttc', v_firm_ttc,
    'indicative_total_ht', v_indicative_ht,
    'indicative_total_ttc', v_indicative_ttc,
    'currency', v_currency,
    'idempotent_replay', false
  );
end;
$$;

alter table public.quote_scenario_pricing_runs enable row level security;
alter table public.quote_scenario_pricing_mutations enable row level security;

create policy "quote_scenario_pricing_runs_select"
  on public.quote_scenario_pricing_runs for select to authenticated
  using (auth.role() = 'authenticated');

revoke all on table public.quote_scenario_pricing_runs from public, anon, authenticated, service_role;
grant select on table public.quote_scenario_pricing_runs to authenticated;

revoke all on table public.quote_scenario_pricing_mutations from public, anon, authenticated, service_role;

revoke all on function public.record_quote_scenario_pricing_run(uuid, uuid, text, text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_quote_scenario_pricing_run(uuid, uuid, text, text, text, uuid, jsonb)
  to service_role;

-- Prérequis de lecture borné de l'Edge P1-A4. Le reset historique ne donne
-- pas de SELECT service_role sur ces deux tables, bien que les fonctions
-- backend les consomment. Aucun privilège d'écriture n'est ajouté.
grant select on table public.quote_facts to service_role;
grant select on table public.quote_request_lines to service_role;

revoke all on function public.quote_scenario_pricing_run_invariants() from public, anon, authenticated;
revoke all on function public.quote_scenario_pricing_mutation_invariants() from public, anon, authenticated;

comment on table public.quote_scenario_pricing_runs is
  'P1-A4. Ledger isolé de cotations de scénario. Ne participe jamais à pricing_runs ni au statut/compteur du dossier. Qualification limitée à provisional/partial/blocked ; aucune version/PDF/email.';
comment on function public.record_quote_scenario_pricing_run(uuid, uuid, text, text, text, uuid, jsonb) is
  'P1-A4. Seule voie d écriture des runs de scénario. Atteste dossier, scope_hash, snapshot complet des faits courants et hypothèses liées vivantes ; idempotence forte, verrou par scénario, supersession linéaire. N écrit dans aucune table canonique de pricing ou de faits.';
