/**
 * Phase 19A P0 Hardening + A4: SendQuotationPanel
 * Manual review + marking panel for quotation sending.
 * 
 * This panel does NOT send emails automatically.
 * It provides a review interface and marks the quotation as manually sent.
 * 
 * A4: Added AI enrichment toggle + ai_generated badge on draft.
 * 
 * Visible only when case status is QUOTED_VERSIONED or SENT.
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Send, Loader2, CheckCircle2, Mail, FileEdit, AlertTriangle, Save, Check, X, Sparkles } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useSendQuotation } from '@/hooks/useSendQuotation';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface SendQuotationPanelProps {
  caseId: string;
}

function PreCheckItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? (
        <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
      ) : (
        <X className="h-4 w-4 text-destructive flex-shrink-0" />
      )}
      <span className={ok ? 'text-foreground' : 'text-destructive font-medium'}>{label}</span>
    </div>
  );
}

export function SendQuotationPanel({ caseId }: SendQuotationPanelProps) {
  const queryClient = useQueryClient();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [useAiEnrichment, setUseAiEnrichment] = useState(false);

  const {
    ownerDraft,
    selectedVersion,
    canSend,
    isSent,
    isCaseSent,
    sentAt,
    sendMutation,
    isLoading,
    hasPdf,
    hasRecipient,
    hasSubject,
    hasBody,
    aiGenerated,
  } = useSendQuotation(caseId);

  // Unified lock flag: draft sent OR case in terminal state
  const isFinalized = isSent || isCaseSent;

  // Local edit state for inline draft editor
  const [editTo, setEditTo] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');

  // Sync local state when draft loads or after save
  useEffect(() => {
    if (ownerDraft) {
      setEditTo(ownerDraft.to_addresses?.[0] ?? '');
      setEditSubject(ownerDraft.subject ?? '');
      setEditBody(ownerDraft.body_text ?? '');
    }
  }, [ownerDraft?.id, ownerDraft?.subject, ownerDraft?.body_text, ownerDraft?.to_addresses?.[0]]);

  // Local flags derived from edit state
  const localHasRecipient = !!editTo.trim();
  const localHasSubject = !!editSubject.trim();
  const localHasBody = !!editBody.trim();

  const hasUnsavedChanges = !!ownerDraft && (
    editTo.trim() !== (ownerDraft.to_addresses?.[0] ?? '') ||
    editSubject.trim() !== (ownerDraft.subject ?? '') ||
    editBody.trim() !== (ownerDraft.body_text ?? '')
  );

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
  if (!ownerDraft && !selectedVersion && !isFinalized) {
    return null;
  }

  const snapshot = selectedVersion?.snapshot as any;
  const totalHt = snapshot?.totals?.total_ht;
  const currency = snapshot?.totals?.currency || 'XOF';
  const formatAmount = (amount: number) => new Intl.NumberFormat('fr-FR').format(amount);

  const handleSaveDraft = async () => {
    if (!ownerDraft || !selectedVersion) return;
    setIsSaving(true);
    try {
      const trimmedTo = editTo.trim();
      const trimmedSubject = editSubject.trim();
      const trimmedBody = editBody.trim();

      const { error } = await supabase
        .from('email_drafts')
        .update({
          to_addresses: trimmedTo ? [trimmedTo] : [],
          subject: trimmedSubject,
          body_text: trimmedBody,
        })
        .eq('id', ownerDraft.id)
        .eq('quotation_version_id', selectedVersion.id);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['send-quotation-data', caseId] });
      toast.success('Brouillon enregistré');
    } catch (err) {
      console.error('[save-draft]', err);
      toast.error('Erreur lors de la sauvegarde du brouillon');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className={`border-blue-200 dark:border-blue-800 ${isFinalized ? 'bg-gradient-to-br from-emerald-50/50 to-background dark:from-emerald-950/20' : 'bg-gradient-to-br from-blue-50/50 to-background dark:from-blue-950/20'}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isFinalized ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Send className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            )}
            <CardTitle className="text-lg">
              {isFinalized ? 'Devis marqué envoyé' : 'Préparer l\'envoi du devis'}
            </CardTitle>
          </div>
          {isFinalized && (
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              MARQUÉ ENVOYÉ
            </Badge>
          )}
        </div>
        {isFinalized && sentAt && (
          <CardDescription>
            Marqué le {format(new Date(sentAt), "d MMMM yyyy 'à' HH:mm", { locale: fr })}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Version summary */}
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
        </div>

        {/* Pre-verification checklist */}
        {!isFinalized && ownerDraft && (
          <div className="p-3 bg-muted/30 rounded-lg space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Pré-vérifications</p>
            <PreCheckItem ok={localHasRecipient} label={localHasRecipient ? 'Destinataire renseigné' : 'Destinataire manquant'} />
            <PreCheckItem ok={localHasSubject} label={localHasSubject ? 'Sujet renseigné' : 'Sujet manquant'} />
            <PreCheckItem ok={localHasBody} label={localHasBody ? 'Corps du message renseigné' : 'Corps du message manquant'} />
            <PreCheckItem ok={hasPdf} label={hasPdf ? 'PDF détecté côté interface' : 'PDF non détecté côté interface'} />
          </div>
        )}

        {/* PDF warning */}
        {!isFinalized && selectedVersion && !hasPdf && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Aucun PDF exporté n'est détecté pour la version sélectionnée. Exportez d'abord le PDF du devis. Le serveur bloquera le marquage sans PDF.
            </p>
          </div>
        )}

        {/* Generate draft button when missing */}
        {!isFinalized && selectedVersion && !ownerDraft && (
          <div className="space-y-3">
            {/* AI enrichment toggle */}
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <Label htmlFor="ai-enrichment" className="text-sm font-medium cursor-pointer">
                  Enrichissement IA
                </Label>
              </div>
              <Switch
                id="ai-enrichment"
                checked={useAiEnrichment}
                onCheckedChange={setUseAiEnrichment}
              />
            </div>

            <Button
              variant="outline"
              className="w-full gap-2"
              disabled={isGenerating}
              onClick={async () => {
                setIsGenerating(true);
                try {
                  const { data, error } = await supabase.functions.invoke('create-quotation-email-draft', {
                    body: { case_id: caseId, version_id: selectedVersion.id, use_ai_enrichment: useAiEnrichment },
                  });
                  if (error) throw error;
                  if (!data?.ok) throw new Error(data?.error || 'Échec de la création du brouillon');
                  queryClient.invalidateQueries({ queryKey: ['send-quotation-data', caseId] });

                  // Differentiated toast based on generation_mode
                  if (data.idempotent) {
                    toast.success('Brouillon existant récupéré');
                  } else if (data.generation_mode === 'ai') {
                    toast.success('Brouillon IA créé', { description: 'Le corps a été enrichi par l\'IA' });
                  } else {
                    toast.success('Brouillon standard créé');
                  }
                } catch (err) {
                  console.error('[create-draft]', err);
                  toast.error('Erreur lors de la création du brouillon');
                } finally {
                  setIsGenerating(false);
                }
              }}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Génération...
                </>
              ) : (
                <>
                  <FileEdit className="h-4 w-4" />
                  Générer un brouillon
                </>
              )}
            </Button>
          </div>
        )}

        {/* Inline draft editor */}
        {!isFinalized && ownerDraft && (
          <div className="space-y-3 p-3 border border-border rounded-lg">
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Revue du brouillon</p>
              {aiGenerated && (
                <Badge variant="outline" className="text-xs gap-1">
                  <Sparkles className="h-3 w-3" />
                  IA
                </Badge>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1">
                <Mail className="h-3 w-3" /> Destinataire
              </label>
              <Input
                value={editTo}
                onChange={(e) => setEditTo(e.target.value)}
                placeholder="email@client.com"
                type="email"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Sujet</label>
              <Input
                value={editSubject}
                onChange={(e) => setEditSubject(e.target.value)}
                placeholder="Objet du devis"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Corps du message</label>
              <Textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                placeholder="Corps du message..."
                rows={5}
              />
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2"
              onClick={handleSaveDraft}
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Enregistrement...
                </>
              ) : (
                <>
                  <Save className="h-3 w-3" />
                  Enregistrer le brouillon
                </>
              )}
            </Button>
          </div>
        )}

        {/* Missing version warning */}
        {!isFinalized && !selectedVersion && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <Mail className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-200">Aucune version de devis sélectionnée.</p>
          </div>
        )}

        {/* Unsaved changes warning */}
        {!isFinalized && ownerDraft && hasUnsavedChanges && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Enregistrez le brouillon pour pouvoir marquer comme envoyé.
            </p>
          </div>
        )}

        {/* Mark as sent button with confirmation */}
        {!isFinalized && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                className="w-full gap-2"
                disabled={!canSend || sendMutation.isPending || hasUnsavedChanges}
              >
                {sendMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Validation en cours...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Marquer comme envoyé
                  </>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <Send className="h-5 w-5 text-blue-600" />
                  Confirmer le marquage comme envoyé
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    <p>
                      Vous êtes sur le point de marquer la <strong>version v{selectedVersion?.version_number}</strong> du devis comme envoyée.
                    </p>
                    {totalHt !== undefined && (
                      <p>
                        Montant total HT : <strong>{formatAmount(totalHt)} {currency}</strong>
                      </p>
                    )}
                    {editTo.trim() && (
                      <p>
                        Destinataire : <strong>{editTo.trim()}</strong>
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      PDF détecté côté interface : <strong>{hasPdf ? 'oui' : 'non'}</strong>
                    </p>
                    <p className="text-amber-600 dark:text-amber-400 font-medium mt-2">
                      Cette action ne déclenche pas d'envoi email automatique. Elle sert à tracer qu'un envoi a été effectué manuellement hors application.
                    </p>
                  </div>
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
                      Validation...
                    </>
                  ) : (
                    'Confirmer le marquage'
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
