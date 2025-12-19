import { useState } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  Copy, 
  Check, 
  Loader2, 
  Mail, 
  FileText, 
  AlertCircle,
  Sparkles,
  Calendar,
  User
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import type { QuotationProcessResult } from '@/services/emailService';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: QuotationProcessResult | null;
  isLoading: boolean;
  onComplete: () => void;
}

export function QuotationProcessor({ 
  open, 
  onOpenChange, 
  result, 
  isLoading,
  onComplete 
}: Props) {
  const [editedBody, setEditedBody] = useState('');
  const [copied, setCopied] = useState(false);

  // Initialize edited body when result changes
  useState(() => {
    if (result?.draft.body) {
      setEditedBody(result.draft.body);
    }
  });

  const handleCopy = async () => {
    const textToCopy = editedBody || result?.draft.body || '';
    await navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    toast.success('Réponse copiée dans le presse-papiers');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    onOpenChange(false);
    onComplete();
  };

  const formatDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), "dd MMMM yyyy 'à' HH:mm", { locale: fr });
    } catch {
      return dateStr;
    }
  };

  const confidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-600 bg-green-100';
    if (confidence >= 0.5) return 'text-yellow-600 bg-yellow-100';
    return 'text-red-600 bg-red-100';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Traitement de la cotation
          </DialogTitle>
          <DialogDescription>
            Vérifiez et modifiez la réponse générée avant de l'envoyer
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">
              Import et génération de la cotation en cours...
            </p>
          </div>
        ) : result ? (
          <div className="flex-1 overflow-hidden flex flex-col gap-4">
            {/* Original Email Section */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Mail className="h-4 w-4" />
                Demande originale
              </div>
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <div className="flex flex-wrap gap-4 text-sm">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <User className="h-3 w-3" />
                    {result.originalEmail.from}
                  </span>
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {formatDate(result.originalEmail.date)}
                  </span>
                </div>
                <p className="font-medium">{result.originalEmail.subject}</p>
                <ScrollArea className="h-24">
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {result.originalEmail.body.substring(0, 500)}
                    {result.originalEmail.body.length > 500 && '...'}
                  </p>
                </ScrollArea>
              </div>
            </div>

            <Separator />

            {/* Analysis Section */}
            <div className="flex flex-wrap gap-2 items-center">
              <Badge className={confidenceColor(result.analysis.confidence)}>
                Confiance: {Math.round(result.analysis.confidence * 100)}%
              </Badge>
              
              {result.analysis.missingInfo.length > 0 && (
                <div className="flex items-center gap-1 text-sm text-amber-600">
                  <AlertCircle className="h-4 w-4" />
                  <span>Infos manquantes: {result.analysis.missingInfo.join(', ')}</span>
                </div>
              )}
            </div>

            {/* Generated Response Section */}
            <div className="flex-1 flex flex-col min-h-0 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <FileText className="h-4 w-4" />
                  Réponse générée
                </div>
                <Badge variant="outline">
                  À: {result.draft.to.join(', ')}
                </Badge>
              </div>
              
              <p className="text-sm text-muted-foreground">
                Objet: {result.draft.subject}
              </p>

              <Textarea
                value={editedBody || result.draft.body}
                onChange={(e) => setEditedBody(e.target.value)}
                className="flex-1 min-h-[200px] resize-none font-mono text-sm"
                placeholder="La réponse générée apparaîtra ici..."
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleClose}>
                Fermer
              </Button>
              <Button onClick={handleCopy} className="gap-2">
                {copied ? (
                  <>
                    <Check className="h-4 w-4" />
                    Copié !
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Copier la réponse
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 gap-4 text-muted-foreground">
            <AlertCircle className="h-8 w-8" />
            <p>Une erreur s'est produite</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
