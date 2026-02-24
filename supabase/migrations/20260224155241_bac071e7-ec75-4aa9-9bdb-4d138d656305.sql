
-- C3.2-A: quote_request_lines table + RPC + security

-- 1. Table
CREATE TABLE IF NOT EXISTS public.quote_request_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES quote_cases(id) ON DELETE CASCADE,
  line_index INTEGER NOT NULL CHECK (line_index >= 1),
  line_label TEXT NOT NULL DEFAULT '',
  request_type_hint TEXT,
  confidence NUMERIC DEFAULT 0.8 CHECK (confidence >= 0 AND confidence <= 1),
  source_email_id UUID REFERENCES emails(id) ON DELETE SET NULL,
  source_excerpt TEXT,
  segment_text TEXT,
  extracted_facts_json JSONB NOT NULL DEFAULT '[]',
  meta_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(case_id, line_index)
);

CREATE INDEX IF NOT EXISTS idx_quote_request_lines_case ON quote_request_lines(case_id);

-- 2. RLS
ALTER TABLE quote_request_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quote_request_lines_select_team" ON public.quote_request_lines;
CREATE POLICY "quote_request_lines_select_team"
  ON quote_request_lines FOR SELECT TO authenticated
  USING (auth.role() = 'authenticated');

-- 3. Table grants
REVOKE ALL ON public.quote_request_lines FROM PUBLIC;
REVOKE ALL ON public.quote_request_lines FROM anon;
REVOKE ALL ON public.quote_request_lines FROM authenticated;
GRANT SELECT ON public.quote_request_lines TO authenticated;

-- 4. RPC replace_quote_request_lines (atomic idempotent)
CREATE OR REPLACE FUNCTION public.replace_quote_request_lines(
  p_case_id UUID, p_lines JSONB
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_count INTEGER := 0;
  v_elem JSONB;
  v_ord BIGINT;
  v_idx INTEGER;
BEGIN
  IF p_case_id IS NULL THEN
    RAISE EXCEPTION 'p_case_id is required';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RETURN 0;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('qrl_' || p_case_id::text));
  DELETE FROM quote_request_lines WHERE case_id = p_case_id;

  FOR v_elem, v_ord IN
    SELECT elem, ord FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(elem, ord)
  LOOP
    IF (v_elem ? 'line_index') AND (v_elem->>'line_index') ~ '^\d+$' AND (v_elem->>'line_index')::INTEGER >= 1 THEN
      v_idx := (v_elem->>'line_index')::INTEGER;
    ELSE
      v_idx := v_ord::INTEGER;
    END IF;

    INSERT INTO quote_request_lines (
      case_id, line_index, line_label, request_type_hint,
      confidence, source_email_id, source_excerpt, segment_text,
      extracted_facts_json, meta_json
    ) VALUES (
      p_case_id, v_idx,
      COALESCE(v_elem->>'line_label', ''),
      NULLIF(v_elem->>'request_type_hint', ''),
      CASE WHEN (v_elem ? 'confidence') AND (v_elem->>'confidence') ~ '^\d*\.?\d+$'
        THEN LEAST(1, GREATEST(0, (v_elem->>'confidence')::numeric))
        ELSE 0.8 END,
      CASE WHEN NULLIF(v_elem->>'source_email_id', '') IS NOT NULL
        THEN (v_elem->>'source_email_id')::uuid ELSE NULL END,
      NULLIF(v_elem->>'source_excerpt', ''),
      NULLIF(v_elem->>'segment_text', ''),
      CASE WHEN jsonb_typeof(COALESCE(v_elem->'extracted_facts_json', '[]'::jsonb)) = 'array'
        THEN COALESCE(v_elem->'extracted_facts_json', '[]'::jsonb)
        ELSE '[]'::jsonb END,
      CASE WHEN jsonb_typeof(COALESCE(v_elem->'meta_json', '{}'::jsonb)) = 'object'
        THEN COALESCE(v_elem->'meta_json', '{}'::jsonb)
        ELSE '{}'::jsonb END
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- 5. RPC security: service_role only
REVOKE ALL ON FUNCTION public.replace_quote_request_lines(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_quote_request_lines(UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.replace_quote_request_lines(UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.replace_quote_request_lines(UUID, JSONB) TO service_role;
