-- Create port_tariffs table for official port tariffs
CREATE TABLE public.port_tariffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR NOT NULL,
  category VARCHAR NOT NULL,
  operation_type VARCHAR NOT NULL,
  classification VARCHAR NOT NULL,
  cargo_type VARCHAR,
  amount NUMERIC NOT NULL,
  unit VARCHAR DEFAULT 'EVP',
  surcharge_percent NUMERIC DEFAULT 0,
  surcharge_conditions TEXT,
  source_document VARCHAR,
  effective_date DATE NOT NULL,
  expiry_date DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.port_tariffs ENABLE ROW LEVEL SECURITY;

-- Public read access for tariffs
CREATE POLICY "port_tariffs_public_read" ON public.port_tariffs
FOR SELECT USING (true);

-- Create index for common queries
CREATE INDEX idx_port_tariffs_provider ON public.port_tariffs(provider);
CREATE INDEX idx_port_tariffs_operation ON public.port_tariffs(operation_type);
CREATE INDEX idx_port_tariffs_active ON public.port_tariffs(is_active);

-- Add trigger for updated_at
CREATE TRIGGER update_port_tariffs_updated_at
BEFORE UPDATE ON public.port_tariffs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add comments
COMMENT ON TABLE public.port_tariffs IS 'Tarifs portuaires officiels (THC, magasinage, manutention)';
COMMENT ON COLUMN public.port_tariffs.provider IS 'Fournisseur: DP_WORLD, PAD, SODATRA';
COMMENT ON COLUMN public.port_tariffs.category IS 'Catégorie: THC, MAGASINAGE, RELEVAGE';
COMMENT ON COLUMN public.port_tariffs.operation_type IS 'Type opération: EXPORT, IMPORT, TRANSIT';
COMMENT ON COLUMN public.port_tariffs.source_document IS 'Référence du document officiel';