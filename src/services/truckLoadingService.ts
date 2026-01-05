import { PackingItem, TruckSpec, OptimizationResult, Algorithm, FleetSuggestionResult } from '@/types/truckLoading';
import { supabase } from '@/integrations/supabase/client';

const RAILWAY_API_URL = import.meta.env.VITE_TRUCK_LOADING_API_URL || 'https://web-production-8afea.up.railway.app';

export interface AIExtractionResult {
  items: PackingItem[];
  document_type: 'packing_list' | 'invoice' | 'mixed' | 'unknown';
  sheets_analyzed: string[];
  warnings: string[];
  total_items: number;
}

// Helper to call the proxy Edge Function
async function callOptimizationProxy(action: string, body?: any): Promise<any> {
  console.log(`[callOptimizationProxy] Action: ${action}`);
  
  const { data, error } = await supabase.functions.invoke('truck-optimization-proxy', {
    body: body || {},
    headers: {
      'x-action': action,
    },
  });

  // The Edge Function uses query params, so we need to call it differently
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/truck-optimization-proxy?action=${action}`,
    {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Erreur proxy (${response.status})`);
  }

  return response.json();
}

// Parse packing list with AI (via edge function)
export async function parsePackingListWithAI(file: File): Promise<AIExtractionResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-packing-list`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: formData,
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Erreur lors de l\'analyse IA du fichier');
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
    total_items: data.total_items || data.items?.length || 0
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
        ...(spec as Omit<TruckSpec, 'name'>)
      }));
    }

    // Nouveau format avec trucks array
    if (data.trucks) {
      return data.trucks.map((t: any) => ({
        name: t.name || t.id,
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
  const results = apiResponse.results || {};
  const placements = (apiResponse.placements || []).map((p: any, index: number) => ({
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
      fill_rate: results.volume_efficiency ?? results.fill_rate ?? 0,
      weight_utilization: results.weight_efficiency ?? results.weight_utilization ?? 0,
      items_placed: results.items_placed ?? placements.length,
      items_total: results.items_total ?? placements.length,
    },
    visualization_base64: apiResponse.visualization_base64 || apiResponse.image_base64,
  };
}

export async function runOptimization(
  items: PackingItem[],
  truckSpec: TruckSpec,
  algorithm: Algorithm = 'simple'
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

  // Backend only accepts 'genetic' or 'simple' - use 'genetic' for better results
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
        throw new Error(errorText || 'Erreur lors de l\'optimisation');
      }

      const apiResponse = await response.json();
      return normalizeOptimizationResult(apiResponse);
    } catch (fallbackError) {
      clearTimeout(timeoutId);
      if (fallbackError instanceof Error && fallbackError.name === 'AbortError') {
        throw new Error('L\'optimisation a pris trop de temps. Essayez l\'algorithme rapide.');
      }
      throw error; // Throw original proxy error
    }
  }
}

export async function getVisualization(
  placements: OptimizationResult['placements'],
  truckSpec: TruckSpec
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
  availableTrucks: string[] = ['van_3t', 'truck_19t', 'truck_26t', 'truck_40t']
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

  const requestBody = {
    items: formattedItems,
    distance_km: distanceKm,
    available_trucks: availableTrucks,
    run_3d: true,
    algorithm: 'simple',
  };

  // Debug logs
  console.log('[suggestFleet] Items count:', formattedItems.length);
  console.log('[suggestFleet] Total weight:', formattedItems.reduce((sum, i) => sum + (i.weight * i.quantity), 0), 'kg');

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
      body: JSON.stringify(requestBody),
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
  const scenarios = (data.scenarios || []).map((s: any) => ({
    name: s.name || 'Scénario',
    description: s.description || '',
    trucks: (s.trucks || []).map((t: any) => ({
      truck_type: t.truck_type || t.type || 'unknown',
      count: t.count || 1,
      fill_rate: t.fill_rate ?? t.volume_efficiency ?? 0,
      weight_utilization: t.weight_utilization ?? t.weight_efficiency ?? 0,
      items_assigned: t.items_assigned ?? t.items_count ?? 0,
      trucks_details: t.trucks_details || (t.placements ? [{
        type: t.truck_type || t.type || 'unknown',
        items: t.items || [],
        volume_capacity: t.volume_capacity || 0,
        weight_capacity: t.weight_capacity || 0,
        placements: (t.placements || []).map((p: any, idx: number) => ({
          item_id: p.item_id || `item_${idx}`,
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
      }] : undefined),
    })),
    total_cost: s.total_cost ?? 0,
    total_trucks: s.total_trucks ?? s.trucks?.length ?? 0,
    is_recommended: s.is_recommended ?? s.recommended ?? false,
  }));

  return {
    scenarios,
    recommended_scenario: data.recommended_scenario || data.recommended || '',
    total_weight: data.total_weight ?? 0,
    total_volume: data.total_volume ?? 0,
    items_count: data.items_count ?? itemsCount,
  };
}
