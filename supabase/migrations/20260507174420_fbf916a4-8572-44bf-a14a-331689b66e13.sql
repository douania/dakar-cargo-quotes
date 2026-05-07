
-- ============================================================
-- PAD-NST-2B-R1 — Hardening idempotence avant import
-- ============================================================

-- 1) Rendre source_row_number obligatoire (tables vides, pas d'impact)
ALTER TABLE public.nst_cn_mappings
  ALTER COLUMN source_row_number SET NOT NULL;

ALTER TABLE public.nst_cpa_mappings
  ALTER COLUMN source_row_number SET NOT NULL;

ALTER TABLE public.nst_nhm_mappings
  ALTER COLUMN source_row_number SET NOT NULL;

ALTER TABLE public.nstr_nst2007_mappings
  ALTER COLUMN source_row_number SET NOT NULL;

-- 2) Empêcher les doublons de source
CREATE UNIQUE INDEX idx_nst_mapping_sources_idempotent
  ON public.nst_mapping_sources (sha256_hash, phase);

-- 3) Empêcher les doublons d'import ligne par ligne
CREATE UNIQUE INDEX idx_nst_cn_mappings_idempotent
  ON public.nst_cn_mappings (source_id, source_row_number);

CREATE UNIQUE INDEX idx_nst_cpa_mappings_idempotent
  ON public.nst_cpa_mappings (source_id, source_row_number);

CREATE UNIQUE INDEX idx_nst_nhm_mappings_idempotent
  ON public.nst_nhm_mappings (source_id, source_row_number);

CREATE UNIQUE INDEX idx_nstr_nst2007_mappings_idempotent
  ON public.nstr_nst2007_mappings (source_id, source_row_number);
