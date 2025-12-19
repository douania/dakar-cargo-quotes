-- Create carrier_billing_templates table
CREATE TABLE public.carrier_billing_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier VARCHAR NOT NULL,
  invoice_type VARCHAR DEFAULT 'CONSOLIDATED',
  invoice_sequence INTEGER DEFAULT 1,
  charge_code VARCHAR NOT NULL,
  charge_name VARCHAR NOT NULL,
  operation_type VARCHAR DEFAULT 'ALL',
  calculation_method VARCHAR NOT NULL,
  base_reference VARCHAR,
  default_amount NUMERIC,
  currency VARCHAR DEFAULT 'XOF',
  vat_rate NUMERIC DEFAULT 18,
  is_variable BOOLEAN DEFAULT false,
  variable_unit VARCHAR,
  notes TEXT,
  source_documents TEXT[],
  effective_date DATE DEFAULT CURRENT_DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.carrier_billing_templates ENABLE ROW LEVEL SECURITY;

-- Public read policy
CREATE POLICY "carrier_billing_templates_public_read" 
ON public.carrier_billing_templates 
FOR SELECT 
USING (true);

-- Create trigger for updated_at
CREATE TRIGGER update_carrier_billing_templates_updated_at
BEFORE UPDATE ON public.carrier_billing_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();