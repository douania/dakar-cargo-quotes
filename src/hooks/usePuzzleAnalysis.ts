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
  // NEW: Transport mode from backend intelligent detection
  transport_mode?: 'air' | 'maritime' | 'road' | 'multimodal' | 'unknown';
  transport_mode_evidence?: string[];
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

interface HsSuggestion {
  item: string;
  hs: string;
  dd?: number;
  tva?: number;
  description?: string;
}

interface WorkScope {
  starts_at?: string;
  includes_freight?: boolean;
  no_freight_needed?: boolean;
  services?: string[];
}

interface AnalysisResponse {
  extracted_data?: ExtractedData;
  detected_elements?: DetectedElements;
  can_quote_now?: boolean;
  request_type?: string;
  clarification_questions?: string[];
  missing_info?: string[];
  questions_to_ask?: string[];
  carrier_detected?: string;
  // NEW: Transport mode from backend
  transport_mode?: 'air' | 'maritime' | 'road' | 'multimodal' | 'unknown';
  transport_mode_evidence?: string[];
  // NEW: AI-provided data
  hs_suggestions?: HsSuggestion[];
  work_scope?: WorkScope;
  required_documents?: string[];
  regulatory_notes?: string;
  offer_type?: 'full_quotation' | 'indicative_dap' | 'rate_only' | 'info_response';
  services_requested?: string[];
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

function detectTransportMode(
  data: ExtractedData, 
  elements: DetectedElements,
  requestType?: string
): 'maritime' | 'air' | 'road' | 'multimodal' | 'unknown' {
  // First, check if backend already detected the transport mode
  const requestTypeLower = (requestType || '').toLowerCase();
  
  // Air freight detection from request_type
  if (requestTypeLower.includes('air') || 
      requestTypeLower.includes('aérien') || 
      requestTypeLower.includes('aerien') ||
      requestTypeLower.includes('fret aérien') ||
      requestTypeLower.includes('air freight')) {
    return 'air';
  }
  
  // Maritime detection from request_type
  if (requestTypeLower.includes('maritime') || 
      requestTypeLower.includes('fcl') || 
      requestTypeLower.includes('lcl') ||
      requestTypeLower.includes('sea') ||
      requestTypeLower.includes('conteneur') ||
      requestTypeLower.includes('container')) {
    return 'maritime';
  }
  
  // Check cargo description and container type for air freight indicators
  const cargoLower = (data.cargo_description || '').toLowerCase();
  const containerLower = (data.container_type || '').toLowerCase();
  
  const airKeywords = [
    'aérien', 'aerien', 'aero', 'avion', 'air freight', 'air cargo',
    'express', 'urgent', 'par air', 'by air', 'vol', 'flight',
    'awb', 'airway', 'air way'
  ];
  
  if (airKeywords.some(kw => cargoLower.includes(kw) || containerLower.includes(kw))) {
    return 'air';
  }
  
  // Check for container types (maritime indicators)
  if (containerLower.match(/^(20|40)/) || containerLower.includes("'") || containerLower.includes('hc')) {
    return 'maritime';
  }
  
  // Maritime keywords
  const maritimeKeywords = ['conteneur', 'container', 'fcl', 'lcl', 'navire', 'bateau', 'vessel', 'port'];
  if (maritimeKeywords.some(kw => cargoLower.includes(kw) || containerLower.includes(kw))) {
    return 'maritime';
  }
  
  // Check for land destinations from Dakar
  const landDestinations = ['mali', 'bamako', 'burkina', 'ouagadougou', 'niger', 'niamey'];
  if (data.destination && landDestinations.some(d => data.destination?.toLowerCase().includes(d))) {
    return 'multimodal'; // Maritime + road transit
  }
  
  // Heuristic: small weight without container type is likely air
  if (data.weight_kg && data.weight_kg < 500 && !data.container_type) {
    return 'air';
  }
  
  // Large weight without other indicators suggests maritime
  if (data.weight_kg && data.weight_kg > 2000) {
    return 'maritime';
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
    
    // USE BACKEND TRANSPORT MODE - it's smarter now!
    // Fallback to extracted_data.transport_mode or 'unknown'
    const transportMode: 'maritime' | 'air' | 'road' | 'multimodal' | 'unknown' = 
      analysisResponse.transport_mode || 
      extractedData.transport_mode || 
      'unknown';
    
    const transportModeEvidence = analysisResponse.transport_mode_evidence || 
      extractedData.transport_mode_evidence || 
      [];
    
    console.log(`Puzzle using transport mode: ${transportMode}, evidence: ${transportModeEvidence.join(', ')}`);
    
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
    
    // Build missing info from client - USE AI DATA if available
    const needsFromClient: MissingInfo[] = [];
    
    // Use questions_to_ask from AI (already filtered for origin/date)
    const aiQuestions = analysisResponse.questions_to_ask || [];
    const aiMissingInfo = analysisResponse.missing_info || [];
    
    // Only add questions the AI specifically says to ask
    aiQuestions.forEach((question, index) => {
      // Skip any origin or date questions that might slip through
      const qLower = question.toLowerCase();
      if (qLower.includes('origine') || qLower.includes('origin') || 
          qLower.includes('date') || qLower.includes('livraison')) {
        return;
      }
      needsFromClient.push({
        key: `ai_question_${index}`,
        label: question.substring(0, 50),
        question: question,
        priority: 'medium',
      });
    });
    
    // Add essential missing info from AI (filtered)
    aiMissingInfo.forEach((info, index) => {
      const infoLower = info.toLowerCase();
      // Skip origin and date - we don't ask for these
      if (infoLower.includes('origine') || infoLower.includes('origin') || 
          infoLower.includes('date') || infoLower.includes('livraison')) {
        return;
      }
      // Only add if not already covered by AI questions
      if (!needsFromClient.some(n => n.question?.toLowerCase().includes(infoLower))) {
        needsFromClient.push({
          key: `missing_${index}`,
          label: info,
          question: `Pouvez-vous fournir : ${info} ?`,
          priority: infoLower.includes('facture') || infoLower.includes('caf') ? 'medium' : 'low',
        });
      }
    });
    
    // Fallback: only ask for destination if truly missing and AI didn't handle it
    if (!extractedData.destination && !detectedElements.hasDestination && needsFromClient.length === 0) {
      needsFromClient.push({
        key: 'destination',
        label: 'Destination finale',
        question: 'Quelle est la destination finale de la marchandise ?',
        priority: 'high',
      });
    }
    
    // Build research items - USE AI DATA to avoid unnecessary research
    const needsResearch: ResearchItem[] = [];
    
    // Check if AI already provided HS suggestions with duty rates
    const hasHsSuggestions = (analysisResponse.hs_suggestions?.length || 0) > 0;
    const hasWorkScope = !!analysisResponse.work_scope;
    const workScopeIncludesFreight = analysisResponse.work_scope?.includes_freight ?? true;
    const noFreightNeeded = analysisResponse.work_scope?.no_freight_needed ?? false;
    
    // Only add freight research if work scope includes freight
    if (!noFreightNeeded && workScopeIncludesFreight) {
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
    }
    
    // HS code research ONLY if AI didn't provide suggestions
    if (extractedData.cargo_description && !detectedElements.hasHsCode && !hasHsSuggestions) {
      needsResearch.push({
        key: 'hs_code',
        label: `Code HS pour "${extractedData.cargo_description.substring(0, 30)}..."`,
        searchType: 'hs_code',
        suggestedActions: ['Rechercher dans nomenclature', 'Consulter @Équipe Douane'],
        status: 'pending',
      });
    }
    
    // Customs duty ONLY if AI didn't provide HS suggestions with rates
    if (extractedData.destination && !hasHsSuggestions) {
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
