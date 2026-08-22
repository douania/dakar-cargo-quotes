-- Phase PROVISIONAL-SCENARIO-QUOTES — Migration 1 (additive, inertielle)
-- Assumption ledger minimal pour les cotations provisoires par scénario.
-- Doctrine : docs/PROVISIONAL_SCENARIO_QUOTES.md
--
-- Cette table est INERTIELLE :
--   * aucun trigger métier, aucune RPC, aucune edge function ;
--   * elle n'écrit JAMAIS dans quote_facts ;
--   * elle ne modifie JAMAIS quote_gaps et ne ferme JAMAIS un gap ;
--   * aucun effet pricing, aucun effet PDF/email, aucun devis rendu firm ;
--   * en Phase 1, aucun code applicatif ne la lit ni ne l'écrit.
--
-- Invariants doctrinaux portés par le schéma :
--   * hypothèse ≠ fact ;
--   * client_confirmed ≠ promoted_to_fact (compatibilité client ≠ promotion) ;
--   * aucune promotion automatique : promoted_fact_id n'est renseigné que sur
--     status='promoted_to_fact', via le chemin canonique existant
--     set-case-fact → supersede_fact (HORS périmètre de cette migration) ;
--   * historique traçable (created_by / resolved_by / timestamps / supersession).

create table if not exists public.quote_scenario_assumptions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.quote_cases(id) on delete cascade,

  -- Périmètre logique sans créer quote_scenarios.
  -- Ex : 'case', 'lot:2', 'commodity:bus', 'service:transport'.
  scope_key text not null default 'case',

  -- Cycle de vie de l'hypothèse. La machine d'états reste APPLICATIVE ;
  -- les CHECK ci-dessous bornent le vocabulaire et l'intégrité statut ↔ champs.
  status text not null default 'active'
    constraint quote_scenario_assumptions_status_check
      check (status in ('active','client_confirmed','refuted','superseded','promoted_to_fact')),

  assumption_type text not null
    constraint quote_scenario_assumptions_type_check
      check (assumption_type in (
        'value','hs','pad','weight','dimensions',
        'quantity','category','partner_cost','service_scope','other'
      )),

  -- Fait que l'hypothèse ANTICIPE (ex: cargo.value, cargo.hs_code, cargo.pad_category).
  -- Simple texte : n'écrit jamais dans quote_facts.
  assumed_fact_key text null,

  -- Lien logique souple vers un gap : ne modifie jamais quote_gaps.
  gap_key text null,
  client_gap_request_id uuid null references public.client_gap_requests(id) on delete set null,

  statement text not null
    constraint quote_scenario_assumptions_statement_not_empty
      check (btrim(statement) <> ''),
  basis text null,

  source_type text not null default 'operator_guidance'
    constraint quote_scenario_assumptions_source_type_check
      check (source_type in (
        'operator_guidance','document_analogy','prior_client_info','internal_experience','other'
      )),
  source_refs jsonb not null default '[]'::jsonb
    constraint quote_scenario_assumptions_source_refs_is_array
      check (jsonb_typeof(source_refs) = 'array'),

  client_visible boolean not null default true,

  risk_level text not null default 'medium'
    constraint quote_scenario_assumptions_risk_level_check
      check (risk_level in ('low','medium','high')),

  metadata jsonb not null default '{}'::jsonb
    constraint quote_scenario_assumptions_metadata_is_object
      check (jsonb_typeof(metadata) = 'object'),

  -- Référence LECTURE SEULE vers le fait promu (jamais d'écriture inverse).
  -- NO ACTION (pas de ON DELETE) : empêche la suppression isolée d'un fait promu
  -- tout en restant compatible avec le cascade par case_id (vérifié en fin d'instruction).
  promoted_fact_id uuid null references public.quote_facts(id),
  -- Self-FK de supersession. NO ACTION pour la même raison (cohérent avec le CHECK superseded).
  superseded_by_assumption_id uuid null references public.quote_scenario_assumptions(id),

  created_by uuid null,
  resolved_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz null,

  -- Cohérence statut ↔ champs (doctrine, traduits en implications booléennes).
  constraint quote_scenario_assumptions_active_clean
    check (status <> 'active'
      or (promoted_fact_id is null and superseded_by_assumption_id is null and resolved_at is null)),
  constraint quote_scenario_assumptions_promoted_requires_fact
    check (status <> 'promoted_to_fact'
      or (promoted_fact_id is not null and resolved_at is not null)),
  constraint quote_scenario_assumptions_fact_only_when_promoted
    check (status = 'promoted_to_fact' or promoted_fact_id is null),
  constraint quote_scenario_assumptions_superseded_requires_ref
    check (status <> 'superseded'
      or (superseded_by_assumption_id is not null and resolved_at is not null)),
  constraint quote_scenario_assumptions_supref_only_when_superseded
    check (status = 'superseded' or superseded_by_assumption_id is null),
  constraint quote_scenario_assumptions_terminal_resolved
    check (status not in ('client_confirmed','refuted') or resolved_at is not null),
  constraint quote_scenario_assumptions_no_self_supersede
    check (superseded_by_assumption_id is null or superseded_by_assumption_id <> id)
);

-- Idempotence / anti-doublon : une seule hypothèse ACTIVE par périmètre logique.
-- NULL traité comme '' via COALESCE (PostgreSQL considère NULL distinct de NULL).
create unique index if not exists uq_quote_scenario_assumptions_active
  on public.quote_scenario_assumptions
    (case_id, scope_key, coalesce(gap_key, ''), coalesce(assumed_fact_key, ''))
  where status = 'active';

-- Index de performance
create index if not exists idx_quote_scenario_assumptions_case_id
  on public.quote_scenario_assumptions(case_id);
create index if not exists idx_quote_scenario_assumptions_case_status
  on public.quote_scenario_assumptions(case_id, status);
create index if not exists idx_quote_scenario_assumptions_case_gap
  on public.quote_scenario_assumptions(case_id, gap_key);
create index if not exists idx_quote_scenario_assumptions_promoted_fact
  on public.quote_scenario_assumptions(promoted_fact_id);

-- updated_at : réutilise le helper existant public.update_updated_at_column().
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at'
      and tgrelid = 'public.quote_scenario_assumptions'::regclass
  ) then
create trigger set_updated_at before update on public.quote_scenario_assumptions
  for each row execute function public.update_updated_at_column();
  end if;
end $$;

-- RLS : ownership via le quote_cases parent (pattern confirmé sur quote_facts).
-- Aucun accès client public ; aucune policy cross-case ; pas de DELETE autorisé.
alter table public.quote_scenario_assumptions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'quote_scenario_assumptions'
      and policyname = 'quote_scenario_assumptions_select'
  ) then
create policy "quote_scenario_assumptions_select"
  on public.quote_scenario_assumptions for select to authenticated
  using (exists (
    select 1 from public.quote_cases qc
    where qc.id = case_id
      and (qc.created_by = auth.uid() or qc.assigned_to = auth.uid())
  ));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'quote_scenario_assumptions'
      and policyname = 'quote_scenario_assumptions_insert'
  ) then
create policy "quote_scenario_assumptions_insert"
  on public.quote_scenario_assumptions for insert to authenticated
  with check (exists (
    select 1 from public.quote_cases qc
    where qc.id = case_id
      and (qc.created_by = auth.uid() or qc.assigned_to = auth.uid())
  ));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'quote_scenario_assumptions'
      and policyname = 'quote_scenario_assumptions_update'
  ) then
create policy "quote_scenario_assumptions_update"
  on public.quote_scenario_assumptions for update to authenticated
  using (exists (
    select 1 from public.quote_cases qc
    where qc.id = case_id
      and (qc.created_by = auth.uid() or qc.assigned_to = auth.uid())
  ))
  with check (exists (
    select 1 from public.quote_cases qc
    where qc.id = case_id
      and (qc.created_by = auth.uid() or qc.assigned_to = auth.uid())
  ));
  end if;
end $$;

-- Documentation doctrine (catalogue)
comment on table public.quote_scenario_assumptions is
  'Assumption ledger (Migration 1, additive, inertielle). Hypotheses operateur pour cotations provisoires par scenario. Doctrine: hypothese != fact; aucune fermeture auto de gap; client_confirmed != promoted_to_fact; aucune promotion automatique.';
comment on column public.quote_scenario_assumptions.promoted_fact_id is
  'Reference LECTURE SEULE vers quote_facts. Renseigne uniquement sur status=promoted_to_fact via le chemin canonique set-case-fact -> supersede_fact (hors scope de cette migration). Jamais d ecriture inverse.';
comment on column public.quote_scenario_assumptions.gap_key is
  'Reference logique souple vers un gap. Ne modifie jamais quote_gaps et ne ferme jamais un gap.';
comment on column public.quote_scenario_assumptions.status is
  'active | client_confirmed | refuted | superseded | promoted_to_fact. client_confirmed (info client compatible) != promoted_to_fact (promotion explicite en fait).';
