import { PackingItem, TruckSpec, OptimizationResult, Algorithm, FleetSuggestionResult, FleetScenario, TruckAvailabilityInfo, FeasibilityScore } from '@/types/truckLoading';
import { supabase } from '@/integrations/supabase/client';

const RAILWAY_API_URL = import.meta.env.VITE_TRUCK_LOADING_API_URL || 'https://web-production-8afea.up.railway.app';

export interface AIExtractionResult {
  items: PackingItem[];
  document_type: 'packing_list' | 'invoice' | 'mixed' | 'unknown';
  sheets_analyzed: string[];
  warnings: string[];
  total_items: number;
  detected_dimension_unit: string;
}

// Mapping des IDs frontend vers les IDs backend
const TRUCK_ID_ALIASES: Record<string, string> = {
  van_3t5: 'van_3t',
  truck_19t: 'porteur_19t',
  truck_26t: 'porteur_26t',
  truck_40t: 'semi_plateau_32t',
  lowbed_50t: 'lowbed_2ess_50t',
  lowbed_60t: 'lowbed_3ess_60t',
  lowbed_80t: 'lowbed_4ess_80t',
};

// ============= TRUCK AVAILABILITY (Senegal/West Africa market) =============
// Based on operational knowledge: semi-trailers are standard and easy to find,
// small trucks (19T) are rare in fleet quantities, exceptional transport is limited
export const TRUCK_AVAILABILITY: Record<string, TruckAvailabilityInfo> = {
  'van_3t': { availability: 'low', maxFleetSize: 2, label: 'Fourgon 3T' },
  'porteur_19t': { availability: 'low', maxFleetSize: 3, label: 'Porteur 19T' },
  'porteur_26t': { availability: 'medium', maxFleetSize: 6, label: 'Porteur 26T' },
  'semi_plateau_32t': { availability: 'high', maxFleetSize: 15, label: 'Semi-remorque plateau 32T' },
  'semi_plateau_38t': { availability: 'high', maxFleetSize: 10, label: 'Semi-remorque plateau 38T' },
  'lowbed_2ess_50t': { availability: 'medium', maxFleetSize: 3, label: 'Lowbed 50T' },
  'lowbed_3ess_60t': { availability: 'low', maxFleetSize: 2, label: 'Lowbed 60T' },
  'lowbed_4ess_80t': { availability: 'low', maxFleetSize: 1, label: 'Lowbed 80T' },
  'convoi_modular': { availability: 'low', maxFleetSize: 1, label: 'Convoi Exceptionnel' },
};

// ============= FEASIBILITY SCORING =============
export function calculateFeasibilityScore(scenario: FleetScenario): FeasibilityScore {
  let score = 100;
  const warnings: string[] = [];
  
  for (const truck of scenario.trucks) {
    const info = TRUCK_AVAILABILITY[truck.truck_type];
    if (!info) continue;
    
    // Penalty if exceeding max mobilizable fleet size
    if (truck.count > info.maxFleetSize) {
      const excess = truck.count - info.maxFleetSize;
      score -= excess * 15;
      warnings.push(`${truck.count}x ${info.label} difficile à mobiliser (max recommandé: ${info.maxFleetSize})`);
    }
    
    // Penalty for low-availability vehicles used in quantity
    if (info.availability === 'low' && truck.count > 1) {
      score -= truck.count * 10;
      warnings.push(`${info.label} rarement disponible en flotte (${truck.count} demandés)`);
    }
    
    // Penalty for low fill rate (< 70%) - underutilized trucks
    if (truck.fill_rate < 0.7) {
      score -= Math.round((0.7 - truck.fill_rate) * 30);
      if (truck.fill_rate < 0.5) {
        warnings.push(`${info.label} sous-utilisé (${Math.round(truck.fill_rate * 100)}%)`);
      }
    }
    
    // Bonus for semi-trailers (market standard, easy to find)
    if (truck.truck_type.includes('semi_plateau')) {
      score += 5;
    }
  }
  
  // Penalty if too many different vehicle types (coordination complexity)
  if (scenario.trucks.length > 2) {
    score -= (scenario.trucks.length - 2) * 8;
    warnings.push('Coordination multi-véhicules complexe');
  }
  
  score = Math.max(0, Math.min(100, score));
  
  return {
    score,
    warnings,
    recommendation: score >= 70 ? 'feasible' : score >= 40 ? 'complex' : 'difficult'
  };
}

// ============= OPTIMAL SCENARIO SELECTION =============
// Recalculate recommended scenario locally (don't trust backend is_recommended flag)
export function selectOptimalScenario(scenarios: FleetScenario[]): string {
  const scored = scenarios.map(s => {
    const feasibility = calculateFeasibilityScore(s);
    const avgFillRate = s.trucks.length > 0 
      ? s.trucks.reduce((sum, t) => sum + t.fill_rate, 0) / s.trucks.length 
      : 0;
    
    return {
      name: s.name,
      feasibility,
      totalTrucks: s.total_trucks,
      avgFillRate
    };
  });

  // Sort by: feasibility >= 70 first, then min trucks, then best fill rate
  const sorted = scored.sort((a, b) => {
    // 1. Feasible scenarios first
    if (a.feasibility.score >= 70 && b.feasibility.score < 70) return -1;
    if (b.feasibility.score >= 70 && a.feasibility.score < 70) return 1;
    
    // 2. Minimum trucks (fewer = better)
    if (a.totalTrucks !== b.totalTrucks) return a.totalTrucks - b.totalTrucks;
    
    // 3. Best average fill rate
    return b.avgFillRate - a.avgFillRate;
  });

  console.log('[selectOptimalScenario] Scoring:', scored.map(s => 
    `${s.name}: score=${s.feasibility.score}, trucks=${s.totalTrucks}, fill=${Math.round(s.avgFillRate * 100)}%`
  ));

  return sorted[0]?.name || scenarios[0]?.name || '';
}

// ============= TRUCK FILTERING (exclude incompatible trucks) =============
export function filterCompatibleTrucks(
  items: PackingItem[], 
  trucks: { id: string; length: number; width: number; height: number; max_weight: number }[]
): typeof trucks {
  // Find max item dimensions (in cm, since items are in cm)
  const maxItemLength = Math.max(...items.map(i => i.length));
  const maxItemWidth = Math.max(...items.map(i => i.width));
  const maxItemHeight = Math.max(...items.map(i => i.height));
  const totalWeight = items.reduce((sum, i) => sum + i.weight * i.quantity, 0);

  console.log(`[filterCompatibleTrucks] Max item: ${maxItemLength}cm x ${maxItemWidth}cm x ${maxItemHeight}cm`);
  console.log(`[filterCompatibleTrucks] Total weight: ${totalWeight} kg`);

  return trucks.filter(truck => {
    // Truck dimensions are in cm (from API), item dimensions are in cm
    // The truck must be able to fit the largest item
    const canFitLargest = truck.length >= maxItemLength 
                       && truck.width >= maxItemWidth 
                       && truck.height >= maxItemHeight;
    
    // For heavy loads (> 50T), exclude small trucks (< 20T capacity)
    const appropriateSize = totalWeight < 50000 || truck.max_weight >= 20000;
    
    if (!canFitLargest) {
      console.log(`[filterCompatibleTrucks] Excluded ${truck.id}: cannot fit largest item`);
    }
    if (!appropriateSize) {
      console.log(`[filterCompatibleTrucks] Excluded ${truck.id}: too small for total weight`);
    }
    
    return canFitLargest && appropriateSize;
  });
}

const percentToRatio = (value: unknown): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return value > 1 ? value / 100 : value;
};

// Helper to call the proxy Edge Function
async function callOptimizationProxy(action: string, body?: any): Promise<any> {
  console.log(`[callOptimizationProxy] Action: ${action}`);

  const { data, error } = await supabase.functions.invoke('truck-optimization-proxy', {
    body: {
      action,
      ...(body || {}),
    },
  });

  if (error) {
    throw new Error(`Edge function returned ${error.message}`);
  }

  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error((data as any).error || 'Erreur du proxy');
  }

  return data;
}

// Parse packing list with AI (via edge function)
export async function parsePackingListWithAI(file: File): Promise<AIExtractionResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-packing-list`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Erreur lors de l'analyse IA du fichier");
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }

  return {
    items: data.items || [],
    document_type: data.document_type || 'unknown',
    sheets_analyzed: data.sheets_analyzed || [],
    warnings: data.warnings || [],
    total_items: data.total_items || data.items?.length || 0,
    detected_dimension_unit: data.detected_dimension_unit || 'unknown',
  };
}

// Legacy function - now redirects to AI parsing
export async function uploadPackingList(file: File): Promise<PackingItem[]> {
  const result = await parsePackingListWithAI(file);
  return result.items;
}

export async function getTruckSpecs(): Promise<TruckSpec[]> {
  console.log('[getTruckSpecs] Fetching via proxy...');

  try {
    const data = await callOptimizationProxy('truck-specs');

    // Parser le format { presets: { truck_name: specs } } ou { trucks: [...] }
    if (data.presets) {
      return Object.entries(data.presets).map(([name, spec]) => ({
        name,
        ...(spec as Omit<TruckSpec, 'name'>),
      }));
    }

    // Format actuel: { trucks: [{ id, name, length, width, height, max_weight, ...}] }
    if (data.trucks) {
      return data.trucks.map((t: any) => ({
        // IMPORTANT: use stable ID for matching with backend outputs
        name: t.id || t.name,
        length: t.length,
        width: t.width,
        height: t.height,
        max_weight: t.max_weight,
      }));
    }

    return data;
  } catch (error) {
    console.error('[getTruckSpecs] Proxy failed, trying direct:', error);
    // Fallback to direct API call
    const response = await fetch(`${RAILWAY_API_URL}/api/optimization/truck-specs`);
    if (!response.ok) {
      throw new Error('Erreur lors de la récupération des spécifications camions');
    }
    return response.json();
  }
}

// Normalise la réponse API vers notre format TypeScript
function normalizeOptimizationResult(apiResponse: any): OptimizationResult {
  const results = apiResponse.results || apiResponse.result || {};
  const placements = (apiResponse.placements || results.placements || []).map((p: any, index: number) => ({
    item_id: p.item_id || `item_${index}`,
    truck_index: p.truck_index ?? 0,
    position: {
      x: p.x ?? p.position?.x ?? 0,
      y: p.y ?? p.position?.y ?? 0,
      z: p.z ?? p.position?.z ?? 0,
    },
    rotated: p.rotation !== 0 || p.rotated || false,
  }));

  return {
    placements,
    metrics: {
      trucks_used: results.trucks_used ?? 1,
      fill_rate: percentToRatio(results.volume_efficiency ?? results.fill_rate ?? 0),
      weight_utilization: percentToRatio(results.weight_efficiency ?? results.weight_utilization ?? 0),
      items_placed: results.items_placed ?? placements.length,
      items_total: results.items_total ?? placements.length,
    },
    visualization_base64: apiResponse.visualization_base64 || apiResponse.image_base64,
  };
}

export async function runOptimization(
  items: PackingItem[],
  truckSpec: TruckSpec,
  algorithm: Algorithm = 'simple',
): Promise<OptimizationResult> {
  // Format items for backend: map description to name
  // IMPORTANT: Convert dimensions from cm to mm for backend compatibility
  const formattedItems = items.map((item, index) => ({
    id: item.id || `item_${index}`,
    name: item.description || `Article ${index + 1}`,
    length: Math.round(item.length * 10), // cm → mm
    width: Math.round(item.width * 10),   // cm → mm
    height: Math.round(item.height * 10), // cm → mm
    weight: item.weight,
    quantity: item.quantity,
    stackable: item.stackable ?? true,
  }));
  
  console.log('[runOptimization] First item dimensions (mm):', formattedItems[0]);

  // Remove 'name' from truckSpec for backend compatibility
  const { name, ...truckWithoutName } = truckSpec;

  // Backend only accepts 'genetic' or 'simple'
  const backendAlgorithm = algorithm === 'simple' ? 'simple' : 'genetic';

  const requestBody = {
    items: formattedItems,
    truck: truckWithoutName,
    algorithm: backendAlgorithm,
  };

  // Debug logs
  console.log('[runOptimization] Truck spec:', JSON.stringify(truckWithoutName, null, 2));
  console.log('[runOptimization] Items count:', formattedItems.length);
  console.log('[runOptimization] Algorithm:', backendAlgorithm);

  try {
    const apiResponse = await callOptimizationProxy('optimize', requestBody);
    console.log('[runOptimization] Response received');
    return normalizeOptimizationResult(apiResponse);
  } catch (error) {
    console.error('[runOptimization] Proxy failed, trying direct:', error);

    // Fallback to direct API call
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000);

    try {
      const response = await fetch(`${RAILWAY_API_URL}/api/optimization/optimize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Erreur lors de l'optimisation");
      }

      const apiResponse = await response.json();
      return normalizeOptimizationResult(apiResponse);
    } catch (fallbackError) {
      clearTimeout(timeoutId);
      if (fallbackError instanceof Error && fallbackError.name === 'AbortError') {
        throw new Error("L'optimisation a pris trop de temps. Essayez l'algorithme rapide.");
      }
      throw error; // Throw original proxy error
    }
  }
}

export async function getVisualization(
  placements: OptimizationResult['placements'],
  truckSpec: TruckSpec,
): Promise<string> {
  const requestBody = {
    placements,
    truck: (({ name, ...rest }) => rest)(truckSpec),
  };

  try {
    const data = await callOptimizationProxy('visualize', requestBody);
    return data.image_base64 || data.visualization_base64;
  } catch (error) {
    console.error('[getVisualization] Proxy failed, trying direct:', error);

    const response = await fetch(`${RAILWAY_API_URL}/api/optimization/visualize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error('Erreur lors de la génération de la visualisation');
    }

    const data = await response.json();
    return data.image_base64 || data.visualization_base64;
  }
}

// Virtual truck spec for exceptional convoy (not in Railway API)
// NOTE: This API expresses dimensions in centimeters (e.g. semi_plateau_32t length=1360 => 13.6m).
const CONVOI_MODULAR_SPEC = {
  id: 'convoi_modular',
  length: 1500, // 15m
  width: 300, // 3m
  height: 400, // 4m
  max_weight: 100000, // 100 tonnes
};

// Suggest optimal fleet configuration with 3D placements
export async function suggestFleet(
  items: PackingItem[],
  distanceKm: number = 100,
  availableTrucks: string[] = ['van_3t', 'truck_19t', 'truck_26t', 'truck_40t'],
): Promise<FleetSuggestionResult> {
  // Format items for backend: map description to name
  // IMPORTANT: Convert dimensions from cm to mm for backend compatibility
  const formattedItems = items.map((item, index) => ({
    id: item.id || `item_${index}`,
    name: item.description || `Article ${index + 1}`,
    length: Math.round(item.length * 10), // cm → mm
    width: Math.round(item.width * 10),   // cm → mm
    height: Math.round(item.height * 10), // cm → mm
    weight: item.weight,
    quantity: item.quantity,
    stackable: item.stackable ?? true,
  }));

  console.log('[suggestFleet] First item dimensions (mm):', formattedItems[0]);

  // Detect if exceptional transport is needed (item > 50T or height > 350cm)
  const needsConvoiModular = items.some(item => 
    item.weight > 50000 ||      // > 50 tonnes
    item.height > 350 ||        // > 3.5m (dimensions in cm)
    item.length > 1500 ||       // > 15m
    item.width > 300            // > 3m
  );

  if (needsConvoiModular) {
    console.log('[suggestFleet] Convoi modulaire requis - article hors gabarit détecté');
  }

  // IMPORTANT: backend expects available_trucks as OBJECTS (not strings)
  const specs = await getTruckSpecs();
  let availableTruckObjects = availableTrucks
    .map((truckId) => TRUCK_ID_ALIASES[truckId] || truckId)
    .map((truckId) => {
      const spec = specs.find((s) => s.name === truckId);
      if (!spec) return null;
      return {
        id: truckId,
        length: spec.length,
        width: spec.width,
        height: spec.height,
        max_weight: spec.max_weight,
      };
    })
    .filter(Boolean) as any[];

  // ============= INTELLIGENT FILTERING =============
  // For heavy loads (> 50T), exclude small trucks that would require too many units
  const totalWeight = items.reduce((sum, i) => sum + i.weight * i.quantity, 0);
  if (totalWeight > 50000) {
    const beforeCount = availableTruckObjects.length;
    availableTruckObjects = availableTruckObjects.filter(t => 
      !['van_3t', 'porteur_19t'].includes(t.id)
    );
    console.log(`[suggestFleet] Petits camions exclus (charge > 50T): ${beforeCount} → ${availableTruckObjects.length}`);
  }

  // Filter trucks that cannot physically fit the largest item
  availableTruckObjects = filterCompatibleTrucks(items, availableTruckObjects);

  // Inject virtual convoi_modular + reduce the search space for exceptional transport
  if (needsConvoiModular) {
    const hasConvoi = availableTruckObjects.some((t) => t.id === 'convoi_modular');
    if (!hasConvoi) {
      availableTruckObjects.push(CONVOI_MODULAR_SPEC);
      console.log('[suggestFleet] Convoi modulaire injecté (100T, 15m x 3m x 4m)');
    }

    // Keep only relevant heavy trucks to avoid combinatorial explosion
    const heavyTruckIds = new Set([
      'semi_plateau_32t',
      'lowbed_2ess_50t',
      'lowbed_3ess_60t',
      'lowbed_4ess_80t',
      'convoi_modular',
    ]);

    availableTruckObjects = availableTruckObjects.filter((t) => heavyTruckIds.has(t.id));
    console.log('[suggestFleet] Camions filtrés (transport exceptionnel):', availableTruckObjects.map((t) => t.id));
  }

  if (availableTruckObjects.length === 0) {
    throw new Error('Aucun camion disponible (types inconnus).');
  }

  const requestBody = {
    items: formattedItems,
    distance_km: distanceKm,
    available_trucks: availableTruckObjects,
    run_3d: false,
    algorithm: 'simple',
  };

  // Debug logs
  console.log('[suggestFleet] Items count:', formattedItems.length);
  console.log(
    '[suggestFleet] Total weight:',
    formattedItems.reduce((sum, i) => sum + i.weight * i.quantity, 0),
    'kg',
  );

  try {
    const data = await callOptimizationProxy('suggest-fleet', requestBody);
    console.log('[suggestFleet] Response received, scenarios:', data.scenarios?.length || 0);

    return parseFleetResponse(data, items.length);
  } catch (error) {
    console.error('[suggestFleet] Proxy failed, trying direct:', error);

    // Fallback to direct API call
    const response = await fetch(`${RAILWAY_API_URL}/api/optimization/suggest-fleet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        ...requestBody,
        // For the direct call, keep the format consistent
        available_trucks: availableTruckObjects,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || 'Erreur lors de la suggestion de flotte');
    }

    const data = await response.json();
    return parseFleetResponse(data, items.length);
  }
}

// Helper to parse fleet response
function parseFleetResponse(data: any, itemsCount: number): FleetSuggestionResult {
  const scenariosRaw = data.scenarios || [];

  const scenarios = scenariosRaw.map((s: any) => {
    const trucksRaw = s.trucks || [];

    return {
      name: s.name || 'Scénario',
      description: s.description || '',
      trucks: trucksRaw.map((t: any) => {
        const truckType = t.truck_type || t.type || t.truck_specs?.id || 'unknown';
        const items = t.items || [];
        const placements = t.placements || [];

        // If the backend returns per-truck entries (truck_specs/items/placements),
        // convert them into our trucks_details format.
        const trucksDetails = t.trucks_details ||
          (t.truck_specs
            ? [
                {
                  type: truckType,
                  items: items.map((it: any) => ({
                    id: String(it.reference ?? it.id ?? ''),
                    name: String(it.description ?? it.name ?? it.reference ?? it.id ?? ''),
                    length: it.length ?? 0,
                    width: it.width ?? 0,
                    height: it.height ?? 0,
                    weight: it.weight ?? 0,
                    quantity: it.quantity ?? 1,
                  })),
                  volume_capacity: t.truck_specs.volume_m3 ?? t.truck_specs.volume_capacity ?? 0,
                  weight_capacity: t.truck_specs.max_weight ?? t.truck_specs.weight_capacity ?? 0,
                  placements: placements.map((p: any, idx: number) => ({
                    item_id: p.item_id || p.reference || p.id || `item_${idx}`,
                    truck_index: p.truck_index ?? 0,
                    position: {
                      x: p.x ?? p.position?.x ?? 0,
                      y: p.y ?? p.position?.y ?? 0,
                      z: p.z ?? p.position?.z ?? 0,
                    },
                    dimensions: {
                      length: p.length ?? p.dimensions?.length ?? 0,
                      width: p.width ?? p.dimensions?.width ?? 0,
                      height: p.height ?? p.dimensions?.height ?? 0,
                    },
                    rotated: p.rotation !== 0 || p.rotated || false,
                  })),
                },
              ]
            : undefined);

        return {
          truck_type: truckType,
          count: t.count || (t.trucks_details?.length ?? 1) || 1,
          fill_rate: percentToRatio(
            t.fill_rate ?? t.volume_efficiency ?? t.metrics?.fill_volume_pct ?? t.loading_result?.volume_efficiency ?? 0,
          ),
          weight_utilization: percentToRatio(
            t.weight_utilization ?? t.weight_efficiency ?? t.metrics?.fill_weight_pct ?? t.loading_result?.weight_efficiency ?? 0,
          ),
          items_assigned: t.items_assigned ?? t.items_count ?? items.length ?? 0,
          trucks_details: trucksDetails,
        };
      }),
      total_cost: s.total_cost ?? s.total_cost_fcfa ?? 0,
      total_trucks: s.total_trucks ?? trucksRaw.length ?? 0,
      is_recommended: s.is_recommended ?? s.recommended ?? false,
    };
  });

  const recommendedScenario =
    data.recommended_scenario ||
    data.recommended ||
    scenariosRaw.find((s: any) => s.recommended || s.is_recommended)?.id ||
    scenariosRaw[0]?.id ||
    '';

  const primaryStats = scenariosRaw[0]?.statistics || data.statistics || {};

  return {
    scenarios,
    recommended_scenario: recommendedScenario,
    total_weight: data.total_weight ?? primaryStats.total_weight ?? 0,
    total_volume: data.total_volume ?? primaryStats.total_volume_m3 ?? 0,
    items_count: data.items_count ?? primaryStats.total_items ?? itemsCount,
  };
}
