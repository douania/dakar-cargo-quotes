CREATE TABLE IF NOT EXISTS public.app_roles (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text        NOT NULL CHECK (role IN ('pad_admin', 'pad_supervisor')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        REFERENCES auth.users(id),
  CONSTRAINT uq_app_roles_user_role UNIQUE (user_id, role)
);

GRANT SELECT ON public.app_roles TO authenticated;
GRANT ALL ON public.app_roles TO service_role;

ALTER TABLE public.app_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_roles_select_own" ON public.app_roles;
CREATE POLICY "app_roles_select_own"
  ON public.app_roles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

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