import { PackingItem, TruckSpec, OptimizationResult, Algorithm } from '@/types/truckLoading';

const API_URL = import.meta.env.VITE_TRUCK_LOADING_API_URL || 'https://web-production-8afea.up.railway.app';

export async function uploadPackingList(file: File): Promise<PackingItem[]> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_URL}/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || 'Erreur lors de l\'upload du fichier');
  }

  const data = await response.json();
  return data.items || data;
}

export async function getTruckSpecs(): Promise<TruckSpec[]> {
  const response = await fetch(`${API_URL}/trucks`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error('Erreur lors de la récupération des spécifications camions');
  }

  return response.json();
}

export async function runOptimization(
  items: PackingItem[],
  truckSpec: TruckSpec,
  algorithm: Algorithm
): Promise<OptimizationResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minutes timeout

  try {
    const response = await fetch(`${API_URL}/optimize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items,
        truck: truckSpec,
        algorithm,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || 'Erreur lors de l\'optimisation');
    }

    return response.json();
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
  const response = await fetch(`${API_URL}/visualize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      placements,
      truck: truckSpec,
    }),
  });

  if (!response.ok) {
    throw new Error('Erreur lors de la génération de la visualisation');
  }

  const data = await response.json();
  return data.image_base64 || data.visualization_base64;
}
