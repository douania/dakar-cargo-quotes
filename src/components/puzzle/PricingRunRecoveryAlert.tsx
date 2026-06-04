import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';

interface PricingRunRecoveryAlertProps {
  caseId: string;
}

interface LatestPricingRun {
  id: string;
  run_number: number;
  status: string | null;
  error_message: string | null;
  outputs_json: Json | null;
  created_at: string | null;
  completed_at: string | null;
}

function getOutputMessage(outputsJson: Json | null): string | null {
  if (!outputsJson || typeof outputsJson !== 'object' || Array.isArray(outputsJson)) {
    return null;
  }

  const message = outputsJson.message;
  return typeof message === 'string' && message.trim() ? message : null;
}

function formatRunDate(value: string | null): string | null {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return format(date, 'dd/MM/yyyy HH:mm', { locale: fr });
}

export function PricingRunRecoveryAlert({ caseId }: PricingRunRecoveryAlertProps) {
  const { data: latestRun } = useQuery({
    queryKey: ['pricing-run-recovery', caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pricing_runs')
        .select('id, run_number, status, error_message, outputs_json, created_at, completed_at')
        .eq('case_id', caseId)
        .order('run_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn('[PricingRunRecoveryAlert] latest run lookup failed:', error);
        return null;
      }

      return data as LatestPricingRun | null;
    },
    enabled: !!caseId,
    staleTime: 30000,
  });

  if (!latestRun || (latestRun.status !== 'failed' && latestRun.status !== 'blocked')) {
    return null;
  }

  const outputMessage = getOutputMessage(latestRun.outputs_json);
  const displayedMessage = latestRun.error_message || outputMessage;
  const runDate = formatRunDate(latestRun.completed_at || latestRun.created_at);
  const hasUnknownIncotermHint = displayedMessage?.includes('Incoterm inconnu');

  return (
    <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertTitle className="text-sm text-amber-900 dark:text-amber-100">
        {latestRun.status === 'failed' ? 'Dernier pricing échoué' : 'Dernier pricing bloqué'}
      </AlertTitle>
      <AlertDescription className="space-y-2 text-sm text-amber-900 dark:text-amber-100">
        <div>
          Run #{latestRun.run_number}
          {runDate ? <span className="text-amber-800 dark:text-amber-200"> · {runDate}</span> : null}
        </div>
        {displayedMessage ? <p>{displayedMessage}</p> : null}
        {hasUnknownIncotermHint ? (
          <p>Vérifiez le fait routing.incoterm, corrigez l’incoterm, puis relancez le pricing.</p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
