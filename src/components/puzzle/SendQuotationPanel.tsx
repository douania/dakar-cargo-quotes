/**
 * Phase 19A: SendQuotationPanel
 * UI for sending a quotation version to the client
 * 
 * Visible only when case status is QUOTED_VERSIONED or SENT
 * Guards: button disabled during loading, after sent, or if prerequisites missing
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Send, Loader2, CheckCircle2, Mail, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useSendQuotation } from '@/hooks/useSendQuotation';

interface SendQuotationPanelProps {
  caseId: string;
}

export function SendQuotationPanel({ caseId }: SendQuotationPanelProps) {
  const {
    ownerDraft,
    selectedVersion,
    canSend,
    isSent,
    sentAt,
    sendMutation,
    isLoading,
  } = useSendQuotation(caseId);

  if (isLoading) {
    return (
      <Card className="border-muted animate-pulse">
        <CardHeader className="pb-3">
          <div className="h-5 bg-muted rounded w-1/3" />
        </CardHeader>
        <CardContent>
          <div className="h-16 bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  // Don't render if no draft and no version
  if (!ownerDraft && !selectedVersion && !isSent) {
    return null;
  }

  const snapshot = selectedVersion?.snapshot as any;
  const totalHt = snapshot?.totals?.total_ht;
  const currency = snapshot?.totals?.currency || 'XOF';
  const formatAmount = (amount: number) => new Intl.NumberFormat('fr-FR').format(amount);

  return (
    <Card className={`border-blue-200 dark:border-blue-800 ${isSent ? 'bg-gradient-to-br from-emerald-50/50 to-background dark:from-emerald-950/20' : 'bg-gradient-to-br from-blue-50/50 to-background dark:from-blue-950/20'}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isSent ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Send className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            )}
            <CardTitle className="text-lg">
              {isSent ? 'Devis envoyé' : 'Envoyer le devis'}
            </CardTitle>
          </div>
          {isSent && (
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              ENVOYÉ
            </Badge>
          )}
        </div>
        {isSent && sentAt && (
          <CardDescription>
            Envoyé le {format(new Date(sentAt), "d MMMM yyyy 'à' HH:mm", { locale: fr })}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Summary */}
        <div className="p-3 bg-muted/50 rounded-lg space-y-2">
          {selectedVersion && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Version</span>
              <span className="font-medium">v{selectedVersion.version_number}</span>
            </div>
          )}
          {totalHt !== undefined && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total HT</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                {formatAmount(totalHt)} {currency}
              </span>
            </div>
          )}
          {ownerDraft?.to_addresses && ownerDraft.to_addresses.length > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1">
                <Mail className="h-3 w-3" />
                Destinataire
              </span>
              <span className="font-medium truncate max-w-[200px]">
                {ownerDraft.to_addresses[0]}
              </span>
            </div>
          )}
        </div>

        {/* Missing prerequisites warning */}
        {!isSent && (!ownerDraft || !selectedVersion) && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-amber-800 dark:text-amber-200">
              {!selectedVersion && <p>Aucune version de devis sélectionnée.</p>}
              {!ownerDraft && <p>Aucun brouillon d'email disponible.</p>}
            </div>
          </div>
        )}

        {/* Send button with confirmation */}
        {!isSent && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                className="w-full gap-2"
                disabled={!canSend || sendMutation.isPending}
              >
                {sendMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Envoi en cours...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Envoyer le devis
                  </>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <Send className="h-5 w-5 text-blue-600" />
                  Confirmer l'envoi du devis
                </AlertDialogTitle>
                <AlertDialogDescription className="space-y-2">
                  <p>
                    Vous êtes sur le point d'envoyer la <strong>version v{selectedVersion?.version_number}</strong> du devis.
                  </p>
                  {totalHt !== undefined && (
                    <p>
                      Montant total HT : <strong>{formatAmount(totalHt)} {currency}</strong>
                    </p>
                  )}
                  {ownerDraft?.to_addresses?.[0] && (
                    <p>
                      Destinataire : <strong>{ownerDraft.to_addresses[0]}</strong>
                    </p>
                  )}
                  <p className="text-amber-600 dark:text-amber-400 font-medium mt-2">
                    Cette action enverra le devis au client et verrouillera les modifications.
                  </p>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={sendMutation.isPending}>Annuler</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => sendMutation.mutate()}
                  disabled={sendMutation.isPending}
                >
                  {sendMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Envoi...
                    </>
                  ) : (
                    'Confirmer et envoyer'
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </CardContent>
    </Card>
  );
}
