/**
 * ================== MODULE DE CONVERSION D'UNITÉS ==================
 * 
 * Ce module centralise TOUTES les conversions d'unités pour l'application.
 * 
 * CONVENTION INTERNE : Le CENTIMÈTRE (cm) est l'unité standard.
 * - Toutes les dimensions internes (PackingItem, UI) sont en cm
 * - Les conversions se font UNIQUEMENT aux frontières du système
 * 
 * FRONTIÈRES :
 * 1. Import packing list → cm (edge function parse-packing-list)
 * 2. Frontend → Railway API : cm → mm (prepareItemsForAPI)
 * 3. Railway API → Frontend : mm → cm (normalizeFromAPI)
 * 4. Frontend → Three.js : cm → mètres (cmToMeters)
 * 
 * ==================================================================
 */

// Types d'unités supportées
export type DimensionUnit = 'mm' | 'cm' | 'm' | 'inch' | 'ft' | 'unknown';

// Facteurs de conversion VERS centimètres
const TO_CM_FACTORS: Record<DimensionUnit, number> = {
  mm: 0.1,      // 1 mm = 0.1 cm
  cm: 1,        // 1 cm = 1 cm
  m: 100,       // 1 m = 100 cm
  inch: 2.54,   // 1 inch = 2.54 cm
  ft: 30.48,    // 1 ft = 30.48 cm
  unknown: 1,   // Assume cm if unknown
};

// Labels pour l'UI
export const UNIT_LABELS: Record<DimensionUnit, string> = {
  mm: 'millimètres',
  cm: 'centimètres',
  m: 'mètres',
  inch: 'pouces',
  ft: 'pieds',
  unknown: 'inconnue',
};

/**
 * Convertit une valeur vers CENTIMÈTRES (unité standard interne)
 * À utiliser lors de l'import de données externes
 */
export function toCentimeters(value: number, unit: DimensionUnit): number {
  const result = Math.round(value * TO_CM_FACTORS[unit] * 100) / 100;
  if (import.meta.env.DEV) {
    console.log(`[UNITS] toCm: ${value} ${unit} → ${result} cm`);
  }
  return result;
}

/**
 * Convertit depuis CENTIMÈTRES vers une autre unité
 * À utiliser pour l'affichage ou l'export
 */
export function fromCentimeters(valueCm: number, targetUnit: DimensionUnit): number {
  const result = Math.round(valueCm / TO_CM_FACTORS[targetUnit] * 100) / 100;
  return result;
}

/**
 * Convertit CENTIMÈTRES vers MILLIMÈTRES
 * À utiliser pour envoyer à l'API Railway
 */
export function cmToMm(valueCm: number): number {
  const result = Math.round(valueCm * 10);
  return result;
}

/**
 * Convertit MILLIMÈTRES vers CENTIMÈTRES
 * À utiliser pour recevoir de l'API Railway
 */
export function mmToCm(valueMm: number): number {
  const result = Math.round(valueMm / 10 * 100) / 100;
  return result;
}

/**
 * Convertit CENTIMÈTRES vers MÈTRES
 * À utiliser pour le rendu Three.js
 */
export function cmToMeters(valueCm: number): number {
  return valueCm / 100;
}

/**
 * Convertit MÈTRES vers CENTIMÈTRES
 * À utiliser pour importer depuis Three.js
 */
export function metersToCm(valueM: number): number {
  return valueM * 100;
}

/**
 * Détection heuristique de l'unité basée sur les valeurs de dimensions
 * Utilisé en fallback quand l'unité n'est pas spécifiée dans le fichier
 */
export function detectUnitFromDimensions(
  length: number, 
  width: number, 
  height: number
): DimensionUnit {
  const maxDim = Math.max(length, width, height);
  
  // Heuristiques basées sur les dimensions typiques de colis industriels
  if (maxDim > 10000) return 'mm';      // > 10000 → très probablement mm (>100m sinon)
  if (maxDim > 1000 && maxDim <= 10000) return 'mm'; // 1000-10000 → probablement mm (1-10m)
  if (maxDim >= 100 && maxDim <= 1000) return 'cm';  // 100-1000 → probablement cm (1-10m)
  if (maxDim >= 10 && maxDim < 100) {
    // Ambigu: pourrait être cm (10-100cm) ou m (10-100m)
    // Préférer cm car plus courant pour du mobilier/équipement standard
    return 'cm';
  }
  if (maxDim < 10) return 'm';           // < 10 → probablement m
  
  return 'unknown';
}

/**
 * Valide la cohérence d'un ensemble de dimensions avec son poids
 * Retourne des warnings si les valeurs semblent incorrectes
 */
export function validateDimensionsWithWeight(
  lengthCm: number,
  widthCm: number,
  heightCm: number,
  weightKg: number
): string[] {
  const warnings: string[] = [];
  
  // Volume en m³
  const volumeM3 = (lengthCm * widthCm * heightCm) / 1_000_000;
  
  if (volumeM3 <= 0) {
    warnings.push('Volume calculé nul ou négatif');
    return warnings;
  }
  
  // Densité en kg/m³
  const density = weightKg / volumeM3;
  
  // Densités de référence:
  // - Air: ~1.2 kg/m³
  // - Eau: 1000 kg/m³
  // - Acier: ~7800 kg/m³
  // - Polystyrène: ~25-200 kg/m³
  // - Bois: ~400-900 kg/m³
  // - Équipement industriel: ~500-3000 kg/m³
  
  if (density < 10) {
    warnings.push(`Densité très faible (${density.toFixed(0)} kg/m³) - vérifier les dimensions ou le poids`);
  }
  if (density > 8000) {
    warnings.push(`Densité très élevée (${density.toFixed(0)} kg/m³) - possible erreur d'unité`);
  }
  
  // Vérifier les dimensions extrêmes (> 20m en une dimension)
  if (lengthCm > 2000 || widthCm > 2000 || heightCm > 2000) {
    const maxM = Math.max(lengthCm, widthCm, heightCm) / 100;
    warnings.push(`Dimension > 20m détectée (${maxM.toFixed(1)}m) - transport exceptionnel requis`);
  }
  
  return warnings;
}

/**
 * Prépare un tableau d'items (en cm) pour l'envoi à l'API Railway (en mm)
 * Fonction de commodité pour la conversion groupée
 */
export function prepareItemsForRailwayAPI(items: Array<{
  id: string;
  description?: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  quantity: number;
  stackable?: boolean;
}>): Array<{
  id: string;
  name: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  quantity: number;
  stackable: boolean;
}> {
  return items.map((item, index) => {
    const result = {
      id: item.id || `item_${index}`,
      name: item.description || `Article ${index + 1}`,
      // CONVERSION EXPLICITE : cm → mm pour Railway
      length: cmToMm(item.length),
      width: cmToMm(item.width),
      height: cmToMm(item.height),
      weight: item.weight,
      quantity: item.quantity,
      stackable: item.stackable ?? true,
    };
    
    if (import.meta.env.DEV && index === 0) {
      console.log(`[UNITS] prepareItemsForRailwayAPI: Item 0 - ${item.length}cm → ${result.length}mm`);
    }
    
    return result;
  });
}

/**
 * Normalise un placement reçu de l'API Railway (mm) vers le format interne (cm)
 */
export function normalizeRailwayPlacement(placement: {
  item_id?: string;
  truck_index?: number;
  x?: number;
  y?: number;
  z?: number;
  position?: { x?: number; y?: number; z?: number };
  length?: number;
  width?: number;
  height?: number;
  rotation?: number;
  rotated?: boolean;
}, index: number): {
  item_id: string;
  truck_index: number;
  position: { x: number; y: number; z: number };
  dimensions?: { length: number; width: number; height: number };
  rotated: boolean;
} {
  // L'API Railway retourne TOUT en mm
  // CONVERSION EXPLICITE : mm → cm pour le frontend
  const posX = placement.x ?? placement.position?.x ?? 0;
  const posY = placement.y ?? placement.position?.y ?? 0;
  const posZ = placement.z ?? placement.position?.z ?? 0;
  
  const result = {
    item_id: placement.item_id || `item_${index}`,
    truck_index: placement.truck_index ?? 0,
    position: {
      x: mmToCm(posX),
      y: mmToCm(posY),
      z: mmToCm(posZ),
    },
    dimensions: (placement.length && placement.width && placement.height) ? {
      length: mmToCm(placement.length),
      width: mmToCm(placement.width),
      height: mmToCm(placement.height),
    } : undefined,
    rotated: placement.rotation !== 0 || placement.rotated || false,
  };
  
  if (import.meta.env.DEV && index === 0) {
    console.log(`[UNITS] normalizeRailwayPlacement: Item 0 - pos ${posX}mm → ${result.position.x}cm`);
  }
  
  return result;
}
