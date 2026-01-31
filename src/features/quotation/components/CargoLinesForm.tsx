/**
 * UI COMPONENT — FROZEN Phase 4E
 * 
 * CargoLinesForm - Composant UI formulaire cargo
 * Phase 4D.1 - Extraction stricte depuis QuotationSheet.tsx L779-939
 * Aucune logique métier, props only
 * 
 * NE PAS MODIFIER sans ouvrir une nouvelle phase de développement.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Package, Container, Boxes, Trash2 } from 'lucide-react';
import type { CargoLine } from '@/features/quotation/types';
import { containerTypes } from '@/features/quotation/constants';

interface CargoLinesFormProps {
  cargoLines: CargoLine[];
  addCargoLine: (type: 'container' | 'breakbulk') => void;
  updateCargoLine: (id: string, updates: Partial<CargoLine>) => void;
  removeCargoLine: (id: string) => void;
}

export function CargoLinesForm({
  cargoLines,
  addCargoLine,
  updateCargoLine,
  removeCargoLine,
}: CargoLinesFormProps) {
  return (
    <Card className="border-border/50 bg-gradient-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            Marchandises ({cargoLines.length})
          </CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => addCargoLine('container')}>
              <Container className="h-4 w-4 mr-1" />
              Conteneur
            </Button>
            <Button variant="outline" size="sm" onClick={() => addCargoLine('breakbulk')}>
              <Boxes className="h-4 w-4 mr-1" />
              Breakbulk
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {cargoLines.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Ajoutez des lignes de marchandise</p>
          </div>
        ) : (
          cargoLines.map((line, index) => (
            <div key={line.id} className="p-4 rounded-lg border bg-muted/30 space-y-3">
              <div className="flex items-center justify-between">
                <Badge variant={line.cargo_type === 'container' ? 'default' : 'secondary'}>
                  {line.cargo_type === 'container' ? (
                    <><Container className="h-3 w-3 mr-1" /> Conteneur</>
                  ) : (
                    <><Boxes className="h-3 w-3 mr-1" /> Breakbulk</>
                  )}
                </Badge>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={() => removeCargoLine(line.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Description</Label>
                  <Input
                    value={line.description}
                    onChange={(e) => updateCargoLine(line.id, { description: e.target.value })}
                    placeholder="Description marchandise"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Origine</Label>
                  <Input
                    value={line.origin}
                    onChange={(e) => updateCargoLine(line.id, { origin: e.target.value })}
                    placeholder="Pays/Port"
                  />
                </div>
              </div>

              {line.cargo_type === 'container' ? (
                <div className="grid grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Type</Label>
                    <Select 
                      value={line.container_type || '40HC'} 
                      onValueChange={(v) => updateCargoLine(line.id, { container_type: v })}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {containerTypes.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nombre</Label>
                    <Input
                      type="number"
                      min="1"
                      value={line.container_count || 1}
                      onChange={(e) => updateCargoLine(line.id, { container_count: parseInt(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">COC/SOC</Label>
                    <Select 
                      value={line.coc_soc || 'COC'} 
                      onValueChange={(v) => updateCargoLine(line.id, { coc_soc: v as 'COC' | 'SOC' })}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="COC">COC (Armateur)</SelectItem>
                        <SelectItem value="SOC">SOC (Chargeur)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Poids (kg)</Label>
                    <Input
                      type="number"
                      value={line.weight_kg || ''}
                      onChange={(e) => updateCargoLine(line.id, { weight_kg: parseFloat(e.target.value) })}
                      placeholder="18000"
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Poids (kg)</Label>
                    <Input
                      type="number"
                      value={line.weight_kg || ''}
                      onChange={(e) => updateCargoLine(line.id, { weight_kg: parseFloat(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Volume (m³)</Label>
                    <Input
                      type="number"
                      value={line.volume_cbm || ''}
                      onChange={(e) => updateCargoLine(line.id, { volume_cbm: parseFloat(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Dimensions</Label>
                    <Input
                      value={line.dimensions || ''}
                      onChange={(e) => updateCargoLine(line.id, { dimensions: e.target.value })}
                      placeholder="L x l x H"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Pièces</Label>
                    <Input
                      type="number"
                      value={line.pieces || ''}
                      onChange={(e) => updateCargoLine(line.id, { pieces: parseInt(e.target.value) })}
                    />
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
