-- Drop the overly permissive public read policy on local_transport_rates
DROP POLICY IF EXISTS "local_transport_rates_public_read" ON public.local_transport_rates;
DROP POLICY IF EXISTS "local_transport_rates_service_manage" ON public.local_transport_rates;

-- The auth_read policy already exists, ensure it uses simple USING (true) for authenticated
DROP POLICY IF EXISTS "local_transport_rates_auth_read" ON public.local_transport_rates;
CREATE POLICY "local_transport_rates_auth_read"
  ON public.local_transport_rates FOR SELECT
  TO authenticated USING (true);