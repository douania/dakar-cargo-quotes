alter table public.quote_scenario_assumptions enable row level security;

drop policy if exists "quote_scenario_assumptions_select" on public.quote_scenario_assumptions;
drop policy if exists "quote_scenario_assumptions_insert" on public.quote_scenario_assumptions;
drop policy if exists "quote_scenario_assumptions_update" on public.quote_scenario_assumptions;

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