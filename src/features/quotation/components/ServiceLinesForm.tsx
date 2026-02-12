/**
 * UI COMPONENT — FROZEN Phase 4E
 * 
 * ServiceLinesForm - Composant UI formulaire services
 * Phase 4D.2 - Extraction stricte depuis QuotationSheet.tsx L1002-1092
 * Aucune logique métier, props only
 * 
 * NE PAS MODIFIER sans ouvrir une nouvelle phase de développement.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DollarSign, Plus, Trash2, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { ServiceLine } from '@/features/quotation/types';
import { serviceTemplates } from '@/features/quotation/constants';

const SOURCE_LABELS: Record<string, string> = {
  catalogue_sodatra: "Catalogue SODATRA",
  local_transport_rate: "Transport local",
  business_rule: "Règle métier",
  customs_tier: "Barème douane",
  customs_weight_tier: "Barème douane (poids)",
  client_override: "Tarif contractuel",
  internal: "Tarif interne",
  no_match: "Non trouvé",
  missing_quantity: "Quantité manquante",
};

function getSourceLabel(source?: string): string | null {
  if (!source) return null;
  if (SOURCE_LABELS[source]) return SOURCE_LABELS[source];
  if (source.startsWith("port_tariffs")) return "Grille portuaire";
  if (source.startsWith("rate_card")) return "Rate card";
  return source.replace(/_/g, ' ');
}

interface ServiceTemplate {
  service: string;
  description: string;
  unit: string;
}

interface ServiceLinesFormProps {
  serviceLines: ServiceLine[];
  addServiceLine: (template?: ServiceTemplate) => void;
  updateServiceLine: (id: string, updates: Partial<ServiceLine>) => void;
  removeServiceLine: (id: string) => void;
  detectedPackage?: string;
}

export function ServiceLinesForm({
  serviceLines,
  addServiceLine,
  updateServiceLine,
  removeServiceLine,
  detectedPackage,
}: ServiceLinesFormProps) {
  return (
    <Card className="border-border/50 bg-gradient-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" />
              Services à coter ({serviceLines.length})
            </CardTitle>
            {detectedPackage && (
              <Badge variant="secondary" className="text-xs">
                {detectedPackage.replace(/_/g, ' ')}
              </Badge>
            )}
          </div>
          <Select onValueChange={(v) => {
            const template = serviceTemplates.find(t => t.service === v);
            if (template) addServiceLine(template);
          }}>
            <SelectTrigger className="w-[200px] h-8">
              <Plus className="h-4 w-4 mr-1" />
              <span className="text-sm">Ajouter service</span>
            </SelectTrigger>
            <SelectContent>
              {serviceTemplates.map((t) => (
                <SelectItem key={t.service} value={t.service}>
                  {t.description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {serviceLines.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <DollarSign className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Ajoutez les services demandés</p>
            <div className="flex flex-wrap justify-center gap-2 mt-3">
              {serviceTemplates.slice(0, 4).map((t) => (
                <Badge 
                  key={t.service} 
                  variant="outline" 
                  className="cursor-pointer hover:bg-primary/10"
                  onClick={() => addServiceLine(t)}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  {t.description}
                </Badge>
              ))}
            </div>
          </div>
        ) : (
          serviceLines.map((line) => {
            const sourceLabel = getSourceLabel(line.source);
            return (
              <div key={line.id} className="space-y-1">
                <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                  <div className="flex-1">
                    <Input
                      value={line.description}
                      onChange={(e) => updateServiceLine(line.id, { description: e.target.value })}
                      className="font-medium"
                    />
                  </div>
                  <div className="w-20">
                    <Input
                      type="number"
                      value={line.quantity}
                      onChange={(e) => updateServiceLine(line.id, { quantity: parseInt(e.target.value) })}
                      className="text-center"
                    />
                  </div>
                  <div className="w-24">
                    <Input
                      value={line.unit}
                      onChange={(e) => updateServiceLine(line.id, { unit: e.target.value })}
                      placeholder="unité"
                    />
                  </div>
                  <div className="w-28">
                    <Input
                      type="number"
                      value={line.rate || ''}
                      onChange={(e) => updateServiceLine(line.id, { rate: parseFloat(e.target.value) })}
                      placeholder="Tarif"
                    />
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => removeServiceLine(line.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {sourceLabel && (
                  <div className="flex items-center gap-1.5 pl-3 flex-wrap">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-1">
                      <Info className="h-2.5 w-2.5" />
                      {sourceLabel}
                    </Badge>
                    {line.explanation && (
                      <span className="text-[11px] text-muted-foreground">
                        — {line.explanation}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
