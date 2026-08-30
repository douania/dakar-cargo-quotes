-- P1-B1 — registre humain des propositions de frais maritimes.
--
-- Invariants :
--   * APPEND-ONLY : chaque confirmation, ajustement, rejet ou révocation crée
--     une nouvelle version ; aucune ligne n'est mise à jour ;
--   * aucun effet pricing dans ce lot : aucune FK vers pricing_runs,
--     quotation_versions ou quote_service_pricing ;
--   * écriture exclusivement par la RPC service_role ; lecture exclusivement
--     par l'Edge Function après preuve d'accès RLS au dossier ;
--   * montants entiers XOF uniquement ; une confirmation reprend exactement la
--     suggestion, un ajustement porte un montant humain explicite ;
--   * idempotence forte : même clé + empreinte différente est refusé ;
--   * la suppression reste possible uniquement par cascade du dossier ou par
--     service_role pour le nettoyage sandbox. Les UPDATE sont interdits même au
--     service_role.

create table public.maritime_fee_decisions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.quote_cases(id) on delete cascade,
  decision_key text not null
    constraint maritime_fee_decisions_key_shape
      check (decision_key ~ '^[A-Z0-9][A-Z0-9:_-]{1,127}$'),
  proposal_id text not null
    constraint maritime_fee_decisions_proposal_id_length
      check (length(btrim(proposal_id)) between 2 and 100),
  proposal_category text not null
    constraint maritime_fee_decisions_category
      check (proposal_category in ('taxe_de_port', 'commission_debours')),
  decision_action text not null
    constraint maritime_fee_decisions_action
      check (decision_action in ('confirm', 'adjust', 'reject', 'revoke')),
  suggested_amount_xof bigint,
  decided_amount_xof bigint,
  currency text not null default 'XOF'
    constraint maritime_fee_decisions_currency check (currency = 'XOF'),
  evidence_level text not null
    constraint maritime_fee_decisions_evidence
      check (evidence_level in ('official', 'validated_internal', 'to_confirm')),
  source_reference text not null
    constraint maritime_fee_decisions_source_reference_length
      check (length(btrim(source_reference)) between 3 and 2000),
  decision_source text not null
    constraint maritime_fee_decisions_decision_source_length
      check (length(btrim(decision_source)) between 3 and 500),
  justification text not null
    constraint maritime_fee_decisions_justification_length
      check (length(btrim(justification)) between 3 and 2000),
  proposal_fingerprint text not null
    constraint maritime_fee_decisions_proposal_fingerprint
      check (proposal_fingerprint ~ '^[0-9a-f]{64}$'),
  input_snapshot_hash text not null
    constraint maritime_fee_decisions_input_snapshot_hash
      check (input_snapshot_hash ~ '^[0-9a-f]{64}$'),
  proposal_snapshot jsonb not null
    constraint maritime_fee_decisions_snapshot_object
      check (jsonb_typeof(proposal_snapshot) = 'object'),
  decision_version integer not null
    constraint maritime_fee_decisions_version_positive check (decision_version > 0),
  supersedes_id uuid,
  idempotency_key text not null
    constraint maritime_fee_decisions_idempotency_length
      check (length(btrim(idempotency_key)) between 8 and 128),
  request_fingerprint text not null
    constraint maritime_fee_decisions_request_fingerprint
      check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  decided_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),

  constraint maritime_fee_decisions_amount_bounds check (
    (suggested_amount_xof is null or suggested_amount_xof between 1 and 999999999999)
    and (decided_amount_xof is null or decided_amount_xof between 1 and 999999999999)
  ),
  constraint maritime_fee_decisions_action_amount check (
    (decision_action = 'confirm'
      and suggested_amount_xof is not null
      and decided_amount_xof is not null
      and decided_amount_xof = suggested_amount_xof)
    or (decision_action = 'adjust' and decided_amount_xof is not null)
    or (decision_action in ('reject', 'revoke') and decided_amount_xof is null)
  ),
  constraint maritime_fee_decisions_snapshot_identity check (
    proposal_snapshot ->> 'decision_key' is not null
    and proposal_snapshot ->> 'decision_key' = decision_key
    and proposal_snapshot #>> '{proposal,id}' is not null
    and proposal_snapshot #>> '{proposal,id}' = proposal_id
    and proposal_snapshot #>> '{proposal,category}' is not null
    and proposal_snapshot #>> '{proposal,category}' = proposal_category
    and proposal_snapshot #>> '{proposal,currency}' is not null
    and proposal_snapshot #>> '{proposal,currency}' = currency
    and proposal_snapshot #> '{proposal,amount}' is not null
    and proposal_snapshot #> '{proposal,amount}' = 'null'::jsonb
  ),
  constraint maritime_fee_decisions_case_id_id_unique unique (case_id, id),
  constraint maritime_fee_decisions_case_version_unique
    unique (case_id, decision_key, decision_version),
  constraint maritime_fee_decisions_idempotency_unique
    unique (case_id, idempotency_key),
  constraint maritime_fee_decisions_supersedes_same_case
    foreign key (case_id, supersedes_id)
      references public.maritime_fee_decisions(case_id, id)
      on delete cascade
);

create index maritime_fee_decisions_current_idx
  on public.maritime_fee_decisions (case_id, decision_key, decision_version desc);

alter table public.maritime_fee_decisions enable row level security;
revoke all on table public.maritime_fee_decisions from public, anon, authenticated;
grant all on table public.maritime_fee_decisions to service_role;

create or replace function public.prevent_maritime_fee_decision_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'IMMUTABLE_MARITIME_FEE_DECISION: les décisions sont append-only'
    using errcode = '55000';
end;
$$;

create trigger maritime_fee_decisions_no_update
before update on public.maritime_fee_decisions
for each row execute function public.prevent_maritime_fee_decision_update();

revoke all on function public.prevent_maritime_fee_decision_update() from public, anon, authenticated;

-- Lecture minimale dédiée : le reset canonique ne donne pas de GRANT SELECT
-- service_role sur quote_cases. Cette RPC évite tout élargissement global et ne
-- retourne que request_type + les quatre colonnes de faits consommées par le
-- moteur. L'Edge Function doit prouver read/write access sous le JWT appelant
-- avant de l'invoquer.
create or replace function public.read_maritime_fee_case_context(p_case_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'request_type', qc.request_type,
    'facts', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'fact_key', qf.fact_key,
          'value_text', qf.value_text,
          'value_number', qf.value_number,
          'value_json', qf.value_json
        ) order by qf.fact_key
      ) filter (where qf.id is not null),
      '[]'::jsonb
    )
  )
  from public.quote_cases qc
  left join public.quote_facts qf
    on qf.case_id = qc.id and qf.is_current = true
  where qc.id = p_case_id
  group by qc.id, qc.request_type;
$$;

revoke all on function public.read_maritime_fee_case_context(uuid)
  from public, anon, authenticated;
grant execute on function public.read_maritime_fee_case_context(uuid)
  to service_role;

create or replace function public.record_maritime_fee_decision(
  p_case_id uuid,
  p_decision_key text,
  p_proposal_id text,
  p_proposal_category text,
  p_decision_action text,
  p_suggested_amount_xof bigint,
  p_decided_amount_xof bigint,
  p_currency text,
  p_evidence_level text,
  p_source_reference text,
  p_decision_source text,
  p_justification text,
  p_proposal_fingerprint text,
  p_input_snapshot_hash text,
  p_proposal_snapshot jsonb,
  p_expected_decision_version integer,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := upper(btrim(coalesce(p_decision_key, '')));
  v_idempotency_key text := btrim(coalesce(p_idempotency_key, ''));
  v_source_reference text := btrim(coalesce(p_source_reference, ''));
  v_decision_source text := btrim(coalesce(p_decision_source, ''));
  v_justification text := btrim(coalesce(p_justification, ''));
  v_previous public.maritime_fee_decisions%rowtype;
  v_replay public.maritime_fee_decisions%rowtype;
  v_created public.maritime_fee_decisions%rowtype;
  v_version integer;
  v_missing jsonb;
begin
  if p_case_id is null or p_actor_user_id is null then
    raise exception 'VALIDATION_FAILED: case_id et actor_user_id sont obligatoires' using errcode = '22023';
  end if;
  if v_key !~ '^[A-Z0-9][A-Z0-9:_-]{1,127}$' then
    raise exception 'VALIDATION_FAILED: decision_key invalide' using errcode = '22023';
  end if;
  if p_decision_action not in ('confirm', 'adjust', 'reject', 'revoke') then
    raise exception 'VALIDATION_FAILED: decision_action invalide' using errcode = '22023';
  end if;
  if length(v_idempotency_key) not between 8 and 128 then
    raise exception 'VALIDATION_FAILED: idempotency_key invalide' using errcode = '22023';
  end if;
  if p_request_fingerprint is null or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION_FAILED: request_fingerprint invalide' using errcode = '22023';
  end if;
  if length(v_decision_source) not between 3 and 500
     or length(v_justification) not between 3 and 2000 then
    raise exception 'VALIDATION_FAILED: source ou justification invalide' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('maritime_fee_' || p_case_id::text || ':' || v_key));

  select * into v_replay
    from public.maritime_fee_decisions
   where case_id = p_case_id and idempotency_key = v_idempotency_key;
  if found then
    if v_replay.request_fingerprint is distinct from p_request_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT: même clé, contenu différent' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'decision', to_jsonb(v_replay),
      'idempotent_replay', true
    );
  end if;

  select * into v_previous
    from public.maritime_fee_decisions
   where case_id = p_case_id and decision_key = v_key
   order by decision_version desc
   limit 1;

  if p_decision_action = 'revoke' then
    if v_previous.id is null then
      raise exception 'DECISION_NOT_FOUND: aucune décision à révoquer' using errcode = 'P0002';
    end if;
    if p_expected_decision_version is null
       or p_expected_decision_version <> v_previous.decision_version then
      raise exception 'STALE_DECISION: version courante différente' using errcode = '40001';
    end if;
    if v_previous.decision_action not in ('confirm', 'adjust', 'reject') then
      raise exception 'INVALID_STATE: seules une confirmation, un ajustement ou un rejet peuvent être révoqués' using errcode = '55000';
    end if;

    p_proposal_id := v_previous.proposal_id;
    p_proposal_category := v_previous.proposal_category;
    p_suggested_amount_xof := v_previous.suggested_amount_xof;
    p_decided_amount_xof := null;
    p_currency := v_previous.currency;
    p_evidence_level := v_previous.evidence_level;
    v_source_reference := v_previous.source_reference;
    p_proposal_fingerprint := v_previous.proposal_fingerprint;
    p_input_snapshot_hash := v_previous.input_snapshot_hash;
    p_proposal_snapshot := v_previous.proposal_snapshot;
  else
    if p_expected_decision_version is not null then
      raise exception 'VALIDATION_FAILED: expected_decision_version réservé à revoke' using errcode = '22023';
    end if;
    if p_proposal_id is null or length(btrim(p_proposal_id)) not between 2 and 100
       or p_proposal_category not in ('taxe_de_port', 'commission_debours')
       or p_currency <> 'XOF'
       or p_evidence_level not in ('official', 'validated_internal', 'to_confirm')
       or length(v_source_reference) not between 3 and 2000
       or p_proposal_fingerprint is null or p_proposal_fingerprint !~ '^[0-9a-f]{64}$'
       or p_input_snapshot_hash is null or p_input_snapshot_hash !~ '^[0-9a-f]{64}$'
       or jsonb_typeof(p_proposal_snapshot) <> 'object'
       or p_proposal_snapshot ->> 'decision_key' is distinct from v_key
       or p_proposal_snapshot #>> '{proposal,id}' is distinct from p_proposal_id
       or p_proposal_snapshot #>> '{proposal,category}' is distinct from p_proposal_category
       or p_proposal_snapshot #>> '{proposal,currency}' is distinct from p_currency
       or p_proposal_snapshot #> '{proposal,amount}' is distinct from 'null'::jsonb then
      raise exception 'VALIDATION_FAILED: snapshot de proposition incohérent' using errcode = '22023';
    end if;

    if p_decision_action in ('confirm', 'adjust') then
      v_missing := p_proposal_snapshot #> '{proposal,missing_confirmation}';
      if jsonb_typeof(v_missing) <> 'array'
         or jsonb_array_length(v_missing) <> 0
         or p_evidence_level not in ('official', 'validated_internal')
         or p_suggested_amount_xof is null or p_suggested_amount_xof <= 0 then
        raise exception 'PROPOSAL_NOT_CONFIRMABLE: proposition incomplète ou preuve insuffisante' using errcode = '55000';
      end if;
    end if;

    if p_decision_action = 'confirm'
       and p_decided_amount_xof is distinct from p_suggested_amount_xof then
      raise exception 'VALIDATION_FAILED: confirm doit reprendre la suggestion exacte' using errcode = '22023';
    elsif p_decision_action = 'adjust'
       and (p_decided_amount_xof is null or p_decided_amount_xof <= 0) then
      raise exception 'VALIDATION_FAILED: adjust exige un montant positif' using errcode = '22023';
    elsif p_decision_action = 'reject' and p_decided_amount_xof is not null then
      raise exception 'VALIDATION_FAILED: reject ne porte aucun montant' using errcode = '22023';
    end if;
  end if;

  v_version := coalesce(v_previous.decision_version, 0) + 1;

  insert into public.maritime_fee_decisions (
    case_id, decision_key, proposal_id, proposal_category, decision_action,
    suggested_amount_xof, decided_amount_xof, currency, evidence_level,
    source_reference, decision_source, justification, proposal_fingerprint,
    input_snapshot_hash, proposal_snapshot, decision_version, supersedes_id,
    idempotency_key, request_fingerprint, decided_by
  ) values (
    p_case_id, v_key, btrim(p_proposal_id), p_proposal_category, p_decision_action,
    p_suggested_amount_xof, p_decided_amount_xof, p_currency, p_evidence_level,
    v_source_reference, v_decision_source, v_justification, p_proposal_fingerprint,
    p_input_snapshot_hash, p_proposal_snapshot, v_version, v_previous.id,
    v_idempotency_key, p_request_fingerprint, p_actor_user_id
  ) returning * into v_created;

  return jsonb_build_object(
    'decision', to_jsonb(v_created),
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.record_maritime_fee_decision(
  uuid, text, text, text, text, bigint, bigint, text, text, text, text, text,
  text, text, jsonb, integer, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.record_maritime_fee_decision(
  uuid, text, text, text, text, bigint, bigint, text, text, text, text, text,
  text, text, jsonb, integer, text, text, uuid
) to service_role;

comment on table public.maritime_fee_decisions is
  'P1-B1. Registre APPEND-ONLY des décisions humaines sur propositions maritimes. Aucun effet pricing dans ce lot. Accès Edge/service_role uniquement.';
comment on column public.maritime_fee_decisions.decided_amount_xof is
  'Montant humain entier XOF. NULL pour reject/revoke. Non consommé par le pricing avant P1-B2.';
comment on column public.maritime_fee_decisions.proposal_fingerprint is
  'SHA-256 serveur du snapshot de proposition. Une décision obsolète reste historique mais ne doit jamais être consommée.';

do $$
begin
  assert not has_table_privilege('anon', 'public.maritime_fee_decisions', 'SELECT'),
    'P1-B1: anon ne doit pas lire le registre';
  assert not has_table_privilege('authenticated', 'public.maritime_fee_decisions', 'SELECT'),
    'P1-B1: authenticated ne doit pas contourner l Edge Function';
  assert not has_table_privilege('authenticated', 'public.maritime_fee_decisions', 'INSERT'),
    'P1-B1: authenticated ne doit pas écrire directement';
  assert has_table_privilege('service_role', 'public.maritime_fee_decisions', 'SELECT'),
    'P1-B1: service_role doit pouvoir relire le registre';
  assert has_function_privilege(
    'service_role',
    'public.record_maritime_fee_decision(uuid,text,text,text,text,bigint,bigint,text,text,text,text,text,text,text,jsonb,integer,text,text,uuid)',
    'EXECUTE'
  ), 'P1-B1: RPC non exécutable par service_role';
  assert not has_function_privilege(
    'authenticated',
    'public.record_maritime_fee_decision(uuid,text,text,text,text,bigint,bigint,text,text,text,text,text,text,text,jsonb,integer,text,text,uuid)',
    'EXECUTE'
  ), 'P1-B1: RPC exposée à authenticated';
  assert has_function_privilege(
    'service_role', 'public.read_maritime_fee_case_context(uuid)', 'EXECUTE'
  ), 'P1-B1: lecteur minimal non exécutable par service_role';
  assert not has_function_privilege(
    'authenticated', 'public.read_maritime_fee_case_context(uuid)', 'EXECUTE'
  ), 'P1-B1: lecteur minimal exposé à authenticated';
end;
$$;
