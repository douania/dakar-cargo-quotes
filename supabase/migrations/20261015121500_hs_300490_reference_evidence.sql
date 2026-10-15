-- GO humain 2026-10-15 12:04. Private development project only.
-- Screenshot image(8).png was inspected by the parent, not by this local executor.
-- It establishes nomenclature only; no fiscal rate or global regulatory edition.
BEGIN;
ALTER TABLE public.hs_codes
  ADD COLUMN IF NOT EXISTS tax_profile_status text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS nomenclature_evidence jsonb,
  ADD COLUMN IF NOT EXISTS tax_evidence jsonb;
ALTER TABLE public.hs_codes
  ALTER COLUMN dd DROP NOT NULL, ALTER COLUMN rs DROP NOT NULL,
  ALTER COLUMN pcs DROP NOT NULL, ALTER COLUMN pcc DROP NOT NULL,
  ALTER COLUMN cosec DROP NOT NULL, ALTER COLUMN tva DROP NOT NULL;
DO $migration$
DECLARE
  source jsonb := jsonb_build_object(
    'change_key','hs-300490-gainde-20261015', 'source_kind','user_provided_gainde_screenshot',
    'library_file_id','libfile_1d4af24015d8819188c24223d4b31b48', 'filename','image(8).png',
    'observed_on','2026-10-15', 'verification_basis','parent_visual_inspection',
    'local_executor_saw_pixels',false, 'regulatory_edition',null, 'includes_tax_rates',false);
  before_row jsonb;
BEGIN
  LOCK TABLE public.hs_codes IN SHARE ROW EXCLUSIVE MODE;
  IF (SELECT count(*) FROM public.hs_codes WHERE code_normalized IN ('3004901000','3004909000')) <> 2 THEN
    RAISE EXCEPTION 'HS correction requires exactly the two pre-existing references';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hs_codes WHERE id='1db2bbce-4764-4883-8983-e62c19000d58' AND code='3004901000' AND code_normalized='3004901000') OR
     NOT EXISTS (SELECT 1 FROM public.hs_codes WHERE id='1aad6993-c2b9-489a-bc2f-142394350c2c' AND code='3004909000' AND code_normalized='3004909000') THEN
    RAISE EXCEPTION 'HS identity drift; no data changed';
  END IF;
  IF (SELECT count(*) FROM public.hs_codes WHERE code_normalized LIKE '300490%') NOT IN (2,3) THEN
    RAISE EXCEPTION 'Unexpected 300490 catalogue cardinality';
  END IF;
  IF EXISTS (SELECT 1 FROM public.hs_codes WHERE code_normalized LIKE '300490%' AND code_normalized NOT IN ('3004901000','3004902000','3004909000')) THEN
    RAISE EXCEPTION 'Unexpected additional 300490 candidate';
  END IF;
  SELECT to_jsonb(h) INTO before_row FROM public.hs_codes h WHERE code_normalized='3004901000';
  IF before_row->>'description' = 'Sel de réhydratation orale (ORASEL)' AND before_row->'nomenclature_evidence' = 'null'::jsonb THEN
    UPDATE public.hs_codes SET description='Anti-paludéens', tax_profile_status='unknown',
      dd=NULL,surtaxe=NULL,rs=NULL,pcs=NULL,pcc=NULL,cosec=NULL,uemoa=NULL,tin=NULL,tva=NULL,tev=NULL,ta=NULL,t_past=NULL,t_para=NULL,t_conj=NULL,t_ciment=NULL,ref=NULL,bic=NULL,mercurialis=NULL,
      nomenclature_evidence=source || jsonb_build_object('previous_row',before_row),
      tax_evidence=jsonb_build_object('status','unknown','reason','Previous numeric profile retained in nomenclature_evidence.previous_row only; changed code/label association is not fiscal evidence'),
      updated_at=now() WHERE code_normalized='3004901000';
  ELSIF (before_row->>'description'='Anti-paludéens' AND before_row->'nomenclature_evidence'->>'change_key'='hs-300490-gainde-20261015' AND before_row->>'tax_profile_status'='unknown'
    AND NOT EXISTS (SELECT 1 FROM jsonb_each(before_row) field WHERE field.key IN ('dd','surtaxe','rs','pcs','pcc','cosec','uemoa','tin','tva','tev','ta','t_past','t_para','t_conj','t_ciment','ref','bic','mercurialis') AND field.value <> 'null'::jsonb)) IS NOT TRUE THEN
    RAISE EXCEPTION 'Unexpected 3004901000 state';
  END IF;
  SELECT to_jsonb(h) INTO before_row FROM public.hs_codes h WHERE code_normalized='3004909000';
  IF before_row->>'description' = '/06 - Autres' AND before_row->'nomenclature_evidence' = 'null'::jsonb THEN
    UPDATE public.hs_codes SET description='Autres',
      nomenclature_evidence=source || jsonb_build_object('previous_row',before_row),updated_at=now()
      WHERE code_normalized='3004909000';
  ELSIF (before_row->>'description'='Autres' AND before_row->'nomenclature_evidence'->>'change_key'='hs-300490-gainde-20261015') IS NOT TRUE THEN
    RAISE EXCEPTION 'Unexpected 3004909000 state';
  END IF;
  IF EXISTS (SELECT 1 FROM public.hs_codes WHERE code_normalized='3004902000') THEN
    IF NOT EXISTS (SELECT 1 FROM public.hs_codes h WHERE code='3004902000' AND code_normalized='3004902000'
      AND description='Sel de réhydratation orale (ORASEL)' AND tax_profile_status='unknown'
      AND nomenclature_evidence->>'change_key'='hs-300490-gainde-20261015'
      AND dd IS NULL AND surtaxe IS NULL AND rs IS NULL AND pcs IS NULL AND pcc IS NULL AND cosec IS NULL AND uemoa IS NULL AND tin IS NULL AND tva IS NULL AND tev IS NULL AND ta IS NULL AND t_past IS NULL AND t_para IS NULL AND t_conj IS NULL AND t_ciment IS NULL AND ref IS NULL AND bic IS NULL AND mercurialis IS NULL) THEN
      RAISE EXCEPTION 'Unexpected existing 3004902000; no overwrite';
    END IF;
  ELSE
    INSERT INTO public.hs_codes(code,code_normalized,description,chapter,
      dd,surtaxe,rs,pcs,pcc,cosec,uemoa,tin,tva,tev,ta,t_past,t_para,t_conj,t_ciment,ref,bic,mercurialis,
      tax_profile_status,nomenclature_evidence,tax_evidence)
    VALUES ('3004902000','3004902000','Sel de réhydratation orale (ORASEL)',30,
      NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,
      'unknown',source,jsonb_build_object('status','unknown','reason','Source contains nomenclature, no rates, bases or exemptions'));
  END IF;
END $migration$;
COMMENT ON COLUMN public.hs_codes.tax_profile_status IS 'legacy preserves existing data; unknown must never be priced as zero; verified requires sourced fiscal evidence. Nomenclature is not rate evidence.';
-- No quotation, fact, pricing run, version, document, account or RLS is rewritten.
COMMIT;
