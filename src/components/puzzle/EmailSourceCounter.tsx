/**
 * Phase 8.1A — Compteur SOURCE / CONTEXT
 * 
 * Affiche le nombre d'emails SOURCE (thread_ref) vs CONTEXT (subject match)
 * Lecture seule, aucun recalcul IA
 */

import { Mail, Link, History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  sourceCount: number;
  contextCount: number;
  totalCount: number;
  isLoading?: boolean;
}

export function EmailSourceCounter({ sourceCount, contextCount, totalCount, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Mail className="h-4 w-4 animate-pulse" />
        <span>Chargement...</span>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{totalCount} emails analysés</span>
        </div>
        
        <Separator orientation="vertical" className="h-4" />
        
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="default" className="bg-green-600 hover:bg-green-700 cursor-help">
                <Link className="h-3 w-3 mr-1" />
                {sourceCount} source
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">
                Emails du thread actuel (thread_ref strict)
                <br />
                <span className="text-muted-foreground">= données contractuelles</span>
              </p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-200 cursor-help">
                <History className="h-3 w-3 mr-1" />
                {contextCount} contexte
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">
                Emails similaires par sujet (historique)
                <br />
                <span className="text-muted-foreground">= aide contextuelle pour l'IA</span>
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
