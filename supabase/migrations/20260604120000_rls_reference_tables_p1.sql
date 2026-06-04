-- RLS-REFERENCE-TABLES-P1: harden sensitive pricing reference tables.

ALTER TABLE public.port_tariffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_billing_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "port_tariffs_insert_authenticated" ON public.port_tariffs;
DROP POLICY IF EXISTS "port_tariffs_update_authenticated" ON public.port_tariffs;
DROP POLICY IF EXISTS "port_tariffs_delete_authenticated" ON public.port_tariffs;
DROP POLICY IF EXISTS "port_tariffs_public_read" ON public.port_tariffs;

DROP POLICY IF EXISTS "carrier_billing_templates_auth_insert" ON public.carrier_billing_templates;
DROP POLICY IF EXISTS "carrier_billing_templates_auth_update" ON public.carrier_billing_templates;
DROP POLICY IF EXISTS "carrier_billing_templates_auth_delete" ON public.carrier_billing_templates;
DROP POLICY IF EXISTS "carrier_billing_templates_public_read" ON public.carrier_billing_templates;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'port_tariffs'
      AND policyname = 'port_tariffs_authenticated_read'
  ) THEN
    CREATE POLICY "port_tariffs_authenticated_read"
      ON public.port_tariffs
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'carrier_billing_templates'
      AND policyname = 'carrier_billing_templates_authenticated_read'
  ) THEN
    CREATE POLICY "carrier_billing_templates_authenticated_read"
      ON public.carrier_billing_templates
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;
