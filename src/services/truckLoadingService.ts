import { PackingItem, TruckSpec, OptimizationResult, Algorithm, FleetSuggestionResult } from '@/types/truckLoading';

const API_URL = import.meta.env.VITE_TRUCK_LOADING_API_URL || 'https://web-production-8afea.up.railway.app';

export interface AIExtractionResult {
  items: PackingItem[];
  document_type: 'packing_list' | 'invoice' | 'mixed' | 'unknown';
  sheets_analyzed: string[];
  warnings: string[];
  total_items: number;
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
  const response = await fetch(`${API_URL}/api/optimization/truck-specs`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error('Erreur lors de la récupération des spécifications camions');
  }

  const data = await response.json();

  // Parser le format { presets: { truck_name: specs } }
  if (data.presets) {
    return Object.entries(data.presets).map(([name, spec]) => ({
      name,
      ...(spec as Omit<TruckSpec, 'name'>)
    }));
  }

  return data;
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
  algorithm: Algorithm
): Promise<OptimizationResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minutes timeout

  try {
    const response = await fetch(`${API_URL}/api/optimization/optimize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items,
        truck: (({ name, ...rest }) => rest)(truckSpec),
        algorithm,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || 'Erreur lors de l\'optimisation');
    }

    const apiResponse = await response.json();
    return normalizeOptimizationResult(apiResponse);
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('L\'optimisation a pris trop de temps. Essayez l\'algorithme rapide.');
    }
    throw error;
  }
}

export async function getVisualization(
  placements: OptimizationResult['placements'],
  truckSpec: TruckSpec
): Promise<string> {
  const response = await fetch(`${API_URL}/api/optimization/visualize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      placements,
      truck: (({ name, ...rest }) => rest)(truckSpec),
    }),
  });

  if (!response.ok) {
    throw new Error('Erreur lors de la génération de la visualisation');
  }

  const data = await response.json();
  return data.image_base64 || data.visualization_base64;
}

// Suggest optimal fleet configuration
export async function suggestFleet(
  items: PackingItem[],
  distanceKm: number = 100,
  availableTrucks: string[] = ['van_3t5', 'truck_19t', 'truck_26t', 'truck_40t']
): Promise<FleetSuggestionResult> {
  const url = `${API_URL}/api/optimization/suggest-fleet`;
  
  // Format items for backend: map description to name
  const formattedItems = items.map((item, index) => ({
    id: item.id || `item_${index}`,
    name: item.description || `Article ${index + 1}`,
    length: item.length,
    width: item.width,
    height: item.height,
    weight: item.weight,
    quantity: item.quantity,
  }));

  const requestBody = {
    items: formattedItems,
    distance_km: distanceKm,
    available_trucks: availableTrucks,
  };

  // Debug logs
  console.log('[suggestFleet] URL:', url);
  console.log('[suggestFleet] Request body:', JSON.stringify(requestBody, null, 2));
  console.log('[suggestFleet] Items count:', formattedItems.length);
  console.log('[suggestFleet] Total weight:', formattedItems.reduce((sum, i) => sum + (i.weight * i.quantity), 0), 'kg');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    console.log('[suggestFleet] Response status:', response.status);
    console.log('[suggestFleet] Response ok:', response.ok);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[suggestFleet] Error response:', errorText);
      let errorMessage = 'Erreur lors de la suggestion de flotte';
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch {
        errorMessage = errorText || errorMessage;
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    console.log('[suggestFleet] Response data:', JSON.stringify(data, null, 2));
    
    // Normalize API response to our types
    const scenarios = (data.scenarios || []).map((s: any) => ({
      name: s.name || 'Scénario',
      description: s.description || '',
      trucks: (s.trucks || []).map((t: any) => ({
        truck_type: t.truck_type || t.type || 'unknown',
        count: t.count || 1,
        fill_rate: t.fill_rate ?? t.volume_efficiency ?? 0,
        weight_utilization: t.weight_utilization ?? t.weight_efficiency ?? 0,
        items_assigned: t.items_assigned ?? t.items_count ?? 0,
      })),
      total_cost: s.total_cost ?? 0,
      total_trucks: s.total_trucks ?? s.trucks?.length ?? 0,
      is_recommended: s.is_recommended ?? s.recommended ?? false,
    }));

    console.log('[suggestFleet] Parsed scenarios:', scenarios.length);

    return {
      scenarios,
      recommended_scenario: data.recommended_scenario || data.recommended || '',
      total_weight: data.total_weight ?? 0,
      total_volume: data.total_volume ?? 0,
      items_count: data.items_count ?? items.length,
    };
  } catch (error) {
    console.error('[suggestFleet] Fetch error:', error);
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      throw new Error('Impossible de contacter le serveur d\'optimisation. Vérifiez votre connexion ou réessayez plus tard.');
    }
    throw error;
  }
}
