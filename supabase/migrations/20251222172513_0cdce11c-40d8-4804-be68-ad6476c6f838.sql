-- Create contacts table for tracking business relationships
CREATE TABLE public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  company TEXT,
  role TEXT CHECK (role IN ('client', 'partner', 'supplier', 'agent', 'prospect', 'internal')),
  country TEXT,
  is_trusted BOOLEAN DEFAULT false,
  notes TEXT,
  interaction_count INTEGER DEFAULT 0,
  last_interaction_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create email_threads table for grouping related emails
CREATE TABLE public.email_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_normalized TEXT NOT NULL,
  first_message_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ,
  participants JSONB DEFAULT '[]'::jsonb,
  client_email TEXT,
  client_company TEXT,
  our_role TEXT CHECK (our_role IN ('direct_quote', 'assist_partner')),
  partner_email TEXT,
  project_name TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'quoted', 'won', 'lost', 'archived')),
  email_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add thread_ref column to emails table to link to email_threads
ALTER TABLE public.emails ADD COLUMN IF NOT EXISTS thread_ref UUID REFERENCES public.email_threads(id);
ALTER TABLE public.emails ADD COLUMN IF NOT EXISTS cc_addresses TEXT[];

-- Enable RLS
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_threads ENABLE ROW LEVEL SECURITY;

-- RLS policies for contacts (deny client access, service role only)
CREATE POLICY "Deny all client access to contacts" 
ON public.contacts 
FOR ALL 
USING (false)
WITH CHECK (false);

-- RLS policies for email_threads (read-only for clients)
CREATE POLICY "email_threads_public_read" 
ON public.email_threads 
FOR SELECT 
USING (true);

-- Create indexes for performance
CREATE INDEX idx_contacts_email ON public.contacts(email);
CREATE INDEX idx_contacts_company ON public.contacts(company);
CREATE INDEX idx_contacts_role ON public.contacts(role);
CREATE INDEX idx_email_threads_subject ON public.email_threads(subject_normalized);
CREATE INDEX idx_email_threads_client ON public.email_threads(client_email);
CREATE INDEX idx_email_threads_status ON public.email_threads(status);
CREATE INDEX idx_emails_thread_ref ON public.emails(thread_ref);

-- Trigger for updated_at
CREATE TRIGGER update_contacts_updated_at
BEFORE UPDATE ON public.contacts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_email_threads_updated_at
BEFORE UPDATE ON public.email_threads
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();