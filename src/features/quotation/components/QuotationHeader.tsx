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
}

export function QuotationHeader({
  isNewQuotation,
  quotationCompleted,
  selectedEmailSubject,
  threadCount,
  isGenerating,
  onBack,
  onGenerateResponse,
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
            <Badge className="bg-green-500/20 text-green-600 border-green-500/30">
              <CheckCircle className="h-3 w-3 mr-1" />
              Cotation réalisée
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
