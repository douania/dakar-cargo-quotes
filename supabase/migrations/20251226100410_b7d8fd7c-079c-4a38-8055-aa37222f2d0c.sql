-- Create local transport rates table
CREATE TABLE public.local_transport_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origin TEXT NOT NULL DEFAULT 'Dakar Port',
  destination TEXT NOT NULL,
  container_type VARCHAR(20) NOT NULL, -- 20DV, 40DV, 40HC, etc.
  cargo_category VARCHAR(50) DEFAULT 'Dry', -- Dry, DG, Special IG, OOG
  rate_amount NUMERIC NOT NULL,
  rate_currency VARCHAR(10) DEFAULT 'XOF',
  rate_includes TEXT[], -- Ce qui est inclus dans le tarif
  validity_start DATE DEFAULT CURRENT_DATE,
  validity_end DATE,
  source_document VARCHAR(255),
  provider VARCHAR(100), -- Transporteur
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.local_transport_rates ENABLE ROW LEVEL SECURITY;

-- Create policy for public read access
CREATE POLICY "local_transport_rates_public_read" 
ON public.local_transport_rates 
FOR SELECT 
USING (true);

-- Create policy for service role to manage
CREATE POLICY "local_transport_rates_service_manage" 
ON public.local_transport_rates 
FOR ALL 
USING (true);

-- Create index for common queries
CREATE INDEX idx_local_transport_destination ON public.local_transport_rates(destination);
CREATE INDEX idx_local_transport_container ON public.local_transport_rates(container_type);
CREATE INDEX idx_local_transport_active ON public.local_transport_rates(is_active) WHERE is_active = true;

-- Add trigger for updated_at
CREATE TRIGGER update_local_transport_rates_updated_at
BEFORE UPDATE ON public.local_transport_rates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();