-- Create quotation_history table for storing learned quotation tariffs
CREATE TABLE public.quotation_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  route_origin TEXT,
  route_port TEXT NOT NULL DEFAULT 'Dakar',
  route_destination TEXT NOT NULL,
  route_hash TEXT GENERATED ALWAYS AS (
    lower(coalesce(route_origin, '') || '|' || route_port || '|' || route_destination)
  ) STORED,
  cargo_type TEXT NOT NULL,
  container_types TEXT[],
  client_name TEXT,
  client_company TEXT,
  partner_company TEXT,
  project_name TEXT,
  incoterm TEXT,
  tariff_lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_amount NUMERIC,
  total_currency TEXT DEFAULT 'FCFA',
  margin_percent NUMERIC,
  regulatory_info JSONB,
  source_email_id UUID,
  source_attachment_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes for efficient searching
CREATE INDEX idx_quotation_history_route_hash ON public.quotation_history(route_hash);
CREATE INDEX idx_quotation_history_cargo_type ON public.quotation_history(cargo_type);
CREATE INDEX idx_quotation_history_client ON public.quotation_history(client_company);
CREATE INDEX idx_quotation_history_created ON public.quotation_history(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.quotation_history ENABLE ROW LEVEL SECURITY;

-- Create policy for edge functions (service role) to read/write
CREATE POLICY "quotation_history_service_access" 
ON public.quotation_history 
FOR ALL 
USING (true);

-- Create trigger for updated_at
CREATE TRIGGER update_quotation_history_updated_at
BEFORE UPDATE ON public.quotation_history
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();