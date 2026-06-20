-- PAD-C2C-HARDEN-PDA-RLS
-- Phase C2-C — Durcissement RLS public.pad_designation_aliases (PDA) uniquement
-- Date : 2026-06-20
-- CTO GO requis avant exécution en production.
--
-- Scope autorisé :
--   - Remplacement des policies INSERT/UPDATE/DELETE sur pad_designation_aliases
--     par des policies restreintes à public.has_pad_admin_role() = true.
--   - Préservation de la policy SELECT (authenticated, USING(true)).
--   - Aucune modification de table, données, index, triggers.
--   - Aucune modification de public.commodity_designation_matches.
--
-- Hors scope de ce patch :
--   - public.commodity_designation_matches : intentionnellement non modifiée
--     (fera l'objet d'une phase séparée après décision CTO).
--   - Attribution de rôle admin dans public.app_roles : non traitée ici.
--     (Procédure documentée dans la migration C2-B.)
--   - UI (PadAliasTab.tsx, CorrespondancesTab.tsx) : non modifiée.
--   - Edge Functions : non modifiées.
--   - Aucun runtime, aucun Lovable, aucune action en DB live.
--
-- Effet opérationnel immédiat après application :
--   Sans ligne active dans public.app_roles (role='pad_admin') pour l'utilisateur
--   appelant, les écritures authenticated sur pad_designation_aliases (INSERT /
--   UPDATE / DELETE) seront refusées par RLS. Les lectures (SELECT) restent
--   accessibles à tous les authenticated. Coordonner avec l'attribution admin
--   avant mise en production.
--
-- Idempotence :
--   DROP POLICY IF EXISTS sur les anciens et nouveaux noms avant CREATE POLICY.

-- =============================================================================
-- Précheck : public.has_pad_admin_role() doit être présente (migration C2-B).
-- Si absente, arrêter immédiatement — ne pas appliquer C2-C sans C2-B.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'has_pad_admin_role'
  ) THEN
    RAISE EXCEPTION
      '[PAD-C2C] STOP — public.has_pad_admin_role() absente. Appliquer la migration C2-B (20260620130000_pad_c2_app_roles.sql) avant C2-C.';
  END IF;
  RAISE NOTICE '[PAD-C2C] Précheck : public.has_pad_admin_role() présente — OK.';
END;
$$;

-- =============================================================================
-- Activation RLS défensive (idempotent — garantit RLS active indépendamment
-- de l'ordre d'application des migrations).
-- =============================================================================

ALTER TABLE public.pad_designation_aliases ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- DROP des policies PDA existantes
--
-- Anciens noms (policies ouvertes — migration 20260404091738) :
--   pad_designation_aliases_insert
--   pad_designation_aliases_update
--   pad_designation_aliases_delete
--
-- Nouveaux noms (guard idempotent si C2-C rejoué) :
--   pad_designation_aliases_insert_admin
--   pad_designation_aliases_update_admin
--   pad_designation_aliases_delete_admin
--
-- SELECT policy : droppée puis recrée pour cohérence idempotente.
-- =============================================================================

DROP POLICY IF EXISTS "pad_designation_aliases_read"         ON public.pad_designation_aliases;
DROP POLICY IF EXISTS "pad_designation_aliases_insert"       ON public.pad_designation_aliases;
DROP POLICY IF EXISTS "pad_designation_aliases_update"       ON public.pad_designation_aliases;
DROP POLICY IF EXISTS "pad_designation_aliases_delete"       ON public.pad_designation_aliases;
DROP POLICY IF EXISTS "pad_designation_aliases_insert_admin" ON public.pad_designation_aliases;
DROP POLICY IF EXISTS "pad_designation_aliases_update_admin" ON public.pad_designation_aliases;
DROP POLICY IF EXISTS "pad_designation_aliases_delete_admin" ON public.pad_designation_aliases;

-- =============================================================================
-- SELECT — préservé, ouvert à tout authenticated (inchangé).
-- =============================================================================

CREATE POLICY "pad_designation_aliases_read"
  ON public.pad_designation_aliases
  FOR SELECT
  TO authenticated
  USING (true);

-- =============================================================================
-- INSERT — restreint à pad_admin uniquement.
-- public.has_pad_admin_role() est STABLE SECURITY DEFINER : lit public.app_roles
-- en bypassant les RLS, filtre sur auth.uid() et role='pad_admin'.
-- =============================================================================

CREATE POLICY "pad_designation_aliases_insert_admin"
  ON public.pad_designation_aliases
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_pad_admin_role());

-- =============================================================================
-- UPDATE — restreint à pad_admin (existant ET après modification).
-- =============================================================================

CREATE POLICY "pad_designation_aliases_update_admin"
  ON public.pad_designation_aliases
  FOR UPDATE
  TO authenticated
  USING  (public.has_pad_admin_role())
  WITH CHECK (public.has_pad_admin_role());

-- =============================================================================
-- DELETE — restreint à pad_admin.
-- =============================================================================

CREATE POLICY "pad_designation_aliases_delete_admin"
  ON public.pad_designation_aliases
  FOR DELETE
  TO authenticated
  USING (public.has_pad_admin_role());

-- =============================================================================
-- CDM — intentionnellement non modifiée dans ce patch (Phase C2-C).
--
-- RISQUE RÉSIDUEL DOCUMENTÉ :
--   Les policies INSERT/UPDATE/DELETE sur commodity_designation_matches restent
--   ouvertes à tout authenticated. En particulier :
--   - CorrespondancesTab.tsx peut valider/supprimer des propositions CDM sans
--     vérification de rôle.
--   - DesignationSuggestionBlock.tsx peut écrire CDM is_validated=true depuis
--     n'importe quel dossier (tout authenticated).
--
-- Durcissement CDM reporté à une phase ultérieure après décision CTO sur :
--   - le périmètre exact des rôles autorisés (pad_admin seulement ? pad_supervisor ?)
--   - la coordination avec DesignationSuggestionBlock.tsx (opérateur terrain)
--
-- TODO Phase C2-D+ :
--   Restreindre INSERT/UPDATE/DELETE sur commodity_designation_matches.
--   Décision CTO requise avant implémentation.
-- =============================================================================
