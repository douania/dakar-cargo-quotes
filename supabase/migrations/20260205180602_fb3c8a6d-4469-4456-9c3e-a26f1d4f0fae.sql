-- Phase 14: runtime_events table (append-only forensic logging)
CREATE TABLE runtime_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts timestamptz DEFAULT now(),
  correlation_id uuid,
  function_name text NOT NULL,
  op text,
  user_id uuid,
  status text CHECK (status IN ('ok','retryable_error','fatal_error')),
  error_code text,
  http_status int,
  duration_ms int,
  meta jsonb DEFAULT '{}'
);

CREATE INDEX idx_runtime_events_ts ON runtime_events(ts DESC);
CREATE INDEX idx_runtime_events_correlation ON runtime_events(correlation_id);
CREATE INDEX idx_runtime_events_function ON runtime_events(function_name, ts DESC);

-- Access control: service role only (no authenticated access)
REVOKE ALL ON runtime_events FROM anon, authenticated;
GRANT INSERT, SELECT ON runtime_events TO service_role;

-- Append-only enforcement via triggers
CREATE OR REPLACE FUNCTION prevent_runtime_events_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'runtime_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER runtime_events_no_update
BEFORE UPDATE ON runtime_events
FOR EACH ROW EXECUTE FUNCTION prevent_runtime_events_mutation();

CREATE TRIGGER runtime_events_no_delete
BEFORE DELETE ON runtime_events
FOR EACH ROW EXECUTE FUNCTION prevent_runtime_events_mutation();

-- Phase 14: rate_limit_buckets table
CREATE TABLE rate_limit_buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  function_name text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count int DEFAULT 1,
  UNIQUE(user_id, function_name, window_start)
);

CREATE INDEX idx_rate_limit_user_fn ON rate_limit_buckets(user_id, function_name);

-- Access control: service role only
REVOKE ALL ON rate_limit_buckets FROM anon, authenticated;
GRANT ALL ON rate_limit_buckets TO service_role;

-- RPC for atomic rate limit upsert (returns new request count)
CREATE OR REPLACE FUNCTION upsert_rate_limit_bucket(
  p_user_id uuid,
  p_function_name text,
  p_window_start timestamptz
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  INSERT INTO rate_limit_buckets (user_id, function_name, window_start, request_count)
  VALUES (p_user_id, p_function_name, p_window_start, 1)
  ON CONFLICT (user_id, function_name, window_start)
  DO UPDATE SET request_count = rate_limit_buckets.request_count + 1
  RETURNING request_count INTO v_count;
  
  RETURN v_count;
END;
$$;