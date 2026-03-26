
-- M23b-fix: Make route_port nullable, remove hardcoded default, fix route_hash

-- Step 1: Drop dependent index
DROP INDEX IF EXISTS idx_quotation_history_route_hash;

-- Step 2: Make route_port nullable and remove default
ALTER TABLE quotation_history 
  ALTER COLUMN route_port DROP NOT NULL,
  ALTER COLUMN route_port DROP DEFAULT;

-- Step 3: Recreate route_hash with coalesce to handle NULL route_port
ALTER TABLE quotation_history DROP COLUMN route_hash;
ALTER TABLE quotation_history ADD COLUMN route_hash TEXT GENERATED ALWAYS AS (
  lower(coalesce(route_origin, '') || '|' || coalesce(route_port, '') || '|' || route_destination)
) STORED;

-- Step 4: Recreate index
CREATE INDEX idx_quotation_history_route_hash ON public.quotation_history(route_hash);
