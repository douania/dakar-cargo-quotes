-- Create customs_regimes table to store regime codes and applicable taxes
CREATE TABLE public.customs_regimes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(10) NOT NULL UNIQUE,
  name VARCHAR(255),
  dd BOOLEAN DEFAULT false,
  stx BOOLEAN DEFAULT false,
  rs BOOLEAN DEFAULT false,
  tin BOOLEAN DEFAULT false,
  tva BOOLEAN DEFAULT false,
  cosec BOOLEAN DEFAULT false,
  pcs BOOLEAN DEFAULT false,
  pcc BOOLEAN DEFAULT false,
  tpast BOOLEAN DEFAULT false,
  ta BOOLEAN DEFAULT false,
  fixed_amount NUMERIC DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.customs_regimes ENABLE ROW LEVEL SECURITY;

-- Public read policy
CREATE POLICY "customs_regimes_public_read" ON public.customs_regimes
  FOR SELECT USING (true);

-- Add update trigger
CREATE TRIGGER update_customs_regimes_updated_at
  BEFORE UPDATE ON public.customs_regimes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Insert all 56 regimes from the screenshots
INSERT INTO public.customs_regimes (code, dd, stx, rs, tin, tva, cosec, pcs, pcc, tpast, ta) VALUES
-- From screenshot 3 (first page)
('C100', true, true, true, true, true, true, true, true, true, true),
('S300', true, false, false, false, false, true, false, false, false, false),
('S320', false, false, false, false, true, false, false, false, false, false),
('S530', false, false, false, false, true, false, false, false, false, false),
('S600', true, false, false, false, true, false, false, false, false, false),
('S110', false, false, false, false, false, false, false, false, false, false),
('S951', true, false, false, false, false, false, false, false, false, false),
('E100', false, false, false, false, false, false, false, false, false, false),
('S301', false, false, false, false, false, false, false, false, false, false),
('S321', false, false, false, false, false, false, false, false, false, false),
('S531', false, false, false, false, false, false, false, false, false, false),
('S601', false, false, false, false, false, false, false, false, false, false),
('S521', false, false, false, false, false, false, false, false, false, false),
('S952', false, false, false, false, false, false, false, false, false, false),
('C121', false, false, true, false, false, true, true, true, false, false),
('C122', true, false, true, false, false, true, true, true, false, false),
('C123', false, false, false, false, false, false, false, false, false, false),
('C124', false, false, false, false, false, false, false, false, false, false),
('C131', true, false, true, false, false, true, true, true, false, false),
('C132', true, false, true, false, false, true, true, true, false, false),
('C138', false, false, true, false, false, true, true, true, false, false),
('C140', false, false, false, false, false, true, true, true, false, false),
('C321', false, false, true, false, false, true, true, true, false, false),
('C322', true, false, true, false, false, true, true, true, false, false),
-- From screenshot 2 (second page)
('C331', true, false, true, false, false, true, true, true, false, false),
('C332', false, false, true, false, false, true, true, true, false, false),
('C340', false, false, false, false, false, false, false, false, false, false),
('C303', true, true, true, false, true, true, true, true, false, false),
('C139', true, true, true, false, false, true, true, true, false, false),
('C301', true, true, true, false, false, true, true, true, false, false),
('C201', true, true, true, true, true, true, true, true, false, false),
('R320', true, false, false, false, false, false, false, false, false, false),
('C401', true, true, true, false, false, false, false, false, false, false),
('S520', false, false, false, false, false, false, false, false, false, false),
('R300', false, false, false, false, false, false, false, false, false, false),
('R520', false, false, false, false, false, false, false, false, false, false),
('R530', false, false, false, false, false, false, false, false, false, false),
('R951', false, false, false, false, false, false, false, false, false, false),
('S954', false, false, false, false, false, false, false, false, false, false),
('C501', true, true, true, true, false, true, true, true, true, true),
('C502', true, true, true, true, false, false, false, false, false, false),
('C503', true, true, true, true, false, false, true, true, false, true),
('C520', true, true, true, true, false, false, true, true, false, true),
('C530', true, true, true, true, true, false, true, true, false, true),
('C521', false, false, false, false, false, true, true, true, false, false),
('C522', false, false, false, false, false, false, false, false, false, false),
('C531', false, false, true, false, false, true, true, true, false, false),
('C540', true, false, false, false, false, false, false, false, false, false),
-- From screenshot 1 (third page)
('C951', true, true, true, true, true, true, true, true, false, true),
('C600', true, true, true, true, true, true, true, true, false, true),
('E840', true, false, false, false, false, false, false, false, false, false),
('R510', false, false, false, false, false, false, false, false, false, false),
('S510', false, false, false, true, false, false, false, false, false, false),
('C339', true, false, true, false, false, true, true, true, false, false),
('S972', false, false, false, true, true, false, true, false, false, false);