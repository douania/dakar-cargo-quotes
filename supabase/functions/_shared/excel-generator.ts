// Excel generation utilities for professional quotations
// Note: This module provides styling constants and helper functions
// The actual ExcelJS usage happens in the edge function

export interface QuotationData {
  reference: string;
  client: string;
  date: string;
  validityDays: number;
  destination: string;
  origin?: string;
  incoterm?: string;
  containerType?: string;
  currency: string;
  lines: QuotationLine[];
  cgvClauses: CGVClause[];
  exclusions: ExclusionItem[];
  totals: {
    subtotal: number;
    margin?: number;
    total: number;
  };
}

export interface QuotationLine {
  category: string;
  service: string;
  unit: string;
  rate: number;
  quantity: number;
  amount: number;
  source: 'OFFICIEL' | 'HISTORIQUE' | 'ESTIMÉ';
  notes?: string;
}

export interface CGVClause {
  code: string;
  title: string;
  content: string;
  isWarning: boolean;
}

export interface ExclusionItem {
  service: string;
  rate: string;
  notes?: string;
}

// Style constants for Excel formatting
export const EXCEL_STYLES = {
  // Colors (as ARGB hex)
  colors: {
    primary: 'FF1E40AF',      // Blue 800
    primaryLight: 'FFDBEAFE', // Blue 100
    secondary: 'FF374151',    // Gray 700
    success: 'FF16A34A',      // Green 600
    successLight: 'FFDCFCE7', // Green 100
    warning: 'FFD97706',      // Amber 600
    warningLight: 'FFFEF3C7', // Amber 100
    danger: 'FFDC2626',       // Red 600
    dangerLight: 'FFFEE2E2', // Red 100
    white: 'FFFFFFFF',
    black: 'FF000000',
    gray100: 'FFF3F4F6',
    gray200: 'FFE5E7EB',
    gray300: 'FFD1D5DB',
    gray500: 'FF6B7280',
    gray700: 'FF374151',
    gray900: 'FF111827',
  },
  
  // Font configurations
  fonts: {
    header: { name: 'Arial', size: 14, bold: true },
    title: { name: 'Arial', size: 11, bold: true },
    normal: { name: 'Arial', size: 10 },
    small: { name: 'Arial', size: 9 },
    mono: { name: 'Courier New', size: 9 },
  },
  
  // Border styles
  borders: {
    thin: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    medium: { style: 'medium', color: { argb: 'FF374151' } },
    thick: { style: 'thick', color: { argb: 'FF1E40AF' } },
  },
};

// Helper to format currency
export function formatCurrency(amount: number, currency: string): string {
  if (currency === 'EUR' || currency === '€') {
    return new Intl.NumberFormat('fr-FR', { 
      style: 'currency', 
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } else if (currency === 'FCFA' || currency === 'XOF') {
    return new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount) + ' FCFA';
  } else if (currency === 'USD' || currency === '$') {
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  }
  return `${amount} ${currency}`;
}

// Detect destination country from location string
export function detectDestinationCountry(destination: string): string {
  const dest = destination.toLowerCase();
  
  if (dest.includes('mali') || dest.includes('bamako') || dest.includes('sikasso') || 
      dest.includes('kayes') || dest.includes('segou') || dest.includes('mopti') ||
      dest.includes('sirakoro') || dest.includes('kati')) {
    return 'MALI';
  }
  
  if (dest.includes('burkina') || dest.includes('ouagadougou') || dest.includes('bobo')) {
    return 'BURKINA';
  }
  
  if (dest.includes('niger') || dest.includes('niamey')) {
    return 'NIGER';
  }
  
  if (dest.includes('guinée') || dest.includes('guinea') || dest.includes('conakry')) {
    return 'GUINEE';
  }
  
  if (dest.includes('mauritanie') || dest.includes('nouakchott')) {
    return 'MAURITANIE';
  }
  
  // Default to Senegal
  return 'SENEGAL';
}

// Get CGV clauses based on destination country
export function getDefaultCGVClauses(country: string): CGVClause[] {
  const commonClauses: CGVClause[] = [
    {
      code: 'VALIDITY',
      title: 'Validité',
      content: 'Cette cotation est valable 30 jours à compter de sa date d\'émission.',
      isWarning: false,
    },
    {
      code: 'PAYMENT',
      title: 'Conditions de paiement',
      content: 'Paiement selon conditions convenues. Retard de paiement = suspension des opérations.',
      isWarning: false,
    },
  ];

  if (country === 'MALI') {
    return [
      ...commonClauses,
      {
        code: 'TRANSIT_TIME',
        title: 'Transit Time',
        content: 'Délai de transit estimé: 15-18 jours depuis arrivée navire Dakar.',
        isWarning: false,
      },
      {
        code: 'DEMURRAGE_FREE',
        title: 'Franchise Demurrage',
        content: 'Demander 21 jours de franchise demurrage lors du booking (au lieu de 10 jours standard).',
        isWarning: true,
      },
      {
        code: 'STORAGE_FREE',
        title: 'Franchise Magasinage',
        content: 'Franchise magasinage DPW Transit (TRIE): 21 jours depuis arrivée navire.',
        isWarning: false,
      },
      {
        code: 'DETENTION_COC',
        title: 'Détention Conteneur COC',
        content: '⚠️ RISQUE ÉLEVÉ: Délai aller-retour Dakar-Mali-Dakar estimé 8-13 jours.\n20\' DRY: €23/jour + Addcom (MSC 5.5%, autres 2.8%)\n40\' DRY: €39/jour + Addcom\nCoût potentiel détention 40HC (5 jours): ~225€ ≈ 150,000 FCFA',
        isWarning: true,
      },
      {
        code: 'CAUTION_COC',
        title: 'Caution Conteneur COC',
        content: '20\': $3,200 USD | 40\': $5,100 USD\nAlternative via broker: €150 (20\') / €250 (40\')\nMaersk/Safmarine: Dispensé de caution',
        isWarning: true,
      },
      {
        code: 'SOC_RECOMMEND',
        title: 'Recommandation SOC',
        content: '💡 Pour les transits Mali longue distance, les conteneurs SOC permettent d\'éviter frais de détention et Transit Fees COC. Économie estimée: 300,000 - 600,000 FCFA par conteneur.',
        isWarning: false,
      },
      {
        code: 'TRUCK_DETENTION',
        title: 'Immobilisation Camion',
        content: 'Franchise: 48h (frontière, Kati, site de livraison)\nAu-delà: €38.11/jour (~25,000 FCFA/jour)',
        isWarning: false,
      },
      {
        code: 'SECURITY',
        title: 'Clause Sécurité Mali',
        content: 'Les délais peuvent être impactés par la situation sécuritaire (blocages routes, escortes obligatoires). Tout retard lié à ces circonstances ne peut engager la responsabilité de SODATRA. Surcoûts sécurité facturés selon conditions réelles.',
        isWarning: true,
      },
      {
        code: 'PAYMENT_MALI',
        title: 'Conditions Paiement Transit',
        content: '80% avant arrivée navire\n10% au passage frontière TRIE\n10% sur présentation POD',
        isWarning: false,
      },
    ];
  }

  // Default Senegal clauses
  return [
    ...commonClauses,
    {
      code: 'STORAGE_FREE',
      title: 'Franchise Magasinage',
      content: 'Franchise magasinage PAD: 10 jours calendaires à partir de l\'arrivée navire.',
      isWarning: false,
    },
    {
      code: 'DEMURRAGE',
      title: 'Surestaries',
      content: 'Franchise demurrage: 10 jours à partir de l\'arrivée navire. Au-delà: tarifs selon compagnie maritime.',
      isWarning: false,
    },
    {
      code: 'DETENTION',
      title: 'Détention Conteneur',
      content: 'Franchise détention: 48h après sortie port jusqu\'au retour conteneur vide.\nTarifs au-delà: 20\' DRY @27€/jour | 40\' DRY @45€/jour',
      isWarning: false,
    },
    {
      code: 'TRUCK',
      title: 'Immobilisation Camion',
      content: 'Franchise immobilisation camion: 24h pour déchargement. Au-delà: 100,000 FCFA/jour.',
      isWarning: false,
    },
  ];
}

// Get default exclusions based on destination
export function getDefaultExclusions(country: string): ExclusionItem[] {
  const commonExclusions: ExclusionItem[] = [
    { service: 'Droits et taxes douaniers', rate: 'Selon déclaration', notes: 'À la charge de l\'importateur' },
    { service: 'Frais de magasinage hors franchise', rate: 'Tarif DPW', notes: 'Si dépassement franchise' },
    { service: 'Surestaries hors franchise', rate: 'Tarif armateur', notes: 'Si dépassement franchise' },
  ];

  if (country === 'MALI') {
    return [
      ...commonExclusions,
      { service: 'BL Charges', rate: '€100', notes: 'Original BL' },
      { service: 'Pre-import / ENS', rate: '€300', notes: 'Si applicable' },
      { service: 'PVI (Inspection)', rate: '0.75% FOB', notes: 'Programme Vérification Import' },
      { service: 'Assurance Mali', rate: '0.15% CIF', notes: 'Assurance locale obligatoire' },
      { service: 'Road Tax Mali', rate: '0.25% CIF', notes: 'Taxe routière Mali' },
    ];
  }

  return [
    ...commonExclusions,
    { service: 'BL Charges', rate: '€100', notes: 'Original BL' },
    { service: 'Assurance transport', rate: 'Sur demande', notes: 'Optionnel' },
  ];
}

// Generate quotation reference number
export function generateQuotationReference(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const random = Math.floor(Math.random() * 9000) + 1000;
  return `QT-${year}${month}-${random}`;
}
