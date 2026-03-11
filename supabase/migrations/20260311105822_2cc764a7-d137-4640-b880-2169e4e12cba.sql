-- Phase 3: Référentiel locations — tables de préparation
-- Ces tables ne sont PAS encore connectées au runtime

-- Table 1: locations_reference
CREATE TABLE public.locations_reference (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL,
  country_code text NOT NULL,
  location_type text NOT NULL CHECK (location_type IN ('sea', 'air', 'inland')),
  city text,
  country_name text,
  is_active boolean NOT NULL DEFAULT true,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  validated_by uuid,
  validated_at timestamptz
);

-- Pas de UNIQUE sur canonical_name seul (risque de collision entre contextes)
-- L'unicité sera gérée via location_aliases.normalized_alias

ALTER TABLE public.locations_reference ENABLE ROW LEVEL SECURITY;

CREATE POLICY "locations_reference_select_authenticated"
  ON public.locations_reference FOR SELECT TO authenticated USING (true);

-- Pas de policy INSERT/UPDATE/DELETE pour authenticated
-- Maintenance par service_role uniquement

-- Table 2: location_aliases
CREATE TABLE public.location_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations_reference(id) ON DELETE CASCADE,
  alias_text text NOT NULL,
  normalized_alias text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  validated_by uuid,
  CONSTRAINT location_aliases_normalized_alias_unique UNIQUE (normalized_alias)
);

-- normalized_alias est rempli explicitement en UPPER() à l'insertion (pas de generated column)
-- Plus robuste et compatible Supabase sans ambiguïté syntaxique

ALTER TABLE public.location_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "location_aliases_select_authenticated"
  ON public.location_aliases FOR SELECT TO authenticated USING (true);

-- Pas de policy INSERT/UPDATE/DELETE pour authenticated
-- Maintenance par service_role uniquement

-- Index pour résolution rapide alias → location
CREATE INDEX idx_location_aliases_normalized ON public.location_aliases (normalized_alias);