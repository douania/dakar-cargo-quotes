-- ============================================================================
-- PHASE 9.1 FIX — Immutabilité des snapshots IA (CTO Review)
-- ============================================================================
-- OBJECTIF: Garantir que decision_proposals est strictement append-only
-- RÈGLE CTO: Les snapshots IA sont IMMUABLES - ni UPDATE ni DELETE autorisés
-- ============================================================================

-- 1. Supprimer la policy UPDATE permissive existante
DROP POLICY IF EXISTS "decision_proposals_update_owner" ON public.decision_proposals;

-- 2. Policy qui interdit explicitement tout UPDATE
-- CTO RULE: Snapshot IA = immuable, aucune modification post-insertion
CREATE POLICY "decision_proposals_no_update" ON public.decision_proposals
  FOR UPDATE TO authenticated
  USING (false);

-- 3. Policy qui interdit explicitement tout DELETE (recommandation CTO)
-- Évite le "nettoyage" de l'audit trail par suppression des propositions
CREATE POLICY "decision_proposals_no_delete" ON public.decision_proposals
  FOR DELETE TO authenticated
  USING (false);