
-- =============================================
-- Correctif RLS : lecture équipe authentifiée
-- Tables du module Puzzle IA (8 tables)
-- =============================================

-- 1. quote_cases
DROP POLICY IF EXISTS "quote_cases_select_owner" ON quote_cases;
CREATE POLICY "quote_cases_select_team"
  ON quote_cases FOR SELECT TO authenticated
  USING (auth.role() = 'authenticated');

-- 2. quote_facts
DROP POLICY IF EXISTS "quote_facts_select_owner" ON quote_facts;
CREATE POLICY "quote_facts_select_team"
  ON quote_facts FOR SELECT TO authenticated
  USING (auth.role() = 'authenticated');

-- 3. quote_gaps
DROP POLICY IF EXISTS "quote_gaps_select_owner" ON quote_gaps;
CREATE POLICY "quote_gaps_select_team"
  ON quote_gaps FOR SELECT TO authenticated
  USING (auth.role() = 'authenticated');

-- 4. pricing_runs
DROP POLICY IF EXISTS "pricing_runs_select_owner" ON pricing_runs;
CREATE POLICY "pricing_runs_select_team"
  ON pricing_runs FOR SELECT TO authenticated
  USING (auth.role() = 'authenticated');

-- 5. case_timeline_events
DROP POLICY IF EXISTS "case_timeline_events_select_owner" ON case_timeline_events;
CREATE POLICY "case_timeline_events_select_team"
  ON case_timeline_events FOR SELECT TO authenticated
  USING (auth.role() = 'authenticated');

-- 6. operator_decisions
DROP POLICY IF EXISTS "operator_decisions_select_owner" ON operator_decisions;
CREATE POLICY "operator_decisions_select_team"
  ON operator_decisions FOR SELECT TO authenticated
  USING (auth.role() = 'authenticated');

-- 7. quotation_versions
DROP POLICY IF EXISTS "quotation_versions_select_owner" ON quotation_versions;
CREATE POLICY "quotation_versions_select_team"
  ON quotation_versions FOR SELECT TO authenticated
  USING (auth.role() = 'authenticated');

-- 8. puzzle_jobs
DROP POLICY IF EXISTS "puzzle_jobs_select_owner" ON puzzle_jobs;
CREATE POLICY "puzzle_jobs_select_team"
  ON puzzle_jobs FOR SELECT TO authenticated
  USING (auth.role() = 'authenticated');
