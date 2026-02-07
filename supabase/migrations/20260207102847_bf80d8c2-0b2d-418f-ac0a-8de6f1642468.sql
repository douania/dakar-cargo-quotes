
-- Fix security definer warning: explicitly set SECURITY INVOKER
ALTER VIEW public.historical_quotation_profiles SET (security_invoker = on);
