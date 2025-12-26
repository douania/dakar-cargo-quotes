import { useMemo } from 'react';

// Types for SODATRA fee suggestions
export interface FeeCalculationParams {
  transport_mode: 'air' | 'maritime' | 'road' | 'multimodal' | 'unknown';
  cargo_value_caf?: number;        // Valeur CAF en FCFA
  weight_kg?: number;
  volume_cbm?: number;
  container_types?: string[];      // ['20DV', '40HC']
  container_count?: number;
  is_exempt_project?: boolean;
  is_dangerous?: boolean;
  is_oog?: boolean;
  is_reefer?: boolean;
  destination_zone?: 'dakar' | 'banlieue' | 'region' | 'mali' | 'transit';
  services_requested?: string[];
  incoterm?: string;
}

export interface SuggestedFee {
  key: string;
  label: string;
  suggested_amount: number;
  min_amount: number;
  max_amount: number;
  unit: string;
  formula: string;
  is_percentage?: boolean;
  percentage_base?: string;
  is_editable: boolean;
  factors_applied: string[];
}

export interface SodatraFeeSuggestion {
  fees: SuggestedFee[];
  total_suggested: number;
  complexity_factor: number;
  complexity_reasons: string[];
  transport_mode: string;
  can_calculate_commission: boolean;
  commission_note?: string;
}

// Base fee configurations
const BASE_FEES = {
  // Dédouanement (customs clearance)
  dedouanement: {
    air: { base: 100000, min: 75000, max: 350000 },
    maritime_conteneur: { base: 150000, min: 120000, max: 400000 },
    maritime_vehicule: { base: 120000, min: 100000, max: 250000 },
    road: { base: 80000, min: 60000, max: 200000 },
    transit: { base: 180000, min: 150000, max: 500000 },  // Mali/Transit
  },
  // Suivi opérationnel
  suivi_operationnel: {
    base: 35000,
    per_container: 25000,
    min: 35000,
    max: 150000,
  },
  // Ouverture dossier
  ouverture_dossier: {
    base: 25000,
    min: 20000,
    max: 35000,
  },
  // Frais documentaires
  frais_documentaires: {
    per_document: 15000,
    min: 15000,
    max: 60000,
  },
  // Commission débours (percentage)
  commission_debours: {
    percentage: 5,
    min: 25000,
    max: null, // Unlimited
  },
};

// Complexity multipliers based on learned patterns from 2HL/Taleb
const COMPLEXITY_FACTORS = {
  exempt_project: { factor: 0.30, label: 'Projet exonéré (+30%)' },
  dangerous_goods: { factor: 0.50, label: 'Marchandises dangereuses (+50%)' },
  oog_cargo: { factor: 0.40, label: 'Hors gabarit/OOG (+40%)' },
  reefer: { factor: 0.25, label: 'Conteneur frigorifique (+25%)' },
  transit_mali: { factor: 0.35, label: 'Transit Mali (+35%)' },
  transit_other: { factor: 0.25, label: 'Transit autres pays (+25%)' },
  high_value: { factor: 0.20, label: 'Valeur élevée > 100M FCFA (+20%)' },
  heavy_cargo: { factor: 0.15, label: 'Cargo lourd > 20T (+15%)' },
  multiple_containers: { factor: 0.10, label: 'Multi-conteneurs (+10%)' },
};

// Zone multipliers
const ZONE_MULTIPLIERS: Record<string, number> = {
  dakar: 1.0,
  banlieue: 1.1,
  region: 1.25,
  mali: 1.5,
  transit: 1.4,
};

function calculateComplexityFactor(params: FeeCalculationParams): { factor: number; reasons: string[] } {
  let factor = 1.0;
  const reasons: string[] = [];

  if (params.is_exempt_project) {
    factor += COMPLEXITY_FACTORS.exempt_project.factor;
    reasons.push(COMPLEXITY_FACTORS.exempt_project.label);
  }

  if (params.is_dangerous) {
    factor += COMPLEXITY_FACTORS.dangerous_goods.factor;
    reasons.push(COMPLEXITY_FACTORS.dangerous_goods.label);
  }

  if (params.is_oog) {
    factor += COMPLEXITY_FACTORS.oog_cargo.factor;
    reasons.push(COMPLEXITY_FACTORS.oog_cargo.label);
  }

  if (params.is_reefer) {
    factor += COMPLEXITY_FACTORS.reefer.factor;
    reasons.push(COMPLEXITY_FACTORS.reefer.label);
  }

  // Zone-based complexity
  if (params.destination_zone === 'mali') {
    factor += COMPLEXITY_FACTORS.transit_mali.factor;
    reasons.push(COMPLEXITY_FACTORS.transit_mali.label);
  } else if (params.destination_zone === 'transit') {
    factor += COMPLEXITY_FACTORS.transit_other.factor;
    reasons.push(COMPLEXITY_FACTORS.transit_other.label);
  }

  // Value-based complexity
  if (params.cargo_value_caf && params.cargo_value_caf > 100000000) {
    factor += COMPLEXITY_FACTORS.high_value.factor;
    reasons.push(COMPLEXITY_FACTORS.high_value.label);
  }

  // Weight-based complexity
  if (params.weight_kg && params.weight_kg > 20000) {
    factor += COMPLEXITY_FACTORS.heavy_cargo.factor;
    reasons.push(COMPLEXITY_FACTORS.heavy_cargo.label);
  }

  // Multiple containers
  if (params.container_count && params.container_count > 2) {
    factor += COMPLEXITY_FACTORS.multiple_containers.factor;
    reasons.push(COMPLEXITY_FACTORS.multiple_containers.label);
  }

  return { factor, reasons };
}

function getDestinationZone(destination?: string): 'dakar' | 'banlieue' | 'region' | 'mali' | 'transit' {
  if (!destination) return 'dakar';
  
  const destLower = destination.toLowerCase();
  
  if (destLower.includes('mali') || destLower.includes('bamako')) return 'mali';
  if (destLower.includes('burkina') || destLower.includes('niger') || destLower.includes('guinée')) return 'transit';
  if (destLower.includes('thies') || destLower.includes('kaolack') || destLower.includes('saint-louis') || 
      destLower.includes('ziguinchor') || destLower.includes('diourbel')) return 'region';
  if (destLower.includes('pikine') || destLower.includes('guediawaye') || destLower.includes('rufisque') ||
      destLower.includes('diamniadio')) return 'banlieue';
  
  return 'dakar';
}

function roundToNearest5000(amount: number): number {
  return Math.round(amount / 5000) * 5000;
}

export function calculateSodatraFees(params: FeeCalculationParams): SodatraFeeSuggestion {
  const fees: SuggestedFee[] = [];
  const { factor: complexityFactor, reasons: complexityReasons } = calculateComplexityFactor(params);
  
  // Determine destination zone
  const zone = params.destination_zone || getDestinationZone(undefined);
  const zoneMultiplier = ZONE_MULTIPLIERS[zone] || 1.0;
  
  // Get container count
  const containerCount = params.container_count || params.container_types?.length || 1;
  
  // 1. Dédouanement
  let dedouanementBase: typeof BASE_FEES.dedouanement[keyof typeof BASE_FEES.dedouanement];
  let dedouanementLabel = 'Honoraires dédouanement';
  
  if (zone === 'mali' || zone === 'transit') {
    dedouanementBase = BASE_FEES.dedouanement.transit;
    dedouanementLabel = 'Honoraires dédouanement transit';
  } else if (params.transport_mode === 'air') {
    dedouanementBase = BASE_FEES.dedouanement.air;
    dedouanementLabel = 'Honoraires dédouanement aérien';
  } else if (params.transport_mode === 'maritime') {
    // Check for vehicle
    const hasVehicle = params.container_types?.some(t => 
      t.toLowerCase().includes('roro') || t.toLowerCase().includes('vehicle')
    );
    dedouanementBase = hasVehicle 
      ? BASE_FEES.dedouanement.maritime_vehicule 
      : BASE_FEES.dedouanement.maritime_conteneur;
    dedouanementLabel = hasVehicle 
      ? 'Honoraires dédouanement véhicule' 
      : 'Honoraires dédouanement maritime';
  } else {
    dedouanementBase = BASE_FEES.dedouanement.air; // Default to air for unknown
  }
  
  // Apply volume factor for maritime
  let volumeFactor = 1.0;
  if (params.volume_cbm && params.volume_cbm > 30) {
    volumeFactor = 1 + (params.volume_cbm - 30) * 0.01; // +1% per m³ above 30
    volumeFactor = Math.min(volumeFactor, 1.5); // Cap at 1.5x
  }
  
  const dedouanementAmount = roundToNearest5000(
    dedouanementBase.base * complexityFactor * zoneMultiplier * volumeFactor
  );
  
  fees.push({
    key: 'dedouanement',
    label: dedouanementLabel,
    suggested_amount: Math.min(Math.max(dedouanementAmount, dedouanementBase.min), dedouanementBase.max),
    min_amount: dedouanementBase.min,
    max_amount: dedouanementBase.max,
    unit: 'dossier',
    formula: `Base ${dedouanementBase.base.toLocaleString('fr-FR')} × ${complexityFactor.toFixed(2)} (complexité) × ${zoneMultiplier.toFixed(2)} (zone)`,
    is_editable: true,
    factors_applied: complexityReasons.length > 0 ? complexityReasons : ['Standard'],
  });
  
  // 2. Suivi opérationnel
  const suiviBase = params.transport_mode === 'maritime' && containerCount > 1
    ? BASE_FEES.suivi_operationnel.base + ((containerCount - 1) * BASE_FEES.suivi_operationnel.per_container)
    : BASE_FEES.suivi_operationnel.base;
  
  const suiviAmount = roundToNearest5000(suiviBase * zoneMultiplier);
  
  fees.push({
    key: 'suivi_operationnel',
    label: 'Suivi opérationnel',
    suggested_amount: Math.min(Math.max(suiviAmount, BASE_FEES.suivi_operationnel.min), BASE_FEES.suivi_operationnel.max),
    min_amount: BASE_FEES.suivi_operationnel.min,
    max_amount: BASE_FEES.suivi_operationnel.max,
    unit: containerCount > 1 ? `${containerCount} conteneurs` : 'dossier',
    formula: containerCount > 1 
      ? `Base ${BASE_FEES.suivi_operationnel.base.toLocaleString('fr-FR')} + ${containerCount - 1} × ${BASE_FEES.suivi_operationnel.per_container.toLocaleString('fr-FR')}`
      : `Forfait ${BASE_FEES.suivi_operationnel.base.toLocaleString('fr-FR')}`,
    is_editable: true,
    factors_applied: containerCount > 1 ? [`Multi-conteneurs (${containerCount})`] : ['Forfait standard'],
  });
  
  // 3. Ouverture dossier
  fees.push({
    key: 'ouverture_dossier',
    label: 'Ouverture dossier',
    suggested_amount: BASE_FEES.ouverture_dossier.base,
    min_amount: BASE_FEES.ouverture_dossier.min,
    max_amount: BASE_FEES.ouverture_dossier.max,
    unit: 'dossier',
    formula: `Forfait fixe ${BASE_FEES.ouverture_dossier.base.toLocaleString('fr-FR')}`,
    is_editable: true,
    factors_applied: ['Forfait standard'],
  });
  
  // 4. Frais documentaires
  // Count documents based on transport mode
  let docCount = 1; // Minimum 1 (main doc)
  if (params.transport_mode === 'air') {
    docCount = 2; // AWB + ECTN
  } else if (params.transport_mode === 'maritime') {
    docCount = 2; // B/L + ECTN
  }
  if (params.is_exempt_project) {
    docCount += 1; // Additional certification
  }
  
  const fraisDocsAmount = roundToNearest5000(
    BASE_FEES.frais_documentaires.per_document * docCount
  );
  
  fees.push({
    key: 'frais_documentaires',
    label: 'Frais documentaires',
    suggested_amount: Math.min(Math.max(fraisDocsAmount, BASE_FEES.frais_documentaires.min), BASE_FEES.frais_documentaires.max),
    min_amount: BASE_FEES.frais_documentaires.min,
    max_amount: BASE_FEES.frais_documentaires.max,
    unit: `${docCount} documents`,
    formula: `${docCount} × ${BASE_FEES.frais_documentaires.per_document.toLocaleString('fr-FR')} FCFA`,
    is_editable: true,
    factors_applied: [`${docCount} documents (${params.transport_mode === 'air' ? 'LTA, ECTN' : 'B/L, ECTN'})`],
  });
  
  // 5. Commission sur débours (if CAF value available)
  const canCalculateCommission = Boolean(params.cargo_value_caf);
  let commissionNote: string | undefined;
  
  if (canCalculateCommission && params.cargo_value_caf) {
    // Estimate D&T at ~25% for standard import
    const estimatedDandT = params.cargo_value_caf * 0.25;
    const commissionAmount = Math.max(
      estimatedDandT * (BASE_FEES.commission_debours.percentage / 100),
      BASE_FEES.commission_debours.min
    );
    
    fees.push({
      key: 'commission_debours',
      label: `Commission débours (${BASE_FEES.commission_debours.percentage}%)`,
      suggested_amount: roundToNearest5000(commissionAmount),
      min_amount: BASE_FEES.commission_debours.min,
      max_amount: 9999999999, // No max
      unit: 'sur D&T',
      formula: `${BASE_FEES.commission_debours.percentage}% des débours douaniers (D&T estimés: ${estimatedDandT.toLocaleString('fr-FR')} FCFA)`,
      is_percentage: true,
      percentage_base: 'debours_douaniers',
      is_editable: true,
      factors_applied: [`Valeur CAF: ${params.cargo_value_caf.toLocaleString('fr-FR')} FCFA`],
    });
  } else {
    commissionNote = 'Commission débours: 5% des D&T (à calculer sur factures commerciales)';
  }
  
  // Calculate total
  const totalSuggested = fees.reduce((sum, fee) => sum + fee.suggested_amount, 0);
  
  return {
    fees,
    total_suggested: totalSuggested,
    complexity_factor: complexityFactor,
    complexity_reasons: complexityReasons,
    transport_mode: params.transport_mode,
    can_calculate_commission: canCalculateCommission,
    commission_note: commissionNote,
  };
}

// Hook version for React components
export function useSodatraFees(params: FeeCalculationParams | null): SodatraFeeSuggestion | null {
  return useMemo(() => {
    if (!params) return null;
    return calculateSodatraFees(params);
  }, [
    params?.transport_mode,
    params?.cargo_value_caf,
    params?.weight_kg,
    params?.volume_cbm,
    params?.container_count,
    params?.is_exempt_project,
    params?.is_dangerous,
    params?.is_oog,
    params?.is_reefer,
    params?.destination_zone,
  ]);
}
