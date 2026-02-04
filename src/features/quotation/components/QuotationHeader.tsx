/**
 * UI COMPONENT — Phase 5D (extended)
 * Phase 6D.x: Ajout bouton Sauvegarder le brouillon
 * Phase 8.7: Gating du bouton Générer si blocking gaps + CTA clarification
 */
import { ArrowLeft, CheckCircle, MessageSquare, Loader2, Send, Save, HelpCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface QuotationHeaderProps {
  isNewQuotation: boolean;
  quotationCompleted: boolean;
  selectedEmailSubject: string | null;
  threadCount: number;
  isGenerating: boolean;
  onBack: () => void;
  onGenerateResponse: () => void;
  currentDraft?: { status: string; version: number; id?: string } | null;
  onSaveDraft?: () => void;
  isSaving?: boolean;
  // Phase 8.7: Gating props
  blockingGapsCount?: number;
  quoteCaseStatus?: string | null;
  onRequestClarification?: () => void;
}

// Labels humains pour les statuts (partagés avec BlockingGapsPanel)
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

export function QuotationHeader({
  isNewQuotation,
  quotationCompleted,
  selectedEmailSubject,
  threadCount,
  isGenerating,
  onBack,
  onGenerateResponse,
  currentDraft,
  onSaveDraft,
  isSaving,
  blockingGapsCount = 0,
  quoteCaseStatus,
  onRequestClarification,
}: QuotationHeaderProps) {
  // Phase 8.7: Gating logic (étendu avec garde-fou quoteCase)
  const hasBlockingGaps = blockingGapsCount > 0;
  const canGenerate = !isGenerating && !!currentDraft?.id && !hasBlockingGaps && quoteCaseStatus !== undefined;
  
  // Garde-fou #1: Statut explicite si quoteCase null
  const statusInfo = quoteCaseStatus 
    ? STATUS_LABELS[quoteCaseStatus] || { label: quoteCaseStatus, variant: 'outline' as const }
    : null;

  return (
    <div className="flex items-center gap-4 mb-6">
      <Button variant="ghost" size="icon" onClick={onBack}>
        <ArrowLeft className="h-5 w-5" />
      </Button>
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-bold">
            {isNewQuotation ? 'Nouvelle cotation' : 'Fiche de cotation'}
          </h1>
          {quotationCompleted && (
            <Badge className="bg-success/20 text-success border-success/30">
              <CheckCircle className="h-3 w-3 mr-1" />
              Cotation réalisée
            </Badge>
          )}
          {currentDraft && !quotationCompleted && (
            <Badge variant={currentDraft.status === 'sent' ? 'default' : 'outline'}>
              {currentDraft.status === 'draft' && 'Brouillon'}
              {currentDraft.status === 'sent' && 'Envoyé'}
              {currentDraft.status === 'accepted' && 'Accepté'}
              {currentDraft.status === 'rejected' && 'Refusé'}
              {currentDraft.status === 'generated' && 'Généré'}
              {currentDraft.version > 1 && ` v${currentDraft.version}`}
            </Badge>
          )}
          {/* Phase 8.7: Badge statut quote_case */}
          {!quotationCompleted && statusInfo && (
            <Badge variant={statusInfo.variant}>
              {statusInfo.label}
            </Badge>
          )}
          {/* Garde-fou #1: Badge explicite si quoteCase === null */}
          {!quotationCompleted && quoteCaseStatus === undefined && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-muted-foreground">
                    <HelpCircle className="h-3 w-3 mr-1" />
                    Dossier non analysé
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Analyse de qualification non encore disponible</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        {selectedEmailSubject && (
          <p className="text-sm text-muted-foreground truncate">
            {selectedEmailSubject}
          </p>
        )}
        {threadCount > 1 && (
          <Badge variant="outline" className="mt-1">
            <MessageSquare className="h-3 w-3 mr-1" />
            {threadCount} emails dans le fil
          </Badge>
        )}
      </div>
      {!quotationCompleted && (
        <div className="flex gap-2">
          {onSaveDraft && (
            <Button 
              variant="outline"
              onClick={onSaveDraft}
              disabled={isSaving}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {currentDraft?.id ? 'Sauvegarder' : 'Sauvegarder le brouillon'}
            </Button>
          )}
          
          {/* Phase 8.7: CTA "Demander clarification" si bloqué */}
          {hasBlockingGaps && onRequestClarification && (
            <Button 
              variant="secondary"
              onClick={onRequestClarification}
            >
              <AlertTriangle className="h-4 w-4 mr-2" />
              Demander clarification
            </Button>
          )}
          
          {/* Phase 8.7: Bouton Générer avec gating + tooltip */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button 
                    onClick={onGenerateResponse}
                    disabled={!canGenerate}
                  >
                    {isGenerating ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    Générer la réponse
                  </Button>
                </span>
              </TooltipTrigger>
              {!canGenerate && (
                <TooltipContent>
                  {!currentDraft?.id && <p>Sauvegardez d'abord le brouillon</p>}
                  {currentDraft?.id && quoteCaseStatus === undefined && (
                    <p>Analyse de qualification en cours...</p>
                  )}
                  {currentDraft?.id && quoteCaseStatus !== undefined && hasBlockingGaps && (
                    <p>Cotation bloquée : {blockingGapsCount} information{blockingGapsCount > 1 ? 's' : ''} manquante{blockingGapsCount > 1 ? 's' : ''}</p>
                  )}
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>
      )}
    </div>
  );
}