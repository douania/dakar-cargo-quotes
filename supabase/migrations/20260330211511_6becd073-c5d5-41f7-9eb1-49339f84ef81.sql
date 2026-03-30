-- =============================================
-- RLS Write Policies — Tariff Reference Tables
-- Version idempotente (DROP IF EXISTS + CREATE)
-- Pattern: shared workspace, authenticated CRUD
-- =============================================

-- 1. carrier_billing_templates
DROP POLICY IF EXISTS "carrier_billing_templates_auth_insert" ON public.carrier_billing_templates;
DROP POLICY IF EXISTS "carrier_billing_templates_auth_update" ON public.carrier_billing_templates;
DROP POLICY IF EXISTS "carrier_billing_templates_auth_delete" ON public.carrier_billing_templates;

CREATE POLICY "carrier_billing_templates_auth_insert"
  ON public.carrier_billing_templates FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "carrier_billing_templates_auth_update"
  ON public.carrier_billing_templates FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "carrier_billing_templates_auth_delete"
  ON public.carrier_billing_templates FOR DELETE
  TO authenticated USING (true);

-- 2. demurrage_rates
DROP POLICY IF EXISTS "demurrage_rates_auth_insert" ON public.demurrage_rates;
DROP POLICY IF EXISTS "demurrage_rates_auth_update" ON public.demurrage_rates;
DROP POLICY IF EXISTS "demurrage_rates_auth_delete" ON public.demurrage_rates;

CREATE POLICY "demurrage_rates_auth_insert"
  ON public.demurrage_rates FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "demurrage_rates_auth_update"
  ON public.demurrage_rates FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "demurrage_rates_auth_delete"
  ON public.demurrage_rates FOR DELETE
  TO authenticated USING (true);

-- 3. warehouse_franchise
DROP POLICY IF EXISTS "warehouse_franchise_auth_insert" ON public.warehouse_franchise;
DROP POLICY IF EXISTS "warehouse_franchise_auth_update" ON public.warehouse_franchise;
DROP POLICY IF EXISTS "warehouse_franchise_auth_delete" ON public.warehouse_franchise;

CREATE POLICY "warehouse_franchise_auth_insert"
  ON public.warehouse_franchise FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "warehouse_franchise_auth_update"
  ON public.warehouse_franchise FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "warehouse_franchise_auth_delete"
  ON public.warehouse_franchise FOR DELETE
  TO authenticated USING (true);

-- 4. holidays_pad
DROP POLICY IF EXISTS "holidays_pad_auth_insert" ON public.holidays_pad;
DROP POLICY IF EXISTS "holidays_pad_auth_update" ON public.holidays_pad;
DROP POLICY IF EXISTS "holidays_pad_auth_delete" ON public.holidays_pad;

CREATE POLICY "holidays_pad_auth_insert"
  ON public.holidays_pad FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "holidays_pad_auth_update"
  ON public.holidays_pad FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "holidays_pad_auth_delete"
  ON public.holidays_pad FOR DELETE
  TO authenticated USING (true);

-- 5. local_transport_rates
DROP POLICY IF EXISTS "local_transport_rates_auth_insert" ON public.local_transport_rates;
DROP POLICY IF EXISTS "local_transport_rates_auth_update" ON public.local_transport_rates;
DROP POLICY IF EXISTS "local_transport_rates_auth_delete" ON public.local_transport_rates;

CREATE POLICY "local_transport_rates_auth_insert"
  ON public.local_transport_rates FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "local_transport_rates_auth_update"
  ON public.local_transport_rates FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "local_transport_rates_auth_delete"
  ON public.local_transport_rates FOR DELETE
  TO authenticated USING (true);