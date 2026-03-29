
-- Bloc 2: Add write policies for reference tables (shared workspace authenticated CRUD)

-- hs_codes: add UPDATE + DELETE for authenticated (INSERT goes via import-hs-codes service_role)
CREATE POLICY "hs_codes_update_authenticated" ON public.hs_codes
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "hs_codes_delete_authenticated" ON public.hs_codes
  FOR DELETE TO authenticated USING (true);

-- tax_rates: add INSERT + UPDATE for authenticated
CREATE POLICY "tax_rates_insert_authenticated" ON public.tax_rates
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "tax_rates_update_authenticated" ON public.tax_rates
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- customs_regimes: add INSERT + UPDATE for authenticated
CREATE POLICY "customs_regimes_insert_authenticated" ON public.customs_regimes
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "customs_regimes_update_authenticated" ON public.customs_regimes
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- port_tariffs: add INSERT + UPDATE + DELETE for authenticated
CREATE POLICY "port_tariffs_insert_authenticated" ON public.port_tariffs
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "port_tariffs_update_authenticated" ON public.port_tariffs
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "port_tariffs_delete_authenticated" ON public.port_tariffs
  FOR DELETE TO authenticated USING (true);

-- pricing_client_overrides: add INSERT + UPDATE + DELETE for authenticated
CREATE POLICY "client_overrides_insert_authenticated" ON public.pricing_client_overrides
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "client_overrides_update_authenticated" ON public.pricing_client_overrides
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "client_overrides_delete_authenticated" ON public.pricing_client_overrides
  FOR DELETE TO authenticated USING (true);
