-- Phase P1-A1 — Durcissement du ledger public.quote_scenario_assumptions
-- + RPC atomique service_role-only public.manage_scenario_assumption.
--
-- PORTÉE STRICTE
--   * tables touchées : public.quote_scenario_assumptions (durcie) et
--     public.quote_scenario_assumption_mutations (nouveau registre append-only
--     d'idempotence) ;
--   * aucune écriture dans quote_facts / quote_request_lines / quotation_versions ;
--   * aucun calcul de prix, aucun total, aucune donnée tarifaire ;
--   * AUCUNE promotion vers quote_facts : la RPC rejette explicitement toute
--     demande de promotion (arbitrage CTO n°3 : PAD/HS/droits/taxes/coûts
--     partenaires passent par leurs workflows dédiés) ;
--   * aucun objet « scénario », aucun snapshot de périmètre (P1-A2/A3/A4).
--
-- ADDITIVE ET NON DESTRUCTIVE
--   * aucune colonne supprimée, aucune donnée réécrite, aucun DELETE ;
--   * les anciennes colonnes (superseded_by_assumption_id, promoted_fact_id,
--     source_refs, metadata…) sont conservées et restent lisibles ;
--   * les nouvelles colonnes sont ajoutées NULLABLE, puis un PRÉFLIGHT
--     FAIL-CLOSED refuse d'installer les invariants si des lignes historiques
--     ne peuvent pas les satisfaire — la migration s'arrête avec le compte exact
--     au lieu d'affaiblir l'invariant ou de fabriquer une valeur métier.
--
-- IDEMPOTENCE : chaque bloc est gardé (IF NOT EXISTS / pg_constraint /
-- pg_policies / attnotnull), la migration peut être rejouée sans effet de bord.

-- =====================================================================
-- 1. Colonnes additives
-- =====================================================================

-- Valeur d'hypothèse EXPLICITEMENT TYPÉE, en EXACTEMENT UNE représentation :
-- un unique jsonb + son type déclaré. Pas de triplet value_text/value_number/
-- value_json, donc aucune ambiguïté possible pour un lecteur.
alter table public.quote_scenario_assumptions
  add column if not exists assumed_value_type text;
alter table public.quote_scenario_assumptions
  add column if not exists assumed_value jsonb;

-- Lien ARRIÈRE de supersession : la nouvelle révision pointe vers la
-- précédente. C'est le lien faisant autorité ; superseded_by_assumption_id
-- (lien avant historique) reste maintenu en miroir pour compatibilité de lecture.
alter table public.quote_scenario_assumptions
  add column if not exists supersedes_assumption_id uuid;

-- =====================================================================
-- 2. PRÉFLIGHT FAIL-CLOSED
--    Compte les lignes qui ne peuvent PAS satisfaire les invariants P1-A1.
--    Sur une table vide (état audité) : 0 → la migration continue.
--    Sur un rejeu après installation : 0 → idempotent.
--    Sur des lignes historiques incompatibles : EXCEPTION avec le détail exact.
-- =====================================================================
do $preflight$
declare
  v_no_value    bigint;
  v_no_creator  bigint;
  v_no_resolver bigint;
  v_bad_scope   bigint;
begin
  select count(*) into v_no_value
    from public.quote_scenario_assumptions
   where assumed_value_type is null or assumed_value is null;

  select count(*) into v_no_creator
    from public.quote_scenario_assumptions
   where created_by is null;

  select count(*) into v_no_resolver
    from public.quote_scenario_assumptions
   where status <> 'active' and resolved_by is null;

  select count(*) into v_bad_scope
    from public.quote_scenario_assumptions
   where scope_key is null
      or length(scope_key) > 120
      or scope_key !~ '^[a-z][a-z0-9_]*(:[A-Za-z0-9._-]{1,64})?$'
      or scope_key ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

  if (v_no_value + v_no_creator + v_no_resolver + v_bad_scope) > 0 then
    raise exception using
      errcode = '23514',
      message = 'P1-A1 PREFLIGHT FAIL-CLOSED — des lignes historiques de quote_scenario_assumptions ne peuvent pas satisfaire les invariants.',
      detail  = format(
        'sans valeur typée: %s | sans created_by: %s | terminales sans resolved_by: %s | scope_key non conforme: %s',
        v_no_value, v_no_creator, v_no_resolver, v_bad_scope),
      hint    = 'Backfill métier explicite requis AVANT rejeu. Ne pas relâcher les contraintes, ne pas fabriquer de valeur métier.';
  end if;
end
$preflight$;

-- =====================================================================
-- 3. Invariants de colonne
-- =====================================================================

-- created_by obligatoire (identité fixée côté serveur par la RPC).
do $$
begin
  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.quote_scenario_assumptions'::regclass
      and attname = 'created_by' and attnum > 0 and not attisdropped and not attnotnull
  ) then
    alter table public.quote_scenario_assumptions alter column created_by set not null;
  end if;
end $$;

-- client_visible FAIL-CLOSED par défaut (était `true` = fail-open).
-- Ne réécrit AUCUNE ligne existante : seul le DEFAULT change.
alter table public.quote_scenario_assumptions
  alter column client_visible set default false;

-- =====================================================================
-- 4. Contraintes CHECK additives
-- =====================================================================

do $$
begin
  -- Valeur obligatoire et appariée : exactement une représentation.
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.quote_scenario_assumptions'::regclass
                   and conname = 'quote_scenario_assumptions_value_required') then
    alter table public.quote_scenario_assumptions
      add constraint quote_scenario_assumptions_value_required
      check (assumed_value_type is not null and assumed_value is not null);
  end if;

  -- Vocabulaire de type fermé.
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.quote_scenario_assumptions'::regclass
                   and conname = 'quote_scenario_assumptions_value_type_check') then
    alter table public.quote_scenario_assumptions
      add constraint quote_scenario_assumptions_value_type_check
      check (assumed_value_type in ('text','number','boolean','date','json'));
  end if;

  -- Cohérence type déclaré ↔ forme jsonb réellement stockée.
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.quote_scenario_assumptions'::regclass
                   and conname = 'quote_scenario_assumptions_value_typed') then
    alter table public.quote_scenario_assumptions
      add constraint quote_scenario_assumptions_value_typed
      check (
        (assumed_value_type = 'text'
           and jsonb_typeof(assumed_value) = 'string'
           and btrim(assumed_value #>> '{}') <> '')
        or (assumed_value_type = 'number'  and jsonb_typeof(assumed_value) = 'number')
        or (assumed_value_type = 'boolean' and jsonb_typeof(assumed_value) = 'boolean')
        or (assumed_value_type = 'date'
           and jsonb_typeof(assumed_value) = 'string'
           and (assumed_value #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
           -- Le cast rejette aussi les dates calendaires impossibles
           -- (ex. 2026-02-30), même si la RPC est appelée directement.
           and to_char((assumed_value #>> '{}')::date, 'YYYY-MM-DD') = (assumed_value #>> '{}'))
        or (assumed_value_type = 'json'    and jsonb_typeof(assumed_value) in ('object','array'))
      );
  end if;

  -- Toute ligne non active a un résolveur identifié (audit des transitions).
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.quote_scenario_assumptions'::regclass
                   and conname = 'quote_scenario_assumptions_terminal_resolved_by') then
    alter table public.quote_scenario_assumptions
      add constraint quote_scenario_assumptions_terminal_resolved_by
      check (status = 'active' or resolved_by is not null);
  end if;

  -- scope_key discipliné : vocabulaire borné, longueur bornée, et JAMAIS un
  -- identifiant technique. Arbitrage CTO n°4 : le périmètre d'un scénario sera
  -- un snapshot immuable + hash, jamais un id quote_request_lines — on interdit
  -- donc dès maintenant qu'un UUID soit encodé dans scope_key.
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.quote_scenario_assumptions'::regclass
                   and conname = 'quote_scenario_assumptions_scope_key_format') then
    alter table public.quote_scenario_assumptions
      add constraint quote_scenario_assumptions_scope_key_format
      check (
        length(scope_key) <= 120
        and scope_key ~ '^[a-z][a-z0-9_]*(:[A-Za-z0-9._-]{1,64})?$'
        and scope_key !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      );
  end if;

  -- Pas d'auto-supersession sur le lien arrière.
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.quote_scenario_assumptions'::regclass
                   and conname = 'quote_scenario_assumptions_no_self_supersedes') then
    alter table public.quote_scenario_assumptions
      add constraint quote_scenario_assumptions_no_self_supersedes
      check (supersedes_assumption_id is null or supersedes_assumption_id <> id);
  end if;
end $$;

-- =====================================================================
-- 5. Clés étrangères de supersession
--    Le lien AVANT existant est recréé DEFERRABLE : une révision doit pouvoir,
--    dans UNE seule transaction, (a) sortir l'ancienne ligne de 'active' —
--    ce qui exige déjà son superseded_by_assumption_id d'après le CHECK de
--    20260624120000 — puis (b) insérer la nouvelle ligne active sans violer
--    l'index unique partiel. Sans report, cette séquence est impossible :
--    c'est exactement la « dépendance circulaire empêchant une transaction
--    sûre » à éliminer. La contrainte reste INITIALLY IMMEDIATE : seule la RPC
--    la reporte explicitement, et elle est TOUJOURS vérifiée au commit.
-- =====================================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.quote_scenario_assumptions'::regclass
      and conname = 'quote_scenario_assumptions_superseded_by_assumption_id_fkey'
      and condeferrable
  ) then
    alter table public.quote_scenario_assumptions
      drop constraint if exists quote_scenario_assumptions_superseded_by_assumption_id_fkey;
    alter table public.quote_scenario_assumptions
      add constraint quote_scenario_assumptions_superseded_by_assumption_id_fkey
      foreign key (superseded_by_assumption_id)
      references public.quote_scenario_assumptions(id)
      deferrable initially immediate;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.quote_scenario_assumptions'::regclass
      and conname = 'quote_scenario_assumptions_supersedes_assumption_id_fkey'
  ) then
    alter table public.quote_scenario_assumptions
      add constraint quote_scenario_assumptions_supersedes_assumption_id_fkey
      foreign key (supersedes_assumption_id)
      references public.quote_scenario_assumptions(id);
  end if;
end $$;

-- Chaîne de révision : remonter l'historique par le lien arrière.
create index if not exists idx_quote_scenario_assumptions_supersedes
  on public.quote_scenario_assumptions (supersedes_assumption_id)
  where supersedes_assumption_id is not null;

-- =====================================================================
-- 6. Registre d'idempotence APPEND-ONLY
--    L'idempotence est une propriété de la REQUÊTE, pas de la ligne mutée :
--    une même hypothèse subit plusieurs mutations (create → revise → confirm),
--    donc une estampille portée par la ligne serait écrasée et un rejeu tardif
--    du `create` recréerait un doublon. Ce registre conserve chaque requête.
-- =====================================================================
create table if not exists public.quote_scenario_assumption_mutations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.quote_cases(id) on delete cascade,
  assumption_id uuid not null references public.quote_scenario_assumptions(id),
  operation text not null
    constraint quote_scenario_assumption_mutations_operation_check
      check (operation in ('create','revise','confirm_client','refute')),
  result_status text not null
    constraint quote_scenario_assumption_mutations_result_status_check
      check (result_status in ('active','client_confirmed','refuted')),
  idempotency_key text not null
    constraint quote_scenario_assumption_mutations_key_len
      check (length(idempotency_key) between 8 and 128),
  request_fingerprint text not null
    constraint quote_scenario_assumption_mutations_fingerprint_sha256
      check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid not null,
  created_at timestamptz not null default now()
);

-- Idempotence forte : une clé ne désigne qu'une seule requête par dossier.
create unique index if not exists uq_quote_scenario_assumption_mutations_idem
  on public.quote_scenario_assumption_mutations (case_id, idempotency_key);

create index if not exists idx_quote_scenario_assumption_mutations_assumption
  on public.quote_scenario_assumption_mutations (assumption_id);

-- Registre d'audit interne : aucun accès Data API. RLS activée SANS policy
-- (deny-all pour anon/authenticated) et aucun GRANT hors service_role.
alter table public.quote_scenario_assumption_mutations enable row level security;

-- =====================================================================
-- 7. Garde anti-liaison inter-dossiers (défense en profondeur)
--    Aucun CHECK ne peut interroger une autre table : c'est un trigger.
--    Il valide que gap, fait référencé et hypothèses liées appartiennent AU
--    MÊME case_id. Il ne vérifie PAS l'existence — la référence manquante est
--    déjà couverte par les FK (y compris celle reportée au commit, qui rend la
--    ligne successeur temporairement invisible pendant une révision).
-- =====================================================================
create or replace function public.quote_scenario_assumptions_enforce_same_case()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case uuid;
begin
  if new.client_gap_request_id is not null then
    select case_id into v_case from client_gap_requests where id = new.client_gap_request_id;
    if v_case is not null and v_case <> new.case_id then
      raise exception 'FORBIDDEN_CROSS_CASE: client_gap_request % appartient au dossier %, pas au dossier %',
        new.client_gap_request_id, v_case, new.case_id using errcode = '23514';
    end if;
  end if;

  if new.promoted_fact_id is not null then
    select case_id into v_case from quote_facts where id = new.promoted_fact_id;
    if v_case is not null and v_case <> new.case_id then
      raise exception 'FORBIDDEN_CROSS_CASE: quote_fact % appartient au dossier %, pas au dossier %',
        new.promoted_fact_id, v_case, new.case_id using errcode = '23514';
    end if;
  end if;

  if new.supersedes_assumption_id is not null then
    select case_id into v_case from quote_scenario_assumptions where id = new.supersedes_assumption_id;
    if v_case is not null and v_case <> new.case_id then
      raise exception 'FORBIDDEN_CROSS_CASE: hypothèse supersédée % appartient au dossier %, pas au dossier %',
        new.supersedes_assumption_id, v_case, new.case_id using errcode = '23514';
    end if;
  end if;

  if new.superseded_by_assumption_id is not null then
    select case_id into v_case from quote_scenario_assumptions where id = new.superseded_by_assumption_id;
    if v_case is not null and v_case <> new.case_id then
      raise exception 'FORBIDDEN_CROSS_CASE: hypothèse successeur % appartient au dossier %, pas au dossier %',
        new.superseded_by_assumption_id, v_case, new.case_id using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'quote_scenario_assumptions_same_case'
      and tgrelid = 'public.quote_scenario_assumptions'::regclass
  ) then
    create trigger quote_scenario_assumptions_same_case
      before insert or update on public.quote_scenario_assumptions
      for each row execute function public.quote_scenario_assumptions_enforce_same_case();
  end if;
end $$;

-- Même garde pour le registre : une mutation ne peut pas rattacher un dossier
-- à l'hypothèse d'un autre dossier.
create or replace function public.quote_scenario_assumption_mutations_enforce_same_case()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case uuid;
begin
  select case_id into v_case from quote_scenario_assumptions where id = new.assumption_id;
  if v_case is not null and v_case <> new.case_id then
    raise exception 'FORBIDDEN_CROSS_CASE: hypothèse % appartient au dossier %, pas au dossier %',
      new.assumption_id, v_case, new.case_id using errcode = '23514';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'quote_scenario_assumption_mutations_same_case'
      and tgrelid = 'public.quote_scenario_assumption_mutations'::regclass
  ) then
    create trigger quote_scenario_assumption_mutations_same_case
      before insert or update on public.quote_scenario_assumption_mutations
      for each row execute function public.quote_scenario_assumption_mutations_enforce_same_case();
  end if;
end $$;

-- =====================================================================
-- 8. RPC ATOMIQUE — seule voie de mutation
--    Opérations autorisées en P1-A1 : create | revise | confirm_client | refute.
--    Toute demande de promotion est REJETÉE explicitement.
--    Codes d'erreur en préfixe stable, consommés par l'Edge Function.
-- =====================================================================
create or replace function public.manage_scenario_assumption(
  p_case_id uuid,
  p_operation text,
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_assumption_id uuid default null,
  p_scope_key text default 'case',
  p_assumption_type text default null,
  p_assumed_fact_key text default null,
  p_gap_key text default null,
  p_client_gap_request_id uuid default null,
  p_statement text default null,
  p_basis text default null,
  p_source_type text default null,
  p_source_refs jsonb default null,
  p_assumed_value_type text default null,
  p_assumed_value jsonb default null,
  p_client_visible boolean default null,
  p_risk_level text default null,
  p_metadata jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_replay        public.quote_scenario_assumption_mutations%rowtype;
  v_target        public.quote_scenario_assumptions%rowtype;
  v_key           text;
  v_result_id     uuid;
  v_result_status text;
  v_scope_key     text;
  v_supersedes    uuid := null;
  v_case_exists   boolean;
  v_actor_exists  boolean;
begin
  -- ── 0. Promotion : refus explicite et non contournable ──────────────
  -- P1-A1 n'écrit JAMAIS dans quote_facts. PAD/HS/droits/taxes/coûts
  -- partenaires relèvent de leurs workflows dédiés (arbitrage CTO n°3).
  if p_operation in ('promote', 'promote_to_fact', 'promote_to_facts', 'promotion') then
    raise exception 'PROMOTION_NOT_ALLOWED: la promotion d''une hypothèse vers quote_facts est hors périmètre P1-A1'
      using errcode = '22023';
  end if;

  if p_operation is null or p_operation not in ('create', 'revise', 'confirm_client', 'refute') then
    raise exception 'VALIDATION_FAILED: opération invalide (%). Autorisées: create, revise, confirm_client, refute', p_operation
      using errcode = '22023';
  end if;

  -- ── 1. Identité et dossier ──────────────────────────────────────────
  if p_case_id is null then
    raise exception 'VALIDATION_FAILED: p_case_id est obligatoire' using errcode = '22023';
  end if;
  if p_actor_user_id is null then
    raise exception 'VALIDATION_FAILED: p_actor_user_id est obligatoire' using errcode = '22023';
  end if;

  select exists (select 1 from quote_cases where id = p_case_id) into v_case_exists;
  if not v_case_exists then
    raise exception 'NOT_FOUND: dossier % introuvable', p_case_id using errcode = '22023';
  end if;

  -- Identité non forgeable : l'acteur doit être un utilisateur réel. L'Edge
  -- Function ne transmet que auth.user.id ; cette vérification empêche qu'un
  -- appelant service_role fautif fabrique un created_by arbitraire.
  select exists (select 1 from auth.users where id = p_actor_user_id) into v_actor_exists;
  if not v_actor_exists then
    raise exception 'FORBIDDEN_IDENTITY: utilisateur % inconnu', p_actor_user_id using errcode = '22023';
  end if;

  -- ── 2. Estampille d'idempotence ─────────────────────────────────────
  v_key := btrim(coalesce(p_idempotency_key, ''));
  if length(v_key) < 8 or length(v_key) > 128 then
    raise exception 'VALIDATION_FAILED: p_idempotency_key doit faire 8 à 128 caractères' using errcode = '22023';
  end if;
  if p_request_fingerprint is null or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION_FAILED: p_request_fingerprint doit être un SHA-256 hexadécimal minuscule' using errcode = '22023';
  end if;

  -- ── 3. Sérialisation par dossier (concurrence) ──────────────────────
  perform pg_advisory_xact_lock(hashtext('quote_scenario_assumption_' || p_case_id::text));

  -- ── 4. Rejeu idempotent ─────────────────────────────────────────────
  select * into v_replay
    from quote_scenario_assumption_mutations
   where case_id = p_case_id and idempotency_key = v_key;

  if found then
    if v_replay.request_fingerprint is distinct from p_request_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT: la clé % a déjà été utilisée avec un contenu différent', v_key
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'assumption_id',     v_replay.assumption_id,
      'status',            v_replay.result_status,
      'operation',         v_replay.operation,
      'idempotent_replay', true
    );
  end if;

  -- ── 5. Opérations ───────────────────────────────────────────────────
  if p_operation = 'create' then
    if p_statement is null or btrim(p_statement) = '' then
      raise exception 'VALIDATION_FAILED: statement est obligatoire' using errcode = '22023';
    end if;
    if p_assumption_type is null then
      raise exception 'VALIDATION_FAILED: assumption_type est obligatoire' using errcode = '22023';
    end if;
    if p_assumed_value_type is null or p_assumed_value is null then
      raise exception 'VALIDATION_FAILED: assumed_value_type et assumed_value sont obligatoires' using errcode = '22023';
    end if;

    v_scope_key := coalesce(nullif(btrim(coalesce(p_scope_key, '')), ''), 'case');

    begin
      insert into quote_scenario_assumptions (
        case_id, scope_key, status, assumption_type, assumed_fact_key, gap_key,
        client_gap_request_id, statement, basis, source_type, source_refs,
        assumed_value_type, assumed_value, client_visible, risk_level, metadata,
        created_by
      ) values (
        p_case_id, v_scope_key, 'active', p_assumption_type,
        nullif(btrim(coalesce(p_assumed_fact_key, '')), ''),
        nullif(btrim(coalesce(p_gap_key, '')), ''),
        p_client_gap_request_id, btrim(p_statement),
        nullif(btrim(coalesce(p_basis, '')), ''),
        coalesce(p_source_type, 'operator_guidance'),
        coalesce(p_source_refs, '[]'::jsonb),
        p_assumed_value_type, p_assumed_value,
        coalesce(p_client_visible, false),
        coalesce(p_risk_level, 'medium'),
        coalesce(p_metadata, '{}'::jsonb),
        p_actor_user_id
      )
      returning id into v_result_id;
    exception when unique_violation then
      raise exception 'CONFLICT_INVALID_STATE: une hypothèse active existe déjà pour ce périmètre (scope=%, gap=%, fait=%). Réviser l''existante.',
        v_scope_key, coalesce(p_gap_key, '-'), coalesce(p_assumed_fact_key, '-')
        using errcode = '23505';
    end;

    v_result_status := 'active';

  elsif p_operation = 'revise' then
    if p_assumption_id is null then
      raise exception 'VALIDATION_FAILED: p_assumption_id est obligatoire pour revise' using errcode = '22023';
    end if;
    if p_statement is null or btrim(p_statement) = '' then
      raise exception 'VALIDATION_FAILED: statement est obligatoire' using errcode = '22023';
    end if;
    if p_assumed_value_type is null or p_assumed_value is null then
      raise exception 'VALIDATION_FAILED: assumed_value_type et assumed_value sont obligatoires' using errcode = '22023';
    end if;

    select * into v_target from quote_scenario_assumptions where id = p_assumption_id for update;
    if not found then
      raise exception 'NOT_FOUND: hypothèse % introuvable', p_assumption_id using errcode = '22023';
    end if;
    if v_target.case_id <> p_case_id then
      raise exception 'FORBIDDEN_CROSS_CASE: hypothèse % appartient au dossier %, pas au dossier %',
        p_assumption_id, v_target.case_id, p_case_id using errcode = '23514';
    end if;
    if v_target.status <> 'active' then
      raise exception 'CONFLICT_INVALID_STATE: seule une hypothèse active peut être révisée (statut courant: %)', v_target.status
        using errcode = '23514';
    end if;

    v_result_id  := gen_random_uuid();
    v_supersedes := v_target.id;

    -- Report du seul lien AVANT : la nouvelle ligne n'existe pas encore au
    -- moment où l'ancienne doit la désigner. Vérifié au commit.
    set constraints public.quote_scenario_assumptions_superseded_by_assumption_id_fkey deferred;

    update quote_scenario_assumptions
       set status = 'superseded',
           superseded_by_assumption_id = v_result_id,
           resolved_at = now(),
           resolved_by = p_actor_user_id
     where id = v_target.id;

    -- Le PÉRIMÈTRE est hérité, jamais reparamétré : une révision remplace la
    -- valeur d'une hypothèse, elle ne déplace pas ce sur quoi elle porte.
    insert into quote_scenario_assumptions (
      id, case_id, scope_key, status, assumption_type, assumed_fact_key, gap_key,
      client_gap_request_id, statement, basis, source_type, source_refs,
      assumed_value_type, assumed_value, client_visible, risk_level, metadata,
      created_by, supersedes_assumption_id
    ) values (
      v_result_id, p_case_id, v_target.scope_key, 'active', v_target.assumption_type,
      v_target.assumed_fact_key, v_target.gap_key, v_target.client_gap_request_id,
      btrim(p_statement), nullif(btrim(coalesce(p_basis, '')), ''),
       coalesce(p_source_type, v_target.source_type),
       coalesce(p_source_refs, v_target.source_refs),
       p_assumed_value_type, p_assumed_value,
       coalesce(p_client_visible, v_target.client_visible),
       coalesce(p_risk_level, v_target.risk_level),
       coalesce(p_metadata, v_target.metadata),
       p_actor_user_id, v_target.id
    );

    v_result_status := 'active';

  else
    -- confirm_client | refute : transitions terminales depuis 'active'.
    if p_assumption_id is null then
      raise exception 'VALIDATION_FAILED: p_assumption_id est obligatoire pour %', p_operation using errcode = '22023';
    end if;

    select * into v_target from quote_scenario_assumptions where id = p_assumption_id for update;
    if not found then
      raise exception 'NOT_FOUND: hypothèse % introuvable', p_assumption_id using errcode = '22023';
    end if;
    if v_target.case_id <> p_case_id then
      raise exception 'FORBIDDEN_CROSS_CASE: hypothèse % appartient au dossier %, pas au dossier %',
        p_assumption_id, v_target.case_id, p_case_id using errcode = '23514';
    end if;
    if v_target.status <> 'active' then
      raise exception 'CONFLICT_INVALID_STATE: transition % impossible depuis le statut %', p_operation, v_target.status
        using errcode = '23514';
    end if;

    v_result_status := case p_operation when 'confirm_client' then 'client_confirmed' else 'refuted' end;

    update quote_scenario_assumptions
       set status = v_result_status,
           resolved_at = now(),
           resolved_by = p_actor_user_id
     where id = v_target.id;

    v_result_id := v_target.id;
  end if;

  -- Relire la ligne résultante pour journaliser l'état réellement persisté.
  -- C'est indispensable lors d'une révision : les champs omis héritent de la
  -- version précédente et ne doivent pas apparaître comme `false`/NULL dans
  -- l'événement d'audit.
  select * into v_target
    from quote_scenario_assumptions
   where id = v_result_id;

  -- ── 6. Enregistrement de la requête (append-only, même transaction) ──
  insert into quote_scenario_assumption_mutations (
    case_id, assumption_id, operation, result_status,
    idempotency_key, request_fingerprint, actor_user_id
  ) values (
    p_case_id, v_result_id, p_operation, v_result_status,
    v_key, p_request_fingerprint, p_actor_user_id
  );

  -- ── 7. Journalisation transactionnelle ──────────────────────────────
  -- Type d'événement DÉJÀ valide au CHECK courant (20260325163446) et déjà
  -- écrit en runtime par build-case-puzzle : aucune extension de contrainte
  -- partagée n'est nécessaire. L'opération réelle est portée par event_data.
  insert into case_timeline_events (case_id, event_type, actor_type, actor_user_id, event_data)
  values (
    p_case_id, 'assumption_applied', 'operator', p_actor_user_id,
    jsonb_build_object(
      'source',                   'manage-scenario-assumption',
      'operation',                p_operation,
      'assumption_id',            v_result_id,
      'assumption_status',        v_result_status,
      'supersedes_assumption_id', v_supersedes,
      'assumed_value_type',       v_target.assumed_value_type,
      'client_visible',           v_target.client_visible,
      'idempotency_key',          v_key,
      'request_fingerprint',      p_request_fingerprint,
      'promoted_to_fact',         false
    )
  );

  return jsonb_build_object(
    'assumption_id',     v_result_id,
    'status',            v_result_status,
    'operation',         p_operation,
    'idempotent_replay', false
  );
end;
$$;

-- =====================================================================
-- 9. PRIVILÈGES MINIMAUX
-- =====================================================================

-- Table : lecture authenticated via RLS uniquement. Aucune mutation directe
-- depuis le front, aucun DELETE nulle part.
revoke all on table public.quote_scenario_assumptions from public;
revoke all on table public.quote_scenario_assumptions from anon;
revoke all on table public.quote_scenario_assumptions from authenticated;
revoke all on table public.quote_scenario_assumptions from service_role;
grant select on table public.quote_scenario_assumptions to authenticated;
-- La RPC SECURITY DEFINER s'exécute comme son propriétaire de migration.
-- service_role conserve la lecture opérationnelle, mais aucune mutation directe :
-- EXECUTE sur manage_scenario_assumption est l'unique voie d'écriture.
grant select on table public.quote_scenario_assumptions to service_role;

-- Registre d'idempotence : strictement interne.
revoke all on table public.quote_scenario_assumption_mutations from public;
revoke all on table public.quote_scenario_assumption_mutations from anon;
revoke all on table public.quote_scenario_assumption_mutations from authenticated;
revoke all on table public.quote_scenario_assumption_mutations from service_role;

-- Les policies d'écriture deviennent mensongères (plus aucun GRANT derrière) :
-- on les retire pour que la posture lue dans le catalogue soit la posture réelle.
drop policy if exists "quote_scenario_assumptions_insert" on public.quote_scenario_assumptions;
drop policy if exists "quote_scenario_assumptions_update" on public.quote_scenario_assumptions;
-- Policy SELECT (shared authenticated operator workspace) conservée telle quelle.
-- Aucune policy DELETE : inchangé.

-- RPC : service_role exclusivement.
revoke all on function public.manage_scenario_assumption(uuid, text, uuid, text, text, uuid, text, text, text, text, uuid, text, text, text, jsonb, text, jsonb, boolean, text, jsonb) from public;
revoke all on function public.manage_scenario_assumption(uuid, text, uuid, text, text, uuid, text, text, text, text, uuid, text, text, text, jsonb, text, jsonb, boolean, text, jsonb) from anon;
revoke all on function public.manage_scenario_assumption(uuid, text, uuid, text, text, uuid, text, text, text, text, uuid, text, text, text, jsonb, text, jsonb, boolean, text, jsonb) from authenticated;
grant execute on function public.manage_scenario_assumption(uuid, text, uuid, text, text, uuid, text, text, text, text, uuid, text, text, text, jsonb, text, jsonb, boolean, text, jsonb) to service_role;

-- Triggers de garde : jamais appelables directement.
revoke all on function public.quote_scenario_assumptions_enforce_same_case() from public;
revoke all on function public.quote_scenario_assumptions_enforce_same_case() from anon;
revoke all on function public.quote_scenario_assumptions_enforce_same_case() from authenticated;
revoke all on function public.quote_scenario_assumption_mutations_enforce_same_case() from public;
revoke all on function public.quote_scenario_assumption_mutations_enforce_same_case() from anon;
revoke all on function public.quote_scenario_assumption_mutations_enforce_same_case() from authenticated;

-- =====================================================================
-- 10. Documentation catalogue
-- =====================================================================
comment on column public.quote_scenario_assumptions.assumed_value is
  'Valeur d hypothese, representation UNIQUE. Sa forme jsonb doit correspondre a assumed_value_type (CHECK quote_scenario_assumptions_value_typed).';
comment on column public.quote_scenario_assumptions.assumed_value_type is
  'text | number | boolean | date | json. Type declare de assumed_value.';
comment on column public.quote_scenario_assumptions.supersedes_assumption_id is
  'Lien ARRIERE faisant autorite : cette revision remplace l hypothese designee. superseded_by_assumption_id est le miroir avant, conserve pour compatibilite de lecture.';
comment on table public.quote_scenario_assumption_mutations is
  'P1-A1. Registre append-only des requetes de mutation d hypothese (idempotence). service_role only, RLS activee sans policy. Aucun DELETE applicatif.';
comment on function public.manage_scenario_assumption(uuid, text, uuid, text, text, uuid, text, text, text, text, uuid, text, text, text, jsonb, text, jsonb, boolean, text, jsonb) is
  'P1-A1. Seule voie de mutation de quote_scenario_assumptions. service_role only. Operations: create | revise | confirm_client | refute. Rejette explicitement toute promotion vers quote_facts. N ecrit jamais dans quote_facts, quote_request_lines, quotation_versions ni aucune donnee tarifaire.';
