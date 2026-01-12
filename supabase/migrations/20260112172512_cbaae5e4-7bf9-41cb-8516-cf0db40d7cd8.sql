-- Phase 1: Tables pour gestion des tenders multi-segments

-- Table principale des projets tender
CREATE TABLE public.tender_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT NOT NULL,
  client TEXT,
  tender_type TEXT DEFAULT 'un_demobilization',
  status TEXT DEFAULT 'draft',
  origin_country TEXT,
  deadline DATE,
  source_email_id UUID REFERENCES public.emails(id),
  source_attachment_id UUID REFERENCES public.email_attachments(id),
  cargo_summary JSONB DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des segments (legs) du tender
CREATE TABLE public.tender_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id UUID REFERENCES public.tender_projects(id) ON DELETE CASCADE,
  segment_order INTEGER NOT NULL DEFAULT 1,
  segment_type TEXT NOT NULL,
  origin_location TEXT NOT NULL,
  destination_location TEXT NOT NULL,
  partner_company TEXT,
  partner_email TEXT,
  rate_per_unit DECIMAL,
  rate_unit TEXT DEFAULT 'm3',
  currency TEXT DEFAULT 'EUR',
  source_email_id UUID REFERENCES public.emails(id),
  source_learned_knowledge_id UUID REFERENCES public.learned_knowledge(id),
  status TEXT DEFAULT 'pending',
  inclusions TEXT[] DEFAULT '{}',
  exclusions TEXT[] DEFAULT '{}',
  additional_charges JSONB DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des contingents (lignes du tender)
CREATE TABLE public.tender_contingents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id UUID REFERENCES public.tender_projects(id) ON DELETE CASCADE,
  contingent_name TEXT NOT NULL,
  origin_location TEXT,
  destination_port TEXT,
  destination_site TEXT,
  rfps_number TEXT,
  cargo_teus INTEGER DEFAULT 0,
  cargo_vehicles INTEGER DEFAULT 0,
  cargo_tonnes DECIMAL DEFAULT 0,
  cargo_cbm DECIMAL DEFAULT 0,
  deadline_ddd DATE,
  cargo_readiness DATE,
  loading_date_pol DATE,
  status TEXT DEFAULT 'pending',
  total_cost_estimate DECIMAL,
  margin_percent DECIMAL DEFAULT 10,
  selling_price DECIMAL,
  segment_costs JSONB DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.tender_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tender_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tender_contingents ENABLE ROW LEVEL SECURITY;

-- Policies for read access
CREATE POLICY "tender_projects_public_read" ON public.tender_projects
  FOR SELECT USING (true);

CREATE POLICY "tender_segments_public_read" ON public.tender_segments
  FOR SELECT USING (true);

CREATE POLICY "tender_contingents_public_read" ON public.tender_contingents
  FOR SELECT USING (true);

-- Policies for service role management
CREATE POLICY "tender_projects_service_manage" ON public.tender_projects
  FOR ALL USING (true);

CREATE POLICY "tender_segments_service_manage" ON public.tender_segments
  FOR ALL USING (true);

CREATE POLICY "tender_contingents_service_manage" ON public.tender_contingents
  FOR ALL USING (true);

-- Triggers for updated_at
CREATE TRIGGER update_tender_projects_updated_at
  BEFORE UPDATE ON public.tender_projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_tender_segments_updated_at
  BEFORE UPDATE ON public.tender_segments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_tender_contingents_updated_at
  BEFORE UPDATE ON public.tender_contingents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Index for performance
CREATE INDEX idx_tender_segments_tender_id ON public.tender_segments(tender_id);
CREATE INDEX idx_tender_contingents_tender_id ON public.tender_contingents(tender_id);
CREATE INDEX idx_tender_projects_status ON public.tender_projects(status);
CREATE INDEX idx_tender_projects_reference ON public.tender_projects(reference);