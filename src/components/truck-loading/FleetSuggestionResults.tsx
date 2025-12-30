import { useState, useEffect } from 'react';
import { Truck, DollarSign, BarChart3, Check, Star, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { FleetSuggestionResult, FleetScenario, PackingItem } from '@/types/truckLoading';
import { suggestFleet } from '@/services/truckLoadingService';
import { toast } from 'sonner';
import { LoadingPlan3D } from './LoadingPlan3D';

interface FleetSuggestionResultsProps {
  items: PackingItem[];
  onReset: () => void;
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

const SPECIAL_TRANSPORT_TYPES = ['convoy_modular', 'exceptional_convoy', 'modular_trailer'];

const SCENARIO_ICONS: Record<string, typeof DollarSign> = {
  'Coût Optimal': DollarSign,
  'Nombre Minimal': Truck,
  'Équilibré': BarChart3,
};

export function FleetSuggestionResults({ items, onReset }: FleetSuggestionResultsProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [result, setResult] = useState<FleetSuggestionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<FleetScenario | null>(null);
  const [showLoadingPlan, setShowLoadingPlan] = useState(false);

  // Ensure weights are in KG before sending
  const normalizedItems = items.map(item => ({
    ...item,
    // Weight should be in KG - the parser should already provide KG
    // but if weight looks suspiciously low (< 100), it might be in tonnes
    weight: item.weight < 100 && item.weight > 0 ? item.weight * 1000 : item.weight,
  }));

  // Auto-load fleet suggestion on mount
  useEffect(() => {
    loadFleetSuggestion();
  }, []);

  const loadFleetSuggestion = async () => {
    setIsLoading(true);
    setError(null);
    
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

  const handleSelectScenario = (scenario: FleetScenario) => {
    setSelectedScenario(scenario);
    setShowLoadingPlan(true);
    toast.success(`Scénario "${scenario.name}" sélectionné - Calcul du plan de chargement...`);
  };

  const handleBackToScenarios = () => {
    setShowLoadingPlan(false);
  };

  // Show 3D loading plan if a scenario is selected
  if (showLoadingPlan && selectedScenario) {
    return (
      <LoadingPlan3D 
        scenario={selectedScenario} 
        items={normalizedItems} 
        onBack={handleBackToScenarios} 
      />
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
                    const isSpecialTransport = SPECIAL_TRANSPORT_TYPES.includes(truck.truck_type);
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
                >
                  {isSelected ? (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Sélectionné
                    </>
                  ) : (
                    'Sélectionner ce scénario'
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