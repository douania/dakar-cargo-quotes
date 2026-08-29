-- P1-A5 — sorties documentaires de scénario, additives et fail-closed.
--
-- Une sortie scénario réutilise quotation_versions uniquement comme enveloppe
-- immuable pour quotation_documents/email_drafts. Elle ne peut jamais devenir
-- la version canonique sélectionnée, ne change pas quote_cases.status et ne
-- modifie ni les faits ni le pricing canonique.

alter table public.quotation_versions
  add column if not exists source_kind text not null default 'canonical';

alter table public.quotation_versions
  add column if not exists scenario_pricing_run_id uuid null
    references public.quote_scenario_pricing_runs(id) on delete cascade;

alter table public.quotation_versions
  alter column pricing_run_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.quotation_versions'::regclass
       and conname = 'quotation_versions_source_shape'
  ) then
    alter table public.quotation_versions
      add constraint quotation_versions_source_shape check (
        (
          source_kind = 'canonical'
          and pricing_run_id is not null
          and scenario_pricing_run_id is null
          and version_number > 0
        )
        or
        (
          source_kind = 'scenario'
          and pricing_run_id is null
          and scenario_pricing_run_id is not null
          and version_number < 0
          and is_selected = false
          and status = 'draft'
        )
      );
  end if;
end $$;

-- Les versions canoniques conservent leur numérotation commerciale positive.
-- Les sorties scénario utilisent un espace technique négatif distinct : elles
-- ne peuvent donc ni consommer ni concurrencer un numéro de devis canonique.
create or replace function public.get_next_quotation_version_number(p_case_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_next integer;
begin
  perform pg_advisory_xact_lock(hashtext('qv_' || p_case_id::text));

  select coalesce(max(version_number), 0) + 1
    into v_next
    from public.quotation_versions
   where case_id = p_case_id
     and source_kind = 'canonical';

  return v_next;
end;
$$;

revoke all on function public.get_next_quotation_version_number(uuid) from public;
grant execute on function public.get_next_quotation_version_number(uuid) to service_role;

create unique index if not exists uq_quotation_versions_scenario_pricing_run
  on public.quotation_versions (scenario_pricing_run_id)
  where source_kind = 'scenario';

create index if not exists idx_quotation_versions_source_kind
  on public.quotation_versions (case_id, source_kind, created_at desc);

create table if not exists public.quote_scenario_output_mutations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.quote_cases(id) on delete cascade,
  scenario_id uuid not null references public.quote_scenarios(id),
  scenario_pricing_run_id uuid not null references public.quote_scenario_pricing_runs(id) on delete cascade,
  quotation_version_id uuid not null references public.quotation_versions(id) on delete cascade,
  idempotency_key text not null
    constraint quote_scenario_output_mutation_key_len
      check (length(idempotency_key) between 8 and 128),
  request_fingerprint text not null
    constraint quote_scenario_output_fingerprint_sha256
      check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid not null,
  created_at timestamptz not null default now(),
  constraint uq_quote_scenario_output_run unique (scenario_pricing_run_id),
  constraint uq_quote_scenario_output_version unique (quotation_version_id),
  constraint uq_quote_scenario_output_idem unique (case_id, idempotency_key)
);

alter table public.quote_scenario_output_mutations enable row level security;
revoke all on table public.quote_scenario_output_mutations
  from public, anon, authenticated, service_role;

create or replace function public.quotation_version_source_invariants()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if old.source_kind = 'scenario' and to_jsonb(new) <> to_jsonb(old) then
      raise exception 'CONFLICT_INVALID_STATE: une sortie scénario est immuable'
        using errcode = '23514';
    end if;
    if old.source_kind <> new.source_kind
       or old.pricing_run_id is distinct from new.pricing_run_id
       or old.scenario_pricing_run_id is distinct from new.scenario_pricing_run_id then
      raise exception 'CONFLICT_INVALID_STATE: la provenance d''une version est immuable'
        using errcode = '23514';
    end if;
  end if;

  if new.source_kind = 'scenario' then
    if new.is_selected or new.status <> 'draft' or new.pricing_run_id is not null
       or new.scenario_pricing_run_id is null
       or new.snapshot #>> '{meta,source_kind}' is distinct from 'scenario'
       or new.snapshot #>> '{meta,quoteQualification,level}' not in ('provisional','partial') then
      raise exception 'SCENARIO_OUTPUT_INVALID: sortie scénario non ferme/non sélectionnée obligatoire'
        using errcode = '23514';
    end if;
  elsif new.source_kind <> 'canonical' then
    raise exception 'VALIDATION_FAILED: source_kind inconnu %', new.source_kind
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists quotation_version_source_invariants
  on public.quotation_versions;
create trigger quotation_version_source_invariants
  before insert or update on public.quotation_versions
  for each row execute function public.quotation_version_source_invariants();

create or replace function public.quote_scenario_output_mutation_invariants()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.quote_scenario_pricing_runs%rowtype;
  v_version public.quotation_versions%rowtype;
begin
  if tg_op = 'UPDATE' then
    raise exception 'CONFLICT_INVALID_STATE: registre de sortie scénario append-only'
      using errcode = '23514';
  end if;
  select * into v_run from public.quote_scenario_pricing_runs
   where id = new.scenario_pricing_run_id;
  select * into v_version from public.quotation_versions
   where id = new.quotation_version_id;
  if v_run.id is null or v_version.id is null
     or v_run.case_id <> new.case_id or v_run.scenario_id <> new.scenario_id
     or v_version.case_id <> new.case_id
     or v_version.source_kind <> 'scenario'
     or v_version.scenario_pricing_run_id <> new.scenario_pricing_run_id then
    raise exception 'FORBIDDEN_CROSS_CASE: mutation de sortie incohérente'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists quote_scenario_output_mutation_invariants
  on public.quote_scenario_output_mutations;
create trigger quote_scenario_output_mutation_invariants
  before insert or update on public.quote_scenario_output_mutations
  for each row execute function public.quote_scenario_output_mutation_invariants();

-- La sélection canonique refuse explicitement les sorties de scénario. Cette
-- garde DB complète l'absence de bouton dans l'UI et le refus de send-quotation.
create or replace function public.select_quotation_version(
  p_version_id uuid,
  p_case_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source text;
begin
  perform pg_advisory_xact_lock(hashtext('qv_select_' || p_case_id::text));

  select source_kind into v_source
    from public.quotation_versions
   where id = p_version_id and case_id = p_case_id;
  if not found then
    raise exception 'NOT_FOUND: version introuvable pour ce dossier'
      using errcode = '22023';
  end if;
  if v_source <> 'canonical' then
    raise exception 'SCENARIO_OUTPUT_NOT_SELECTABLE: une sortie scénario ne peut pas devenir un devis canonique'
      using errcode = '23514';
  end if;

  update public.quotation_versions
     set is_selected = false
   where case_id = p_case_id and source_kind = 'canonical' and is_selected = true;
  update public.quotation_versions
     set is_selected = true
   where id = p_version_id and case_id = p_case_id and source_kind = 'canonical';
end;
$$;

revoke all on function public.select_quotation_version(uuid, uuid) from public;
grant execute on function public.select_quotation_version(uuid, uuid) to service_role;

create or replace function public.create_scenario_quotation_version(
  p_case_id uuid,
  p_scenario_id uuid,
  p_scenario_pricing_run_id uuid,
  p_expected_scope_hash text,
  p_idempotency_key text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.quote_scenario_pricing_runs%rowtype;
  v_scenario public.quote_scenarios%rowtype;
  v_replay public.quote_scenario_output_mutations%rowtype;
  v_existing public.quotation_versions%rowtype;
  v_fact jsonb;
  v_fact_row public.quote_facts%rowtype;
  v_assumption jsonb;
  v_assumption_row public.quote_scenario_assumptions%rowtype;
  v_count integer;
  v_version_id uuid := gen_random_uuid();
  v_version_number integer;
  v_now timestamptz := now();
  v_reference text;
  v_client_email text;
  v_client_company text;
  v_lines jsonb := '[]'::jsonb;
  v_exclusions jsonb := '[]'::jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_snapshot jsonb;
begin
  if p_case_id is null or p_scenario_id is null
     or p_scenario_pricing_run_id is null or p_actor_user_id is null then
    raise exception 'VALIDATION_FAILED: identités obligatoires' using errcode = '22023';
  end if;
  if p_expected_scope_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION_FAILED: scope_hash invalide' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 128 then
    raise exception 'VALIDATION_FAILED: idempotency_key invalide' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('scenario-output:' || p_scenario_pricing_run_id::text, 0)
  );

  select * into v_replay
    from public.quote_scenario_output_mutations
   where case_id = p_case_id and idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_replay.scenario_id <> p_scenario_id
       or v_replay.scenario_pricing_run_id <> p_scenario_pricing_run_id then
      raise exception 'IDEMPOTENCY_CONFLICT: même clé, scénario ou run différent'
        using errcode = '23505';
    end if;
    select * into v_existing from public.quotation_versions
     where id = v_replay.quotation_version_id;
  end if;

  if v_existing.id is null then
    select * into v_existing from public.quotation_versions
     where scenario_pricing_run_id = p_scenario_pricing_run_id
       and source_kind = 'scenario';
  end if;

  select * into v_run from public.quote_scenario_pricing_runs
   where id = p_scenario_pricing_run_id for share;
  if not found then
    raise exception 'NOT_FOUND: run de scénario introuvable' using errcode = '22023';
  end if;
  if v_run.case_id <> p_case_id or v_run.scenario_id <> p_scenario_id then
    raise exception 'FORBIDDEN_CROSS_CASE: run/scénario/dossier incohérents'
      using errcode = '23514';
  end if;
  if v_run.status <> 'success' or v_run.qualification not in ('provisional','partial')
     or v_run.superseded_by_run_id is not null then
    raise exception 'SCENARIO_RUN_NOT_OUTPUTTABLE: seul le dernier run success non ferme est admissible'
      using errcode = '23514';
  end if;

  select * into v_scenario from public.quote_scenarios
   where id = p_scenario_id for share;
  if not found or v_scenario.case_id <> p_case_id
     or v_scenario.scope_hash <> p_expected_scope_hash
     or v_run.scenario_scope_hash <> p_expected_scope_hash
     or v_scenario.scope_snapshot is distinct from v_run.scenario_snapshot
     or v_scenario.status in ('blocked','superseded','promoted_to_final')
     or v_scenario.superseded_by_scenario_id is not null then
    raise exception 'SCENARIO_STATE_CHANGED: scénario non vivant ou périmètre modifié'
      using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.quote_scenario_selections
     where case_id = p_case_id and scenario_id = p_scenario_id and released_at is null
  ) then
    raise exception 'SCENARIO_NOT_SELECTED: le scénario doit rester explicitement sélectionné'
      using errcode = '23514';
  end if;

  -- Attestation exacte du snapshot des faits courants, identique à P1-A4.
  select count(*) into v_count from public.quote_facts
   where case_id = p_case_id and is_current = true;
  if jsonb_array_length(v_run.facts_snapshot) <> v_count then
    raise exception 'SCENARIO_STATE_CHANGED: ensemble des faits courants modifié'
      using errcode = '23514';
  end if;
  for v_fact in select value from jsonb_array_elements(v_run.facts_snapshot) loop
    select * into v_fact_row from public.quote_facts
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
  if (select count(distinct value ->> 'id') from jsonb_array_elements(v_run.facts_snapshot)) <> v_count then
    raise exception 'VALIDATION_FAILED: faits dupliqués dans le snapshot'
      using errcode = '22023';
  end if;

  -- Attestation exacte des hypothèses encore liées et vivantes.
  select count(*) into v_count
    from public.quote_scenario_links l
    join public.quote_scenario_assumptions a on a.id = l.assumption_id
   where l.scenario_id = p_scenario_id and l.assumption_id is not null;
  if jsonb_array_length(v_run.assumptions_snapshot) <> v_count then
    raise exception 'SCENARIO_STATE_CHANGED: ensemble des hypothèses liées modifié'
      using errcode = '23514';
  end if;
  for v_assumption in select value from jsonb_array_elements(v_run.assumptions_snapshot) loop
    select a.* into v_assumption_row
      from public.quote_scenario_assumptions a
      join public.quote_scenario_links l on l.assumption_id = a.id
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
      raise exception 'SCENARIO_STATE_CHANGED: hypothèse % modifiée/non vivante',
        v_assumption ->> 'id' using errcode = '23514';
    end if;
  end loop;
  if (select count(distinct value ->> 'id') from jsonb_array_elements(v_run.assumptions_snapshot)) <> v_count then
    raise exception 'VALIDATION_FAILED: hypothèses dupliquées dans le snapshot'
      using errcode = '22023';
  end if;

  -- Un rejeu ne contourne jamais l'attestation de fraîcheur ci-dessus.
  if v_existing.id is not null then
    return jsonb_build_object(
      'version_id', v_existing.id,
      'version_number', v_existing.version_number,
      'scenario_reference', v_existing.snapshot #>> '{scenario,reference}',
      'qualification', v_existing.snapshot #>> '{meta,quoteQualification,level}',
      'idempotent_replay', true
    );
  end if;

  v_reference := 'SC-' || upper(left(replace(p_scenario_id::text, '-', ''), 8))
    || '-R' || v_scenario.revision_no::text || '-E' || v_run.run_seq::text;

  select et.client_email, et.client_company
    into v_client_email, v_client_company
    from public.quote_cases qc
    left join public.email_threads et on et.id = qc.thread_id
   where qc.id = p_case_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'service_code', coalesce(nullif(line ->> 'service_code', ''), nullif(line ->> 'charge_code', ''), nullif(line ->> 'category', ''), 'LINE_' || ordinality::text),
    'description', coalesce(nullif(line ->> 'description', ''), nullif(line ->> 'charge_name', ''), nullif(line ->> 'label', ''), nullif(line ->> 'category', '')),
    'quantity', case when jsonb_typeof(line -> 'quantity') = 'number' then (line ->> 'quantity')::numeric else 1 end,
    'unit_price', case
      when jsonb_typeof(line -> 'unit_price') = 'number' then (line ->> 'unit_price')::numeric
      when jsonb_typeof(line -> 'unitPrice') = 'number' then (line ->> 'unitPrice')::numeric
      when jsonb_typeof(line -> 'rate') = 'number' then (line ->> 'rate')::numeric
      when jsonb_typeof(line -> 'amount') = 'number' then (line ->> 'amount')::numeric /
        greatest(case when jsonb_typeof(line -> 'quantity') = 'number' then (line ->> 'quantity')::numeric else 1 end, 1)
      else 0 end,
    'amount', case when jsonb_typeof(line -> 'amount') = 'number' then (line ->> 'amount')::numeric else 0 end,
    'currency', coalesce(nullif(line ->> 'currency', ''), v_run.currency),
    'source', coalesce(line -> 'source', 'null'::jsonb),
    'type', coalesce(line -> 'type', 'null'::jsonb),
    'category', coalesce(line -> 'category', 'null'::jsonb),
    'label', coalesce(line -> 'label', 'null'::jsonb),
    'scenario_provenance', coalesce(line -> 'scenario_provenance', '{}'::jsonb)
  ) order by ordinality), '[]'::jsonb)
    into v_lines
    from jsonb_array_elements(v_run.tariff_lines) with ordinality as t(line, ordinality);

  select coalesce(jsonb_agg(jsonb_build_object(
    'service_code', coalesce(nullif(line ->> 'service_code', ''), nullif(line ->> 'category', ''), 'LINE_' || ordinality::text),
    'description', coalesce(nullif(line ->> 'description', ''), nullif(line ->> 'label', ''), nullif(line ->> 'category', ''), 'Élément non chiffré'),
    'reason', case
      when upper(coalesce(line #>> '{source,type}', '')) = 'TO_CONFIRM' or line -> 'amount' = 'null'::jsonb
        then 'À confirmer'
      when coalesce((line #>> '{scenario_provenance,assumption_dependent}')::boolean, false)
        then 'Dépend d''une hypothèse'
      else 'Exclu du socle documenté'
    end
  ) order by ordinality), '[]'::jsonb)
    into v_exclusions
    from jsonb_array_elements(v_run.tariff_lines) with ordinality as t(line, ordinality)
   where upper(coalesce(line #>> '{source,type}', '')) = 'TO_CONFIRM'
      or line -> 'amount' = 'null'::jsonb
      or coalesce((line #>> '{scenario_provenance,firm_eligible}')::boolean, false) = false;

  select coalesce(jsonb_agg(jsonb_build_object(
    'code', coalesce(nullif(item ->> 'code', ''), nullif(item ->> 'reason', ''), 'SCENARIO_RESERVATION'),
    'message', coalesce(nullif(item ->> 'message', ''), nullif(item ->> 'service_key', ''), nullif(item ->> 'open_point_key', ''), 'Élément sous réserve')
  )), '[]'::jsonb)
    into v_reasons
    from jsonb_array_elements(v_run.reservations) item;
  if jsonb_array_length(v_run.assumptions_snapshot) > 0 then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
      'code', 'SCENARIO_ASSUMPTIONS_APPLIED',
      'message', 'Le calcul dépend d''hypothèses opérateur explicites'
    ));
  end if;
  if jsonb_array_length(v_reasons) = 0 then
    v_reasons := jsonb_build_array(jsonb_build_object(
      'code', 'SCENARIO_ESTIMATE_ONLY',
      'message', 'Estimation de scénario volontairement non ferme'
    ));
  end if;

  -- Espace technique négatif séparé, jamais affiché comme numéro de devis.
  -- Le verrou rend aussi deux créations scénario concurrentes déterministes.
  perform pg_advisory_xact_lock(hashtext('qv_insert_' || p_case_id::text));
  select coalesce(min(version_number), 0) - 1 into v_version_number
    from public.quotation_versions
   where case_id = p_case_id
     and source_kind = 'scenario';

  v_snapshot := jsonb_build_object(
    'meta', jsonb_build_object(
      'version_id', v_version_id,
      'version_number', v_version_number,
      'created_at', v_now,
      'source_kind', 'scenario',
      'scenario_pricing_run_id', v_run.id,
      'quoteQualification', jsonb_build_object(
        'level', v_run.qualification,
        'reasons', v_reasons,
        'firmTotalPolicy', 'excludes_reserved_items'
      )
    ),
    'scenario', jsonb_build_object(
      'id', v_scenario.id,
      'root_scenario_id', v_scenario.root_scenario_id,
      'reference', v_reference,
      'title', v_scenario.title,
      'revision_no', v_scenario.revision_no,
      'pricing_run_seq', v_run.run_seq,
      'scope_hash', v_scenario.scope_hash,
      'scope_snapshot', v_scenario.scope_snapshot,
      'open_points', v_scenario.open_points,
      'assumptions', v_run.assumptions_snapshot,
      'reservations', v_run.reservations,
      'exclusions', v_exclusions
    ),
    'inputs', v_run.inputs_json,
    'client', jsonb_build_object('email', v_client_email, 'company', v_client_company),
    'raw_lines', v_run.tariff_lines,
    'lines', v_lines,
    'totals', jsonb_build_object(
      'total_ht', v_run.firm_total_ht,
      'total_ttc', v_run.firm_total_ttc,
      'firm_total_ht', v_run.firm_total_ht,
      'firm_total_ttc', v_run.firm_total_ttc,
      'indicative_total_ht', v_run.indicative_total_ht,
      'indicative_total_ttc', v_run.indicative_total_ttc,
      'currency', v_run.currency,
      'scenario_dual_totals', true
    ),
    'sources', v_run.tariff_sources
  );

  insert into public.quotation_versions (
    id, case_id, pricing_run_id, scenario_pricing_run_id, source_kind,
    version_number, status, is_selected, snapshot, created_by
  ) values (
    v_version_id, p_case_id, null, v_run.id, 'scenario',
    v_version_number, 'draft', false, v_snapshot, p_actor_user_id
  );

  insert into public.quotation_version_lines (
    quotation_version_id, line_order, service_code, description,
    quantity, unit_price, amount, currency, breakdown
  )
  select v_version_id, normalized.ordinality::integer - 1,
         normalized.line ->> 'service_code', normalized.line ->> 'description',
         (normalized.line ->> 'quantity')::numeric, (normalized.line ->> 'unit_price')::numeric,
         (normalized.line ->> 'amount')::numeric, normalized.line ->> 'currency',
         coalesce(raw.line -> 'breakdown', 'null'::jsonb)
    from jsonb_array_elements(v_lines) with ordinality as normalized(line, ordinality)
    left join lateral (
      select value as line
        from jsonb_array_elements(v_run.tariff_lines) with ordinality source(value, source_ordinality)
       where source_ordinality = normalized.ordinality
    ) raw on true;

  insert into public.quote_scenario_output_mutations (
    case_id, scenario_id, scenario_pricing_run_id, quotation_version_id,
    idempotency_key, request_fingerprint, actor_user_id
  ) values (
    p_case_id, p_scenario_id, v_run.id, v_version_id,
    btrim(p_idempotency_key), v_run.request_fingerprint, p_actor_user_id
  );

  insert into public.case_timeline_events (
    case_id, event_type, event_data, actor_type, actor_user_id
  ) values (
    p_case_id, 'output_generated', jsonb_build_object(
      'kind', 'scenario_quotation_version_v1',
      'version_id', v_version_id,
      'scenario_id', p_scenario_id,
      'scenario_pricing_run_id', v_run.id,
      'scenario_reference', v_reference,
      'qualification', v_run.qualification,
      'selected', false,
      'case_status_changed', false
    ), 'user', p_actor_user_id
  );

  return jsonb_build_object(
    'version_id', v_version_id,
    'version_number', v_version_number,
    'scenario_reference', v_reference,
    'qualification', v_run.qualification,
    'idempotent_replay', false
  );
end;
$$;

-- Garde de consommation partagée par PDF et brouillon email. Elle réatteste
-- les faits et hypothèses au moment de CHAQUE lecture : une sortie devenue
-- obsolète n'est donc pas réutilisable, même si son run n'a pas été relancé.
create or replace function public.assert_scenario_quotation_version_current(
  p_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version public.quotation_versions%rowtype;
  v_run public.quote_scenario_pricing_runs%rowtype;
  v_scenario public.quote_scenarios%rowtype;
  v_fact jsonb;
  v_fact_row public.quote_facts%rowtype;
  v_assumption jsonb;
  v_assumption_row public.quote_scenario_assumptions%rowtype;
  v_count integer;
begin
  select * into v_version from public.quotation_versions
   where id = p_version_id and source_kind = 'scenario';
  if not found then
    raise exception 'NOT_FOUND: sortie scénario introuvable' using errcode = '22023';
  end if;
  select * into v_run from public.quote_scenario_pricing_runs
   where id = v_version.scenario_pricing_run_id;
  select * into v_scenario from public.quote_scenarios
   where id = v_run.scenario_id;
  if v_run.id is null or v_scenario.id is null
     or v_run.case_id <> v_version.case_id
     or v_scenario.case_id <> v_version.case_id
     or v_run.status <> 'success'
     or v_run.qualification not in ('provisional','partial')
     or v_run.superseded_by_run_id is not null
     or v_scenario.status in ('blocked','superseded','promoted_to_final')
     or v_scenario.superseded_by_scenario_id is not null
     or v_scenario.scope_hash <> v_run.scenario_scope_hash
     or v_scenario.scope_snapshot is distinct from v_run.scenario_snapshot
     or v_version.snapshot #>> '{scenario,id}' is distinct from v_scenario.id::text
     or v_version.snapshot #>> '{scenario,scope_hash}' is distinct from v_scenario.scope_hash
     or v_version.snapshot #>> '{meta,quoteQualification,level}' is distinct from v_run.qualification
     or not exists (
       select 1 from public.quote_scenario_selections
        where case_id = v_version.case_id and scenario_id = v_scenario.id
          and released_at is null
     ) then
    raise exception 'SCENARIO_OUTPUT_STALE: run/scénario/sélection non courant'
      using errcode = '23514';
  end if;

  select count(*) into v_count from public.quote_facts
   where case_id = v_version.case_id and is_current = true;
  if jsonb_array_length(v_run.facts_snapshot) <> v_count then
    raise exception 'SCENARIO_OUTPUT_STALE: ensemble des faits courants modifié'
      using errcode = '23514';
  end if;
  for v_fact in select value from jsonb_array_elements(v_run.facts_snapshot) loop
    select * into v_fact_row from public.quote_facts
     where id = (v_fact ->> 'id')::uuid
       and case_id = v_version.case_id and is_current = true;
    if not found
       or v_fact ->> 'fact_key' is distinct from v_fact_row.fact_key
       or coalesce(v_fact -> 'value_text', 'null'::jsonb) is distinct from coalesce(to_jsonb(v_fact_row.value_text), 'null'::jsonb)
       or coalesce(v_fact -> 'value_number', 'null'::jsonb) is distinct from coalesce(to_jsonb(v_fact_row.value_number), 'null'::jsonb)
       or coalesce(v_fact -> 'value_json', 'null'::jsonb) is distinct from coalesce(v_fact_row.value_json, 'null'::jsonb)
       or coalesce(v_fact -> 'value_date', 'null'::jsonb) is distinct from coalesce(to_jsonb(v_fact_row.value_date), 'null'::jsonb)
       or coalesce(v_fact -> 'source_type', 'null'::jsonb) is distinct from coalesce(to_jsonb(v_fact_row.source_type), 'null'::jsonb)
       or coalesce(v_fact -> 'confidence', 'null'::jsonb) is distinct from coalesce(to_jsonb(v_fact_row.confidence), 'null'::jsonb) then
      raise exception 'SCENARIO_OUTPUT_STALE: fait courant modifié'
        using errcode = '23514';
    end if;
  end loop;
  if (select count(distinct value ->> 'id') from jsonb_array_elements(v_run.facts_snapshot)) <> v_count then
    raise exception 'SCENARIO_OUTPUT_STALE: snapshot de faits dupliqué'
      using errcode = '23514';
  end if;

  select count(*) into v_count
    from public.quote_scenario_links l
    join public.quote_scenario_assumptions a on a.id = l.assumption_id
   where l.scenario_id = v_scenario.id and l.assumption_id is not null;
  if jsonb_array_length(v_run.assumptions_snapshot) <> v_count then
    raise exception 'SCENARIO_OUTPUT_STALE: ensemble des hypothèses liées modifié'
      using errcode = '23514';
  end if;
  for v_assumption in select value from jsonb_array_elements(v_run.assumptions_snapshot) loop
    select a.* into v_assumption_row
      from public.quote_scenario_assumptions a
      join public.quote_scenario_links l on l.assumption_id = a.id
     where a.id = (v_assumption ->> 'id')::uuid
       and a.case_id = v_version.case_id and l.scenario_id = v_scenario.id;
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
      raise exception 'SCENARIO_OUTPUT_STALE: hypothèse liée modifiée/non vivante'
        using errcode = '23514';
    end if;
  end loop;
  if (select count(distinct value ->> 'id') from jsonb_array_elements(v_run.assumptions_snapshot)) <> v_count then
    raise exception 'SCENARIO_OUTPUT_STALE: snapshot d''hypothèses dupliqué'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'case_id', v_version.case_id,
    'scenario_id', v_scenario.id,
    'scenario_pricing_run_id', v_run.id,
    'scenario_reference', v_version.snapshot #>> '{scenario,reference}',
    'qualification', v_run.qualification,
    'current', true
  );
end;
$$;

revoke all on function public.create_scenario_quotation_version(
  uuid, uuid, uuid, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.create_scenario_quotation_version(
  uuid, uuid, uuid, text, text, uuid
) to service_role;

revoke all on function public.assert_scenario_quotation_version_current(uuid)
  from public, anon, authenticated;
grant execute on function public.assert_scenario_quotation_version_current(uuid)
  to service_role;

revoke all on function public.quotation_version_source_invariants()
  from public, anon, authenticated;
revoke all on function public.quote_scenario_output_mutation_invariants()
  from public, anon, authenticated;

comment on column public.quotation_versions.source_kind is
  'canonical = devis sélectionnable ; scenario = sortie de travail P1-A5 non sélectionnable et non ferme.';
comment on function public.create_scenario_quotation_version(uuid, uuid, uuid, text, text, uuid) is
  'P1-A5 : crée atomiquement une sortie scénario immuable, sans état dossier, facts ou pricing canonique.';
