-- Phase 7.0.1-fix: Correctifs CTO pour GO PROD
-- Fixes: Atomic run_number, RLS INSERT, Atomic fact supersession

-- 1. Function atomique pour run_number (Bloquant A)
-- Utilise pg_advisory_xact_lock pour prévenir les race conditions
CREATE OR REPLACE FUNCTION get_next_pricing_run_number(p_case_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_number INTEGER;
BEGIN
  -- Lock on case to prevent concurrent runs
  PERFORM pg_advisory_xact_lock(hashtext(p_case_id::text));
  
  SELECT COALESCE(MAX(run_number), 0) + 1 
  INTO next_number
  FROM pricing_runs
  WHERE case_id = p_case_id;
  
  RETURN next_number;
END;
$$;

-- 2. Function atomique pour supersession des facts (Bloquant C)
-- Garantit l'atomicité de la désactivation + insertion
CREATE OR REPLACE FUNCTION supersede_fact(
  p_case_id UUID,
  p_fact_key TEXT,
  p_fact_category TEXT,
  p_value_text TEXT DEFAULT NULL,
  p_value_number NUMERIC DEFAULT NULL,
  p_value_json JSONB DEFAULT NULL,
  p_value_date TIMESTAMPTZ DEFAULT NULL,
  p_source_type TEXT DEFAULT 'ai_extraction',
  p_source_email_id UUID DEFAULT NULL,
  p_source_attachment_id UUID DEFAULT NULL,
  p_source_excerpt TEXT DEFAULT NULL,
  p_confidence NUMERIC DEFAULT 0.80
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_fact_id UUID;
  new_fact_id UUID;
BEGIN
  -- Lock to prevent concurrent supersessions on same fact_key
  PERFORM pg_advisory_xact_lock(hashtext(p_case_id::text || p_fact_key));
  
  -- Find and deactivate old fact
  SELECT id INTO old_fact_id
  FROM quote_facts
  WHERE case_id = p_case_id AND fact_key = p_fact_key AND is_current = true;
  
  IF old_fact_id IS NOT NULL THEN
    UPDATE quote_facts 
    SET is_current = false, updated_at = now()
    WHERE id = old_fact_id;
  END IF;
  
  -- Insert new fact
  INSERT INTO quote_facts (
    case_id, fact_key, fact_category,
    value_text, value_number, value_json, value_date,
    source_type, source_email_id, source_attachment_id, source_excerpt,
    confidence, is_current, supersedes_fact_id
  ) VALUES (
    p_case_id, p_fact_key, p_fact_category,
    p_value_text, p_value_number, p_value_json, p_value_date,
    p_source_type, p_source_email_id, p_source_attachment_id, p_source_excerpt,
    p_confidence, true, old_fact_id
  )
  RETURNING id INTO new_fact_id;
  
  RETURN new_fact_id;
END;
$$;

-- 3. Correction RLS INSERT quote_cases (Bloquant B)
-- Remplace WITH CHECK(true) par une condition stricte ownership
DROP POLICY IF EXISTS "quote_cases_insert_authenticated" ON quote_cases;

CREATE POLICY "quote_cases_insert_owner"
  ON quote_cases FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid() 
    AND (assigned_to IS NULL OR assigned_to = auth.uid())
  );