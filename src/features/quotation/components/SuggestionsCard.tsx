/**
 * UI COMPONENT — FROZEN (Phase 3B)
 * - Ne pas modifier sans ouvrir une nouvelle phase
 * - Logique métier volontairement absente
 * - Toute évolution = nouvelle phase (3B.x)
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Lightbulb } from 'lucide-react';
import type { Suggestion } from '@/features/quotation/types';

interface SuggestionsCardProps {
  suggestions: Suggestion[];
}

export function SuggestionsCard({ suggestions }: SuggestionsCardProps) {
  if (suggestions.length === 0) return null;

  return (
    <Card className="border-border/50 bg-gradient-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          Suggestions IA
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {suggestions.slice(0, 5).map((sug, i) => (
            <div 
              key={i} 
              className="p-2 rounded-lg bg-muted/30 text-sm cursor-pointer hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{sug.value}</span>
                <Badge variant="outline" className="text-xs">
                  {Math.round(sug.confidence * 100)}%
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{sug.source}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
