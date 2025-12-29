import { Truck, Package, Scale, BarChart3, RefreshCw, Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { OptimizationResult, TruckSpec } from '@/types/truckLoading';

interface LoadingPlanViewerProps {
  result: OptimizationResult;
  truckSpec: TruckSpec;
  onReset: () => void;
}

export function LoadingPlanViewer({ result, truckSpec, onReset }: LoadingPlanViewerProps) {
  const { metrics, placements, visualization_base64 } = result;

  const getFillRateColor = (rate: number) => {
    if (rate >= 80) return 'text-green-600';
    if (rate >= 60) return 'text-amber-600';
    return 'text-red-600';
  };

  const getFillRateProgress = (rate: number) => {
    if (rate >= 80) return 'bg-green-500';
    if (rate >= 60) return 'bg-amber-500';
    return 'bg-red-500';
  };

  // Group placements by truck
  const placementsByTruck = placements.reduce((acc, placement) => {
    const truckIndex = placement.truck_index;
    if (!acc[truckIndex]) {
      acc[truckIndex] = [];
    }
    acc[truckIndex].push(placement);
    return acc;
  }, {} as Record<number, typeof placements>);

  const truckIndices = Object.keys(placementsByTruck).map(Number).sort((a, b) => a - b);

  return (
    <div className="space-y-6">
      {/* Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Taux de remplissage</p>
                <p className={`text-3xl font-bold ${getFillRateColor(metrics.fill_rate)}`}>
                  {metrics.fill_rate.toFixed(1)}%
                </p>
              </div>
              <BarChart3 className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <Progress
              value={metrics.fill_rate}
              className={`h-2 mt-3 ${getFillRateProgress(metrics.fill_rate)}`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Camions utilisés</p>
                <p className="text-3xl font-bold">{metrics.trucks_used}</p>
              </div>
              <Truck className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              {truckSpec.name}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Poids utilisé</p>
                <p className="text-3xl font-bold">{metrics.weight_utilization.toFixed(1)}%</p>
              </div>
              <Scale className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Capacité: {truckSpec.max_weight.toLocaleString()} kg
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Articles placés</p>
                <p className="text-3xl font-bold">
                  {metrics.items_placed}
                  <span className="text-lg text-muted-foreground">/{metrics.items_total}</span>
                </p>
              </div>
              <Package className="h-8 w-8 text-muted-foreground/50" />
            </div>
            {metrics.items_placed < metrics.items_total && (
              <Badge variant="destructive" className="mt-3">
                {metrics.items_total - metrics.items_placed} non placés
              </Badge>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 3D Visualization */}
      {visualization_base64 && (
        <Card>
          <CardHeader>
            <CardTitle>Visualisation 3D du chargement</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-center bg-muted/30 rounded-lg p-4">
              <img
                src={`data:image/png;base64,${visualization_base64}`}
                alt="Visualisation 3D du chargement"
                className="max-w-full h-auto rounded-lg shadow-md"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Placements by Truck */}
      <Card>
        <CardHeader>
          <CardTitle>Détail des placements</CardTitle>
        </CardHeader>
        <CardContent>
          {truckIndices.length > 1 ? (
            <Tabs defaultValue={`truck-${truckIndices[0]}`}>
              <TabsList className="mb-4">
                {truckIndices.map((index) => (
                  <TabsTrigger key={index} value={`truck-${index}`}>
                    Camion {index + 1}
                    <Badge variant="secondary" className="ml-2">
                      {placementsByTruck[index].length}
                    </Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
              
              {truckIndices.map((index) => (
                <TabsContent key={index} value={`truck-${index}`}>
                  <PlacementsTable placements={placementsByTruck[index]} />
                </TabsContent>
              ))}
            </Tabs>
          ) : (
            <PlacementsTable placements={placements} />
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-between items-center">
        <Button variant="outline" onClick={onReset} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Nouvelle optimisation
        </Button>
        
        <Button variant="outline" disabled className="gap-2">
          <Download className="h-4 w-4" />
          Exporter PDF (bientôt)
        </Button>
      </div>
    </div>
  );
}

function PlacementsTable({ placements }: { placements: OptimizationResult['placements'] }) {
  return (
    <div className="rounded-md border overflow-auto max-h-[300px]">
      <Table>
        <TableHeader className="sticky top-0 bg-background">
          <TableRow>
            <TableHead>Article ID</TableHead>
            <TableHead className="text-right">Position X</TableHead>
            <TableHead className="text-right">Position Y</TableHead>
            <TableHead className="text-right">Position Z</TableHead>
            <TableHead className="text-center">Rotation</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {placements.map((placement, idx) => (
            <TableRow key={idx}>
              <TableCell className="font-mono">{placement.item_id}</TableCell>
              <TableCell className="text-right">{placement.position.x.toFixed(1)} cm</TableCell>
              <TableCell className="text-right">{placement.position.y.toFixed(1)} cm</TableCell>
              <TableCell className="text-right">{placement.position.z.toFixed(1)} cm</TableCell>
              <TableCell className="text-center">
                {placement.rotated ? (
                  <Badge variant="secondary">90°</Badge>
                ) : (
                  <Badge variant="outline">0°</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
