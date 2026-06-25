-- Phase PROVISIONAL-SCENARIO-QUOTES — Migration 1C (additive, alignement RLS)
-- Aligne UNIQUEMENT les policies RLS de public.quote_scenario_assumptions sur le
-- modèle d'accès documenté du projet : "shared authenticated operator workspace"
-- (docs/SECURITY_CONTRACT.md : « quote_cases et tables enfants : Shared workspace
-- — Contrat team-wide inchangé »).
--
-- Contexte : la migration 20260624120000 a créé des policies owner-scoped
-- (quote_cases.created_by = auth.uid() OR quote_cases.assigned_to = auth.uid()),
-- plus strictes que le contrat courant. Le rapport ACCESS-DECISION a conclu à un
-- désalignement à corriger AVANT toute consommation runtime (sinon un opérateur
-- non créateur/assigné verrait le dossier, ses facts et ses gaps team-wide, mais
-- pas ses hypothèses).
--
-- Périmètre strict de cette migration :
--   * DROP des 3 policies owner-scoped + CREATE des équivalentes team-wide ;
--   * aucune modification de colonnes, FK, CHECK, index, trigger, commentaires, GRANT ;
--   * aucune autre table touchée ; aucune policy DELETE ; aucun GRANT nouveau.
--
-- Forme RLS retenue : auth.role() = 'authenticated' — pattern appliqué aux tables
-- enfants de quote_cases (quote_facts, quote_gaps, pricing_runs, case_timeline_events…)
-- par le « correctif team » 20260214110527. Préféré à USING (true) pour expliciter
-- l'intention shared-workspace et rester cohérent avec ce groupe de pairs.
--
-- Doctrine inchangée : table inertielle ; hypothèse != fact ; aucune promotion
-- automatique ; aucune fermeture automatique de gap ; aucun effet pricing/PDF/email.

-- RLS reste activée (réassertion défensive idempotente ; ne modifie rien si déjà active).
alter table public.quote_scenario_assumptions enable row level security;

-- 1. Suppression des policies owner-scoped héritées de 20260624120000.
drop policy if exists "quote_scenario_assumptions_select" on public.quote_scenario_assumptions;
drop policy if exists "quote_scenario_assumptions_insert" on public.quote_scenario_assumptions;
drop policy if exists "quote_scenario_assumptions_update" on public.quote_scenario_assumptions;

-- 2. Recréation alignée shared authenticated operator workspace.
create policy "quote_scenario_assumptions_select"
  on public.quote_scenario_assumptions for select to authenticated
  using (auth.role() = 'authenticated');

create policy "quote_scenario_assumptions_insert"
  on public.quote_scenario_assumptions for insert to authenticated
  with check (auth.role() = 'authenticated');

create policy "quote_scenario_assumptions_update"
  on public.quote_scenario_assumptions for update to authenticated
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Pas de policy DELETE (cohérent avec la migration de création).
-- Pas de GRANT : les privilèges par défaut du rôle authenticated suffisent en
-- Lovable/Supabase Cloud (cf. rapport ACCESS-DECISION : toutes les tables enfants
-- de quote_cases fonctionnent sans GRANT explicite).
