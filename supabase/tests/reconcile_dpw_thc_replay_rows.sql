-- LOCAL empty disposable database, supabase mounted read-only at /repo-supabase.
-- Run as local test superuser (pg_read_file); all fixtures rolled back.
BEGIN;
DO $$ BEGIN IF to_regclass('public.port_tariffs') IS NOT NULL THEN
  RAISE EXCEPTION 'Test requires an empty disposable database'; END IF; END $$;
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
\ir ../migrations/20251219115748_c891986f-47fa-43be-bb61-7d5a578f9e42.sql
ALTER TABLE public.port_tariffs ADD COLUMN evidence_level text;
\ir ../migrations/20260825170000_reconcile_dpw_dthc_canonical_grid.sql
CREATE FUNCTION pg_temp.fingerprint() RETURNS jsonb LANGUAGE sql AS $$
SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.port_tariffs t; $$;
CREATE FUNCTION pg_temp.reconcile() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
EXECUTE pg_read_file('/repo-supabase/migrations/20260911080000_reconcile_dpw_thc_replay_rows.sql'); END $$;
DO $$ DECLARE v_denied boolean:=false; v_before jsonb; BEGIN
  v_before:=pg_temp.fingerprint();
  BEGIN EXECUTE pg_read_file('/repo-supabase/migrations/20260911090000_dthc4_d1_retire_non_canonical_thc_rows.sql');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%5 ligne(s) canonique(s) active(s), 11 attendues.%' THEN RAISE; END IF;
    v_denied:=true;
  END;
  ASSERT v_denied AND pg_temp.fingerprint()=v_before, 'original D1 failure not reproduced';
  PERFORM pg_temp.reconcile();
  ASSERT (SELECT count(*)=16 FROM public.port_tariffs), 'wrong target count';
  ASSERT (SELECT count(*)=11 FROM public.port_tariffs WHERE is_active), 'wrong canonical count';
  ASSERT (SELECT count(*)=5 FROM public.port_tariffs WHERE NOT is_active), 'legacy reactivated';
  ASSERT pg_temp.fingerprint() @> v_before, 'existing import rows changed';
  v_before:=pg_temp.fingerprint(); PERFORM pg_temp.reconcile();
  ASSERT pg_temp.fingerprint()=v_before, 'replay changed existing rows';
END $$;
\ir ../migrations/20260911090000_dthc4_d1_retire_non_canonical_thc_rows.sql
\ir ../migrations/20260911120000_dthc4_provenance_arrete_035532.sql
DO $$ DECLARE v_sql text; v_before jsonb; v_denied boolean; v_cases integer:=0; BEGIN
  v_before:=pg_temp.fingerprint(); PERFORM pg_temp.reconcile();
  ASSERT pg_temp.fingerprint()=v_before, 'post-provenance replay changed rows';
  FOREACH v_sql IN ARRAY ARRAY[
    'UPDATE public.port_tariffs SET amount=1 WHERE cargo_type=''STANDARD'' AND operation_type=''TRANSIT''',
    'UPDATE public.port_tariffs SET unit=''CNT'' WHERE cargo_type=''COTON''',
    'UPDATE public.port_tariffs SET classification=''unexpected'' WHERE cargo_type=''COTON''',
    'UPDATE public.port_tariffs SET provider=''DP_WORLD'' WHERE cargo_type=''COTON''',
    'UPDATE public.port_tariffs SET source_document=''unexpected'' WHERE cargo_type=''COTON''',
    'UPDATE public.port_tariffs SET evidence_level=''observed'' WHERE cargo_type=''COTON''',
    'UPDATE public.port_tariffs SET effective_date=DATE ''2025-01-01'' WHERE cargo_type=''COTON''',
    'UPDATE public.port_tariffs SET expiry_date=DATE ''2025-01-01'' WHERE cargo_type=''COTON''',
    'UPDATE public.port_tariffs SET surcharge_percent=1 WHERE cargo_type=''COTON''',
    'UPDATE public.port_tariffs SET is_active=false WHERE cargo_type=''COTON''',
    'UPDATE public.port_tariffs SET is_active=true WHERE cargo_type=''CONTENEUR_40''',
    'INSERT INTO public.port_tariffs SELECT gen_random_uuid(),provider,category,operation_type,classification,cargo_type,amount,unit,surcharge_percent,surcharge_conditions,source_document,effective_date,expiry_date,is_active,created_at,updated_at,evidence_level FROM public.port_tariffs WHERE cargo_type=''COTON'''
  ] LOOP
    BEGIN
      EXECUTE v_sql;
      -- Force earlier inserts, then a later conflict: the entire migration must roll back.
      IF v_cases=0 THEN DELETE FROM public.port_tariffs WHERE cargo_type='COTON'; END IF;
      v_before:=pg_temp.fingerprint(); v_denied:=false;
      BEGIN PERFORM pg_temp.reconcile(); EXCEPTION WHEN raise_exception THEN
        IF SQLERRM NOT LIKE '[DTHC-REPLAY] STOP:%' THEN RAISE; END IF;
        v_denied:=true;
      END;
      ASSERT v_denied AND pg_temp.fingerprint()=v_before, 'drift accepted or partial write';
      RAISE SQLSTATE 'ZX001';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END;
    v_cases:=v_cases+1;
  END LOOP;
  RAISE NOTICE 'PASS: % rejection/atomicity cases, 11 exact inserts, inactive legacy, strict replay and D1/provenance chain',v_cases;
END $$;
CREATE FUNCTION pg_temp.corrupt_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.amount:=1; RETURN NEW; END $$;
CREATE TRIGGER test_corrupt_insert BEFORE INSERT ON public.port_tariffs
FOR EACH ROW EXECUTE FUNCTION pg_temp.corrupt_insert();
DO $$ DECLARE v_before jsonb; v_denied boolean:=false; BEGIN
  DELETE FROM public.port_tariffs WHERE cargo_type='COTON';
  v_before:=pg_temp.fingerprint();
  BEGIN PERFORM pg_temp.reconcile(); EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '[DTHC-REPLAY] STOP: inserted target differs%' THEN RAISE; END IF;
    v_denied:=true;
  END;
  ASSERT v_denied AND pg_temp.fingerprint()=v_before, 'trigger drift accepted or partial write';
  RAISE NOTICE 'PASS: insert-trigger drift rejected atomically (13th negative case)';
END $$;
ROLLBACK;

-- Cloud-state reproduction: SELECT-only snapshot 2026-09-14, all 14 business
-- attributes of the 24 DPW/THC rows; UUIDs/timestamps are synthetic, not exported.
-- This is not a Cloud execution nor a complete Cloud database clone.
BEGIN;
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
\ir ../migrations/20251219115748_c891986f-47fa-43be-bb61-7d5a578f9e42.sql
ALTER TABLE public.port_tariffs ADD COLUMN evidence_level text;
WITH snapshot(operation_type,cargo_type,classification,amount,surcharge_percent,is_active) AS (VALUES
('EXPORT','CONTENEUR_20','Coton origine MALI / SN','70000','50',false),
('EXPORT','CONTENEUR_20','Standard','155000','50',false),
('EXPORT','CONTENEUR_40','Standard 40 pieds','232500','50',false),
('EXPORT','CONTENEUR_FRIGO','Reefer (frigo)','90000','50',false),
('EXPORT','CONTENEUR_OOG','OOG (hors gabarit)','310000','50',false),
('EXPORT','CONTENEUR_VIDE','Vide','75000','50',false),
('EXPORT','COTON','Coton (Mali/Sénégal)','70000','0',true),
('EXPORT','DANGEROUS','Produits dangereux (IMDG classe 1-9)','155000','50',true),
('EXPORT','REEFER','Conteneurs frigorifiques','170500','0',true),
('EXPORT','SPECIAL','Conteneurs spéciaux (OOG, flat, open top, tank)','310000','0',true),
('EXPORT','STANDARD','Produits standards','155000','0',true),
('IMPORT','BASIC','Produits de base (huile, pharma, riz, sucre, lait)','70000','0',true),
('IMPORT','CONTENEUR_20','Standard','155000','50',false),
('IMPORT','CONTENEUR_20','Transbordement','75000','50',false),
('IMPORT','CONTENEUR_40','Standard 40 pieds','232500','50',false),
('IMPORT','CONTENEUR_FRIGO','Reefer (frigo)','115000','50',false),
('IMPORT','CONTENEUR_OOG','OOG (hors gabarit)','310000','50',false),
('IMPORT','CONTENEUR_VIDE','Vide','75000','50',false),
('IMPORT','DANGEROUS','Produits dangereux (IMDG classe 1-9)','155000','50',true),
('IMPORT','REEFER','Conteneurs frigorifiques','170500','0',true),
('IMPORT','SPECIAL','Conteneurs spéciaux (OOG, flat, open top, tank)','310000','0',true),
('IMPORT','STANDARD','Produits standards','155000','0',true),
('TRANSIT','CONTENEUR_20','Transit (TRIE)','110000','50',false),
('TRANSIT','STANDARD','Import/export (sauf coton Mali/SN et spéciaux)','110000','0',true)
)
INSERT INTO public.port_tariffs(provider,category,operation_type,cargo_type,classification,
  amount,unit,surcharge_percent,surcharge_conditions,source_document,effective_date,expiry_date,is_active,evidence_level)
SELECT 'DPW','THC',operation_type,cargo_type,classification,amount::numeric,'EVP',surcharge_percent::numeric,
  CASE WHEN is_active THEN null ELSE 'Produits dangereux' END,
  CASE WHEN is_active THEN 'Arrêté ministériel n° 035532 du 28/11/2023 - JORS n° 7723 du 06/04/2024 p. 471'
    ELSE 'DPW_TARIFS_2025_0001.pdf' END,
  CASE WHEN is_active THEN DATE '2024-04-06' ELSE DATE '2025-01-01' END,null,is_active,'official'
FROM snapshot;
-- A no-op must not merely rewrite the same values: reject every attempted write.
CREATE FUNCTION pg_temp.forbid_tariff_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Unexpected write in Cloud-state no-op test'; END $$;
CREATE TRIGGER test_no_tariff_write BEFORE INSERT OR UPDATE OR DELETE ON public.port_tariffs
FOR EACH ROW EXECUTE FUNCTION pg_temp.forbid_tariff_write();
CREATE TEMP TABLE cloud_thc_before AS SELECT jsonb_agg(to_jsonb(t) ORDER BY id) AS fingerprint
FROM public.port_tariffs t;
DO $$ BEGIN
  ASSERT (SELECT count(*)=24 AND count(*) FILTER (WHERE is_active)=11
    AND count(*) FILTER (WHERE NOT is_active)=13 FROM public.port_tariffs), 'Cloud fixture counts differ';
END $$;
\ir ../migrations/20260911080000_reconcile_dpw_thc_replay_rows.sql
\ir ../migrations/20260911080000_reconcile_dpw_thc_replay_rows.sql
\ir ../migrations/20260911090000_dthc4_d1_retire_non_canonical_thc_rows.sql
\ir ../migrations/20260911120000_dthc4_provenance_arrete_035532.sql
DO $$ BEGIN
  ASSERT (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.port_tariffs t)
    = (SELECT fingerprint FROM cloud_thc_before), 'Cloud-state full row fingerprint changed';
  RAISE NOTICE 'PASS: Cloud-state 24 rows (11 active/13 inactive), two reconciliations + D1/provenance, zero attempted write, complete fingerprint unchanged';
END $$;
ROLLBACK;
