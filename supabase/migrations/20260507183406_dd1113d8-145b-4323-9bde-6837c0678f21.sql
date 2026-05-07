-- ============================================================
-- PAD-NST-2D — Table pad_nst_recommendation_rules (vide)
-- ============================================================

CREATE TABLE public.pad_nst_recommendation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  nst_level text NOT NULL,
  nst_code text NOT NULL,

  pad_category text NOT NULL,

  confidence numeric NOT NULL,
  evidence_level text NOT NULL,
  validation_status text NOT NULL DEFAULT 'candidate',

  notes text,
  source_document text,
  source_reference text,

  requires_operator_validation boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_pad_nst_rule_level
    CHECK (nst_level IN ('group', 'division')),

  CONSTRAINT chk_pad_nst_rule_code_format
    CHECK (
      (nst_level = 'division' AND nst_code ~ '^[0-9]{2}$')
      OR
      (nst_level = 'group' AND nst_code ~ '^[0-9]{2}\.[0-9A-Z]$')
    ),

  CONSTRAINT chk_pad_nst_rule_pad_category
    CHECK (pad_category ~ '^(T(0[1-9]|1[0-4])|P0[1-5])$'),

  CONSTRAINT chk_pad_nst_rule_confidence
    CHECK (confidence >= 0 AND confidence <= 1),

  CONSTRAINT chk_pad_nst_rule_evidence_level
    CHECK (evidence_level IN (
      'pad_official_extract',
      'nstr_bridge_inferred',
      'expert_rule',
      'operator_override'
    )),

  CONSTRAINT chk_pad_nst_rule_validation_status
    CHECK (validation_status IN (
      'candidate',
      'validated',
      'rejected',
      'deprecated'
    )),

  CONSTRAINT uq_pad_nst_rule
    UNIQUE (nst_level, nst_code, pad_category)
);

-- RLS : SELECT only for authenticated
ALTER TABLE public.pad_nst_recommendation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read pad_nst_recommendation_rules"
  ON public.pad_nst_recommendation_rules
  FOR SELECT TO authenticated
  USING (true);

-- Index
CREATE INDEX idx_pad_nst_rules_level_code
  ON public.pad_nst_recommendation_rules(nst_level, nst_code);

CREATE INDEX idx_pad_nst_rules_pad_category
  ON public.pad_nst_recommendation_rules(pad_category);

CREATE INDEX idx_pad_nst_rules_active_validated
  ON public.pad_nst_recommendation_rules(nst_level, nst_code, confidence DESC)
  WHERE is_active = true AND validation_status = 'validated';