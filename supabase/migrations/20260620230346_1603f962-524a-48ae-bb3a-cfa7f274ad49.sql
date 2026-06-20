DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='has_pad_admin_role'
  ) THEN
    RAISE EXCEPTION '[PAD-C2C] STOP — public.has_pad_admin_role() absente.';
  END IF;
END $$;

ALTER TABLE public.pad_designation_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pad_designation_aliases_read"         ON public.pad_designation_aliases;
DROP POLICY IF EXISTS "pad_designation_aliases_insert"       ON public.pad_designation_aliases;
DROP POLICY IF EXISTS "pad_designation_aliases_update"       ON public.pad_designation_aliases;
DROP POLICY IF EXISTS "pad_designation_aliases_delete"       ON public.pad_designation_aliases;
DROP POLICY IF EXISTS "pad_designation_aliases_insert_admin" ON public.pad_designation_aliases;
DROP POLICY IF EXISTS "pad_designation_aliases_update_admin" ON public.pad_designation_aliases;
DROP POLICY IF EXISTS "pad_designation_aliases_delete_admin" ON public.pad_designation_aliases;

CREATE POLICY "pad_designation_aliases_read"
  ON public.pad_designation_aliases FOR SELECT TO authenticated USING (true);

CREATE POLICY "pad_designation_aliases_insert_admin"
  ON public.pad_designation_aliases FOR INSERT TO authenticated
  WITH CHECK (public.has_pad_admin_role());

CREATE POLICY "pad_designation_aliases_update_admin"
  ON public.pad_designation_aliases FOR UPDATE TO authenticated
  USING (public.has_pad_admin_role()) WITH CHECK (public.has_pad_admin_role());

CREATE POLICY "pad_designation_aliases_delete_admin"
  ON public.pad_designation_aliases FOR DELETE TO authenticated
  USING (public.has_pad_admin_role());