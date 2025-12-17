-- Table pour stocker les alertes de veille marché
CREATE TABLE public.market_intelligence (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL, -- douanes.sn, portdakar.sn, msc.com, etc.
  category TEXT NOT NULL, -- regulation, tariff, market_change, news
  title TEXT NOT NULL,
  summary TEXT,
  content TEXT,
  url TEXT,
  impact_level TEXT DEFAULT 'medium', -- low, medium, high, critical
  is_processed BOOLEAN DEFAULT false,
  detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table pour stocker les profils d'experts (comme Taleb)
CREATE TABLE public.expert_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT DEFAULT 'operations',
  expertise TEXT[], -- ['quotation', 'negotiation', 'customs', 'maritime']
  communication_style JSONB, -- Style de communication appris
  response_patterns JSONB, -- Patterns de réponse appris
  quotation_templates JSONB, -- Templates de cotation
  learned_from_count INTEGER DEFAULT 0,
  last_learned_at TIMESTAMP WITH TIME ZONE,
  is_primary BOOLEAN DEFAULT false, -- Expert principal à imiter
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table pour les sources de veille configurées
CREATE TABLE public.surveillance_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  category TEXT NOT NULL, -- regulation, port, shipping, news
  scrape_frequency TEXT DEFAULT 'weekly', -- daily, weekly, monthly
  last_scraped_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  selectors JSONB, -- CSS selectors for scraping
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.market_intelligence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expert_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surveillance_sources ENABLE ROW LEVEL SECURITY;

-- Policies - public read/write pour l'application interne
CREATE POLICY "Allow all operations on market_intelligence" ON public.market_intelligence FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on expert_profiles" ON public.expert_profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on surveillance_sources" ON public.surveillance_sources FOR ALL USING (true) WITH CHECK (true);

-- Insérer le profil de Taleb comme expert principal
INSERT INTO public.expert_profiles (name, email, role, expertise, is_primary) 
VALUES ('Taleb Hoballah', 'th@2hlgroup.com', 'operations', ARRAY['quotation', 'negotiation', 'customs', 'maritime', 'breakbulk'], true);

-- Insérer les sources de veille
INSERT INTO public.surveillance_sources (name, url, category) VALUES
('Douanes Sénégal', 'https://douanes.sn', 'regulation'),
('ORBUS', 'https://orfreetrade.com', 'regulation'),
('Port Autonome de Dakar', 'https://portdakar.sn', 'port'),
('DP World Dakar', 'https://www.dpworld.com/senegal', 'port'),
('MSC', 'https://www.msc.com', 'shipping'),
('CMA CGM', 'https://www.cma-cgm.com', 'shipping'),
('Maersk', 'https://www.maersk.com', 'shipping'),
('Financial Afrik', 'https://www.financialafrik.com', 'news');