import { useState, useEffect } from 'react';
import { Loader2, Box, RotateCcw, Eye } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FleetScenario, PackingItem, OptimizationResult, TruckSpec } from '@/types/truckLoading';
import { runOptimization, getTruckSpecs } from '@/services/truckLoadingService';
import { toast } from 'sonner';

interface LoadingPlan3DProps {
  scenario: FleetScenario;
  items: PackingItem[];
  onBack: () => void;
}

interface TruckLoadingResult {
  truckType: string;
  truckIndex: number;
  result: OptimizationResult;
  truckSpec: TruckSpec;
}

const TRUCK_LABELS: Record<string, string> = {
  van_3t5: 'Fourgon 3.5T',
  truck_19t: 'Camion 19T',
  truck_26t: 'Camion 26T',
  truck_40t: 'Semi-remorque 40T',
};

export function LoadingPlan3D({ scenario, items, onBack }: LoadingPlan3DProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [truckSpecs, setTruckSpecs] = useState<TruckSpec[]>([]);
  const [loadingResults, setLoadingResults] = useState<TruckLoadingResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeTruck, setActiveTruck] = useState<string>('truck-0');

  useEffect(() => {
    loadOptimizationPlans();
  }, [scenario, items]);

  const loadOptimizationPlans = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // 1. Get truck specifications
      const specs = await getTruckSpecs();
      setTruckSpecs(specs);

      // 2. For each truck type in scenario, call optimize
      const results: TruckLoadingResult[] = [];
      let itemOffset = 0;

      for (const allocation of scenario.trucks) {
        const truckSpec = specs.find(s => s.name === allocation.truck_type);
        if (!truckSpec) {
          console.warn(`Truck spec not found for ${allocation.truck_type}`);
          continue;
        }

        // Distribute items across trucks of this type
        const itemsPerTruck = Math.ceil(allocation.items_assigned / allocation.count);

        for (let i = 0; i < allocation.count; i++) {
          const startIdx = itemOffset;
          const endIdx = Math.min(startIdx + itemsPerTruck, items.length);
          const truckItems = items.slice(startIdx, endIdx);
          
          if (truckItems.length === 0) continue;

          try {
            // Ensure weights are in KG (should already be, but verify)
            const normalizedItems = truckItems.map(item => ({
              ...item,
              // Weight should be in KG - if it looks like grams, convert
              weight: item.weight < 100 ? item.weight * 1000 : item.weight,
            }));

            const result = await runOptimization(normalizedItems, truckSpec, 'simple');
            
            results.push({
              truckType: allocation.truck_type,
              truckIndex: results.length,
              result,
              truckSpec,
            });
          } catch (err) {
            console.error(`Error optimizing truck ${i} of type ${allocation.truck_type}:`, err);
          }

          itemOffset = endIdx;
        }
      }

      setLoadingResults(results);
      
      if (results.length > 0) {
        toast.success('Plans de chargement calculés', {
          description: `${results.length} camion(s) optimisé(s)`
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du calcul des plans';
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <div className="text-center">
          <p className="text-lg font-medium">Calcul des plans de chargement...</p>
          <p className="text-sm text-muted-foreground">
            Optimisation du placement pour {scenario.total_trucks} camion(s)
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-4">
        <div className="rounded-full bg-destructive/10 p-4">
          <Box className="h-8 w-8 text-destructive" />
        </div>
        <div className="text-center">
          <p className="text-lg font-medium text-destructive">{error}</p>
        </div>
        <Button variant="outline" onClick={onBack}>
          <RotateCcw className="h-4 w-4 mr-2" />
          Retour aux scénarios
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Plan de Chargement 3D</h2>
          <p className="text-muted-foreground">
            Scénario "{scenario.name}" - {scenario.total_trucks} camion(s)
          </p>
        </div>
        <Button variant="outline" onClick={onBack}>
          <RotateCcw className="h-4 w-4 mr-2" />
          Retour
        </Button>
      </div>

      {loadingResults.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">Aucun plan de chargement disponible</p>
          </CardContent>
        </Card>
      ) : (
        <Tabs value={activeTruck} onValueChange={setActiveTruck}>
          <TabsList className="mb-4">
            {loadingResults.map((lr, idx) => (
              <TabsTrigger key={`truck-${idx}`} value={`truck-${idx}`}>
                {TRUCK_LABELS[lr.truckType] || lr.truckType} #{idx + 1}
              </TabsTrigger>
            ))}
          </TabsList>

          {loadingResults.map((lr, idx) => (
            <TabsContent key={`truck-${idx}`} value={`truck-${idx}`}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 3D Visualization or Base64 Image */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Eye className="h-5 w-5" />
                      Visualisation du chargement
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {lr.result.visualization_base64 ? (
                      <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
                        <img
                          src={`data:image/png;base64,${lr.result.visualization_base64}`}
                          alt={`Plan de chargement ${TRUCK_LABELS[lr.truckType] || lr.truckType}`}
                          className="w-full h-full object-contain"
                        />
                      </div>
                    ) : (
                      <div className="aspect-video bg-muted rounded-lg flex items-center justify-center">
                        <div className="text-center text-muted-foreground">
                          <Box className="h-12 w-12 mx-auto mb-2 opacity-50" />
                          <p>Visualisation 3D non disponible</p>
                          <p className="text-sm">Utilisez les coordonnées ci-dessous</p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Metrics */}
                <Card>
                  <CardHeader>
                    <CardTitle>Métriques</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-muted/50 rounded-lg p-4 text-center">
                        <p className="text-2xl font-bold text-primary">
                          {(lr.result.metrics.fill_rate * 100).toFixed(1)}%
                        </p>
                        <p className="text-sm text-muted-foreground">Taux de remplissage</p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-4 text-center">
                        <p className="text-2xl font-bold text-primary">
                          {(lr.result.metrics.weight_utilization * 100).toFixed(1)}%
                        </p>
                        <p className="text-sm text-muted-foreground">Utilisation poids</p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-4 text-center">
                        <p className="text-2xl font-bold">{lr.result.metrics.items_placed}</p>
                        <p className="text-sm text-muted-foreground">Articles placés</p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-4 text-center">
                        <p className="text-2xl font-bold">{lr.result.metrics.trucks_used}</p>
                        <p className="text-sm text-muted-foreground">Camions utilisés</p>
                      </div>
                    </div>

                    <div className="pt-4 border-t">
                      <p className="text-sm font-medium mb-2">Dimensions du camion :</p>
                      <div className="text-sm text-muted-foreground space-y-1">
                        <p>Longueur: {(lr.truckSpec.length / 1000).toFixed(2)} m</p>
                        <p>Largeur: {(lr.truckSpec.width / 1000).toFixed(2)} m</p>
                        <p>Hauteur: {(lr.truckSpec.height / 1000).toFixed(2)} m</p>
                        <p>Charge max: {(lr.truckSpec.max_weight / 1000).toFixed(1)} T</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Placements Table */}
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Détails des placements (coordonnées X, Y, Z)</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Article</TableHead>
                        <TableHead className="text-center">Position X (mm)</TableHead>
                        <TableHead className="text-center">Position Y (mm)</TableHead>
                        <TableHead className="text-center">Position Z (mm)</TableHead>
                        <TableHead className="text-center">Rotation</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lr.result.placements.map((placement, pIdx) => (
                        <TableRow key={pIdx}>
                          <TableCell className="font-medium">{placement.item_id}</TableCell>
                          <TableCell className="text-center">{placement.position.x.toFixed(0)}</TableCell>
                          <TableCell className="text-center">{placement.position.y.toFixed(0)}</TableCell>
                          <TableCell className="text-center">{placement.position.z.toFixed(0)}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant={placement.rotated ? "default" : "outline"}>
                              {placement.rotated ? 'Oui' : 'Non'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
