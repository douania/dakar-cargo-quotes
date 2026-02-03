/**
 * Phase 8.2 — Alerte anti-rejeu
 * 
 * Affiche un avertissement si aucun nouvel email SOURCE depuis la dernière analyse
 * Permet de voir le dernier résultat ou de forcer quand même
 */

import { AlertCircle, Eye, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface Props {
  onViewLastResult: () => void;
  onForceAnalysis: () => void;
  isForcing?: boolean;
}

export function NoNewEmailsWarning({ onViewLastResult, onForceAnalysis, isForcing }: Props) {
  return (
    <Alert className="border-amber-200 bg-amber-50">
      <AlertCircle className="h-4 w-4 text-amber-600" />
      <AlertTitle className="text-amber-800">Aucun nouvel email source</AlertTitle>
      <AlertDescription className="text-amber-700">
        <p className="mb-3">
          Le puzzle a déjà été analysé avec les mêmes emails du thread.
          Une nouvelle analyse ne produira pas de résultat différent.
        </p>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={onViewLastResult}
            className="bg-white"
          >
            <Eye className="h-4 w-4 mr-2" />
            Voir dernier résultat
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onForceAnalysis}
            disabled={isForcing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isForcing ? 'animate-spin' : ''}`} />
            Forcer quand même
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
