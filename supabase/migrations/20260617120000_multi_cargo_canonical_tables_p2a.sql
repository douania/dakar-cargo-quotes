-- MULTI-CARGO-LINES-ARCHITECTURE-1 / Phase 2-A : DB foundation (additive, inerte)
--
-- Tables canoniques futures pour le support multi-cargo.
-- AUCUN code runtime ne consomme ces tables dans cette phase : la migration est
-- purement structurelle et n'altère aucun comportement existant.
--   * pas de modification de quote_facts (reste mono-valué)
--   * pas de modification de quote_request_lines (staging / détection inchangés)
--   * pas de backfill, pas de RPC, pas d'adoption runtime
-- Pattern RLS aligné sur quote_request_lines (lecture équipe authentifiée),
-- conformément au correctif 20260214110527 « lecture équipe authentifiée ».

-- =====================================================================
-- 1. cargo_lines : ligne cargo canonique au niveau dossier
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.cargo_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES quote_cases(id) ON DELETE CASCADE,
  line_index INTEGER NOT NULL CHECK (line_index >= 1),
  status TEXT NOT NULL DEFAULT 'to_confirm'
    CHECK (status IN ('to_confirm', 'confirmed', 'superseded')),

  -- Données cargo (toutes nullables : remplissage progressif puis confirmé)
  description TEXT,
  hs_code TEXT,
  value_number NUMERIC,
  value_currency TEXT,
  weight_kg NUMERIC,
  volume_cbm NUMERIC,
  pieces_count NUMERIC,

  -- Provenance (signal de détection / email source). FK SET NULL : la donnée
  -- canonique survit à la disparition du signal de staging.
  source_quote_request_line_id UUID REFERENCES quote_request_lines(id) ON DELETE SET NULL,
  source_email_id UUID REFERENCES emails(id) ON DELETE SET NULL,
  source_excerpt TEXT,

  -- Supersession temporelle (aligné sur le modèle quote_facts.is_current)
  supersedes_cargo_line_id UUID REFERENCES public.cargo_lines(id),
  is_current BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Invariant de supersession : une ligne 'superseded' ne peut pas rester courante.
  CONSTRAINT cargo_lines_superseded_not_current
    CHECK (NOT (status = 'superseded' AND is_current = true))
);

-- Un seul line_index courant par dossier (partial unique, style uq_quote_facts_current_key)
CREATE UNIQUE INDEX IF NOT EXISTS uq_cargo_lines_current_line
  ON public.cargo_lines(case_id, line_index) WHERE is_current = true;

-- Clé composite (id, case_id) : cible de la FK composite cargo_equipment -> cargo_lines
-- garantissant la cohérence du case_id. Non-partielle : requis pour servir de cible de FK.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cargo_lines_id_case
  ON public.cargo_lines(id, case_id);

CREATE INDEX IF NOT EXISTS idx_cargo_lines_case ON public.cargo_lines(case_id);
CREATE INDEX IF NOT EXISTS idx_cargo_lines_status ON public.cargo_lines(status);
CREATE INDEX IF NOT EXISTS idx_cargo_lines_source_qrl
  ON public.cargo_lines(source_quote_request_line_id)
  WHERE source_quote_request_line_id IS NOT NULL;

-- =====================================================================
-- 2. cargo_equipment : équipement / conteneur canonique
--    cargo_line_id nullable : équipement rattaché à une ligne (1:N) OU
--    équipement de dossier / partagé non encore alloué (cargo_line_id IS NULL).
--    Une relation many-to-many ligne <-> équipement n'est PAS requise ici et
--    pourra être ajoutée plus tard de façon additive si un cas réel l'impose.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.cargo_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES quote_cases(id) ON DELETE CASCADE,
  cargo_line_id UUID,
  equipment_type TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'to_confirm'
    CHECK (status IN ('to_confirm', 'confirmed', 'superseded')),

  -- Provenance (similaire à cargo_lines, là où c'est pertinent)
  source_quote_request_line_id UUID REFERENCES quote_request_lines(id) ON DELETE SET NULL,
  source_email_id UUID REFERENCES emails(id) ON DELETE SET NULL,
  source_excerpt TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Cohérence tenant : si cargo_line_id est renseigné, la ligne cargo référencée
  -- doit appartenir au MÊME case_id. FK composite en MATCH SIMPLE (défaut) : non
  -- contrainte lorsque cargo_line_id IS NULL (équipement de dossier / partagé).
  CONSTRAINT cargo_equipment_line_case_fk
    FOREIGN KEY (cargo_line_id, case_id)
    REFERENCES public.cargo_lines(id, case_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cargo_equipment_case ON public.cargo_equipment(case_id);
CREATE INDEX IF NOT EXISTS idx_cargo_equipment_line
  ON public.cargo_equipment(cargo_line_id) WHERE cargo_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cargo_equipment_type ON public.cargo_equipment(equipment_type);

-- =====================================================================
-- 3. RLS : lecture équipe authentifiée (aligné quote_request_lines).
--    Aucune écriture authenticated dans cette phase : les écritures futures
--    passeront par service_role (bypass RLS + privilèges par défaut Supabase,
--    exactement comme quote_request_lines aujourd'hui).
-- =====================================================================
ALTER TABLE public.cargo_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargo_equipment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cargo_lines_select_team" ON public.cargo_lines;
CREATE POLICY "cargo_lines_select_team"
  ON public.cargo_lines FOR SELECT TO authenticated
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "cargo_equipment_select_team" ON public.cargo_equipment;
CREATE POLICY "cargo_equipment_select_team"
  ON public.cargo_equipment FOR SELECT TO authenticated
  USING (auth.role() = 'authenticated');

-- =====================================================================
-- 4. Grants (aligné quote_request_lines) : SELECT authenticated uniquement.
--    service_role conserve l'accès via les privilèges par défaut Supabase ;
--    aucun INSERT / UPDATE / DELETE accordé à authenticated dans cette phase.
-- =====================================================================
REVOKE ALL ON public.cargo_lines FROM PUBLIC;
REVOKE ALL ON public.cargo_lines FROM anon;
REVOKE ALL ON public.cargo_lines FROM authenticated;
GRANT SELECT ON public.cargo_lines TO authenticated;

REVOKE ALL ON public.cargo_equipment FROM PUBLIC;
REVOKE ALL ON public.cargo_equipment FROM anon;
REVOKE ALL ON public.cargo_equipment FROM authenticated;
GRANT SELECT ON public.cargo_equipment TO authenticated;
