import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface PuzzleJob {
  id: string;
  thread_id: string;
  email_id: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  current_phase: string | null;
  progress: number;
  phases_completed: string[];
  partial_results: Record<string, unknown>;
  final_puzzle: Record<string, unknown> | null;
  knowledge_stored: number;
  email_count: number | null;
  attachment_count: number | null;
  emails_analyzed_ids: string[] | null;
  error_message: string | null;
  error_phase: string | null;
  attempt: number;
  last_heartbeat: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  // Computed fields from poll response
  is_stale?: boolean;
  can_resume?: boolean;
}

interface UsePuzzleJobOptions {
  autoResume?: boolean; // Automatically trigger tick if stale detected
  pollingInterval?: number; // ms between polls (default 3000)
}

const PHASE_LABELS: Record<string, string> = {
  extract_request: 'Extraction de la demande',
  extract_clarifications: 'Analyse des clarifications',
  extract_quotation: 'Extraction de la cotation',
  extract_negotiation: 'Analyse de la négociation',
  extract_contacts: 'Extraction des contacts',
};

export function usePuzzleJob(
  threadId: string | undefined,
  options: UsePuzzleJobOptions = {}
) {
  const { autoResume = true, pollingInterval = 3000 } = options;
  
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<PuzzleJob | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isTicking, setIsTicking] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Start a new analysis job
  const startAnalysis = useCallback(async (emailId?: string) => {
    if (!threadId) {
      toast.error('Thread ID requis pour démarrer l\'analyse');
      return null;
    }
    
    setIsStarting(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('learn-quotation-puzzle', {
        body: { threadId, emailId, mode: 'start' }
      });
      
      if (error) throw error;
      
      if (data.job_id) {
        setJobId(data.job_id);
        setIsPolling(true);
        
        if (data.message === 'Job déjà en cours') {
          toast.info('Analyse déjà en cours, reprise du suivi...');
        } else {
          toast.success('Analyse démarrée en arrière-plan');
        }
        
        return data;
      }
      
      throw new Error('No job_id returned');
    } catch (error) {
      console.error('[usePuzzleJob] Start error:', error);
      toast.error('Erreur lors du démarrage de l\'analyse');
      return null;
    } finally {
      setIsStarting(false);
    }
  }, [threadId]);

  // Cancel the current job
  const cancelAnalysis = useCallback(async () => {
    if (!jobId) return false;
    
    try {
      const { error } = await supabase.functions.invoke('learn-quotation-puzzle', {
        body: { job_id: jobId, mode: 'cancel' }
      });
      
      if (error) throw error;
      
      setIsPolling(false);
      setJob(prev => prev ? { ...prev, status: 'cancelled' } : null);
      toast.info('Analyse annulée');
      return true;
    } catch (error) {
      console.error('[usePuzzleJob] Cancel error:', error);
      toast.error('Erreur lors de l\'annulation');
      return false;
    }
  }, [jobId]);

  // Resume a stale job by triggering a single phase (tick)
  const resumeStaleJob = useCallback(async () => {
    if (!jobId) return null;
    
    setIsTicking(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('learn-quotation-puzzle', {
        body: { job_id: jobId, mode: 'tick' }
      });
      
      if (error) throw error;
      
      if (data.phase_completed) {
        toast.success(`Phase "${PHASE_LABELS[data.phase_completed] || data.phase_completed}" terminée`);
      }
      
      return data;
    } catch (error) {
      console.error('[usePuzzleJob] Tick error:', error);
      toast.error('Erreur lors de la reprise');
      return null;
    } finally {
      setIsTicking(false);
    }
  }, [jobId]);

  // Poll for job status
  const pollStatus = useCallback(async () => {
    if (!jobId) return;
    
    try {
      const { data, error } = await supabase.functions.invoke('learn-quotation-puzzle', {
        body: { job_id: jobId, mode: 'poll' }
      });
      
      if (error) throw error;
      
      setJob(data);
      
      // Auto-resume if stale and option enabled
      if (autoResume && data.is_stale && data.can_resume && !isTicking) {
        console.log('[usePuzzleJob] Job stale, triggering tick...');
        await resumeStaleJob();
      }
      
      // Stop polling if terminal state
      if (['completed', 'failed', 'cancelled'].includes(data.status)) {
        setIsPolling(false);
        
        if (data.status === 'completed') {
          toast.success(`Analyse terminée: ${data.knowledge_stored || 0} connaissances extraites`);
        } else if (data.status === 'failed') {
          toast.error(`Analyse échouée: ${data.error_message || 'Erreur inconnue'}`);
        }
      }
    } catch (error) {
      console.error('[usePuzzleJob] Poll error:', error);
    }
  }, [jobId, autoResume, isTicking, resumeStaleJob]);

  // Setup polling interval
  useEffect(() => {
    if (!isPolling || !jobId) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }
    
    // Initial poll
    pollStatus();
    
    // Setup interval
    pollingRef.current = setInterval(pollStatus, pollingInterval);
    
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [isPolling, jobId, pollStatus, pollingInterval]);

  // Reset state when threadId changes
  useEffect(() => {
    setJobId(null);
    setJob(null);
    setIsPolling(false);
  }, [threadId]);

  return {
    // State
    job,
    jobId,
    isPolling,
    isStarting,
    isTicking,
    
    // Actions
    startAnalysis,
    cancelAnalysis,
    resumeStaleJob,
    
    // Computed
    isRunning: job?.status === 'running',
    isComplete: job?.status === 'completed',
    isFailed: job?.status === 'failed',
    isCancelled: job?.status === 'cancelled',
    isStale: job?.is_stale ?? false,
    canResume: job?.can_resume ?? false,
    
    // Helpers
    phaseLabel: job?.current_phase ? PHASE_LABELS[job.current_phase] || job.current_phase : null,
    phasesRemaining: job ? 5 - (job.phases_completed?.length || 0) : 5,
  };
}

export { PHASE_LABELS };
