BEGIN;
SET LOCAL lock_timeout='5s';
LOCK TABLE public.pricing_runs IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.pricing_runs WHERE outputs_json ? 'operator_basis') THEN
 RAISE EXCEPTION 'ROLLBACK_REFUSED: devis sur bases opérateur existants, historique à préserver'; END IF;
END $$;
DROP FUNCTION public.adopt_operator_quotation_basis(uuid,uuid,uuid,text,text,uuid);
DROP INDEX public.pricing_runs_operator_source_unique;
DROP INDEX public.pricing_runs_operator_key_unique;
COMMIT;
