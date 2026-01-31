/**
 * UI COMPONENT — Phase 5D (extended)
 * - Ajout prop currentDraft pour affichage statut
 */
import { ArrowLeft, CheckCircle, MessageSquare, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface QuotationHeaderProps {
  isNewQuotation: boolean;
  quotationCompleted: boolean;
  selectedEmailSubject: string | null;
  threadCount: number;
  isGenerating: boolean;
  onBack: () => void;
  onGenerateResponse: () => void;
  currentDraft?: { status: string; version: number } | null;
}

export function QuotationHeader({
  isNewQuotation,
  quotationCompleted,
  selectedEmailSubject,
  threadCount,
  isGenerating,
  onBack,
  onGenerateResponse,
  currentDraft,
}: QuotationHeaderProps) {
  return (
    <div className="flex items-center gap-4 mb-6">
      <Button variant="ghost" size="icon" onClick={onBack}>
        <ArrowLeft className="h-5 w-5" />
      </Button>
      <div className="flex-1">
        <div className="flex items-center gap-2">
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
              {currentDraft.version > 1 && ` v${currentDraft.version}`}
            </Badge>
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
        <Button 
          onClick={onGenerateResponse}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Send className="h-4 w-4 mr-2" />
          )}
          Générer la réponse
        </Button>
      )}
    </div>
  );
}
