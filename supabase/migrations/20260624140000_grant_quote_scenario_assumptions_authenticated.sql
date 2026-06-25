-- Phase PROVISIONAL-SCENARIO-QUOTES — Migration 1D (additive, GRANT explicite)
-- Accorde explicitement au rôle authenticated les privilèges d'accès Data API sur
-- public.quote_scenario_assumptions. L'accès reste gaté par les policies RLS
-- shared-workspace alignées en 20260624130000. Suit le risque moyen « absence de
-- GRANT explicite » relevé par le plan Lovable. Aucune autre modification.
-- Volontairement : pas de DELETE, pas de anon, pas de service_role, pas de ALL, pas de REVOKE.

GRANT SELECT, INSERT, UPDATE
  ON public.quote_scenario_assumptions
  TO authenticated;
