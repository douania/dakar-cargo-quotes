// =====================================================
// RÈGLES MÉTIER POUR LE SYSTÈME DE COTATION SODATRA
// =====================================================
// Ce fichier contient toutes les règles métier codifiées
// pour le calcul professionnel des cotations logistiques
// au Sénégal et en Afrique de l'Ouest.

// =====================================================
// 1. MATRICE INCOTERMS ICC 2020
// =====================================================
export interface IncotermRule {
  code: string;
  group: 'E' | 'F' | 'C' | 'D';
  sellerPays: {
    origin: boolean;
    freight: boolean;
    insurance: boolean;
    import: boolean;
    destination: boolean;
  };
  cafMethod: 'FOB_PLUS_FREIGHT' | 'INVOICE_VALUE';
  description: string;
}

export const INCOTERMS_MATRIX: Record<string, IncotermRule> = {
  'EXW': {
    code: 'EXW',
    group: 'E',
    sellerPays: { origin: true, freight: false, insurance: false, import: false, destination: false },
    cafMethod: 'FOB_PLUS_FREIGHT',
    description: 'Ex Works - Vendeur prépare, acheteur enlève'
  },
  'FCA': {
    code: 'FCA',
    group: 'F',
    sellerPays: { origin: true, freight: false, insurance: false, import: false, destination: false },
    cafMethod: 'FOB_PLUS_FREIGHT',
    description: 'Free Carrier - Franco transporteur'
  },
  'FAS': {
    code: 'FAS',
    group: 'F',
    sellerPays: { origin: true, freight: false, insurance: false, import: false, destination: false },
    cafMethod: 'FOB_PLUS_FREIGHT',
    description: 'Free Alongside Ship - Franco le long du navire'
  },
  'FOB': {
    code: 'FOB',
    group: 'F',
    sellerPays: { origin: true, freight: false, insurance: false, import: false, destination: false },
    cafMethod: 'FOB_PLUS_FREIGHT',
    description: 'Free On Board - Franco à bord'
  },
  'CFR': {
    code: 'CFR',
    group: 'C',
    sellerPays: { origin: true, freight: true, insurance: false, import: false, destination: false },
    cafMethod: 'INVOICE_VALUE',
    description: 'Cost and Freight - Coût et fret'
  },
  'CIF': {
    code: 'CIF',
    group: 'C',
    sellerPays: { origin: true, freight: true, insurance: true, import: false, destination: false },
    cafMethod: 'INVOICE_VALUE',
    description: 'Cost Insurance Freight - Coût assurance fret'
  },
  'CPT': {
    code: 'CPT',
    group: 'C',
    sellerPays: { origin: true, freight: true, insurance: false, import: false, destination: false },
    cafMethod: 'INVOICE_VALUE',
    description: 'Carriage Paid To - Port payé jusqu\'à'
  },
  'CIP': {
    code: 'CIP',
    group: 'C',
    sellerPays: { origin: true, freight: true, insurance: true, import: false, destination: false },
    cafMethod: 'INVOICE_VALUE',
    description: 'Carriage Insurance Paid - Port payé assurance comprise'
  },
  'DAP': {
    code: 'DAP',
    group: 'D',
    sellerPays: { origin: true, freight: true, insurance: true, import: false, destination: true },
    cafMethod: 'INVOICE_VALUE',
    description: 'Delivered At Place - Rendu au lieu de destination'
  },
  'DPU': {
    code: 'DPU',
    group: 'D',
    sellerPays: { origin: true, freight: true, insurance: true, import: false, destination: true },
    cafMethod: 'INVOICE_VALUE',
    description: 'Delivered at Place Unloaded - Rendu déchargé'
  },
  'DDP': {
    code: 'DDP',
    group: 'D',
    sellerPays: { origin: true, freight: true, insurance: true, import: true, destination: true },
    cafMethod: 'INVOICE_VALUE',
    description: 'Delivered Duty Paid - Rendu droits acquittés'
  }
};

// =====================================================
// 2. CONVERSION EVP (Equivalent Vingt Pieds)
// =====================================================
export const EVP_CONVERSION: Record<string, number> = {
  '20DV': 1,
  '20DC': 1,
  '20GP': 1,
  '20ST': 1,
  '20RF': 1,
  '20OT': 1,
  '20FR': 1,
  '40DV': 2,
  '40DC': 2,
  '40GP': 2,
  '40ST': 2,
  '40HC': 2,
  '40HQ': 2,
  '40RF': 2,
  '40OT': 2,
  '40FR': 2,
  '45HC': 2.25,
  '45HQ': 2.25,
};

export function getEVPMultiplier(containerType: string): number {
  // Normaliser le type de conteneur
  const normalized = containerType.toUpperCase().replace(/['\s-]/g, '');
  
  // Chercher correspondance exacte
  if (EVP_CONVERSION[normalized]) {
    return EVP_CONVERSION[normalized];
  }
  
  // Chercher par taille
  if (normalized.includes('45')) return 2.25;
  if (normalized.includes('40')) return 2;
  if (normalized.includes('20')) return 1;
  
  // Par défaut
  return 1;
}

// =====================================================
// 3. ZONES DE LIVRAISON SÉNÉGAL
// =====================================================
export interface ZoneConfig {
  code: string;
  name: string;
  multiplier: number;
  distanceKm: number;
  additionalDays: number;
  requiresSpecialPermit: boolean;
  examples: string[];
}

export const DELIVERY_ZONES: Record<string, ZoneConfig> = {
  'DAKAR': {
    code: 'DAKAR',
    name: 'Dakar Centre',
    multiplier: 1.0,
    distanceKm: 0,
    additionalDays: 0,
    requiresSpecialPermit: false,
    examples: ['Plateau', 'Médina', 'Fann', 'Point E', 'Almadies']
  },
  'DAKAR_BANLIEUE': {
    code: 'DAKAR_BANLIEUE',
    name: 'Banlieue Dakar',
    multiplier: 1.15,
    distanceKm: 25,
    additionalDays: 0,
    requiresSpecialPermit: false,
    examples: ['Pikine', 'Guédiawaye', 'Rufisque', 'Thiaroye', 'Keur Massar']
  },
  'THIES_REGION': {
    code: 'THIES_REGION',
    name: 'Région Thiès',
    multiplier: 1.3,
    distanceKm: 70,
    additionalDays: 1,
    requiresSpecialPermit: false,
    examples: ['Thiès', 'Mbour', 'Tivaouane', 'Diamniadio']
  },
  'DIOURBEL': {
    code: 'DIOURBEL',
    name: 'Région Diourbel',
    multiplier: 1.5,
    distanceKm: 150,
    additionalDays: 1,
    requiresSpecialPermit: false,
    examples: ['Diourbel', 'Touba', 'Mbacké', 'Bambey']
  },
  'KAOLACK': {
    code: 'KAOLACK',
    name: 'Région Kaolack',
    multiplier: 1.6,
    distanceKm: 200,
    additionalDays: 1,
    requiresSpecialPermit: false,
    examples: ['Kaolack', 'Fatick', 'Nioro du Rip', 'Kaffrine']
  },
  'SAINT_LOUIS': {
    code: 'SAINT_LOUIS',
    name: 'Région Saint-Louis',
    multiplier: 1.8,
    distanceKm: 270,
    additionalDays: 2,
    requiresSpecialPermit: false,
    examples: ['Saint-Louis', 'Richard-Toll', 'Louga', 'Dagana']
  },
  'ZIGUINCHOR': {
    code: 'ZIGUINCHOR',
    name: 'Casamance',
    multiplier: 2.0,
    distanceKm: 450,
    additionalDays: 3,
    requiresSpecialPermit: true,
    examples: ['Ziguinchor', 'Kolda', 'Sédhiou', 'Bignona']
  },
  'TAMBACOUNDA': {
    code: 'TAMBACOUNDA',
    name: 'Région Est',
    multiplier: 2.2,
    distanceKm: 500,
    additionalDays: 3,
    requiresSpecialPermit: true,
    examples: ['Tambacounda', 'Kédougou', 'Bakel', 'Matam']
  },
  'MALI': {
    code: 'MALI',
    name: 'Mali Transit',
    multiplier: 3.0,
    distanceKm: 1200,
    additionalDays: 5,
    requiresSpecialPermit: true,
    examples: ['Bamako', 'Kayes', 'Sikasso', 'Mopti']
  },
  'MAURITANIE': {
    code: 'MAURITANIE',
    name: 'Mauritanie Transit',
    multiplier: 2.8,
    distanceKm: 800,
    additionalDays: 4,
    requiresSpecialPermit: true,
    examples: ['Nouakchott', 'Rosso', 'Atar']
  },
  'GUINEE': {
    code: 'GUINEE',
    name: 'Guinée Transit',
    multiplier: 2.5,
    distanceKm: 700,
    additionalDays: 4,
    requiresSpecialPermit: true,
    examples: ['Conakry', 'Labé', 'Kankan']
  },
  'GAMBIE': {
    code: 'GAMBIE',
    name: 'Gambie Transit',
    multiplier: 1.8,
    distanceKm: 300,
    additionalDays: 2,
    requiresSpecialPermit: true,
    examples: ['Banjul', 'Serekunda']
  }
};

export function identifyZone(destination: string): ZoneConfig {
  const destinationLower = destination.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  
  for (const [code, zone] of Object.entries(DELIVERY_ZONES)) {
    // Vérifier le nom de la zone
    if (destinationLower.includes(zone.name.toLowerCase())) {
      return zone;
    }
    // Vérifier les exemples
    for (const example of zone.examples) {
      if (destinationLower.includes(example.toLowerCase())) {
        return zone;
      }
    }
  }
  
  // Zone par défaut si non identifiée
  return DELIVERY_ZONES['THIES_REGION'];
}

// =====================================================
// 4. SEUILS DE TRANSPORT EXCEPTIONNEL
// =====================================================
export interface ExceptionalThreshold {
  parameter: string;
  normalMax: number;
  unit: string;
  actionIfExceeded: string;
}

export const TRANSPORT_THRESHOLDS: ExceptionalThreshold[] = [
  { parameter: 'weight', normalMax: 40, unit: 'tonnes', actionIfExceeded: 'Autorisation AGEROUTE + escorte' },
  { parameter: 'length', normalMax: 18.75, unit: 'mètres', actionIfExceeded: 'Autorisation préfectorale' },
  { parameter: 'width', normalMax: 2.55, unit: 'mètres', actionIfExceeded: 'Escorte véhicule pilote' },
  { parameter: 'height', normalMax: 4.4, unit: 'mètres', actionIfExceeded: 'Vérification itinéraire' },
];

export function checkExceptionalTransport(dimensions: {
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
}): { isExceptional: boolean; reasons: string[] } {
  const reasons: string[] = [];
  
  if (dimensions.weight && dimensions.weight > 40) {
    reasons.push(`Poids ${dimensions.weight}T > 40T: Autorisation AGEROUTE + escorte requise`);
  }
  if (dimensions.length && dimensions.length > 18.75) {
    reasons.push(`Longueur ${dimensions.length}m > 18.75m: Autorisation préfectorale`);
  }
  if (dimensions.width && dimensions.width > 2.55) {
    reasons.push(`Largeur ${dimensions.width}m > 2.55m: Escorte véhicule pilote`);
  }
  if (dimensions.height && dimensions.height > 4.4) {
    reasons.push(`Hauteur ${dimensions.height}m > 4.4m: Vérification itinéraire requise`);
  }
  
  return { isExceptional: reasons.length > 0, reasons };
}

// =====================================================
// 5. CALCUL DES JOURS OUVRÉS PORT DE DAKAR
// =====================================================
export function calculateWorkingDays(startDate: Date, daysToAdd: number, holidays: string[] = []): Date {
  let currentDate = new Date(startDate);
  let addedDays = 0;
  
  while (addedDays < daysToAdd) {
    currentDate.setDate(currentDate.getDate() + 1);
    const dayOfWeek = currentDate.getDay();
    const dateStr = currentDate.toISOString().split('T')[0];
    
    // Skip weekends and holidays
    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidays.includes(dateStr)) {
      addedDays++;
    }
  }
  
  return currentDate;
}

// =====================================================
// 6. RÈGLES DE CALCUL CAF (Coût Assurance Fret)
// =====================================================
export interface CAFCalculation {
  fobValue: number;
  freightAmount: number;
  insuranceRate: number;
  cafValue: number;
  method: string;
}

export function calculateCAF(params: {
  incoterm: string;
  invoiceValue: number;
  freightAmount?: number;
  insuranceRate?: number;
}): CAFCalculation {
  const incotermRule = INCOTERMS_MATRIX[params.incoterm.toUpperCase()];
  const insuranceRate = params.insuranceRate || 0.005; // 0.5% par défaut
  
  if (!incotermRule) {
    throw new Error(`Incoterm inconnu: ${params.incoterm}`);
  }
  
  if (incotermRule.cafMethod === 'INVOICE_VALUE') {
    // CIF, CFR, CPT, CIP, DAP, DPU, DDP: CAF = Valeur facture
    return {
      fobValue: params.invoiceValue,
      freightAmount: 0,
      insuranceRate: 0,
      cafValue: params.invoiceValue,
      method: 'INVOICE_VALUE'
    };
  } else {
    // FOB, FCA, FAS, EXW: CAF = FOB + Fret + Assurance
    const freight = params.freightAmount || (params.invoiceValue * 0.08); // Estimer 8% si non fourni
    const insurance = (params.invoiceValue + freight) * insuranceRate;
    
    return {
      fobValue: params.invoiceValue,
      freightAmount: freight,
      insuranceRate,
      cafValue: params.invoiceValue + freight + insurance,
      method: 'FOB_PLUS_FREIGHT'
    };
  }
}

// =====================================================
// 7. CALCUL DES HONORAIRES SODATRA
// =====================================================
export interface SodatraFeeParams {
  transportMode: 'maritime' | 'aerien' | 'routier';
  cargoValue: number;
  weightTonnes: number;
  volumeM3: number;
  containerCount: number;
  containerTypes: string[];
  destinationZone: string;
  isIMO: boolean;
  isOOG: boolean;
  isTransit: boolean;
  isReefer: boolean;
}

export interface SodatraFeeResult {
  dedouanement: number;
  suivi: number;
  ouvertureDossier: number;
  documentation: number;
  commission: number;
  total: number;
  complexity: { factor: number; reasons: string[] };
}

export function calculateSodatraFees(params: SodatraFeeParams): SodatraFeeResult {
  // Facteur de complexité
  let complexityFactor = 1.0;
  const complexityReasons: string[] = [];
  
  if (params.isIMO) { complexityFactor += 0.3; complexityReasons.push('Marchandise IMO'); }
  if (params.isOOG) { complexityFactor += 0.25; complexityReasons.push('Hors gabarit'); }
  if (params.isTransit) { complexityFactor += 0.2; complexityReasons.push('Transit'); }
  if (params.isReefer) { complexityFactor += 0.15; complexityReasons.push('Conteneur réfrigéré'); }
  
  const zone = DELIVERY_ZONES[params.destinationZone] || DELIVERY_ZONES['DAKAR'];
  if (zone.multiplier > 1.5) {
    complexityFactor += (zone.multiplier - 1) * 0.3;
    complexityReasons.push(`Zone éloignée: ${zone.name}`);
  }
  
  // Base de calcul: 0.4% de la valeur CAF avec min/max
  const valueBased = Math.min(Math.max(params.cargoValue * 0.004, 100000), 500000);
  
  // Dédouanement: base + complexité
  const dedouanement = Math.round((valueBased * 0.6 * complexityFactor) / 5000) * 5000;
  
  // Suivi opérationnel: par conteneur ou par tonne
  const suiviBase = params.containerCount > 0 
    ? params.containerCount * 35000 
    : params.weightTonnes * 3000;
  const suivi = Math.round((suiviBase * complexityFactor) / 5000) * 5000;
  
  // Ouverture dossier: fixe selon transport
  const ouvertureDossier = params.transportMode === 'maritime' ? 25000 : 
                           params.transportMode === 'aerien' ? 20000 : 15000;
  
  // Documentation: fixe
  const documentation = 15000;
  
  // Commission sur débours: 5%
  const commission = Math.round(params.cargoValue * 0.0002 * 100) * 100; // ~0.02% valeur
  
  const total = dedouanement + suivi + ouvertureDossier + documentation + commission;
  
  return {
    dedouanement: Math.max(dedouanement, 75000),
    suivi: Math.max(suivi, 35000),
    ouvertureDossier,
    documentation,
    commission: Math.max(commission, 25000),
    total,
    complexity: { factor: complexityFactor, reasons: complexityReasons }
  };
}

// =====================================================
// 8. MATCHING HISTORIQUE INTELLIGENT
// =====================================================
export interface HistoricalMatchCriteria {
  destination: string;
  cargoType: string;
  transportMode: string;
  containerType?: string;
  maxAgeDays: number;
}

export interface HistoricalMatchScore {
  totalScore: number;
  breakdown: {
    destination: number;
    cargoType: number;
    transportMode: number;
    containerType: number;
    recency: number;
  };
  isValidMatch: boolean;
  warnings: string[];
}

export function calculateHistoricalMatchScore(
  criteria: HistoricalMatchCriteria,
  candidate: {
    destination: string;
    cargoType: string;
    transportMode?: string;
    containerType?: string;
    createdAt: string;
  }
): HistoricalMatchScore {
  const breakdown = {
    destination: 0,
    cargoType: 0,
    transportMode: 0,
    containerType: 0,
    recency: 0
  };
  const warnings: string[] = [];
  
  // Score destination (max 35 points)
  const criteriaZone = identifyZone(criteria.destination);
  const candidateZone = identifyZone(candidate.destination);
  
  if (criteria.destination.toLowerCase() === candidate.destination.toLowerCase()) {
    breakdown.destination = 35;
  } else if (criteriaZone.code === candidateZone.code) {
    breakdown.destination = 25;
    warnings.push('Destination dans la même zone');
  } else if (Math.abs(criteriaZone.distanceKm - candidateZone.distanceKm) < 100) {
    breakdown.destination = 15;
    warnings.push('Destination à distance similaire');
  }
  
  // Score cargo type (max 25 points)
  const criteriaCargoNorm = criteria.cargoType.toLowerCase();
  const candidateCargoNorm = candidate.cargoType.toLowerCase();
  
  if (criteriaCargoNorm === candidateCargoNorm) {
    breakdown.cargoType = 25;
  } else if (
    (criteriaCargoNorm.includes('container') && candidateCargoNorm.includes('container')) ||
    (criteriaCargoNorm.includes('breakbulk') && candidateCargoNorm.includes('breakbulk'))
  ) {
    breakdown.cargoType = 15;
    warnings.push('Type de cargo similaire');
  }
  
  // Score transport mode (max 20 points)
  if (candidate.transportMode) {
    if (criteria.transportMode === candidate.transportMode) {
      breakdown.transportMode = 20;
    } else {
      breakdown.transportMode = 5;
      warnings.push('Mode de transport différent');
    }
  }
  
  // Score container type (max 10 points)
  if (criteria.containerType && candidate.containerType) {
    if (criteria.containerType === candidate.containerType) {
      breakdown.containerType = 10;
    } else if (criteria.containerType.slice(0, 2) === candidate.containerType.slice(0, 2)) {
      breakdown.containerType = 6;
      warnings.push('Taille conteneur identique');
    }
  }
  
  // Score récence (max 10 points)
  const ageMs = Date.now() - new Date(candidate.createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  
  if (ageDays <= 30) {
    breakdown.recency = 10;
  } else if (ageDays <= 90) {
    breakdown.recency = 7;
  } else if (ageDays <= 180) {
    breakdown.recency = 4;
    warnings.push('Tarif datant de plus de 3 mois');
  } else {
    breakdown.recency = 1;
    warnings.push('Tarif ancien (> 6 mois)');
  }
  
  const totalScore = Object.values(breakdown).reduce((a, b) => a + b, 0);
  
  return {
    totalScore,
    breakdown,
    isValidMatch: totalScore >= 70, // Seuil de 70%
    warnings
  };
}

// =====================================================
// 9. TYPES DE SOURCE DE DONNÉES
// =====================================================
export type DataSourceType = 'OFFICIAL' | 'CALCULATED' | 'HISTORICAL' | 'TO_CONFIRM';

export interface QuotationLineSource {
  type: DataSourceType;
  reference: string;
  confidence: number;
  validUntil?: string;
  historicalMatch?: {
    originalDate: string;
    originalRoute: string;
    similarityScore: number;
  };
}

export const SOURCE_CONFIDENCE: Record<DataSourceType, number> = {
  'OFFICIAL': 1.0,
  'CALCULATED': 0.9,
  'HISTORICAL': 0.6,
  'TO_CONFIRM': 0.0
};

export const SOURCE_LABELS: Record<DataSourceType, { label: string; icon: string; color: string }> = {
  'OFFICIAL': { label: 'Tarif Officiel', icon: '🔒', color: 'green' },
  'CALCULATED': { label: 'Règle Métier', icon: '⚙️', color: 'blue' },
  'HISTORICAL': { label: 'Suggestion Historique', icon: '💡', color: 'amber' },
  'TO_CONFIRM': { label: 'À Confirmer', icon: '⚠️', color: 'red' }
};
