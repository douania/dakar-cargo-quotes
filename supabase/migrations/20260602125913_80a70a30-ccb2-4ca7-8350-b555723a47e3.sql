-- ============================================================
-- PAD-V5-SHADOW-IMPORT-DESIGN-1 — Phase A1 (table only, no data)
-- ============================================================

CREATE TABLE public.pad_cn2008_mapping_v5_shadow (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Provenance
  source_version           text        NOT NULL,
  source_hash              text        NOT NULL,
  source_document          text        NOT NULL DEFAULT 'PAD_NSTR_CN2008_V5_SHADOW_PACKAGE',
  source_reference         text,

  -- Empreinte ligne déterministe, calculée à l'import :
  --   row_key = sha256_hex(
  --     source_version || '|' || nstr3_code || '|' ||
  --     COALESCE(cn2008_code,'')  || '|' ||
  --     COALESCE(nst2007_code,'') || '|' ||
  --     COALESCE(cn2008_label,'')
  --   )
  row_key                  text        NOT NULL,

  -- Clés métier
  nstr3_code               text        NOT NULL,
  parent_nstr2             text        NOT NULL,
  nstr_label               text,
  cn2008_code              text,
  cn2008_label             text,
  nst2007_code             text,
  nst2007_label            text,
  crosswalk_relationship   text        NOT NULL,

  -- Décision V5
  v5_pad_category          text,
  v5_decision              text        NOT NULL,
  v5_method                text        NOT NULL,
  v5_category_source       text        NOT NULL,
  v5_confidence            numeric(4,3) NOT NULL,
  v5_requires_operator     boolean     NOT NULL,
  v5_note                  text,

  -- Cycle de vie
  is_active                boolean     NOT NULL DEFAULT true,
  imported_at              timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  -- Formats
  CONSTRAINT v5_row_key_format_chk     CHECK (row_key     ~ '^[0-9a-f]{64}$'),
  CONSTRAINT v5_source_hash_format_chk CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT v5_nstr3_format_chk       CHECK (nstr3_code  ~ '^[0-9]{3}$'),
  CONSTRAINT v5_parent_chk             CHECK (parent_nstr2 = substr(nstr3_code, 1, 2)),

  -- Garde-fous métier
  CONSTRAINT v5_decision_chk CHECK (
    v5_decision IN ('AUTO_SAFE','AUTO_SAFE_CANDIDATE','TO_CONFIRM','DORMANT','REJECT')
  ),
  CONSTRAINT v5_category_chk CHECK (
    v5_pad_category IS NULL OR v5_pad_category IN (
      'T01','T02','T03','T04','T05','T06','T07','T08','T09','T10','T11','T12','T13','T14',
      'P01','P02','P03','P04','P05'
    )
  ),
  CONSTRAINT v5_category_required_for_safe CHECK (
    (v5_decision IN ('AUTO_SAFE','AUTO_SAFE_CANDIDATE') AND v5_pad_category IS NOT NULL)
    OR v5_decision NOT IN ('AUTO_SAFE','AUTO_SAFE_CANDIDATE')
  ),
  CONSTRAINT v5_category_forbidden_for_unsafe CHECK (
    (v5_decision IN ('TO_CONFIRM','DORMANT','REJECT') AND v5_pad_category IS NULL)
    OR v5_decision NOT IN ('TO_CONFIRM','DORMANT','REJECT')
  ),
  CONSTRAINT v5_requires_operator_chk CHECK (
    (v5_decision = 'AUTO_SAFE'              AND v5_requires_operator = false)
    OR (v5_decision = 'AUTO_SAFE_CANDIDATE' AND v5_requires_operator = true)
    OR (v5_decision IN ('TO_CONFIRM','DORMANT','REJECT') AND v5_requires_operator = true)
  ),
  CONSTRAINT v5_confidence_chk CHECK (v5_confidence >= 0 AND v5_confidence <= 1),
  CONSTRAINT v5_category_source_chk CHECK (
    v5_category_source IN ('PDF_DIRECT','NSTR3_SUBTABLE_VERIFIED','NONE')
  )
);

-- Unicité forte : (source_version, row_key)
CREATE UNIQUE INDEX pad_v5_shadow_uq_version_rowkey
  ON public.pad_cn2008_mapping_v5_shadow (source_version, row_key);

-- Index secondaires de lookup
CREATE INDEX pad_v5_shadow_cn2008_idx
  ON public.pad_cn2008_mapping_v5_shadow (cn2008_code) WHERE cn2008_code IS NOT NULL;
CREATE INDEX pad_v5_shadow_nstr3_idx
  ON public.pad_cn2008_mapping_v5_shadow (nstr3_code);
CREATE INDEX pad_v5_shadow_decision_idx
  ON public.pad_cn2008_mapping_v5_shadow (v5_decision);
CREATE INDEX pad_v5_shadow_pad_cat_idx
  ON public.pad_cn2008_mapping_v5_shadow (v5_pad_category) WHERE v5_pad_category IS NOT NULL;
CREATE INDEX pad_v5_shadow_active_version_idx
  ON public.pad_cn2008_mapping_v5_shadow (source_version, is_active);

-- GRANTs (Data API) — référentiel interne, pas d'anon
GRANT SELECT ON public.pad_cn2008_mapping_v5_shadow TO authenticated;
GRANT ALL    ON public.pad_cn2008_mapping_v5_shadow TO service_role;

-- RLS — lecture authenticated uniquement, aucune policy d'écriture client
ALTER TABLE public.pad_cn2008_mapping_v5_shadow ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pad_v5_shadow_read_authenticated"
  ON public.pad_cn2008_mapping_v5_shadow
  FOR SELECT TO authenticated
  USING (true);

-- Trigger updated_at (fonction confirmée présente par précheck D.0 #1)
CREATE TRIGGER trg_pad_v5_shadow_updated_at
  BEFORE UPDATE ON public.pad_cn2008_mapping_v5_shadow
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();