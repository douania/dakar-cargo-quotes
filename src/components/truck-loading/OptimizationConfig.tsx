import { useState, useEffect } from 'react';
import { Truck, Zap, Brain, Play, Loader2, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PackingItem, TruckSpec, OptimizationResult, Algorithm } from '@/types/truckLoading';
import { getTruckSpecs, runOptimization } from '@/services/truckLoadingService';
import { toast } from 'sonner';

interface OptimizationConfigProps {
  items: PackingItem[];
  onOptimizationComplete: (result: OptimizationResult, truck: TruckSpec) => void;
}

const DEFAULT_TRUCKS: TruckSpec[] = [
  { name: '20 pieds Standard', length: 590, width: 235, height: 239, max_weight: 21770 },
  { name: '40 pieds Standard', length: 1203, width: 235, height: 239, max_weight: 26680 },
  { name: '40 pieds High Cube', length: 1203, width: 235, height: 269, max_weight: 26460 },
];

export function OptimizationConfig({ items, onOptimizationComplete }: OptimizationConfigProps) {
  const [trucks, setTrucks] = useState<TruckSpec[]>(DEFAULT_TRUCKS);
  const [selectedTruckName, setSelectedTruckName] = useState<string>('');
  const [algorithm, setAlgorithm] = useState<Algorithm>('simple');
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingTrucks, setLoadingTrucks] = useState(true);

  useEffect(() => {
    loadTrucks();
  }, []);

  const loadTrucks = async () => {
    try {
      const specs = await getTruckSpecs();
      if (specs && specs.length > 0) {
        setTrucks(specs);
      }
    } catch (err) {
      console.log('Using default truck specs');
    } finally {
      setLoadingTrucks(false);
    }
  };

  const selectedTruck = trucks.find(t => t.name === selectedTruckName);

  const handleOptimize = async () => {
    if (!selectedTruck) {
      setError('Veuillez sélectionner un type de camion');
      return;
    }

    setError(null);
    setIsOptimizing(true);

    const startTime = Date.now();

    try {
      const result = await runOptimization(items, selectedTruck, algorithm);
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      
      toast.success(`Optimisation terminée en ${duration}s`);
      onOptimizationComplete(result, selectedTruck);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de l\'optimisation';
      setError(message);
      toast.error(message);
    } finally {
      setIsOptimizing(false);
    }
  };

  const totalWeight = items.reduce((sum, item) => sum + item.weight * item.quantity, 0);
  const totalVolume = items.reduce((sum, item) => {
    return sum + (item.length * item.width * item.height * item.quantity) / 1000000;
  }, 0);

  return (
    <div className="space-y-6">
      {/* Truck Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            Type de camion
          </CardTitle>
          <CardDescription>
            Sélectionnez le type de conteneur à charger
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select
            value={selectedTruckName}
            onValueChange={setSelectedTruckName}
            disabled={loadingTrucks}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choisir un type de camion..." />
            </SelectTrigger>
            <SelectContent>
              {trucks.map((truck) => (
                <SelectItem key={truck.name} value={truck.name}>
                  {truck.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedTruck && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/50 rounded-lg">
              <div>
                <p className="text-xs text-muted-foreground">Longueur</p>
                <p className="font-semibold">{selectedTruck.length} cm</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Largeur</p>
                <p className="font-semibold">{selectedTruck.width} cm</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Hauteur</p>
                <p className="font-semibold">{selectedTruck.height} cm</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Poids max</p>
                <p className="font-semibold">{selectedTruck.max_weight.toLocaleString()} kg</p>
              </div>
            </div>
          )}

          {selectedTruck && (
            <div className="flex gap-4 text-sm">
              <div className={`flex items-center gap-2 ${totalWeight > selectedTruck.max_weight ? 'text-destructive' : 'text-muted-foreground'}`}>
                <span>Poids à charger:</span>
                <span className="font-medium">{totalWeight.toFixed(0)} kg</span>
                {totalWeight > selectedTruck.max_weight && (
                  <AlertCircle className="h-4 w-4" />
                )}
              </div>
              <div className="text-muted-foreground">
                <span>Volume à charger:</span>
                <span className="font-medium ml-2">{totalVolume.toFixed(2)} m³</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Algorithm Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Algorithme d'optimisation</CardTitle>
          <CardDescription>
            Choisissez entre rapidité et qualité du résultat
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={algorithm}
            onValueChange={(value) => setAlgorithm(value as Algorithm)}
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            <Label
              htmlFor="simple"
              className={`flex items-start gap-4 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                algorithm === 'simple'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <RadioGroupItem value="simple" id="simple" className="mt-1" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="h-4 w-4 text-amber-500" />
                  <span className="font-semibold">Rapide (Heuristique)</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Résultat en quelques secondes. Bon compromis qualité/vitesse pour la plupart des cas.
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  ⏱️ ~5-10 secondes
                </p>
              </div>
            </Label>

            <Label
              htmlFor="genetic"
              className={`flex items-start gap-4 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                algorithm === 'genetic'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <RadioGroupItem value="genetic" id="genetic" className="mt-1" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Brain className="h-4 w-4 text-purple-500" />
                  <span className="font-semibold">Optimal (Génétique)</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Meilleur taux de remplissage. Recommandé pour les chargements complexes.
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  ⏱️ ~30-120 secondes
                </p>
              </div>
            </Label>
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Error Display */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Optimize Button */}
      <div className="flex justify-end">
        <Button
          size="lg"
          onClick={handleOptimize}
          disabled={!selectedTruck || isOptimizing}
          className="gap-2 min-w-[200px]"
        >
          {isOptimizing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Optimisation en cours...
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              Lancer l'optimisation
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
