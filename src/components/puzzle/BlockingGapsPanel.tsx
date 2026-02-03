/**
 * Phase 8.1B — Panneau "Pourquoi la cotation n'est pas prête"
 * 
 * Affiche l'état du quote_case et ses gaps bloquants
 * ZÉRO logique nouvelle — exposition de l'état existant uniquement
 */

import { AlertCircle, AlertTriangle, CheckCircle2, HelpCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface BlockingGap {
  id: string;
  gap_key: string;
  gap_category: string;
  question_fr: string | null;
  is_blocking: boolean;
  status: string;
}

interface Props {
  quoteCaseStatus: string | null;
  blockingGaps: BlockingGap[];
  isLoading?: boolean;
}

// Labels humains pour les statuts
const STATUS_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  NEW_THREAD: { label: 'Nouveau fil', variant: 'secondary' },
  RFQ_DETECTED: { label: 'Demande détectée', variant: 'secondary' },
  FACTS_PARTIAL: { label: 'Données incomplètes', variant: 'destructive' },
  NEED_INFO: { label: 'Info requise', variant: 'destructive' },
  READY_TO_PRICE: { label: 'Prêt à coter', variant: 'default' },
  PRICING_RUNNING: { label: 'Cotation en cours', variant: 'secondary' },
  PRICED_DRAFT: { label: 'Brouillon prêt', variant: 'default' },
  HUMAN_REVIEW: { label: 'En revue', variant: 'secondary' },
  SENT: { label: 'Envoyé', variant: 'outline' },
  ARCHIVED: { label: 'Archivé', variant: 'outline' },
};

// Labels pour les catégories de gaps
const GAP_CATEGORY_LABELS: Record<string, string> = {
  cargo: 'Marchandise',
  routing: 'Itinéraire',
  timing: 'Délais',
  pricing: 'Tarification',
  documentation: 'Documents',
  contact: 'Contact',
};

export function BlockingGapsPanel({ quoteCaseStatus, blockingGaps, isLoading }: Props) {
  const [isOpen, setIsOpen] = useState(true);

  if (isLoading) {
    return (
      <Alert className="border-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        <AlertTitle>Chargement de l'état du dossier...</AlertTitle>
      </Alert>
    );
  }

  // Si pas de quote_case, pas de panneau
  if (!quoteCaseStatus) {
    return null;
  }

  const statusInfo = STATUS_LABELS[quoteCaseStatus] || { label: quoteCaseStatus, variant: 'outline' as const };
  const isBlocked = blockingGaps.length > 0;
  const isReady = ['READY_TO_PRICE', 'PRICED_DRAFT', 'SENT', 'ARCHIVED'].includes(quoteCaseStatus);

  // Si prêt à coter, afficher un message positif
  if (isReady && !isBlocked) {
    return (
      <Alert className="border-green-200 bg-green-50">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <AlertTitle className="text-green-800">Dossier prêt</AlertTitle>
        <AlertDescription className="text-green-700">
          Toutes les informations nécessaires sont disponibles.
          <Badge variant="default" className="ml-2 bg-green-600">
            {statusInfo.label}
          </Badge>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Alert className={isBlocked ? "border-amber-200 bg-amber-50" : "border-blue-200 bg-blue-50"}>
        <CollapsibleTrigger className="w-full text-left">
          <div className="flex items-start gap-2">
            {isBlocked ? (
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
            ) : (
              <HelpCircle className="h-4 w-4 text-blue-600 mt-0.5" />
            )}
            <div className="flex-1">
              <AlertTitle className={isBlocked ? "text-amber-800" : "text-blue-800"}>
                {isBlocked ? "Cotation incomplète" : "État du dossier"}
              </AlertTitle>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={statusInfo.variant}>
                  {statusInfo.label}
                </Badge>
                {isBlocked && (
                  <span className="text-sm text-amber-700">
                    {blockingGaps.length} élément{blockingGaps.length > 1 ? 's' : ''} bloquant{blockingGaps.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
            {isBlocked && (
              <div className="text-muted-foreground">
                {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            )}
          </div>
        </CollapsibleTrigger>

        {isBlocked && (
          <CollapsibleContent>
            <AlertDescription className="mt-3 pt-3 border-t border-amber-200">
              <ul className="space-y-2">
                {blockingGaps.map((gap) => (
                  <li key={gap.id} className="flex items-start gap-2 text-sm text-amber-800">
                    <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <Badge variant="outline" className="text-xs mr-2">
                        {GAP_CATEGORY_LABELS[gap.gap_category] || gap.gap_category}
                      </Badge>
                      <span>{gap.question_fr || gap.gap_key}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </CollapsibleContent>
        )}
      </Alert>
    </Collapsible>
  );
}
