-- PAD-C2-APP-ROLES
-- Phase C2-B — Modèle de rôle admin minimal (table + RLS SELECT + RPC)
-- Date : 2026-06-20
-- CTO GO requis avant exécution en production.
--
-- Scope autorisé :
--   - Création de public.app_roles
--   - RLS : SELECT own rows seulement ; aucun INSERT/UPDATE/DELETE ouvert à authenticated
--   - RPC public.has_pad_admin_role() STABLE SECURITY DEFINER
--   - GRANT EXECUTE ON FUNCTION has_pad_admin_role() TO authenticated
--
-- Hors scope de ce patch (Phase C2-C et suivantes) :
--   - Aucune modification RLS sur pad_designation_aliases
--   - Aucune modification RLS sur commodity_designation_matches
--   - Aucune modification UI (PadAliasTab.tsx, CorrespondancesTab.tsx)
--   - Aucune Edge Function
--   - Aucun seed d'utilisateurs admin
--   - Aucun push, aucune migration en base de prod
--
-- Idempotence :
--   CREATE TABLE IF NOT EXISTS
--   DROP POLICY IF EXISTS avant CREATE POLICY
--   CREATE OR REPLACE FUNCTION

-- =============================================================================
-- Table public.app_roles
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.app_roles (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text        NOT NULL CHECK (role IN ('pad_admin', 'pad_supervisor')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        REFERENCES auth.users(id),
  CONSTRAINT uq_app_roles_user_role UNIQUE (user_id, role)
);

-- =============================================================================
-- RLS sur public.app_roles
-- =============================================================================

ALTER TABLE public.app_roles ENABLE ROW LEVEL SECURITY;

-- SELECT : chaque utilisateur ne voit que ses propres lignes.
DROP POLICY IF EXISTS "app_roles_select_own" ON public.app_roles;
CREATE POLICY "app_roles_select_own"
  ON public.app_roles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- INSERT / UPDATE / DELETE : aucune policy ouverte à authenticated.
-- L'attribution de rôles se fait exclusivement via service_role (SQL Editor,
-- script de migration ou backfill admin). Voir NOTE ci-dessous.

-- =============================================================================
-- RPC public.has_pad_admin_role()
--
-- Vérifie si l'utilisateur appelant possède le rôle 'pad_admin'.
-- STABLE      : pas de side-effects, résultat cacheable dans la transaction.
-- SECURITY DEFINER : lit app_roles en bypassant les RLS de la table ; la requête
--   est filtrée sur auth.uid() — aucune ligne d'un autre utilisateur n'est exposée.
-- SET search_path = public : protège contre l'injection de search_path.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.has_pad_admin_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_roles
    WHERE user_id = auth.uid()
      AND role = 'pad_admin'
  );
$$;

REVOKE ALL ON FUNCTION public.has_pad_admin_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_pad_admin_role() FROM anon;
GRANT EXECUTE ON FUNCTION public.has_pad_admin_role() TO authenticated;

-- =============================================================================
-- NOTE : attribution de rôles admin (service_role uniquement)
--
-- Aucun utilisateur n'est seedé dans ce patch (périmètre C2-B strictement
-- respecté). Pour attribuer le rôle pad_admin à un utilisateur en production,
-- exécuter via Supabase Dashboard (SQL Editor) en service_role :
--
--   INSERT INTO public.app_roles (user_id, role, created_by)
--   VALUES ('<uuid-user-cible>', 'pad_admin', '<uuid-admin-executant>');
--
-- Cette opération NE DOIT PAS être exposée à un utilisateur authenticated
-- via RLS ou Edge Function avant une décision CTO explicite (Phase C2-C+).
-- =============================================================================

-- =============================================================================
-- RLS PDA / CDM — Non modifiée dans ce patch (Phase C2-B)
--
-- RISQUE RÉSIDUEL DOCUMENTÉ (rapport audit 2026-06-20 §R1) :
--   Les policies INSERT/UPDATE/DELETE sur pad_designation_aliases et
--   commodity_designation_matches sont ouvertes à tout utilisateur authenticated.
--   Tout authenticated peut donc écrire un alias PAD ou valider une proposition
--   CDM sans vérification de rôle DB.
--
-- Durcissement volontairement reporté à Phase C2-C car il nécessite :
--   - Coordination avec PadAliasTab.tsx et CorrespondancesTab.tsx (admin UI)
--   - Création de la Edge Function validate-pad-alias-enrichment (Phase C2-D)
--   - Validation CTO du scénario de bascule (pas de rupture opérationnelle)
--
-- TODO Phase C2-C :
--   1. Restreindre INSERT/UPDATE/DELETE sur pad_designation_aliases à
--      has_pad_admin_role() = true (ou via service_role uniquement).
--   2. Restreindre la validation CDM (is_validated=true) à has_pad_admin_role().
--   3. Coordonner avec admin UI pour éviter toute régression opérationnelle.
-- =============================================================================
