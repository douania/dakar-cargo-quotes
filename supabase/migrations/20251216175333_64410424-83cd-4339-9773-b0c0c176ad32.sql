-- Créer la fonction update_updated_at_column si elle n'existe pas
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Table pour stocker les emails synchronisés
CREATE TABLE public.emails (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email_config_id UUID REFERENCES public.email_configs(id) ON DELETE CASCADE,
  message_id TEXT UNIQUE NOT NULL,
  thread_id TEXT,
  from_address TEXT NOT NULL,
  to_addresses TEXT[] NOT NULL,
  cc_addresses TEXT[],
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  sent_at TIMESTAMP WITH TIME ZONE,
  received_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  is_read BOOLEAN DEFAULT false,
  is_quotation_request BOOLEAN DEFAULT false,
  extracted_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Table pour les connaissances apprises
CREATE TABLE public.learned_knowledge (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  data JSONB NOT NULL,
  source_type TEXT,
  source_id UUID,
  confidence NUMERIC DEFAULT 0.5,
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMP WITH TIME ZONE,
  is_validated BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Table pour les brouillons de réponses
CREATE TABLE public.email_drafts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  original_email_id UUID REFERENCES public.emails(id),
  to_addresses TEXT[] NOT NULL,
  cc_addresses TEXT[],
  subject TEXT NOT NULL,
  body_text TEXT,
  body_html TEXT,
  status TEXT DEFAULT 'draft',
  ai_generated BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  sent_at TIMESTAMP WITH TIME ZONE
);

-- Index
CREATE INDEX idx_emails_thread ON public.emails(thread_id);
CREATE INDEX idx_emails_from ON public.emails(from_address);
CREATE INDEX idx_emails_quotation ON public.emails(is_quotation_request) WHERE is_quotation_request = true;
CREATE INDEX idx_learned_category ON public.learned_knowledge(category);

-- Enable RLS
ALTER TABLE public.emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learned_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_drafts ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "emails_public_read" ON public.emails FOR SELECT USING (true);
CREATE POLICY "emails_public_insert" ON public.emails FOR INSERT WITH CHECK (true);
CREATE POLICY "emails_public_update" ON public.emails FOR UPDATE USING (true);
CREATE POLICY "emails_public_delete" ON public.emails FOR DELETE USING (true);

CREATE POLICY "learned_public_read" ON public.learned_knowledge FOR SELECT USING (true);
CREATE POLICY "learned_public_insert" ON public.learned_knowledge FOR INSERT WITH CHECK (true);
CREATE POLICY "learned_public_update" ON public.learned_knowledge FOR UPDATE USING (true);
CREATE POLICY "learned_public_delete" ON public.learned_knowledge FOR DELETE USING (true);

CREATE POLICY "drafts_public_read" ON public.email_drafts FOR SELECT USING (true);
CREATE POLICY "drafts_public_insert" ON public.email_drafts FOR INSERT WITH CHECK (true);
CREATE POLICY "drafts_public_update" ON public.email_drafts FOR UPDATE USING (true);
CREATE POLICY "drafts_public_delete" ON public.email_drafts FOR DELETE USING (true);

-- Trigger
CREATE TRIGGER update_learned_knowledge_updated_at
BEFORE UPDATE ON public.learned_knowledge
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();