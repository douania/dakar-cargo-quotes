-- T3: Add audit columns for quantity tracking
ALTER TABLE public.quote_service_pricing 
  ADD COLUMN IF NOT EXISTS quantity_used numeric,
  ADD COLUMN IF NOT EXISTS unit_used text;