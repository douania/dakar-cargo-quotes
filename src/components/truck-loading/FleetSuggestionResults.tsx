import { useState, useEffect, useMemo } from 'react';
import { Truck, DollarSign, BarChart3, Check, Star, Loader2, RefreshCw, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { FleetSuggestionResult, FleetScenario, PackingItem, OptimizationResult, TruckSpec, FeasibilityScore } from '@/types/truckLoading';
import { suggestFleet, runOptimization, getTruckSpecs, calculateFeasibilityScore, selectOptimalScenario } from '@/services/truckLoadingService';
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
  van_3t: 'Fourgon 3T',
  van_3t5: 'Fourgon 3.5T',
  truck_19t: 'Porteur 19T',
  porteur_19t: 'Porteur 19T',
  truck_26t: 'Porteur 26T',
  porteur_26t: 'Porteur 26T',
  truck_40t: 'Semi-remorque 40T',
  semi_plateau_32t: 'Semi-remorque plateau 32T',
  lowbed_50t: 'Lowbed 2 essieux 50T',
  lowbed_2ess_50t: 'Lowbed 2 essieux 50T',
  lowbed_60t: 'Lowbed 3 essieux 60T',
  lowbed_3ess_60t: 'Lowbed 3 essieux 60T',
  lowbed_80t: 'Lowbed 4 essieux 80T',
  lowbed_4ess_80t: 'Lowbed 4 essieux 80T',
  convoy_modular: 'Convoi Exceptionnel (Remorque Modulaire)',
  exceptional_convoy: 'Convoi Exceptionnel',
  modular_trailer: 'Remorque Modulaire',
};

const SPECIAL_TRANSPORT_TYPES = ['convoi_modular', 'convoy_modular', 'exceptional_convoy', 'modular_trailer', 'heavy_modular', 'lowbed', 'lowbed_50t', 'lowbed_60t', 'lowbed_80t'];

// Default spec for exceptional convoy / modular trailers (not in truck-specs API)
// NOTE: keep units aligned with truck-specs API (centimeters)
const SPECIAL_TRANSPORT_SPEC: TruckSpec = {
  name: 'convoi_modular',
  length: 1500, // 15m
  width: 300, // 3m
  height: 400, // 4m
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

// ============= SCENARIOS GRID COMPONENT =============
interface ScenariosGridProps {
  scenarios: FleetScenario[];
  selectedScenario: FleetScenario | null;
  isOptimizing: boolean;
  onSelectScenario: (scenario: FleetScenario) => void;
  formatCost: (cost: number) => string;
}

function ScenariosGrid({ scenarios, selectedScenario, isOptimizing, onSelectScenario, formatCost }: ScenariosGridProps) {
  // Calculate recommended scenario locally (ignore backend is_recommended)
  const recommendedScenarioName = useMemo(() => {
    return selectOptimalScenario(scenarios);
  }, [scenarios]);

  // Calculate feasibility for each scenario
  const scenarioFeasibility = useMemo(() => {
    const map = new Map<string, FeasibilityScore>();
    scenarios.forEach(s => {
      map.set(s.name, calculateFeasibilityScore(s));
    });
    return map;
  }, [scenarios]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {scenarios.map((scenario) => {
        const Icon = SCENARIO_ICONS[scenario.name] || Truck;
        const isSelected = selectedScenario?.name === scenario.name;
        const isRecommended = scenario.name === recommendedScenarioName;
        const feasibility = scenarioFeasibility.get(scenario.name);
        const avgFillRate = scenario.trucks.length > 0 
          ? scenario.trucks.reduce((sum, t) => sum + t.fill_rate, 0) / scenario.trucks.length 
          : 0;
        
        return (
          <Card 
            key={scenario.name}
            className={`relative transition-all ${
              isRecommended 
                ? 'ring-2 ring-primary shadow-lg' 
                : isSelected 
                ? 'ring-2 ring-primary/50' 
                : 'hover:shadow-md'
            }`}
          >
            {/* Recommended badge (recalculated locally) */}
            {isRecommended && (
              <Badge 
                className="absolute -top-2 -right-2 gap-1 bg-primary text-primary-foreground"
              >
                <Star className="h-3 w-3" />
                Recommandé
              </Badge>
            )}
            
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className={`rounded-full p-2 ${isRecommended ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-lg">{scenario.name}</CardTitle>
                  <CardDescription className="text-sm">{scenario.description}</CardDescription>
                </div>
              </div>
              
              {/* Feasibility badge */}
              {feasibility && (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {feasibility.recommendation === 'feasible' && (
                    <Badge className="bg-green-100 text-green-800 border-green-300">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Faisable
                    </Badge>
                  )}
                  {feasibility.recommendation === 'complex' && (
                    <Badge className="bg-amber-100 text-amber-800 border-amber-300">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Mobilisation complexe
                    </Badge>
                  )}
                  {feasibility.recommendation === 'difficult' && (
                    <Badge className="bg-red-100 text-red-800 border-red-300">
                      <XCircle className="h-3 w-3 mr-1" />
                      Difficile à mobiliser
                    </Badge>
                  )}
                  
                  {/* Average fill rate indicator */}
                  <Badge variant="outline" className={avgFillRate >= 0.8 ? 'text-green-600 border-green-300' : avgFillRate >= 0.6 ? 'text-amber-600 border-amber-300' : 'text-red-600 border-red-300'}>
                    {Math.round(avgFillRate * 100)}% remplissage moy.
                  </Badge>
                </div>
              )}
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
                              SPÉCIAL
                            </Badge>
                          )}
                        </div>
                        <span className="font-medium">×{truck.count}</span>
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Remplissage</span>
                          <span className={truck.fill_rate >= 0.8 ? 'text-green-600 font-medium' : truck.fill_rate < 0.6 ? 'text-amber-600' : ''}>
                            {(truck.fill_rate * 100).toFixed(0)}%
                          </span>
                        </div>
                        <Progress 
                          value={truck.fill_rate * 100} 
                          className={`h-1.5 ${truck.fill_rate < 0.6 ? '[&>div]:bg-amber-500' : ''}`} 
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              
              {/* Feasibility warnings */}
              {feasibility && feasibility.warnings.length > 0 && (
                <div className="bg-amber-50 rounded-lg p-2 space-y-1">
                  {feasibility.warnings.slice(0, 2).map((warning, i) => (
                    <div key={i} className="text-xs text-amber-700 flex items-start gap-1">
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                      <span>{warning}</span>
                    </div>
                  ))}
                  {feasibility.warnings.length > 2 && (
                    <div className="text-xs text-amber-600">
                      +{feasibility.warnings.length - 2} avertissement(s)
                    </div>
                  )}
                </div>
              )}
              
              {/* Select Button */}
              <Button 
                className="w-full" 
                variant={isSelected ? "default" : "outline"}
                onClick={() => onSelectScenario(scenario)}
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
  );
}

// ============= MAIN COMPONENT =============

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
      // Déterminer si transport exceptionnel nécessaire
      const needsExceptionalTransport = normalizedItems.some(item => 
        item.weight > 32000 ||   // Plus de 32T par article
        item.length > 1360 ||    // Plus de 13.6m (en cm)
        item.width > 280 ||      // Plus de 2.8m
        item.height > 300        // Plus de 3m
      );

      // Construire la liste des camions disponibles
      const availableTrucks = ['van_3t5', 'truck_19t', 'truck_26t', 'truck_40t'];
      if (needsExceptionalTransport) {
        availableTrucks.push('lowbed_50t', 'lowbed_60t', 'lowbed_80t');
        console.log('[FleetSuggestion] Transport exceptionnel détecté - lowbeds ajoutés');
      }

      console.log('[FleetSuggestion] Available trucks:', availableTrucks);
      console.log('[FleetSuggestion] Total weight:', totalWeight, 'kg');
      console.log('[FleetSuggestion] Items count:', normalizedItems.length);

      // Chronométrage de l'appel suggest-fleet
      console.time('[API] suggest-fleet');
      const suggestion = await suggestFleet(normalizedItems, 100, availableTrucks);
      console.timeEnd('[API] suggest-fleet');
      
      setResult(suggestion);
      
      toast.success('Scénarios de flotte calculés', {
        description: `${suggestion.scenarios.length} options disponibles`
      });
    } catch (err) {
      console.timeEnd('[API] suggest-fleet'); // Arrêter le chrono même en cas d'erreur
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
  // Uses trucks_details from suggest-fleet API which contains pre-assigned items per truck
  const handleSelectScenario = async (scenario: FleetScenario) => {
    setSelectedScenario(scenario);
    setIsOptimizing(true);
    setOptimizationError(null);
    setLoadingResults([]);

    console.log('[handleSelectScenario] Scenario:', scenario.name);
    console.log('[handleSelectScenario] Original items from props:', normalizedItems.length, normalizedItems);

    toast.info(`Calcul du plan de chargement pour "${scenario.name}"...`);

    try {
      // 1. Get truck specifications for dimensions
      const specs = await getTruckSpecs();
      console.log('[FleetSuggestion] Truck specs loaded:', specs.map(s => s.name));

      const results: TruckLoadingResult[] = [];
      const errors: string[] = [];
      
      // Track if we successfully found items in trucks_details
      let foundItemsInTrucksDetails = false;

      // 2. Iterate through each allocation in the scenario
      for (const allocation of scenario.trucks) {
        console.log(`[FleetSuggestion] Processing allocation:`, allocation.truck_type, 'count:', allocation.count, 'trucks_details:', allocation.trucks_details?.length || 0);
        
        // Check if trucks_details is available (pre-assigned items from backend)
        if (allocation.trucks_details && allocation.trucks_details.length > 0) {
          console.log(`[FleetSuggestion] Using trucks_details for ${allocation.truck_type}: ${allocation.trucks_details.length} truck(s)`);
          
          // Process each truck with its pre-assigned items
          for (let i = 0; i < allocation.trucks_details.length; i++) {
            const truckDetail = allocation.trucks_details[i];
            
            console.log(`[FleetSuggestion] Truck detail ${i + 1}:`, JSON.stringify(truckDetail, null, 2));
            
            if (!truckDetail.items || truckDetail.items.length === 0) {
              console.warn(`[FleetSuggestion] No items in trucks_details for truck ${i + 1} of type ${truckDetail.type}`);
              continue;
            }
            
            foundItemsInTrucksDetails = true;

            // L'API Railway retourne les dimensions en CM (centimètres)
            // Notre standard interne est aussi le CM, donc PAS de conversion nécessaire
            const truckItems: PackingItem[] = truckDetail.items.map(item => {
              console.log(`[UNITS] trucks_details item ${item.id}: ${item.length}cm (déjà en cm)`);
              
              return {
                id: item.id,
                description: item.name,
                // PAS DE CONVERSION - Railway API retourne des CM
                length: item.length,
                width: item.width,
                height: item.height,
                weight: normalizeWeight(item.weight),
                quantity: item.quantity || 1,
                stackable: true,
              };
            });
            
            console.log('[optimize] Items en CM (format Railway):', truckItems.length, truckItems);

            // Build truck spec from trucks_details or fallback to API specs
            let truckSpec: TruckSpec | undefined = specs.find(s => s.name === truckDetail.type);
            
            if (!truckSpec) {
              truckSpec = specs.find(s => 
                s.name.includes(truckDetail.type) || 
                truckDetail.type.includes(s.name)
              );
            }

            // Use volume_capacity and weight_capacity from trucks_details if spec not found
            if (!truckSpec) {
              if (isSpecialTransportType(truckDetail.type)) {
                truckSpec = { ...SPECIAL_TRANSPORT_SPEC, name: truckDetail.type };
              } else {
              // Create spec from trucks_details capacities (dimensions en CM - standard Railway API)
                console.log(`[FleetSuggestion] Creating spec from trucks_details for ${truckDetail.type}`);
                truckSpec = {
                  name: truckDetail.type,
                  length: 1360,  // Semi-remorque standard: 13.6m en cm
                  width: 248,    // 2.48m en cm
                  height: 270,   // 2.7m en cm
                  max_weight: truckDetail.weight_capacity || 25000,
                };
              }
            }

            try {
              console.log(`[FleetSuggestion] Optimizing truck ${i + 1} (${truckDetail.type}) with ${truckItems.length} items from trucks_details`);
              
              // Chronométrage par camion
              const timerLabel = `[API] optimize truck ${results.length + 1} (${truckDetail.type})`;
              console.time(timerLabel);
              const optimResult = await runOptimization(truckItems, truckSpec, 'simple');
              console.timeEnd(timerLabel);
              
              // truckSpec reste en CM (standard interne)
              // TruckScene3D convertira CM → mètres pour Three.js
              console.log(`[UNITS] truckSpec for ${truckDetail.type}: ${truckSpec.length}×${truckSpec.width}×${truckSpec.height} cm`);
              
              results.push({
                truckType: truckDetail.type,
                truckIndex: results.length,
                result: optimResult,
                truckSpec: truckSpec, // Garder en CM
                isSpecialTransport: isSpecialTransportType(truckDetail.type),
              });
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : 'Erreur inconnue';
              console.error(`[FleetSuggestion] Error optimizing truck ${i + 1} of type ${truckDetail.type}:`, errMsg);
              errors.push(`Camion ${truckDetail.type} #${i + 1}: ${errMsg}`);
            }
          }
        } else {
          // FALLBACK: No trucks_details, use legacy distribution method with original items
          console.warn(`[FleetSuggestion] No trucks_details for ${allocation.truck_type}, using fallback with original items`);
          
          let truckSpec = specs.find(s => s.name === allocation.truck_type);
          
          if (!truckSpec) {
            truckSpec = specs.find(s => 
              s.name.includes(allocation.truck_type) || 
              allocation.truck_type.includes(s.name)
            );
          }
          
          if (!truckSpec && isSpecialTransportType(allocation.truck_type)) {
            truckSpec = { ...SPECIAL_TRANSPORT_SPEC, name: allocation.truck_type };
          }
          
          if (!truckSpec) {
            console.warn(`[FleetSuggestion] Truck spec not found for "${allocation.truck_type}"`);
            errors.push(`Spécifications non trouvées pour: ${allocation.truck_type}`);
            continue;
          }

          // Fallback: distribute original items evenly across trucks of this type
          const itemsPerTruck = Math.ceil(normalizedItems.length / scenario.total_trucks);
          const startIdx = results.length * itemsPerTruck;
          
          for (let i = 0; i < allocation.count; i++) {
            const truckStartIdx = startIdx + (i * itemsPerTruck);
            const truckEndIdx = Math.min(truckStartIdx + itemsPerTruck, normalizedItems.length);
            const truckItems = normalizedItems.slice(truckStartIdx, truckEndIdx);
            
            if (truckItems.length === 0) {
              console.warn(`[FleetSuggestion] Fallback: No items for truck ${i + 1}, skipping`);
              continue;
            }

            console.log('[optimize] Items envoyés (fallback):', truckItems.length, truckItems);

            try {
              console.log(`[FleetSuggestion] Fallback: Optimizing truck ${i + 1} (${allocation.truck_type}) with ${truckItems.length} items`);
              
              // Chronométrage par camion (fallback)
              const timerLabel = `[API] optimize truck ${results.length + 1} fallback (${allocation.truck_type})`;
              console.time(timerLabel);
              const optimResult = await runOptimization(truckItems, truckSpec, 'simple');
              console.timeEnd(timerLabel);
              
              // truckSpec reste en CM (standard interne)
              console.log(`[UNITS] truckSpec fallback for ${allocation.truck_type}: ${truckSpec.length}×${truckSpec.width}×${truckSpec.height} cm`);
              
              results.push({
                truckType: allocation.truck_type,
                truckIndex: results.length,
                result: optimResult,
                truckSpec: truckSpec, // Garder en CM
                isSpecialTransport: isSpecialTransportType(allocation.truck_type),
              });
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : 'Erreur inconnue';
              console.error(`[FleetSuggestion] Error optimizing truck ${i + 1} of type ${allocation.truck_type}:`, errMsg);
              errors.push(`Camion ${allocation.truck_type} #${i + 1}: ${errMsg}`);
            }
          }
        }
      }

      // FINAL FALLBACK: If no items were found in trucks_details AND results are empty, 
      // use all original items with a single truck
      if (results.length === 0 && !foundItemsInTrucksDetails && normalizedItems.length > 0) {
        console.warn('[FleetSuggestion] FINAL FALLBACK: No items found in trucks_details, using all original items');
        console.log('[optimize] Items envoyés (final fallback):', normalizedItems.length, normalizedItems);
        
        const firstAllocation = scenario.trucks[0];
        let truckSpec = specs.find(s => s.name === firstAllocation?.truck_type) || specs[0] || SPECIAL_TRANSPORT_SPEC;
        
        try {
          const optimResult = await runOptimization(normalizedItems, truckSpec, 'simple');
          // truckSpec reste en CM (standard interne)
          console.log(`[UNITS] truckSpec final fallback: ${truckSpec.length}×${truckSpec.width}×${truckSpec.height} cm`);
          
          results.push({
            truckType: truckSpec.name,
            truckIndex: 0,
            result: optimResult,
            truckSpec: truckSpec, // Garder en CM
            isSpecialTransport: isSpecialTransportType(truckSpec.name),
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Erreur inconnue';
          console.error(`[FleetSuggestion] Final fallback optimization failed:`, errMsg);
          errors.push(`Fallback: ${errMsg}`);
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
        setOptimizationError('Aucun article à placer. Vérifiez que la packing list contient des articles.');
        toast.error('Aucun plan généré - liste vide');
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
            {normalizedItems.some(i => i.weight > 32000 || i.height > 300 || i.width > 280) 
              ? 'Transport exceptionnel détecté — cela peut prendre jusqu\u2019à 5 minutes.'
              : `Optimisation du placement pour "${selectedScenario?.name}"`}
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
      <ScenariosGrid 
        scenarios={result.scenarios}
        selectedScenario={selectedScenario}
        isOptimizing={isOptimizing}
        onSelectScenario={handleSelectScenario}
        formatCost={formatCost}
      />

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
