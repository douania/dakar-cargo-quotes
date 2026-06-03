-- PAD-V5 B2.0: allow pad_v5_shadow as an explicit CCC source.
-- No data write, no seed, no RLS change.

ALTER TABLE public.commodity_classification_candidates
  DROP CONSTRAINT ccc_source_chk;

ALTER TABLE public.commodity_classification_candidates
  ADD CONSTRAINT ccc_source_chk CHECK (
    source IN (
      'operator',
      'structured_code_exact',
      'validated_alias',
      'pad_label_2_3',
      'reference_label_cn_nhm_nst_nstr',
      'ai_suggestion',
      'web_hs_lookup',
      'pad_v5_shadow'
    )
  );
