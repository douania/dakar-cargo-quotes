// ============================================================================
// Phase 10.1 — UI GATE "Lancer le pricing"
// + Modale taux de change GAINDE (exchange_rates)
// ============================================================================

import { useState } from 'react';
import { Loader2, Calculator, Info, AlertTriangle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  computeValidUntil,
  PERIOD_LABELS,
  DAY_LABELS,
  type ValidityPeriod,
} from '@/lib/exchangeRateUtils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface PricingLaunchPanelProps {
  caseId: string;
  onComplete?: () => void;
}

export function PricingLaunchPanel({ caseId, onComplete }: PricingLaunchPanelProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Exchange rate modal state
  const [missingCurrency, setMissingCurrency] = useState<string | null>(null);
  const [showRateModal, setShowRateModal] = useState(false);
  const [rateInput, setRateInput] = useState('');
  const [isSubmittingRate, setIsSubmittingRate] = useState(false);
  const [ratePeriod, setRatePeriod] = useState<ValidityPeriod>('weekly');
  const [rateDayOfWeek, setRateDayOfWeek] = useState(3);

  const handleLaunchPricing = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const { data, error: fnError } = await supabase.functions.invoke('run-pricing', {
        body: { case_id: caseId }
      });
      
      if (fnError) throw fnError;
      
      toast.success(`Pricing lancé - ${data?.lines_count ?? 0} lignes calculées`);
      setConfirmOpen(false);
      onComplete?.();
      
    } catch (err: any) {
      console.error('[PricingLaunchPanel] Error:', err);
      
      const message = err.message || '';

      // Intercept exchange rate error → open modal
      if (message.includes('Exchange rate for')) {
        const match = message.match(/Exchange rate for (\w+)/);
        setMissingCurrency(match?.[1] || 'USD');
        setShowRateModal(true);
        setConfirmOpen(false);
        setIsLoading(false);
        return;
      }

      if (message.includes('not ready') || message.includes('status')) {
        setError('Le dossier n\'est pas prêt pour le pricing');
      } else if (message.includes('Access denied')) {
        setError('Vous n\'avez pas accès à ce dossier');
      } else {
        setError(message);
      }
      
      toast.error('Erreur lors du lancement du pricing');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitRate = async () => {
    const rate = Number(rateInput);
    if (!Number.isFinite(rate) || rate <= 0) {
      toast.error('Veuillez saisir un taux valide (nombre positif)');
      return;
    }

    setIsSubmittingRate(true);
    try {
      const { error: upsertError } = await supabase.functions.invoke('upsert-exchange-rate', {
        body: {
          currency_code: missingCurrency,
          rate_to_xof: rate,
          valid_until: computeValidUntil(ratePeriod, rateDayOfWeek),
        }
      });

      if (upsertError) throw upsertError;

      toast.success(`Taux ${missingCurrency}/XOF enregistré : ${rate}`);
      setShowRateModal(false);
      setRateInput('');
      setMissingCurrency(null);

      // Relaunch pricing automatically
      handleLaunchPricing();
    } catch (err: any) {
      console.error('[PricingLaunchPanel] Rate upsert error:', err);
      toast.error(`Erreur d'enregistrement du taux : ${err.message}`);
    } finally {
      setIsSubmittingRate(false);
    }
  };

  return (
    <>
      <Card className="border-warning/50 bg-warning/10">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-warning-foreground" />
            <CardTitle className="text-base">Lancer le pricing</CardTitle>
          </div>
          <CardDescription>
            Toutes les décisions sont validées. 
            Vous pouvez maintenant lancer le calcul de prix.
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-4">
          <Alert className="border-primary/30 bg-primary/5">
            <Info className="h-4 w-4 text-primary" />
            <AlertDescription className="text-sm text-primary">
              Cette action est tracée et auditée. 
              Le calcul peut prendre plusieurs secondes.
            </AlertDescription>
          </Alert>
          
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={isLoading}
            className="w-full gap-2"
            variant="default"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Calcul en cours...
              </>
            ) : (
              <>
                <Calculator className="h-4 w-4" />
                Lancer le pricing
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Confirmation dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer le lancement du pricing ?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>Cette action va déclencher le moteur de pricing.</p>
                <ul className="list-disc list-inside text-sm space-y-1">
                  <li>Le calcul est basé sur les décisions validées</li>
                  <li>L'opération est tracée et auditée</li>
                  <li>Le calcul peut prendre plusieurs secondes</li>
                </ul>
                <div className="flex items-start gap-2 p-3 bg-warning/10 border border-warning/30 rounded-lg mt-3">
                  <AlertTriangle className="h-4 w-4 text-warning-foreground mt-0.5" />
                  <p className="text-sm text-warning-foreground">
                    Une fois lancé, le pricing ne peut pas être annulé.
                  </p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>Annuler</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleLaunchPricing}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Calcul...
                </>
              ) : (
                'Confirmer'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Exchange rate modal */}
      <Dialog open={showRateModal} onOpenChange={setShowRateModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Taux de change {missingCurrency}/XOF requis
            </DialogTitle>
            <DialogDescription>
              Le taux de change pour la devise <strong>{missingCurrency}</strong> est absent ou expiré.
              Saisissez le taux GAINDE (taux douane officiel) pour continuer.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="exchange-rate">
                1 {missingCurrency} = ? XOF (FCFA)
              </Label>
              <Input
                id="exchange-rate"
                type="number"
                step="0.01"
                min="0"
                placeholder="Ex: 605.50"
                value={rateInput}
                onChange={(e) => setRateInput(e.target.value)}
                disabled={isSubmittingRate}
              />
              <p className="text-xs text-muted-foreground">
                Source : GAINDE
              </p>
            </div>

            {/* Période de validité */}
            <div className="space-y-2">
              <Label>Période de validité</Label>
              <Select value={ratePeriod} onValueChange={v => setRatePeriod(v as ValidityPeriod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PERIOD_LABELS) as ValidityPeriod[]).map(p => (
                    <SelectItem key={p} value={p}>{PERIOD_LABELS[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {ratePeriod === 'weekly' && (
              <div className="space-y-2">
                <Label>Expire le</Label>
                <Select value={String(rateDayOfWeek)} onValueChange={v => setRateDayOfWeek(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DAY_LABELS.map((label, i) => (
                      <SelectItem key={i} value={String(i)}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowRateModal(false);
                setRateInput('');
              }}
              disabled={isSubmittingRate}
            >
              Annuler
            </Button>
            <Button
              onClick={handleSubmitRate}
              disabled={isSubmittingRate || !rateInput}
            >
              {isSubmittingRate ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Enregistrement...
                </>
              ) : (
                'Enregistrer et relancer'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
