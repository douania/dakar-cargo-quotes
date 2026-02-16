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

interface CaseCardProps {
  caseData: QuoteCaseData;
}

export function CaseCard({ caseData }: CaseCardProps) {
  const navigate = useNavigate();
  const config = STATUS_CONFIG[caseData.status] || { label: caseData.status, className: 'bg-muted text-muted-foreground' };
  const completeness = caseData.puzzle_completeness ?? 0;

  return (
    <Card
      className="border-border/50 bg-gradient-card cursor-pointer hover:border-primary/30 transition-colors"
      onClick={() => navigate(`/case/${caseData.id}`)}
    >
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={`${config.className} border-0 text-[11px]`}>
                  {config.label}
                </Badge>
                {caseData.request_type && (
                  <span className="text-xs text-muted-foreground truncate">
                    {caseData.request_type}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1.5">
                <div className="flex-1 max-w-[200px]">
                  <Progress value={completeness * 100} className="h-1.5" />
                </div>
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                  {Math.round(completeness * 100)}%
                </span>
              </div>
            </div>
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {format(new Date(caseData.updated_at), 'dd MMM HH:mm', { locale: fr })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
