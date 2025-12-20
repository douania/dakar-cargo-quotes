import { useState, useEffect } from 'react';
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
  User,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  FileWarning,
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
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { V5AnalysisDisplay } from '@/components/V5AnalysisDisplay';
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
  useEffect(() => {
    if (result?.draft.body) {
      setEditedBody(result.draft.body);
    }
  }, [result?.draft.body]);

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

  const regulatoryAnalysis = result?.analysis?.regulatoryAnalysis;
  const attachmentsAnalysis = result?.analysis?.attachmentsAnalysis;
  const feasibility = result?.analysis?.feasibility;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Analyse experte de la cotation
          </DialogTitle>
          <DialogDescription>
            Analyse réglementaire et réponse générée par l'expert IA
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">
              Analyse experte en cours (pièces jointes, régimes, faisabilité)...
            </p>
          </div>
        ) : result ? (
          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-4">
              {/* Regulatory Analysis Alert */}
              {regulatoryAnalysis && regulatoryAnalysis.correction_needed && (
                <Card className="border-amber-500 bg-amber-50">
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="font-semibold text-amber-800">
                          Correction réglementaire recommandée
                        </p>
                        <p className="text-sm text-amber-700">
                          Régime demandé: <strong>{regulatoryAnalysis.requested_regime || 'Non spécifié'}</strong>
                          {' → '}
                          Régime recommandé: <strong>{regulatoryAnalysis.recommended_regime} ({regulatoryAnalysis.regime_code})</strong>
                        </p>
                        <p className="text-sm text-amber-600">
                          {regulatoryAnalysis.correction_explanation}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Feasibility Check */}
              {feasibility && (
                <Card className={feasibility.is_feasible ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}>
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-3">
                      {feasibility.is_feasible ? (
                        <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
                      )}
                      <div className="space-y-2">
                        <p className={`font-semibold ${feasibility.is_feasible ? 'text-green-800' : 'text-red-800'}`}>
                          {feasibility.is_feasible ? 'Opération réalisable' : 'Points de vigilance'}
                        </p>
                        {feasibility.concerns && feasibility.concerns.length > 0 && (
                          <ul className="text-sm list-disc list-inside text-muted-foreground">
                            {feasibility.concerns.map((c: string, i: number) => (
                              <li key={i}>{c}</li>
                            ))}
                          </ul>
                        )}
                        {feasibility.recommendations && feasibility.recommendations.length > 0 && (
                          <div className="mt-2">
                            <p className="text-sm font-medium">Recommandations:</p>
                            <ul className="text-sm list-disc list-inside text-muted-foreground">
                              {feasibility.recommendations.map((r: string, i: number) => (
                                <li key={i}>{r}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Attachments Analysis */}
              {attachmentsAnalysis && (
                <Card className="border-blue-200">
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-3">
                      <FileWarning className="h-5 w-5 text-blue-600 flex-shrink-0" />
                      <div className="space-y-1">
                        <p className="font-semibold text-blue-800">
                          Analyse des pièces jointes
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {attachmentsAnalysis.analyzed 
                            ? attachmentsAnalysis.extracted_info || 'Informations extraites avec succès'
                            : 'Les pièces jointes n\'ont pas pu être analysées'}
                        </p>
                        {attachmentsAnalysis.missing_info && attachmentsAnalysis.missing_info.length > 0 && (
                          <p className="text-sm text-amber-600">
                            Infos non trouvées: {attachmentsAnalysis.missing_info.join(', ')}
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* V5 Analysis Display */}
              {result.analysis?.v5Analysis && (
                <V5AnalysisDisplay v5Analysis={result.analysis.v5Analysis} />
              )}

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
                  <ScrollArea className="h-20">
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {result.originalEmail.body.substring(0, 400)}
                      {result.originalEmail.body.length > 400 && '...'}
                    </p>
                  </ScrollArea>
                </div>
              </div>

              <Separator />

              {/* Analysis Badges */}
              <div className="flex flex-wrap gap-2 items-center">
                <Badge className={confidenceColor(result.analysis.confidence)}>
                  Confiance: {Math.round(result.analysis.confidence * 100)}%
                </Badge>
                
                {regulatoryAnalysis && !regulatoryAnalysis.correction_needed && (
                  <Badge variant="outline" className="text-green-600 border-green-300">
                    <ShieldCheck className="h-3 w-3 mr-1" />
                    Régime approprié: {regulatoryAnalysis.recommended_regime}
                  </Badge>
                )}

                {result.analysis.missingInfo && result.analysis.missingInfo.length > 0 && (
                  <div className="flex items-center gap-1 text-sm text-amber-600">
                    <AlertCircle className="h-4 w-4" />
                    <span>Infos manquantes: {result.analysis.missingInfo.join(', ')}</span>
                  </div>
                )}
              </div>

              {/* Generated Response Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <FileText className="h-4 w-4" />
                    Réponse experte générée
                  </div>
                  {result.draft.to && result.draft.to.length > 0 && (
                    <Badge variant="outline">
                      À: {result.draft.to.join(', ')}
                    </Badge>
                  )}
                </div>

                <p className="text-sm text-muted-foreground">
                  Objet: {result.draft.subject}
                </p>

                <Textarea
                  value={editedBody || result.draft.body}
                  onChange={(e) => setEditedBody(e.target.value)}
                  className="min-h-[250px] resize-none font-mono text-sm"
                  placeholder="La réponse générée apparaîtra ici..."
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2 pb-4">
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
          </ScrollArea>
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
