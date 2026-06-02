ALTER TABLE public.pad_cn2008_mapping_v5_shadow
  ADD COLUMN cpa2008_code text,
  ADD COLUMN cpa2008_label text;

COMMENT ON COLUMN public.pad_cn2008_mapping_v5_shadow.row_key IS
  'V5 row identity. Formula from A1B: sha256_hex(source_version|nstr3_code|cn2008_code|cpa2008_code|nst2007_code|cn2008_label|cpa2008_label|nst2007_label), empty string for NULL source fields.';