-- Fix search_path for prevent_runtime_events_mutation
CREATE OR REPLACE FUNCTION prevent_runtime_events_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'runtime_events is append-only';
END;
$$ LANGUAGE plpgsql SET search_path = public;