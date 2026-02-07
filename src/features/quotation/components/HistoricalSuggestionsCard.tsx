/**
 * UI COMPONENT — FROZEN Phase M3.2
 *
 * HistoricalSuggestionsCard - Affiche les suggestions tarifaires basées sur l'historique
 * Consultative only — ne modifie aucun calcul normatif
 *
 * NE PAS MODIFIER sans ouvrir une nouvelle phase de développement.
 */

import React, { memo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { History, Plus } from 'lucide-react';
import type { HistoricalSuggestions, HistoricalSuggestionLine } from '@/features/quotation/types';

interface HistoricalSuggestionsCardProps {
  suggestions: HistoricalSuggestions;
  onAddSuggestion: (line: HistoricalSuggestionLine) => void;
}

function formatAmount(amount: number, currency: string): string {
  return `${amount.toLocaleString('fr-FR')} ${currency}`;
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return 'Élevée';
  if (confidence >= 0.5) return 'Moyenne';
  return 'Faible';
}

function confidenceVariant(confidence: number): 'default' | 'secondary' | 'outline' {
  if (confidence >= 0.8) return 'default';
  if (confidence >= 0.5) return 'secondary';
  return 'outline';
}

export const HistoricalSuggestionsCard = memo(function HistoricalSuggestionsCard({
  suggestions,
  onAddSuggestion,
}: HistoricalSuggestionsCardProps) {
  if (!suggestions.suggested_lines.length) return null;

  return (
    <Card className="border-border/50 bg-gradient-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          Suggestions basées sur l'historique
        </CardTitle>
        <CardDescription>
          Basé sur {suggestions.based_on_quotations} cotation{suggestions.based_on_quotations > 1 ? 's' : ''} similaire{suggestions.based_on_quotations > 1 ? 's' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {suggestions.suggested_lines.map((line, idx) => (
          <div
            key={`${line.bloc}-${line.category}-${idx}`}
            className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-muted/30"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{line.description}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant="outline" className="text-xs">
                  {line.bloc}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {line.category}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {formatAmount(line.suggested_amount, line.currency)}
                </span>
                <Badge variant={confidenceVariant(line.confidence)} className="text-xs">
                  {confidenceLabel(line.confidence)} ({line.based_on} cot.)
                </Badge>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => onAddSuggestion(line)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Ajouter
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
});
