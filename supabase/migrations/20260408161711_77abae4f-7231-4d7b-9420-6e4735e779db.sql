-- COCKPIT-5 Phase 2: enrich known_business_contacts
ALTER TABLE public.known_business_contacts
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS service_types TEXT[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.known_business_contacts.contact_email
  IS 'Email de contact principal pour les demandes commerciales';
COMMENT ON COLUMN public.known_business_contacts.service_types
  IS 'Types de service : freight_maritime, freight_aerien, origin_charges, terminal, transport_local, etc.';