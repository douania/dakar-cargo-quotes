ALTER TABLE public.customs_regimes
ADD COLUMN IF NOT EXISTS hors_promad boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS hors_bic boolean DEFAULT false;