-- Phase 7.1: Async Quotation Puzzle Engine
-- Table puzzle_jobs avec FK, RLS UPDATE, anti-doublon, index

CREATE TABLE public.puzzle_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Relations avec FK et ON DELETE
  thread_id UUID NOT NULL REFERENCES public.email_threads(id) ON DELETE CASCADE,
  email_id UUID REFERENCES public.emails(id) ON DELETE SET NULL,
  
  -- État du job
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  current_phase TEXT,
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  phases_completed TEXT[] DEFAULT '{}',
  
  -- Résultats (partiels puis finaux)
  partial_results JSONB DEFAULT '{}',
  final_puzzle JSONB,
  knowledge_stored INTEGER DEFAULT 0,
  
  -- Métriques
  email_count INTEGER,
  attachment_count INTEGER,
  error_message TEXT,
  error_phase TEXT,
  
  -- Reprise et monitoring (CTO requirement B)
  attempt INTEGER DEFAULT 1,
  last_heartbeat TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  
  -- Ownership
  created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index pour lookup rapide thread + owner + status
CREATE INDEX idx_puzzle_jobs_thread_owner_status
ON public.puzzle_jobs(created_by, thread_id, status);

-- Index pour les jobs running (stale detection)
CREATE INDEX idx_puzzle_jobs_running_heartbeat
ON public.puzzle_jobs(last_heartbeat)
WHERE status = 'running';

-- Anti-doublon : un seul job actif par thread/user (CTO requirement C)
CREATE UNIQUE INDEX uq_puzzle_jobs_one_active_per_thread
ON public.puzzle_jobs(created_by, thread_id)
WHERE status IN ('pending', 'running');

-- RLS
ALTER TABLE public.puzzle_jobs ENABLE ROW LEVEL SECURITY;

-- Policy SELECT : owner voit ses jobs
CREATE POLICY puzzle_jobs_owner_select
ON public.puzzle_jobs FOR SELECT TO authenticated
USING (created_by = auth.uid());

-- Policy INSERT : owner crée ses jobs
CREATE POLICY puzzle_jobs_owner_insert
ON public.puzzle_jobs FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid());

-- Policy UPDATE : owner peut annuler ses jobs (CTO requirement A)
CREATE POLICY puzzle_jobs_owner_update
ON public.puzzle_jobs FOR UPDATE TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());