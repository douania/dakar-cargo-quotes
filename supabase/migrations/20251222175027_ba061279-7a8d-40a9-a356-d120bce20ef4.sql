-- Create known_business_contacts table for explicit role mapping
CREATE TABLE public.known_business_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_pattern TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL,
  default_role TEXT NOT NULL CHECK (default_role IN ('partner', 'client', 'supplier', 'agent', 'internal')),
  country TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.known_business_contacts ENABLE ROW LEVEL SECURITY;

-- Allow public read access (reference data)
CREATE POLICY "known_business_contacts_public_read" 
ON public.known_business_contacts 
FOR SELECT 
USING (true);

-- Insert known contacts
INSERT INTO public.known_business_contacts (domain_pattern, company_name, default_role, country, notes) VALUES
('2hlgroup.com', '2HL Group', 'partner', 'FR', 'Partenaire principal - TALEB'),
('group-7.de', 'GROUP7 AG', 'client', 'DE', 'Client final allemand'),
('kroll-international.de', 'Kroll International', 'supplier', 'DE', 'Agent/fournisseur pour cotations'),
('vector-gmbh.de', 'Vector GmbH', 'supplier', 'DE', 'Agent/fournisseur'),
('msc.com', 'MSC', 'supplier', NULL, 'Armateur'),
('cma-cgm.com', 'CMA CGM', 'supplier', NULL, 'Armateur'),
('maersk.com', 'MAERSK', 'supplier', NULL, 'Armateur'),
('hapag-lloyd.com', 'Hapag-Lloyd', 'supplier', NULL, 'Armateur'),
('one-line.com', 'ONE Line', 'supplier', NULL, 'Armateur'),
('sodatra.sn', 'SODATRA', 'internal', 'SN', 'Notre entreprise'),
('paklinkshipping.com', 'Paklink Shipping', 'agent', 'PK', 'Agent Pakistan');

-- Create trigger for updated_at
CREATE TRIGGER update_known_business_contacts_updated_at
BEFORE UPDATE ON public.known_business_contacts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();