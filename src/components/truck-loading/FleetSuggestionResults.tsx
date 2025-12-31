import { useState, useEffect } from 'react';
import { Truck, DollarSign, BarChart3, Check, Star, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { FleetSuggestionResult, FleetScenario, PackingItem, OptimizationResult, TruckSpec } from '@/types/truckLoading';
import { suggestFleet, runOptimization, getTruckSpecs } from '@/services/truckLoadingService';
import { toast } from 'sonner';
import { LoadingPlan3D } from './LoadingPlan3D';

interface FleetSuggestionResultsProps {
  items: PackingItem[];
  onReset: () => void;
}

// Result for a single truck optimization
interface TruckLoadingResult {
  truckType: string;
  truckIndex: number;
  result: OptimizationResult;
  truckSpec: TruckSpec;
  isSpecialTransport: boolean;
}

const TRUCK_LABELS: Record<string, string> = {
  van_3t5: 'Fourgon 3.5T',
  truck_19t: 'Camion 19T',
  truck_26t: 'Camion 26T',
  truck_40t: 'Semi-remorque 40T',
  convoy_modular: 'Convoi Exceptionnel (Remorque Modulaire)',
  exceptional_convoy: 'Convoi Exceptionnel',
  modular_trailer: 'Remorque Modulaire',
};

const SPECIAL_TRANSPORT_TYPES = ['convoy_modular', 'exceptional_convoy', 'modular_trailer', 'heavy_modular'];

// Default spec for exceptional convoy / modular trailers (not in truck-specs API)
const SPECIAL_TRANSPORT_SPEC: TruckSpec = {
  name: 'convoy_modular',
  length: 15000, // 15m modular trailer
  width: 3000,   // 3m wide
  height: 3500,  // 3.5m height
  max_weight: 100000, // 100 tonnes
};

const isSpecialTransportType = (truckType: string): boolean => {
  const lowerType = truckType.toLowerCase();
  return SPECIAL_TRANSPORT_TYPES.some(st => lowerType.includes(st)) ||
    lowerType.includes('convoi') ||
    lowerType.includes('exceptionnel') ||
    lowerType.includes('modulaire') ||
    lowerType.includes('remorque');
};

const SCENARIO_ICONS: Record<string, typeof DollarSign> = {
  'Coût Optimal': DollarSign,
  'Nombre Minimal': Truck,
  'Équilibré': BarChart3,
};

/**
 * Safe weight normalization:
 * - Weights should already be in KG from the parser
 * - Only convert if clearly in tonnes (0 < weight < 1)
 * - Do NOT multiply by 1000 for weights < 100 (that's incorrect)
 */
const normalizeWeight = (weight: number): number => {
  if (weight > 0 && weight < 1) {
    // Clearly in tonnes, convert to kg
    return weight * 1000;
  }
  // Already in kg (or 0)
  return weight;
};

export function FleetSuggestionResults({ items, onReset }: FleetSuggestionResultsProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [result, setResult] = useState<FleetSuggestionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<FleetScenario | null>(null);
  const [showLoadingPlan, setShowLoadingPlan] = useState(false);
  const [loadingResults, setLoadingResults] = useState<TruckLoadingResult[]>([]);
  const [optimizationError, setOptimizationError] = useState<string | null>(null);

  // Normalize weights safely
  const normalizedItems = items.map(item => ({
    ...item,
    weight: normalizeWeight(item.weight),
  }));

  // Sanity check for total weight
  const totalWeight = normalizedItems.reduce((sum, item) => sum + item.weight * item.quantity, 0);
  const isSuspiciousWeight = totalWeight > 500000; // > 500 tonnes seems suspicious

  // Auto-load fleet suggestion on mount
  useEffect(() => {
    loadFleetSuggestion();
  }, []);

  const loadFleetSuggestion = async () => {
    setIsLoading(true);
    setError(null);
    
    if (isSuspiciousWeight) {
      console.warn(`[FleetSuggestion] Suspicious total weight: ${totalWeight} kg. Verify units.`);
    }
    
    try {
      const suggestion = await suggestFleet(normalizedItems, 100, ['van_3t5', 'truck_19t', 'truck_26t', 'truck_40t']);
      setResult(suggestion);
      
      toast.success('Scénarios de flotte calculés', {
        description: `${suggestion.scenarios.length} options disponibles`
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du calcul des scénarios';
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const formatCost = (cost: number) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'decimal',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cost) + ' FCFA';
  };

  // Run optimization when user clicks "Valider ce scénario"
  const handleSelectScenario = async (scenario: FleetScenario) => {
    setSelectedScenario(scenario);
    setIsOptimizing(true);
    setOptimizationError(null);
    setLoadingResults([]);

    toast.info(`Calcul du plan de chargement pour "${scenario.name}"...`);

    try {
      // 1. Get truck specifications
      const specs = await getTruckSpecs();
      console.log('[FleetSuggestion] Truck specs loaded:', specs.map(s => s.name));

      // 2. Calculate total trucks in scenario for fallback distribution
      const totalTrucksInScenario = scenario.trucks.reduce((sum, a) => sum + a.count, 0);
      
      // 3. For each truck type in scenario, call optimize
      const results: TruckLoadingResult[] = [];
      const errors: string[] = [];
      let itemOffset = 0;
      let remainingItems = normalizedItems.length;

      for (const allocation of scenario.trucks) {
        // Find truck spec with fallback for partial matches
        let truckSpec = specs.find(s => s.name === allocation.truck_type);
        
        if (!truckSpec) {
          // Fallback: search by partial match
          truckSpec = specs.find(s => 
            s.name.includes(allocation.truck_type) || 
            allocation.truck_type.includes(s.name)
          );
        }
        
        // Special transport fallback
        if (!truckSpec && isSpecialTransportType(allocation.truck_type)) {
          console.log(`[FleetSuggestion] Using special transport spec for "${allocation.truck_type}"`);
          truckSpec = { ...SPECIAL_TRANSPORT_SPEC, name: allocation.truck_type };
        }
        
        if (!truckSpec) {
          console.warn(`[FleetSuggestion] Truck spec not found for "${allocation.truck_type}"`);
          errors.push(`Spécifications non trouvées pour: ${allocation.truck_type}`);
          continue;
        }
        
        console.log(`[FleetSuggestion] Using spec for "${allocation.truck_type}":`, truckSpec.name);

        // Robust item distribution:
        // - Use items_assigned if available and > 0
        // - Otherwise, distribute remaining items evenly across remaining trucks
        let itemsForThisType = allocation.items_assigned || 0;
        
        if (itemsForThisType === 0 && remainingItems > 0) {
          // Fallback: distribute remaining items across remaining trucks
          const remainingTrucks = totalTrucksInScenario - results.length;
          itemsForThisType = Math.ceil(remainingItems / Math.max(1, remainingTrucks)) * allocation.count;
          console.log(`[FleetSuggestion] Fallback distribution: ${itemsForThisType} items for ${allocation.count} trucks`);
        }

        const itemsPerTruck = Math.ceil(itemsForThisType / allocation.count);

        for (let i = 0; i < allocation.count; i++) {
          const startIdx = itemOffset;
          const endIdx = Math.min(startIdx + itemsPerTruck, normalizedItems.length);
          const truckItems = normalizedItems.slice(startIdx, endIdx);
          
          if (truckItems.length === 0) {
            console.log(`[FleetSuggestion] No items for truck ${i + 1} of type ${allocation.truck_type}`);
            continue;
          }

          try {
            console.log(`[FleetSuggestion] Optimizing truck ${i + 1} of ${allocation.count} (${allocation.truck_type}) with ${truckItems.length} items`);
            
            const optimResult = await runOptimization(truckItems, truckSpec, 'simple');
            
            results.push({
              truckType: allocation.truck_type,
              truckIndex: results.length,
              result: optimResult,
              truckSpec,
              isSpecialTransport: isSpecialTransportType(allocation.truck_type),
            });

            // Only advance offset on success
            itemOffset = endIdx;
            remainingItems = normalizedItems.length - itemOffset;
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : 'Erreur inconnue';
            console.error(`[FleetSuggestion] Error optimizing truck ${i + 1} of type ${allocation.truck_type}:`, errMsg);
            errors.push(`Camion ${allocation.truck_type} #${i + 1}: ${errMsg}`);
            // Don't advance itemOffset on failure - items can be retried
          }
        }
      }

      setLoadingResults(results);

      if (results.length > 0) {
        toast.success('Plans de chargement calculés', {
          description: `${results.length} camion(s) optimisé(s)`
        });
        setShowLoadingPlan(true);
      } else if (errors.length > 0) {
        const errorMsg = `Tous les calculs ont échoué:\n${errors.slice(0, 3).join('\n')}`;
        setOptimizationError(errorMsg);
        toast.error('Échec du calcul des plans', {
          description: errors[0]
        });
      } else {
        setOptimizationError('Aucun article à placer ou configuration invalide');
        toast.error('Aucun plan généré');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du calcul des plans';
      setOptimizationError(message);
      toast.error(message);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleBackToScenarios = () => {
    setShowLoadingPlan(false);
    setLoadingResults([]);
    setOptimizationError(null);
  };

  // Show 3D loading plan if a scenario is selected and results are ready
  if (showLoadingPlan && selectedScenario && loadingResults.length > 0) {
    return (
      <LoadingPlan3D 
        scenario={selectedScenario} 
        items={normalizedItems} 
        onBack={handleBackToScenarios}
        precomputedResults={loadingResults}
      />
    );
  }

  // Show optimization error if all calls failed
  if (optimizationError && selectedScenario) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-4">
        <div className="rounded-full bg-destructive/10 p-4">
          <AlertTriangle className="h-8 w-8 text-destructive" />
        </div>
        <div className="text-center max-w-md">
          <p className="text-lg font-medium text-destructive">Échec du calcul des plans de chargement</p>
          <p className="text-sm text-muted-foreground mt-2 whitespace-pre-line">
            {optimizationError}
          </p>
          <p className="text-xs text-muted-foreground mt-4">
            Causes possibles: poids excessif, dimensions incohérentes, erreur backend
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={handleBackToScenarios}>
            Retour aux scénarios
          </Button>
          <Button onClick={() => handleSelectScenario(selectedScenario)}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Réessayer
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <div className="text-center">
          <p className="text-lg font-medium">Calcul des scénarios optimaux...</p>
          <p className="text-sm text-muted-foreground">
            Analyse de {items.length} articles pour déterminer la meilleure configuration
          </p>
        </div>
      </div>
    );
  }

  if (isOptimizing) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <div className="text-center">
          <p className="text-lg font-medium">Calcul des plans de chargement...</p>
          <p className="text-sm text-muted-foreground">
            Optimisation du placement pour "{selectedScenario?.name}"
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-4">
        <div className="rounded-full bg-destructive/10 p-4">
          <Truck className="h-8 w-8 text-destructive" />
        </div>
        <div className="text-center">
          <p className="text-lg font-medium text-destructive">{error}</p>
          <p className="text-sm text-muted-foreground mt-2">
            Vérifiez que le backend est accessible et réessayez
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onReset}>
            Recommencer
          </Button>
          <Button onClick={loadFleetSuggestion}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Réessayer
          </Button>
        </div>
      </div>
    );
  }

  if (!result || result.scenarios.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-4">
        <p className="text-muted-foreground">Aucun scénario disponible</p>
        <Button onClick={onReset}>Recommencer</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Sanity warning for suspicious weight */}
      {isSuspiciousWeight && (
        <Card className="border-amber-500 bg-amber-500/10">
          <CardContent className="flex items-center gap-4 py-4">
            <AlertTriangle className="h-6 w-6 text-amber-600" />
            <div>
              <p className="font-medium text-amber-700">Poids total élevé détecté</p>
              <p className="text-sm text-muted-foreground">
                Poids total: {(totalWeight / 1000).toFixed(1)} tonnes. Vérifiez que les unités sont correctes (kg attendus).
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="rounded-full bg-primary/10 p-3">
              <Truck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Articles à charger</p>
              <p className="text-2xl font-bold">{result.items_count}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="rounded-full bg-primary/10 p-3">
              <BarChart3 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Poids total</p>
              <p className="text-2xl font-bold">{(result.total_weight / 1000).toFixed(1)} T</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="rounded-full bg-primary/10 p-3">
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Volume total</p>
              <p className="text-2xl font-bold">{result.total_volume.toFixed(1)} m³</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Scenarios Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {result.scenarios.map((scenario) => {
          const Icon = SCENARIO_ICONS[scenario.name] || Truck;
          const isSelected = selectedScenario?.name === scenario.name;
          
          return (
            <Card 
              key={scenario.name}
              className={`relative transition-all ${
                scenario.is_recommended 
                  ? 'ring-2 ring-primary shadow-lg' 
                  : isSelected 
                  ? 'ring-2 ring-primary/50' 
                  : 'hover:shadow-md'
              }`}
            >
              {scenario.is_recommended && (
                <Badge 
                  className="absolute -top-2 -right-2 gap-1 bg-primary text-primary-foreground"
                >
                  <Star className="h-3 w-3" />
                  Recommandé
                </Badge>
              )}
              
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className={`rounded-full p-2 ${scenario.is_recommended ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{scenario.name}</CardTitle>
                    <CardDescription className="text-sm">{scenario.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-4">
                {/* Cost */}
                <div className="text-center py-3 bg-muted/50 rounded-lg">
                  <p className="text-2xl font-bold text-primary">{formatCost(scenario.total_cost)}</p>
                  <p className="text-xs text-muted-foreground">{scenario.total_trucks} camion(s)</p>
                </div>
                
                {/* Trucks breakdown */}
                <div className="space-y-3">
                  <p className="text-sm font-medium">Répartition des camions :</p>
                {scenario.trucks.map((truck, idx) => {
                    const isSpecialTransport = isSpecialTransportType(truck.truck_type);
                    return (
                      <div key={idx} className="space-y-1">
                        <div className="flex justify-between items-center text-sm">
                          <div className="flex items-center gap-2">
                            <span>{TRUCK_LABELS[truck.truck_type] || truck.truck_type}</span>
                            {isSpecialTransport && (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                TRANSPORT SPÉCIAL
                              </Badge>
                            )}
                          </div>
                          <span className="font-medium">×{truck.count}</span>
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Remplissage</span>
                            <span>{(truck.fill_rate * 100).toFixed(0)}%</span>
                          </div>
                          <Progress value={truck.fill_rate * 100} className="h-1.5" />
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                {/* Select Button */}
                <Button 
                  className="w-full" 
                  variant={isSelected ? "default" : "outline"}
                  onClick={() => handleSelectScenario(scenario)}
                  disabled={isOptimizing}
                >
                  {isOptimizing && isSelected ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Calcul en cours...
                    </>
                  ) : (
                    'Valider ce scénario'
                  )}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex justify-center pt-4">
        <Button variant="outline" onClick={onReset}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Nouvelle analyse
        </Button>
      </div>
    </div>
  );
}
