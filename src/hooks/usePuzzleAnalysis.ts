import { useMemo } from 'react';
import type { PuzzleAnalysis, PuzzlePiece, MissingInfo, ResearchItem, Suggestion } from '@/components/QuotationPuzzle';

interface ExtractedData {
  weight_kg?: number | null;
  volume_cbm?: number | null;
  container_type?: string | null;
  incoterm?: string | null;
  carrier?: string | null;
  origin?: string | null;
  destination?: string | null;
  cargo_description?: string | null;
  value?: number | null;
  currency?: string | null;
  eta_date?: string | null;
}

interface DetectedElements {
  hasPI: boolean;
  hasIncoterm: boolean;
  hasDestination: boolean;
  hasOrigin: boolean;
  hasContainerType: boolean;
  hasGoodsDescription: boolean;
  hasHsCode: boolean;
  hasValue: boolean;
}

interface AnalysisResponse {
  extracted_data?: ExtractedData;
  detected_elements?: DetectedElements;
  can_quote_now?: boolean;
  request_type?: string;
  clarification_questions?: string[];
  missing_info?: string[];
  carrier_detected?: string;
  v5_analysis?: {
    coherence_audit?: any;
    incoterm_analysis?: any;
    risk_analysis?: any;
  };
  suggestions?: Suggestion[];
}

// Route-based carrier suggestions
const CARRIER_SUGGESTIONS: Record<string, { name: string; detail: string }[]> = {
  'air_dakar_abidjan': [
    { name: 'Air France Cargo', detail: 'via Paris CDG, 2-3j transit' },
    { name: 'Ethiopian Airlines Cargo', detail: 'via Addis-Abeba, compétitif' },
    { name: 'Royal Air Maroc Cargo', detail: 'via Casablanca' },
    { name: 'Kenya Airways Cargo', detail: 'via Nairobi' },
  ],
  'air_dakar_europe': [
    { name: 'Air France Cargo', detail: 'direct, 1j transit' },
    { name: 'Brussels Airlines Cargo', detail: 'via Bruxelles' },
    { name: 'Turkish Airlines Cargo', detail: 'via Istanbul, bon rapport qualité/prix' },
  ],
  'air_dakar_asia': [
    { name: 'Ethiopian Airlines Cargo', detail: 'via Addis-Abeba, 2j transit' },
    { name: 'Turkish Airlines Cargo', detail: 'via Istanbul, 2-3j transit' },
    { name: 'Qatar Airways Cargo', detail: 'via Doha' },
    { name: 'Emirates SkyCargo', detail: 'via Dubai' },
  ],
  'sea_dakar_china': [
    { name: 'CMA CGM', detail: 'direct, 25-30j' },
    { name: 'MSC', detail: 'via transbordement, 28-35j' },
    { name: 'COSCO', detail: 'direct, compétitif Chine' },
    { name: 'Hapag-Lloyd', detail: 'fiable, 30j' },
  ],
  'sea_dakar_europe': [
    { name: 'CMA CGM', detail: 'direct, 10-12j' },
    { name: 'MSC', detail: 'fréquent, 12-14j' },
    { name: 'Maersk', detail: 'premium, 10j' },
    { name: 'Grimaldi', detail: 'RoRo, véhicules' },
  ],
};

function detectTransportMode(data: ExtractedData, elements: DetectedElements): 'maritime' | 'air' | 'road' | 'multimodal' | 'unknown' {
  // Check for air freight indicators
  if (data.container_type?.toLowerCase().includes('air') || 
      data.cargo_description?.toLowerCase().includes('aérien') ||
      data.cargo_description?.toLowerCase().includes('avion') ||
      (data.weight_kg && data.weight_kg < 1000 && !data.container_type)) {
    return 'air';
  }
  
  // Check for container types
  if (data.container_type?.match(/^(20|40)/)) {
    return 'maritime';
  }
  
  // Check for land destinations from Dakar
  const landDestinations = ['mali', 'bamako', 'burkina', 'ouagadougou', 'niger', 'niamey'];
  if (data.destination && landDestinations.some(d => data.destination?.toLowerCase().includes(d))) {
    return 'multimodal'; // Maritime + road transit
  }
  
  return 'unknown';
}

function getCarrierSuggestions(transportMode: string, origin?: string, destination?: string): Suggestion | null {
  let routeKey = '';
  
  const originLower = (origin || '').toLowerCase();
  const destLower = (destination || '').toLowerCase();
  
  if (transportMode === 'air') {
    if (destLower.includes('abidjan') || destLower.includes('côte')) {
      routeKey = 'air_dakar_abidjan';
    } else if (destLower.includes('europe') || destLower.includes('france') || destLower.includes('paris')) {
      routeKey = 'air_dakar_europe';
    } else if (originLower.includes('chin') || originLower.includes('shanghai') || originLower.includes('asia')) {
      routeKey = 'air_dakar_asia';
    } else {
      routeKey = 'air_dakar_abidjan'; // Default for West Africa
    }
  } else {
    if (originLower.includes('chin') || originLower.includes('shanghai')) {
      routeKey = 'sea_dakar_china';
    } else if (originLower.includes('europe') || originLower.includes('france') || originLower.includes('rotterdam')) {
      routeKey = 'sea_dakar_europe';
    } else {
      routeKey = 'sea_dakar_europe'; // Default
    }
  }
  
  const carriers = CARRIER_SUGGESTIONS[routeKey];
  if (!carriers) return null;
  
  return {
    type: 'carrier',
    title: transportMode === 'air' 
      ? `✈️ Compagnies aériennes ${origin || 'Origine'} → ${destination || 'Destination'}`
      : `🚢 Compagnies maritimes ${origin || 'Origine'} → Dakar`,
    items: carriers.map(c => ({
      label: c.name,
      detail: c.detail,
      action: 'Contacter',
    })),
  };
}

export function usePuzzleAnalysis(analysisResponse: AnalysisResponse | null): PuzzleAnalysis | null {
  return useMemo(() => {
    if (!analysisResponse) return null;
    
    const extractedData = analysisResponse.extracted_data || {};
    const detectedElements = analysisResponse.detected_elements || {
      hasPI: false,
      hasIncoterm: false,
      hasDestination: false,
      hasOrigin: false,
      hasContainerType: false,
      hasGoodsDescription: false,
      hasHsCode: false,
      hasValue: false,
    };
    
    const transportMode = detectTransportMode(extractedData, detectedElements);
    
    // Build provided pieces
    const provided: PuzzlePiece[] = [];
    
    if (extractedData.destination) {
      provided.push({
        key: 'destination',
        label: 'Destination',
        value: extractedData.destination,
        source: 'email',
        confidence: 0.9,
      });
    }
    
    if (extractedData.origin) {
      provided.push({
        key: 'origin',
        label: 'Origine',
        value: extractedData.origin,
        source: 'email',
        confidence: 0.9,
      });
    }
    
    if (extractedData.incoterm) {
      provided.push({
        key: 'incoterm',
        label: 'Incoterm',
        value: extractedData.incoterm,
        source: 'email',
        confidence: 0.95,
      });
    }
    
    if (extractedData.weight_kg) {
      provided.push({
        key: 'weight',
        label: 'Poids',
        value: `${extractedData.weight_kg} kg`,
        source: 'email',
        confidence: 0.9,
      });
    }
    
    if (extractedData.volume_cbm) {
      provided.push({
        key: 'volume',
        label: 'Volume',
        value: `${extractedData.volume_cbm} m³`,
        source: 'email',
        confidence: 0.9,
      });
    }
    
    if (extractedData.container_type) {
      provided.push({
        key: 'container',
        label: 'Type conteneur/transport',
        value: extractedData.container_type,
        source: 'email',
        confidence: 0.95,
      });
    }
    
    if (extractedData.value && extractedData.currency) {
      provided.push({
        key: 'value',
        label: 'Valeur marchandise',
        value: `${extractedData.value.toLocaleString('fr-FR')} ${extractedData.currency}`,
        source: 'attachment',
        confidence: 0.85,
      });
    }
    
    if (extractedData.cargo_description) {
      provided.push({
        key: 'cargo',
        label: 'Marchandise',
        value: extractedData.cargo_description,
        source: 'email',
        confidence: 0.8,
      });
    }
    
    if (extractedData.carrier) {
      provided.push({
        key: 'carrier',
        label: 'Transporteur',
        value: extractedData.carrier,
        source: 'email',
        confidence: 0.9,
      });
    }
    
    if (detectedElements.hasPI) {
      provided.push({
        key: 'pi',
        label: 'Facture proforma',
        value: 'Jointe',
        source: 'attachment',
        confidence: 1,
      });
    }
    
    // Build missing info from client
    const needsFromClient: MissingInfo[] = [];
    
    if (!detectedElements.hasIncoterm && !extractedData.incoterm) {
      needsFromClient.push({
        key: 'incoterm',
        label: 'Incoterm souhaité',
        question: 'Quel Incoterm souhaitez-vous (FOB, CIF, DAP, DDP...) ?',
        priority: 'high',
      });
    }
    
    if (!detectedElements.hasDestination && !extractedData.destination) {
      needsFromClient.push({
        key: 'destination',
        label: 'Destination finale',
        question: 'Quelle est la destination finale de la marchandise ?',
        priority: 'high',
      });
    }
    
    if (!detectedElements.hasOrigin && !extractedData.origin && !detectedElements.hasPI) {
      needsFromClient.push({
        key: 'origin',
        label: 'Origine',
        question: 'Quel est le port/pays d\'origine ?',
        priority: 'medium',
      });
    }
    
    if (!extractedData.eta_date) {
      needsFromClient.push({
        key: 'eta',
        label: 'Date souhaitée',
        question: 'Quelle est la date de livraison souhaitée ?',
        priority: 'low',
      });
    }
    
    // Build research items
    const needsResearch: ResearchItem[] = [];
    
    // Tariff research based on transport mode
    if (transportMode === 'air') {
      needsResearch.push({
        key: 'air_freight',
        label: `Tarif fret aérien ${extractedData.origin || 'Origine'} → ${extractedData.destination || 'Destination'}`,
        searchType: 'tariff',
        suggestedActions: ['Contacter compagnies aériennes', 'Vérifier tarifs historiques'],
        status: 'pending',
      });
    } else if (transportMode === 'maritime' || transportMode === 'multimodal') {
      needsResearch.push({
        key: 'sea_freight',
        label: `Tarif fret maritime ${extractedData.origin || 'Origine'} → Dakar`,
        searchType: 'tariff',
        suggestedActions: ['Consulter tarifs compagnie', 'Vérifier surcharges actuelles'],
        status: 'pending',
      });
    }
    
    // HS code research if goods described but no HS code
    if (extractedData.cargo_description && !detectedElements.hasHsCode) {
      needsResearch.push({
        key: 'hs_code',
        label: `Code HS pour "${extractedData.cargo_description.substring(0, 30)}..."`,
        searchType: 'hs_code',
        suggestedActions: ['Rechercher dans nomenclature', 'Consulter @Équipe Douane'],
        status: 'pending',
      });
    }
    
    // Customs duty calculation if we have HS code potential
    if (extractedData.destination) {
      const destLower = extractedData.destination.toLowerCase();
      if (destLower.includes('mali') || destLower.includes('burkina') || destLower.includes('niger')) {
        needsResearch.push({
          key: 'transit_cost',
          label: `Frais transit TRIE vers ${extractedData.destination}`,
          searchType: 'tariff',
          suggestedActions: ['Calculer caution TRIE', 'Vérifier frais EMASE'],
          status: 'pending',
        });
      } else {
        needsResearch.push({
          key: 'customs_duty',
          label: 'Droits et taxes à l\'importation',
          searchType: 'customs_duty',
          suggestedActions: ['Calculer DD/RS/TVA selon code HS'],
          status: 'pending',
        });
      }
    }
    
    // Build suggestions
    const suggestions: Suggestion[] = [];
    
    // Carrier suggestions based on route
    const carrierSuggestion = getCarrierSuggestions(
      transportMode,
      extractedData.origin || undefined,
      extractedData.destination || undefined
    );
    if (carrierSuggestion) {
      suggestions.push(carrierSuggestion);
    }
    
    // Historical quotes suggestion
    if (extractedData.destination) {
      suggestions.push({
        type: 'historical_quote',
        title: `📊 Cotations similaires vers ${extractedData.destination}`,
        items: [
          { label: 'Rechercher dans l\'historique', action: 'Rechercher' },
          { label: 'Estimer fourchette de prix', detail: 'basé sur opérations passées' },
        ],
      });
    }
    
    // Tips based on detected issues
    if (analysisResponse.v5_analysis?.coherence_audit?.alerts?.length > 0) {
      suggestions.push({
        type: 'tip',
        title: '⚠️ Points de vigilance CTU',
        items: analysisResponse.v5_analysis.coherence_audit.alerts.map((a: any) => ({
          label: a.message_fr || a.message,
        })),
      });
    }
    
    // Calculate completeness
    const totalFields = 8; // destination, origin, incoterm, weight/volume, container, value, cargo, date
    const filledFields = provided.length;
    const completeness = Math.min(100, Math.round((filledFields / totalFields) * 100));
    
    const canGenerateQuote = analysisResponse.can_quote_now || 
      (completeness >= 60 && provided.some(p => p.key === 'destination'));
    
    return {
      provided,
      needsFromClient,
      needsResearch,
      suggestions,
      completeness,
      canGenerateQuote,
      transportMode,
    };
  }, [analysisResponse]);
}
