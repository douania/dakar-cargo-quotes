
-- ============================================================
-- PAD-NST-2B — Migration structurelle : 7 tables NST (vides)
-- ============================================================

-- -------------------------------------------------------
-- Table 1 : nst_divisions (20 divisions NST 2007)
-- -------------------------------------------------------
CREATE TABLE public.nst_divisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_code text NOT NULL UNIQUE,
  label_en text NOT NULL,
  label_fr text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_division_code_format CHECK (division_code ~ '^[0-9]{2}$')
);

ALTER TABLE public.nst_divisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read nst_divisions"
  ON public.nst_divisions FOR SELECT TO authenticated USING (true);

-- -------------------------------------------------------
-- Table 2 : nst_groups (81 groupes NST 2007)
-- -------------------------------------------------------
CREATE TABLE public.nst_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_code text NOT NULL UNIQUE,
  division_code text NOT NULL REFERENCES public.nst_divisions(division_code),
  label_en text NOT NULL,
  label_fr text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_group_code_format CHECK (group_code ~ '^[0-9]{2}\.[0-9A-Z]$')
);

CREATE INDEX idx_nst_groups_division_code ON public.nst_groups(division_code);

ALTER TABLE public.nst_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read nst_groups"
  ON public.nst_groups FOR SELECT TO authenticated USING (true);

-- -------------------------------------------------------
-- Table 3 : nst_mapping_sources (traçabilité fichiers)
-- -------------------------------------------------------
CREATE TABLE public.nst_mapping_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name text NOT NULL,
  source_type text NOT NULL,
  sha256_hash text NOT NULL,
  row_count integer,
  source_uri text,
  local_path text,
  phase text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nst_mapping_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read nst_mapping_sources"
  ON public.nst_mapping_sources FOR SELECT TO authenticated USING (true);

-- -------------------------------------------------------
-- Table 4 : nst_cn_mappings (NST 2007 ↔ CN 2024)
-- -------------------------------------------------------
CREATE TABLE public.nst_cn_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nst_group_code text NOT NULL REFERENCES public.nst_groups(group_code),
  cn_code text NOT NULL,
  cn_label text,
  hs6_prefix text,
  source_id uuid NOT NULL REFERENCES public.nst_mapping_sources(id),
  source_row_number integer,
  source_uri text,
  target_uri text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_cn_code_format CHECK (cn_code ~ '^[0-9]{8}$'),
  CONSTRAINT chk_hs6_prefix_format CHECK (hs6_prefix IS NULL OR hs6_prefix ~ '^[0-9]{6}$')
);

CREATE INDEX idx_nst_cn_mappings_group_code ON public.nst_cn_mappings(nst_group_code);
CREATE INDEX idx_nst_cn_mappings_cn_code ON public.nst_cn_mappings(cn_code);
CREATE INDEX idx_nst_cn_mappings_hs6_prefix ON public.nst_cn_mappings(hs6_prefix);
CREATE INDEX idx_nst_cn_mappings_source_id ON public.nst_cn_mappings(source_id);

ALTER TABLE public.nst_cn_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read nst_cn_mappings"
  ON public.nst_cn_mappings FOR SELECT TO authenticated USING (true);

-- -------------------------------------------------------
-- Table 5 : nst_cpa_mappings (NST 2007 ↔ CPA 2.1)
-- -------------------------------------------------------
CREATE TABLE public.nst_cpa_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nst_group_code text NOT NULL REFERENCES public.nst_groups(group_code),
  cpa_code text NOT NULL,
  cpa_label text,
  source_id uuid NOT NULL REFERENCES public.nst_mapping_sources(id),
  source_row_number integer,
  source_uri text,
  target_uri text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_nst_cpa_mappings_group_code ON public.nst_cpa_mappings(nst_group_code);
CREATE INDEX idx_nst_cpa_mappings_cpa_code ON public.nst_cpa_mappings(cpa_code);
CREATE INDEX idx_nst_cpa_mappings_source_id ON public.nst_cpa_mappings(source_id);

ALTER TABLE public.nst_cpa_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read nst_cpa_mappings"
  ON public.nst_cpa_mappings FOR SELECT TO authenticated USING (true);

-- -------------------------------------------------------
-- Table 6 : nst_nhm_mappings (NST 2007 ↔ NHM 2025)
-- -------------------------------------------------------
CREATE TABLE public.nst_nhm_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nst_group_code text NOT NULL REFERENCES public.nst_groups(group_code),
  nhm_code text NOT NULL,
  nhm_label text,
  source_id uuid NOT NULL REFERENCES public.nst_mapping_sources(id),
  source_row_number integer,
  source_uri text,
  target_uri text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_nst_nhm_mappings_group_code ON public.nst_nhm_mappings(nst_group_code);
CREATE INDEX idx_nst_nhm_mappings_nhm_code ON public.nst_nhm_mappings(nhm_code);
CREATE INDEX idx_nst_nhm_mappings_source_id ON public.nst_nhm_mappings(source_id);

ALTER TABLE public.nst_nhm_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read nst_nhm_mappings"
  ON public.nst_nhm_mappings FOR SELECT TO authenticated USING (true);

-- -------------------------------------------------------
-- Table 7 : nstr_nst2007_mappings (NST/R 1967 ↔ NST 2007)
-- -------------------------------------------------------
CREATE TABLE public.nstr_nst2007_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nstr_code text,
  nstr_chapter text,
  nstr_label text,
  cn2008_code text,
  cpa2008_code text,
  nst2007_code text NOT NULL REFERENCES public.nst_groups(group_code),
  nst2007_label text,
  is_quarantined boolean NOT NULL DEFAULT false,
  quarantine_reason text,
  source_id uuid NOT NULL REFERENCES public.nst_mapping_sources(id),
  source_row_number integer,
  source_uri text,
  target_uri text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_nstr_code_format CHECK (nstr_code IS NULL OR nstr_code ~ '^[0-9]{3}$'),
  CONSTRAINT chk_nstr_chapter_format CHECK (nstr_chapter IS NULL OR nstr_chapter ~ '^[0-9]{2}$'),
  CONSTRAINT chk_nst2007_not_dot CHECK (nst2007_code <> '.')
);

CREATE INDEX idx_nstr_mappings_nstr_code ON public.nstr_nst2007_mappings(nstr_code);
CREATE INDEX idx_nstr_mappings_nstr_chapter ON public.nstr_nst2007_mappings(nstr_chapter);
CREATE INDEX idx_nstr_mappings_nst2007_code ON public.nstr_nst2007_mappings(nst2007_code);
CREATE INDEX idx_nstr_mappings_source_id ON public.nstr_nst2007_mappings(source_id);

ALTER TABLE public.nstr_nst2007_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read nstr_nst2007_mappings"
  ON public.nstr_nst2007_mappings FOR SELECT TO authenticated USING (true);
