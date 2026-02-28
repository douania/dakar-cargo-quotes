
CREATE TABLE public.case_puzzle_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.quote_cases(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed','cancelled')),
  progress int NOT NULL DEFAULT 0,
  attempt int NOT NULL DEFAULT 1,
  last_heartbeat timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms int,
  error_message text,
  final_result jsonb,
  request_params jsonb,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cpj_user_case_status ON public.case_puzzle_jobs (created_by, case_id, status);
CREATE INDEX idx_cpj_heartbeat ON public.case_puzzle_jobs (last_heartbeat) WHERE status = 'running';
CREATE UNIQUE INDEX idx_cpj_active_unique ON public.case_puzzle_jobs (created_by, case_id) WHERE status IN ('pending', 'running');

ALTER TABLE public.case_puzzle_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cpj_select_owner" ON public.case_puzzle_jobs
  FOR SELECT TO authenticated USING (created_by = auth.uid());

CREATE POLICY "cpj_insert_owner" ON public.case_puzzle_jobs
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

CREATE POLICY "cpj_update_owner" ON public.case_puzzle_jobs
  FOR UPDATE TO authenticated USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());
