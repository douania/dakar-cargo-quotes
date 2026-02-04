/**
 * Phase 9.4 — Indicateur d'avancement des décisions
 * 
 * CTO RULES:
 * ❌ Aucun bouton "continuer"
 * ❌ Aucun changement de statut
 * ✅ Lecture pure
 */

import { CheckCircle, Circle, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { 
  DecisionType, 
  ALL_DECISION_TYPES, 
  DECISION_TYPE_LABELS 
} from '@/hooks/useDecisionSupport';

interface DecisionStatus {
  type: DecisionType;
  isCommitted: boolean;
  isCommitting?: boolean;
}

interface Props {
  decisions: DecisionStatus[];
  className?: string;
}

export function DecisionProgressIndicator({ decisions, className }: Props) {
  // Construire un map pour lookup rapide
  const statusMap = new Map(decisions.map(d => [d.type, d]));
  
  // Compter les décisions validées
  const committedCount = decisions.filter(d => d.isCommitted).length;
  const totalCount = ALL_DECISION_TYPES.length;
  const allComplete = committedCount === totalCount;

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header avec compteur */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          Décisions validées
        </span>
        <Badge 
          variant={allComplete ? "default" : "secondary"}
          className={cn(
            "font-mono",
            allComplete && "bg-green-600 hover:bg-green-700"
          )}
        >
          {committedCount} / {totalCount}
        </Badge>
      </div>

      {/* Liste des types de décision */}
      <div className="space-y-1.5">
        {ALL_DECISION_TYPES
          .sort((a, b) => DECISION_TYPE_LABELS[a].order - DECISION_TYPE_LABELS[b].order)
          .map(type => {
            const status = statusMap.get(type);
            const isCommitted = status?.isCommitted ?? false;
            const isCommitting = status?.isCommitting ?? false;

            return (
              <div 
                key={type}
                className={cn(
                  "flex items-center gap-2 text-sm py-1 px-2 rounded transition-colors",
                  isCommitted && "bg-green-50 text-green-800",
                  isCommitting && "bg-blue-50 text-blue-700",
                  !isCommitted && !isCommitting && "text-muted-foreground"
                )}
              >
                {isCommitting ? (
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                ) : isCommitted ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground/50" />
                )}
                <span className={cn(
                  isCommitted && "font-medium"
                )}>
                  {DECISION_TYPE_LABELS[type].label}
                </span>
              </div>
            );
          })}
      </div>

      {/* Message de complétion */}
      {allComplete && (
        <div className="text-xs text-green-700 bg-green-50 rounded p-2 text-center border border-green-200">
          ✅ Toutes les décisions ont été validées
        </div>
      )}
    </div>
  );
}
