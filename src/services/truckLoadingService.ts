import { PackingItem, TruckSpec, OptimizationResult, Algorithm, FleetSuggestionResult } from '@/types/truckLoading';
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

const TRUCK_ID_ALIASES: Record<string, string> = {
  van_3t5: 'van_3t',
};

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
  const formattedItems = items.map((item, index) => ({
    id: item.id || `item_${index}`,
    name: item.description || `Article ${index + 1}`,
    length: item.length,
    width: item.width,
    height: item.height,
    weight: item.weight,
    quantity: item.quantity,
    stackable: item.stackable ?? true,
  }));

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
    const timeoutId = setTimeout(() => controller.abort(), 120000);

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

// Suggest optimal fleet configuration with 3D placements
export async function suggestFleet(
  items: PackingItem[],
  distanceKm: number = 100,
  availableTrucks: string[] = ['van_3t', 'truck_19t', 'truck_26t', 'truck_40t'],
): Promise<FleetSuggestionResult> {
  // Format items for backend: map description to name
  const formattedItems = items.map((item, index) => ({
    id: item.id || `item_${index}`,
    name: item.description || `Article ${index + 1}`,
    length: item.length,
    width: item.width,
    height: item.height,
    weight: item.weight,
    quantity: item.quantity,
    stackable: item.stackable ?? true,
  }));

  // IMPORTANT: backend expects available_trucks as OBJECTS (not strings)
  const specs = await getTruckSpecs();
  const availableTruckObjects = availableTrucks
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
    .filter(Boolean);

  if (availableTruckObjects.length === 0) {
    throw new Error('Aucun camion disponible (types inconnus).');
  }

  const requestBody = {
    items: formattedItems,
    distance_km: distanceKm,
    available_trucks: availableTruckObjects,
    run_3d: true,
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
