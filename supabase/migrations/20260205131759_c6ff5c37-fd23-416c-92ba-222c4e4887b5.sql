-- ============================================================================
-- Phase 13 — Colonnes idempotence + forensic + RPC transactionnelle
-- ============================================================================

-- 1. operator_decisions : ajout colonnes
ALTER TABLE operator_decisions 
ADD COLUMN IF NOT EXISTS idempotency_key text,
ADD COLUMN IF NOT EXISTS facts_hash text,
ADD COLUMN IF NOT EXISTS gaps_hash text,
ADD COLUMN IF NOT EXISTS decision_version integer;

-- 2. Index unique partiel pour idempotence (case_id + idempotency_key)
CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_decisions_idempotency 
ON operator_decisions (case_id, idempotency_key) 
WHERE idempotency_key IS NOT NULL;

-- 3. decision_proposals : ajout hash forensic
ALTER TABLE decision_proposals 
ADD COLUMN IF NOT EXISTS facts_hash text,
ADD COLUMN IF NOT EXISTS gaps_hash text;

-- ============================================================================
-- RPC: commit_decision_atomic (transaction gaps check + insert)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.commit_decision_atomic(
  p_case_id uuid,
  p_decision_type text,
  p_idempotency_key text,
  p_proposal_id uuid,
  p_selected_key text,
  p_override_value text DEFAULT NULL,
  p_override_reason text DEFAULT NULL,
  p_facts_hash text DEFAULT NULL,
  p_gaps_hash text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing_id uuid;
  v_blocking_count integer;
  v_new_decision_id uuid;
  v_decision_version integer;
  v_old_decision_id uuid;
BEGIN
  -- Lock transactionnel sur case_id pour eviter race conditions
  PERFORM pg_advisory_xact_lock(hashtext('decision_' || p_case_id::text));
  
  -- 1. Idempotence check
  SELECT id INTO v_existing_id
  FROM operator_decisions
  WHERE case_id = p_case_id 
    AND idempotency_key = p_idempotency_key;
  
  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'decision_id', v_existing_id,
      'idempotent', true,
      'status', 'existing'
    );
  END IF;
  
  -- 2. Gaps blocking check (DANS LA TRANSACTION)
  SELECT COUNT(*) INTO v_blocking_count
  FROM quote_gaps
  WHERE case_id = p_case_id 
    AND is_blocking = true 
    AND status = 'open';
  
  IF v_blocking_count > 0 AND p_override_reason IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'blocking_gaps_open',
      'blocking_count', v_blocking_count,
      'status', 'rejected'
    );
  END IF;
  
  -- 3. Calculer decision_version (incremental par decision_type)
  SELECT COALESCE(MAX(decision_version), 0) + 1 INTO v_decision_version
  FROM operator_decisions
  WHERE case_id = p_case_id AND decision_type = p_decision_type::decision_type;
  
  -- 4. Trouver et superseder ancienne decision (si existe)
  SELECT id INTO v_old_decision_id
  FROM operator_decisions
  WHERE case_id = p_case_id 
    AND decision_type = p_decision_type::decision_type
    AND is_final = true;
  
  -- 5. Insert nouvelle decision
  INSERT INTO operator_decisions (
    case_id, proposal_id, decision_type, selected_key,
    override_value, override_reason, decided_by, decided_at,
    is_final, idempotency_key, facts_hash, gaps_hash, decision_version
  ) VALUES (
    p_case_id, p_proposal_id, p_decision_type::decision_type, p_selected_key,
    p_override_value, p_override_reason, p_user_id, now(),
    true, p_idempotency_key, p_facts_hash, p_gaps_hash, v_decision_version
  )
  RETURNING id INTO v_new_decision_id;
  
  -- 6. Superseder ancienne decision (si existe)
  IF v_old_decision_id IS NOT NULL THEN
    UPDATE operator_decisions
    SET is_final = false, superseded_by = v_new_decision_id
    WHERE id = v_old_decision_id;
  END IF;
  
  RETURN jsonb_build_object(
    'decision_id', v_new_decision_id,
    'decision_version', v_decision_version,
    'idempotent', false,
    'superseded_id', v_old_decision_id,
    'status', 'created'
  );
END;
$$;

-- Securite : service_role only
REVOKE ALL ON FUNCTION commit_decision_atomic FROM PUBLIC;
GRANT EXECUTE ON FUNCTION commit_decision_atomic TO service_role;