-- Safe disable, NOT a data-destroying down migration. Do not drop the ledger,
-- release unresolved targets, or downgrade to an unguarded backend. Keep normal
-- leases, receipt reads and fenced uncertainty/finalization available in-flight.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.register_generation_recipe_grant(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz),
 public.claim_generation_recipe_attempt(uuid,uuid,uuid,text,uuid) FROM service_role;
COMMIT;
