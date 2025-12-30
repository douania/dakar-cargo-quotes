import { PackingItem, TruckSpec, OptimizationResult, Algorithm } from '@/types/truckLoading';
import { supabase } from '@/integrations/supabase/client';

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
