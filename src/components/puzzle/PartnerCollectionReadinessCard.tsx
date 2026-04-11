/**
 * COCKPIT-9 Phase 1: Partner collection sufficiency verdict.
 * P2-A: Migrated to consume useCockpitState (shared query, no internal fetch).
 * Verdict logic delegated to computeCollectionVerdict in cockpitStatusConstants.
 */

import { useCockpitState } from '@/hooks/useCockpitState';
import type { CollectionVerdict } from '@/lib/cockpitStatusConstants';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PackageSearch, CheckCircle2, AlertTriangle, XCircle, Minus } from 'lucide-react';

interface Props {
  caseId: string;
}

export function PartnerCollectionReadinessCard({ caseId }: Props) {
  const { data, isLoading } = useCockpitState(caseId);

  if (isLoading || !data) return null;

  const {
    collectionVerdict: verdict,
    exploitablePartnerRequests: exploitable,
    openPartnerRequests: openCount,
    pendingPartnerFacts: totalPending,
    selectedPartnerName,
  } = data;

  // Build summary string
  const parts: string[] = [];
  parts.push(`${exploitable} exploitable${exploitable > 1 ? 's' : ''}`);
  if (openCount > 0) parts.push(`${openCount} ouverte${openCount > 1 ? 's' : ''}`);
  if (totalPending > 0) parts.push(`${totalPending} fait(s) à valider`);
  const summary = parts.join(' · ');

  const config: Record<CollectionVerdict, {
    icon: React.ReactNode;
    label: string;
    badgeClass: string;
    detail: string;
  }> = {
    neutral: {
      icon: <Minus className="h-4 w-4 text-muted-foreground" />,
      label: 'Direct',
      badgeClass: 'bg-muted text-muted-foreground',
      detail: 'Aucune collecte partenaire — pricing direct possible.',
    },
    insufficient: {
      icon: <XCircle className="h-4 w-4 text-destructive" />,
      label: 'Insuffisante',
      badgeClass: 'bg-destructive/10 text-destructive',
      detail: summary,
    },
    in_progress: {
      icon: <AlertTriangle className="h-4 w-4 text-amber-600" />,
      label: 'En cours',
      badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
      detail: summary,
    },
    sufficient: {
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
      label: 'Suffisante',
      badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
      detail: summary,
    },
  };

  const c = config[verdict];

  return (
    <Card className="border-border/50 mb-3">
      <CardContent className="py-3 px-4 space-y-2">
        <div className="flex items-center gap-3">
          <PackageSearch className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium text-muted-foreground">Collecte partenaires</span>
          {c.icon}
          <Badge className={`${c.badgeClass} text-xs font-medium`}>{c.label}</Badge>
          <span className="text-xs text-muted-foreground ml-auto">{c.detail}</span>
        </div>
        {verdict !== 'neutral' && (
          <div className="flex items-center gap-2 pl-7">
            <span className="text-xs text-muted-foreground">Offre retenue :</span>
            {selectedPartnerName ? (
              <span className="text-xs font-medium">{selectedPartnerName}</span>
            ) : (
              <span className="text-xs text-muted-foreground/70 italic">Sélection opérateur requise</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
