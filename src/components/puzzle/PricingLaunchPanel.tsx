// ============================================================================
// Phase 10.1 — UI GATE "Lancer le pricing"
// + Modale taux de change GAINDE (exchange_rates)
// ============================================================================

import { useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
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
import { useServiceScope } from '@/hooks/useServiceScope';
import { qualifyScope } from '@/lib/scopeQualification';
import { useMemo } from 'react';

type PricingPrecheck = {
  code: "HS_CODE_REQUIRED" | "REGIME_REQUIRED_FOR_EXEMPTION" | "FREIGHT_REQUIRED_FOR_FOB" | "CARGO_VALUE_REQUIRED" | "SERVICE_PACKAGE_REQUIRED";
  key: string;
  label: string;
};

interface PricingLaunchPanelProps {
  caseId: string;
  onComplete?: () => void;
  blockedByIntent?: string;
  pricingPrechecks?: PricingPrecheck[];
  isRerun?: boolean;
}

export function PricingLaunchPanel({ caseId, onComplete, blockedByIntent, pricingPrechecks = [], isRerun = false }: PricingLaunchPanelProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // P2-D: scope-aware description
  const { data: serviceScope } = useServiceScope(caseId);
  const scopeResult = useMemo(
    () => qualifyScope({ serviceScope: serviceScope ?? null, facts: {}, caseStatus: "INTAKE" }),
    [serviceScope],
  );
  const hasCriticalUnconfirmed = scopeResult.hasCriticalUnconfirmed;

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
      
      if (fnError) {
        // Phase EQ1.2-quinquies: extract real error body from FunctionsHttpError.context
        let details = '';
        if (fnError instanceof FunctionsHttpError) {
          try {
            const errorBody = await fnError.context.json();
            details = 
              (typeof errorBody?.details === 'string' ? errorBody.details : '') ||
              (typeof errorBody?.error === 'string' ? errorBody.error : '') ||
              fnError.message;
          } catch {
            try {
              details = await fnError.context.text();
            } catch {
              details = fnError.message;
            }
          }
        } else {
          details =
            (data && typeof data === 'object' && 'details' in data && typeof data.details === 'string' ? data.details : '') ||
            (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : '') ||
            fnError.message ||
            'Erreur lors du lancement du pricing';
        }
        throw new Error(details);
      }

      // Check for soft blockers (HTTP 200 but pricing blocked)
      if (data?.pricing_blockers?.length > 0) {
        // Phase EQ1.2-quinquies: handle EXCHANGE_RATE_REQUIRED soft blocker
        if (data.pricing_blockers.includes('EXCHANGE_RATE_REQUIRED')) {
          const currency = data.missing_currency;
          if (currency) {
            setMissingCurrency(currency);
            setShowRateModal(true);
          } else {
            setError(data.message || 'Un taux de change valide est requis avant de lancer le pricing.');
          }
          setConfirmOpen(false);
          onComplete?.();
          return;
        }

        const blockerMsg = data.message || 'Données manquantes pour le pricing';
        setError(blockerMsg);
        toast.error(blockerMsg);
        setConfirmOpen(false);
        onComplete?.();
        return;
      }
      
      toast.success(`Pricing lancé - ${data?.lines_count ?? 0} lignes calculées`);
      setConfirmOpen(false);
      onComplete?.();
      
    } catch (err: any) {
      console.error('[PricingLaunchPanel] Error:', err);
      
      const message = String(err?.message || '');

      // Intercept exchange rate error → open modal (legacy 500 path)
      const exchangeRateMatch = message.match(/Exchange rate for\s+([A-Z]{3})/i);
      if (exchangeRateMatch && message.includes('expired or missing')) {
        const currency = exchangeRateMatch[1]?.toUpperCase();
        if (currency) {
          setMissingCurrency(currency);
          setShowRateModal(true);
        } else {
          setError('Un taux de change valide est requis, devise non identifiée.');
        }
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
      
      toast.error(message || 'Erreur lors du lancement du pricing');
      onComplete?.();
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
            <CardTitle className="text-base">{isRerun ? 'Relancer le pricing' : 'Lancer le pricing'}</CardTitle>
          </div>
          <CardDescription>
            {isRerun
              ? 'Un pricing a déjà été calculé. Vous pouvez relancer le calcul avec les données mises à jour.'
              : hasCriticalUnconfirmed
                ? 'Un pricing peut être lancé. Des services restent non confirmés dans le périmètre du dossier.'
                : 'Toutes les décisions sont validées. Vous pouvez maintenant lancer le calcul de prix.'}
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {blockedByIntent && (
            <Alert className="border-indigo-300 bg-indigo-50 dark:bg-indigo-950/30">
              <AlertTriangle className="h-4 w-4 text-indigo-600" />
              <AlertDescription className="text-sm text-indigo-800 dark:text-indigo-200">
                Le pricing est bloqué : ce dossier est identifié comme <strong>{blockedByIntent}</strong>.
                Clarifiez l'intention commerciale avant de tarifer.
              </AlertDescription>
            </Alert>
          )}

          {pricingPrechecks.length > 0 && (
            <Alert className="border-orange-300 bg-orange-50 dark:bg-orange-950/30">
              <AlertTriangle className="h-4 w-4 text-orange-600" />
              <AlertDescription>
                <p className="font-medium text-sm mb-1">Préchecks pricing — données manquantes</p>
                <ul className="list-disc list-inside text-sm space-y-1">
                  {pricingPrechecks.map(b => <li key={b.code}>{b.label}</li>)}
                </ul>
              </AlertDescription>
            </Alert>
          )}

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
            disabled={isLoading || !!blockedByIntent || pricingPrechecks.length > 0}
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
                {isRerun ? 'Relancer le pricing' : 'Lancer le pricing'}
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
