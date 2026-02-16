import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { FolderOpen } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { QuoteCaseData } from '@/hooks/useQuoteCaseData';

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  NEW_THREAD:       { label: 'Nouveau',         className: 'bg-muted text-muted-foreground' },
  RFQ_DETECTED:     { label: 'RFQ détectée',    className: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
  FACTS_PARTIAL:    { label: 'Faits partiels',  className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  NEED_INFO:        { label: 'Info manquante',   className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  READY_TO_PRICE:   { label: 'Prêt à chiffrer', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  PRICING_RUNNING:  { label: 'Chiffrage…',      className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 animate-pulse' },
  PRICED_DRAFT:     { label: 'Chiffré',         className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  HUMAN_REVIEW:     { label: 'Revue humaine',   className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' },
  QUOTED_VERSIONED: { label: 'Versionné',       className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' },
};

const REQUEST_TYPE_LABELS: Record<string, string> = {
  SEA_FCL_IMPORT: 'Maritime FCL Import',
  SEA_LCL_IMPORT: 'Maritime LCL Import',
  SEA_FCL_EXPORT: 'Maritime FCL Export',
  SEA_LCL_EXPORT: 'Maritime LCL Export',
  AIR_IMPORT: 'Aérien Import',
  AIR_EXPORT: 'Aérien Export',
  ROAD_IMPORT: 'Routier Import',
  ROAD_EXPORT: 'Routier Export',
  TRANSIT: 'Transit',
};

interface CaseCardProps {
  caseData: QuoteCaseData;
  clientName?: string;
}

export function CaseCard({ caseData, clientName }: CaseCardProps) {
  const navigate = useNavigate();
  const config = STATUS_CONFIG[caseData.status] || { label: caseData.status, className: 'bg-muted text-muted-foreground' };
  // puzzle_completeness is already 0–100 in DB
  const completeness = Math.min(caseData.puzzle_completeness ?? 0, 100);
  const typeLabel = REQUEST_TYPE_LABELS[caseData.request_type ?? ''] ?? caseData.request_type;

  return (
    <Card
      className="border-border/50 bg-gradient-card cursor-pointer hover:border-primary/30 transition-colors"
      onClick={() => navigate(`/case/${caseData.id}`)}
    >
      <CardContent className="py-3 px-4">
        {/* Line 1: Client name + date */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="font-medium text-sm truncate">
              {clientName || 'Client inconnu'}
            </span>
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {format(new Date(caseData.updated_at), 'dd MMM HH:mm', { locale: fr })}
          </span>
        </div>

        {/* Line 2: Status badge + request type */}
        <div className="flex items-center gap-2 mt-1.5 ml-6">
          <Badge className={`${config.className} border-0 text-[11px]`}>
            {config.label}
          </Badge>
          {typeLabel && (
            <span className="text-xs text-muted-foreground truncate">
              {typeLabel}
            </span>
          )}
        </div>

        {/* Line 3: Progress bar */}
        <div className="flex items-center gap-3 mt-2 ml-6">
          <div className="flex-1 max-w-[200px]">
            <Progress value={completeness} className="h-1.5" />
          </div>
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
            {Math.round(completeness)}%
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
