-- =============================================================================
-- H2-a2 — Gestion des rôles depuis l'application : rôle role_admin, rôles
-- tariff_admin / role_admin admis dans app_roles, garde-fou anti-verrouillage.
-- GO CTO SODATRA du 9 septembre 2026 (« attribue-moi le rôle et la possibilité
-- d'attribuer des rôles moi-même »).
--
-- Constat : app_roles (PAD-C2) n'admet que 'pad_admin' et 'pad_supervisor' et
-- n'a aucune policy d'écriture — l'attribution passait par service_role. H2-a a
-- créé has_tariff_admin_role() mais la contrainte interdisait encore le rôle.
--
-- Ce patch :
--   1. étend la contrainte de rôle à 'tariff_admin' et 'role_admin' ;
--   2. crée has_role_admin_role() (même patron SECURITY DEFINER que PAD-C2) ;
--   3. ouvre app_roles aux role_admin : lecture de toutes les lignes, insertion,
--      mise à jour, suppression ; les autres utilisateurs gardent la lecture de
--      leurs propres lignes uniquement ;
--   4. interdit par trigger de supprimer ou de retirer le DERNIER role_admin
--      (jamais de verrouillage de l'administration), quel que soit l'appelant.
-- Aucun utilisateur seedé : l'attribution initiale reste une opération
-- service_role hors dépôt (aucun identifiant de compte dans Git).
-- Idempotent ; rollback : DROP des policies, du trigger, de la fonction, et
-- restauration de la contrainte initiale.
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.app_roles') IS NULL THEN
    RAISE EXCEPTION '[H2-a2] STOP — public.app_roles absente.';
  END IF;
END $$;

-- 1. Rôles admis.
ALTER TABLE public.app_roles DROP CONSTRAINT IF EXISTS app_roles_role_check;
ALTER TABLE public.app_roles
  ADD CONSTRAINT app_roles_role_check
  CHECK (role IN ('pad_admin', 'pad_supervisor', 'tariff_admin', 'role_admin'));

COMMENT ON TABLE public.app_roles IS
  'Rôles applicatifs par utilisateur. pad_admin / pad_supervisor (PAD-C2), tariff_admin (honoraires, H2-a), role_admin (gestion des rôles, H2-a2). Le dernier role_admin ne peut pas être retiré.';

-- 2. has_role_admin_role().
CREATE OR REPLACE FUNCTION public.has_role_admin_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_roles
    WHERE user_id = auth.uid()
      AND role = 'role_admin'
  );
$$;

REVOKE ALL ON FUNCTION public.has_role_admin_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_role_admin_role() FROM anon;
GRANT EXECUTE ON FUNCTION public.has_role_admin_role() TO authenticated;

-- 3. Policies app_roles pour les role_admin (la lecture « ses propres lignes »
--    de PAD-C2 est conservée telle quelle).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_roles TO authenticated;

DROP POLICY IF EXISTS "app_roles_select_role_admin" ON public.app_roles;
CREATE POLICY "app_roles_select_role_admin"
  ON public.app_roles FOR SELECT TO authenticated
  USING (public.has_role_admin_role());

DROP POLICY IF EXISTS "app_roles_insert_role_admin" ON public.app_roles;
CREATE POLICY "app_roles_insert_role_admin"
  ON public.app_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_role_admin_role());

DROP POLICY IF EXISTS "app_roles_update_role_admin" ON public.app_roles;
CREATE POLICY "app_roles_update_role_admin"
  ON public.app_roles FOR UPDATE TO authenticated
  USING (public.has_role_admin_role()) WITH CHECK (public.has_role_admin_role());

DROP POLICY IF EXISTS "app_roles_delete_role_admin" ON public.app_roles;
CREATE POLICY "app_roles_delete_role_admin"
  ON public.app_roles FOR DELETE TO authenticated
  USING (public.has_role_admin_role());

-- 4. Garde-fou : jamais zéro role_admin après une suppression ou une mise à jour.
CREATE OR REPLACE FUNCTION public.app_roles_keep_last_role_admin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.role = 'role_admin'
     AND (TG_OP = 'DELETE' OR NEW.role <> 'role_admin' OR NEW.user_id <> OLD.user_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.app_roles r
       WHERE r.role = 'role_admin' AND r.id <> OLD.id
     ) THEN
    RAISE EXCEPTION '[H2-a2] Refusé : ce compte est le dernier role_admin. Attribuez d''abord role_admin à un autre compte.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_roles_keep_last_role_admin ON public.app_roles;
CREATE TRIGGER trg_app_roles_keep_last_role_admin
  BEFORE UPDATE OR DELETE ON public.app_roles
  FOR EACH ROW EXECUTE FUNCTION public.app_roles_keep_last_role_admin();
