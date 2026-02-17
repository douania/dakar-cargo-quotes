// ============================================================================
// Phase 10.1 — UI GATE "Lancer le pricing"
// 
// ⚠️ CTO RULES ABSOLUES:
// ❌ AUCUN calcul de prix ici
// ❌ AUCUNE logique métier
// ❌ AUCUNE lecture des tables pricing
// ❌ AUCUNE transition de statut (gérée par run-pricing)
// ❌ AUCUN auto-trigger
// 
// ✅ UI uniquement
// ✅ Déclenchement explicite Phase 11 (run-pricing)
// ✅ Confirmation utilisateur obligatoire
// ============================================================================

import { useState } from 'react';
import { Loader2, Calculator, Info, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
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

  const handleLaunchPricing = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // ❌ AUCUN calcul de prix ici
      // ❌ AUCUNE logique métier
      // ❌ AUCUNE lecture des tables pricing
      // ❌ AUCUNE transition de statut
      // ✅ Appel unique run-pricing
      
      const { data, error: fnError } = await supabase.functions.invoke('run-pricing', {
        body: { case_id: caseId }
      });
      
      if (fnError) throw fnError;
      
      toast.success(`Pricing lancé - ${data?.lines_count ?? 0} lignes calculées`);
      setConfirmOpen(false);
      onComplete?.();
      
      // Pas de redirection automatique - l'UI se mettra à jour via le hook
      
    } catch (err: any) {
      console.error('[PricingLaunchPanel] Error:', err);
      
      // Gestion des erreurs spécifiques
      const message = err.message || 'Erreur inconnue';
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
          {/* Alert info traçabilité */}
          <Alert className="border-primary/30 bg-primary/5">
            <Info className="h-4 w-4 text-primary" />
            <AlertDescription className="text-sm text-primary">
              Cette action est tracée et auditée. 
              Le calcul peut prendre plusieurs secondes.
            </AlertDescription>
          </Alert>
          
          {/* Erreur si présente */}
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          {/* Bouton principal */}
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

      {/* Dialog de confirmation obligatoire */}
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
    </>
  );
}
