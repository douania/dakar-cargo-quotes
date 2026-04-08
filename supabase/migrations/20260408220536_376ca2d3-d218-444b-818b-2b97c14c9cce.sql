-- COCKPIT-9 Phase 2: Add partner request selection columns
ALTER TABLE public.external_quote_requests
  ADD COLUMN IF NOT EXISTS is_selected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS selected_at timestamptz;

-- Ensure only one selected request per case
CREATE UNIQUE INDEX IF NOT EXISTS idx_eqr_one_selected_per_case
  ON public.external_quote_requests (case_id)
  WHERE is_selected = true;