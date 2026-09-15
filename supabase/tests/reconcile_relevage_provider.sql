-- LOCAL disposable database only; all fixtures/functions rolled back.
-- Mount supabase read-only at /repo-supabase; execute psql -v ON_ERROR_STOP=1 -f ...
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.port_tariffs') IS NOT NULL THEN
    RAISE EXCEPTION 'Test requires an empty disposable database';
  END IF;
END $$;
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
-- Real original table/trigger/policy, not a simplified substitute.
\ir ../migrations/20251219115748_c891986f-47fa-43be-bb61-7d5a578f9e42.sql
ALTER TABLE public.port_tariffs ADD COLUMN evidence_level text;
CREATE TEMP TABLE migration_text AS SELECT pg_read_file('/repo-supabase/migrations/20260910170000_reconcile_relevage_provider.sql') AS sql;
CREATE FUNCTION pg_temp.reconcile() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE (SELECT sql FROM migration_text); END $$;
CREATE FUNCTION pg_temp.fingerprint() RETURNS jsonb LANGUAGE sql AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.port_tariffs t;
$$;
SELECT pg_temp.reconcile(); -- empty reference table is a no-op, never synthesized
INSERT INTO public.port_tariffs(provider,category,operation_type,classification,cargo_type,amount,unit,source_document,effective_date,evidence_level)
VALUES
('DP_WORLD','RELEVAGE','TRANSIT','Standard 20 pieds','CONTENEUR_20',36560,'FCFA/EVP','Taleb_Quote_2024','2024-10-01','observed'),
('DP_WORLD','RELEVAGE','TRANSIT','Standard 40 pieds','CONTENEUR_40',73120,'FCFA/CNT','Taleb_Quote_2024','2024-10-01','observed'),
('DP_WORLD','THC','IMPORT','Synthetic other row','synthetic',123,'EVP','synthetic','2024-01-01','observed');
CREATE TEMP TABLE seed_rows AS TABLE public.port_tariffs;
DO $$
DECLARE v_sql text; v_before jsonb; v_denied boolean; v_cases integer := 0;
BEGIN
  v_before := pg_temp.fingerprint(); v_denied := false;
  BEGIN
    EXECUTE pg_read_file('/repo-supabase/migrations/20260910180000_dthc4_f1_relevage_official_rate.sql');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%2 ligne(s) RELEVAGE hors DPW / TRANSIT.%' THEN RAISE; END IF;
    v_denied := true;
  END;
  ASSERT v_denied AND pg_temp.fingerprint() = v_before, 'original F1 failure not reproduced atomically';
  -- Every failed subtransaction restores the seed; verify refusal itself writes nothing.
  FOREACH v_sql IN ARRAY ARRAY[
    'UPDATE public.port_tariffs SET amount=1 WHERE cargo_type=''CONTENEUR_20''',
    'UPDATE public.port_tariffs SET unit=''FCFA/CNT'' WHERE cargo_type=''CONTENEUR_20''',
    'UPDATE public.port_tariffs SET source_document=''unexpected'' WHERE cargo_type=''CONTENEUR_20''',
    'UPDATE public.port_tariffs SET evidence_level=''official'' WHERE cargo_type=''CONTENEUR_20''',
    'UPDATE public.port_tariffs SET operation_type=''IMPORT'' WHERE cargo_type=''CONTENEUR_20''',
    'UPDATE public.port_tariffs SET provider=''DPW'' WHERE cargo_type=''CONTENEUR_20''',
    'UPDATE public.port_tariffs SET is_active=false WHERE cargo_type=''CONTENEUR_20''',
    'UPDATE public.port_tariffs SET surcharge_percent=10 WHERE cargo_type=''CONTENEUR_20''',
    'UPDATE public.port_tariffs SET expiry_date=DATE ''2025-01-01'' WHERE cargo_type=''CONTENEUR_20''',
    'UPDATE public.port_tariffs SET effective_date=DATE ''2025-01-01'' WHERE cargo_type=''CONTENEUR_20''',
    'UPDATE public.port_tariffs SET classification=''unexpected'' WHERE cargo_type=''CONTENEUR_20''',
    'UPDATE public.port_tariffs SET surcharge_conditions=''unexpected'' WHERE cargo_type=''CONTENEUR_20''',
    'DELETE FROM public.port_tariffs WHERE cargo_type=''CONTENEUR_40''',
    'UPDATE public.port_tariffs SET cargo_type=''CONTENEUR_20'',classification=''Standard 20 pieds'',amount=36560,unit=''FCFA/EVP'' WHERE cargo_type=''CONTENEUR_40''',
    'INSERT INTO public.port_tariffs SELECT gen_random_uuid(),provider,category,operation_type,classification,cargo_type,amount,unit,surcharge_percent,surcharge_conditions,source_document,effective_date,expiry_date,is_active,created_at,updated_at,evidence_level FROM seed_rows WHERE cargo_type=''CONTENEUR_20'''
  ] LOOP
    BEGIN
      EXECUTE v_sql;
      v_before := pg_temp.fingerprint(); v_denied := false;
      BEGIN PERFORM pg_temp.reconcile();
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM NOT LIKE '[RELEVAGE-PROVIDER] STOP:%' THEN RAISE; END IF;
        v_denied := true;
      END;
      ASSERT v_denied, 'unsafe seed accepted';
      ASSERT pg_temp.fingerprint() = v_before, 'refused migration changed data';
      RAISE SQLSTATE 'ZX001'; -- restore this synthetic variant only
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
    END;
    v_cases := v_cases + 1;
  END LOOP;
  PERFORM pg_temp.reconcile();
  ASSERT (SELECT count(*)=2 FROM public.port_tariffs WHERE category='RELEVAGE' AND provider='DPW');
  ASSERT NOT EXISTS (SELECT 1 FROM public.port_tariffs t JOIN seed_rows b USING(id)
    WHERE CASE WHEN b.category='RELEVAGE'
      THEN (to_jsonb(t)-'provider'-'updated_at') IS DISTINCT FROM (to_jsonb(b)-'provider'-'updated_at')
      ELSE to_jsonb(t) IS DISTINCT FROM to_jsonb(b) END), 'non-provider data changed';
  v_before := pg_temp.fingerprint();
  PERFORM pg_temp.reconcile();
  ASSERT pg_temp.fingerprint() = v_before, 'replay changed rows or timestamps';
  RAISE NOTICE 'PASS: % rejection/atomicity cases, exact two-row normalization, outside preservation, replay', v_cases;
END $$;
-- Run the unchanged historical chain and verify its restored final state.
\ir ../migrations/20260910180000_dthc4_f1_relevage_official_rate.sql
\ir ../migrations/20260911103000_dthc4_f1b_restore_transit_relevage.sql
DO $$ DECLARE v_before jsonb; BEGIN
  ASSERT (SELECT array_agg(amount ORDER BY cargo_type)=ARRAY[36560,73120,82260]::numeric[]
    FROM public.port_tariffs WHERE category='RELEVAGE'), 'F1b final amounts differ';
  v_before := pg_temp.fingerprint();
  PERFORM pg_temp.reconcile();
  ASSERT pg_temp.fingerprint() = v_before, 'already migrated database changed';
  RAISE NOTICE 'PASS: unchanged F1/F1b chain and strict no-op after F1b';
END $$;
ROLLBACK;
