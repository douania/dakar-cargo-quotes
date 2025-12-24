import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CUSTOMS_CODE_REFERENCE, getLegalContextForRegime, analyzeRegimeAppropriateness } from "../_shared/customs-code-reference.ts";
import { CTU_CODE_REFERENCE, isCTURelevant, getAllRelevantCTUContexts } from "../_shared/ctu-code-reference.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Response templates for different request types - BILINGUAL
const RESPONSE_TEMPLATES = {
  quotation_standard: {
    EN: {
      greeting: "Gd day Dear {contact_name},",
      body: "Pls find attached our best offer for the captioned.\n\nFor any questions, pls don't hesitate.",
      closing: "With we remain,\nBest Regards"
    },
    FR: {
      greeting: "Bonjour {contact_name},",
      body: "Pls find notre meilleure offre en pièce jointe.\n\nN'hésitez pas pour toute question.",
      closing: "Bien à vous,\nMeilleures Salutations"
    }
  },
  pi_only_needs_clarification: {
    EN: {
      greeting: "Dear {contact_name},",
      body: "Well noted the PI, thks.\n\nTo prepare our offer, pls kindly confirm:\n{questions}\n\nWe'll revert soonest upon receipt.",
      closing: "With we remain,\nBest Regards"
    },
    FR: {
      greeting: "Bonjour {contact_name},",
      body: "Bien reçu la PI, merci.\n\nPour établir notre offre, pls confirm:\n{questions}\n\nDès réception, nous revenons vers vous asap.",
      closing: "Bav / Meilleures Salutations"
    }
  },
  quotation_exempt: {
    EN: {
      greeting: "Gd day Dear {contact_name},",
      body: "Pls find below our offer for exempt project shipment.\n\nDuty free as per {regime} regime.\nAll docs to be provided for customs clearance.",
      closing: "With we remain,\nBest Regards"
    },
    FR: {
      greeting: "Bonjour {contact_name},",
      body: "Pls find notre offre pour l'expédition projet exonéré.\n\nExonération selon régime {regime}.\nDocs requis pour dédouanement.",
      closing: "Bien à vous,\nMeilleures Salutations"
    }
  },
  regime_question: {
    EN: {
      greeting: "Dear {contact_name},",
      body: "Kindly note:\n\n{response}\n\n@Équipe Douane pls confirm if needed.",
      closing: "Best Regards"
    },
    FR: {
      greeting: "Bonjour {contact_name},",
      body: "Pour info:\n\n{response}\n\n@Équipe Douane pls confirmer si besoin.",
      closing: "Meilleures Salutations"
    }
  },
  acknowledgment: {
    EN: {
      greeting: "Dear {contact_name},",
      body: "Well noted w/ thks.\nWe'll revert soonest.",
      closing: "Best Regards"
    },
    FR: {
      greeting: "Bonjour {contact_name},",
      body: "Bien noté, merci.\nNous revenons vers vous asap.",
      closing: "Meilleures Salutations"
    }
  },
  rate_confirmation: {
    EN: {
      greeting: "Hi Dear {contact_name},",
      body: "Pls find below rates as discussed:\n\n{rates}\n\nRates valid until {validity}.",
      closing: "With we remain,\nBest Regards"
    },
    FR: {
      greeting: "Bonjour {contact_name},",
      body: "Pls find les tarifs comme discuté:\n\n{rates}\n\nValidité: {validity}.",
      closing: "Bien à vous,\nMeilleures Salutations"
    }
  }
};

// ============ LANGUAGE DETECTION ============
function detectEmailLanguage(body: string, subject: string): 'FR' | 'EN' {
  const content = ((body || '') + ' ' + (subject || '')).toLowerCase();
  
  // French markers
  const frenchWords = ['bonjour', 'cher', 'madame', 'monsieur', 'veuillez', 'merci', 
    'cordialement', 'pièce jointe', 'en attaché', 'prière de', 's\'il vous plaît',
    'ci-joint', 'nous vous prions', 'salutations', 'meilleures', 'sincères',
    'objet', 'demande', 'concernant', 'suite à', 'selon', 'notre offre'];
  // English markers  
  const englishWords = ['dear', 'please', 'kindly', 'attached', 'regards', 'thank you',
    'find below', 'best regards', 'looking forward', 'further to', 'as per',
    'herewith', 'enclosed', 'subject', 'request', 'concerning', 'following'];
  
  const frScore = frenchWords.filter(w => content.includes(w)).length;
  const enScore = englishWords.filter(w => content.includes(w)).length;
  
  console.log(`Language detection: FR=${frScore}, EN=${enScore}`);
  return frScore > enScore ? 'FR' : 'EN';
}

// ============ REQUEST TYPE ANALYSIS ============
interface RequestAnalysis {
  type: 'PI_ONLY' | 'QUOTATION_REQUEST' | 'QUESTION' | 'ACKNOWLEDGMENT' | 'FOLLOW_UP';
  missingContext: string[];
  suggestedQuestions: string[];
  canQuote: boolean;
  detectedElements: {
    hasPI: boolean;
    hasIncoterm: boolean;
    hasDestination: boolean;
    hasOrigin: boolean;
    hasContainerType: boolean;
    hasGoodsDescription: boolean;
    hasHsCode: boolean;
    hasValue: boolean;
  };
}

function analyzeRequestType(email: any, attachments: any[]): RequestAnalysis {
  const hasPI = attachments?.some(a => 
    /proforma|PI|invoice|facture/i.test(a.filename || '')
  ) || false;
  
  const bodyText = ((email.body_text || '') + ' ' + (email.subject || '')).toLowerCase();
  const attachmentData = attachments?.map(a => JSON.stringify(a.extracted_data || {})).join(' ').toLowerCase() || '';
  const fullContent = bodyText + ' ' + attachmentData;
  
  // Detect what information is present
  const hasIncoterm = /\b(FOB|CIF|DAP|DDP|EXW|CFR|CIP|CPT|FCA|FAS)\b/i.test(fullContent);
  
  // Enhanced destination detection - West African cities, airport codes, maritime ports
  const hasDestination = /\b(Dakar|Bamako|Mali|Burkina|Ouaga|Ouagadougou|Niger|Niamey|Guinée|Conakry|Abidjan|Côte d'Ivoire|Ivory Coast|Lomé|Togo|Cotonou|Benin|Bénin|Accra|Ghana|Lagos|Nigeria|Nouakchott|Mauritanie|Banjul|Gambie|Gambia|Bissau|Freetown|Sierra Leone|Monrovia|Liberia|destination|livraison|AOD|POD|port of discharge|aéroport de destination)\b/i.test(fullContent);
  
  // Enhanced origin detection - includes AOL (Airport of Loading), EXW locations, pickup addresses
  const hasOrigin = /\b(from|de|origine|origin|port of loading|POL|departure|chargement|Shanghai|Ningbo|Shenzhen|Guangzhou|Rotterdam|Hamburg|Marseille|Anvers|Antwerp|Le Havre|Fos|AOL|airport of loading|enlèvement|pickup|adresse d'enlèvement|EXW\s+\w+|point de départ)\b/i.test(fullContent);
  
  // Enhanced transport mode detection - maritime + air freight
  const hasContainerType = /\b(20['']?|40['']?|container|conteneur|ctnr|TEU|EVP|HC|high cube|fret\s*aérien|air\s*freight|cargo\s*aérien|avion|airway|AWB|LTA|air\s*cargo|kg|dimensions?\s*:?\s*\d+\s*(mm|cm|m)|poids\s*:?\s*\d+\s*kg)\b/i.test(fullContent);
  
  const hasGoodsDescription = /\b(marchandise|goods|cargo|merchandise|produit|équipement|machine|vehicle|véhicule|dispositif|device|matériel|equipment)\b/i.test(fullContent);
  const hasHsCode = /\b\d{4}[.\s]?\d{2}[.\s]?\d{2,4}\b/.test(fullContent) || /\bHS\s*:?\s*\d{4}/i.test(fullContent);
  const hasValue = /\b(USD|EUR|FCFA|XOF|\$|€)\s*[\d,.]+|\d+[.,]\d{2,}\s*(USD|EUR|FCFA)/i.test(fullContent);
  const hasQuestion = /\?|kindly|please confirm|pouvez-vous|could you|what is|quel est/i.test(bodyText);
  
  const detectedElements = {
    hasPI,
    hasIncoterm,
    hasDestination,
    hasOrigin,
    hasContainerType,
    hasGoodsDescription,
    hasHsCode,
    hasValue
  };
  
  const missingContext: string[] = [];
  const suggestedQuestions: string[] = [];
  const language = detectEmailLanguage(email.body_text, email.subject);
  
  if (!hasIncoterm) {
    missingContext.push(language === 'FR' ? 'Incoterm souhaité' : 'Required Incoterm');
    suggestedQuestions.push(language === 'FR' 
      ? '• Incoterm souhaité (FOB, CIF, DAP, DDP...) ?' 
      : '• Required Incoterm (FOB, CIF, DAP, DDP...) ?');
  }
  if (!hasDestination) {
    missingContext.push(language === 'FR' ? 'Destination finale' : 'Final destination');
    suggestedQuestions.push(language === 'FR' 
      ? '• Destination finale ?' 
      : '• Final destination ?');
  }
  if (!hasOrigin && !hasPI) {
    missingContext.push(language === 'FR' ? 'Port/Pays d\'origine' : 'Origin port/country');
    suggestedQuestions.push(language === 'FR' 
      ? '• Port/pays d\'origine ?' 
      : '• Port/country of origin ?');
  }
  if (!hasContainerType && !hasPI) {
    missingContext.push(language === 'FR' ? 'Type de conteneur/transport' : 'Container/transport type');
    suggestedQuestions.push(language === 'FR' 
      ? '• Type de conteneur ou mode de transport ?' 
      : '• Container type or transport mode ?');
  }
  
  // Determine type
  let type: RequestAnalysis['type'] = 'QUOTATION_REQUEST';
  
  if (hasPI && missingContext.length >= 2) {
    type = 'PI_ONLY';  // PI without enough context
  } else if (hasQuestion && !hasPI && missingContext.length >= 2) {
    type = 'QUESTION';
  } else if (/well noted|bien noté|noted with thanks|accusé de réception/i.test(bodyText)) {
    type = 'ACKNOWLEDGMENT';
  } else if (/further to|suite à|following our|comme convenu|as discussed/i.test(bodyText)) {
    type = 'FOLLOW_UP';
  }
  
  const canQuote = missingContext.length <= 1; // Allow quoting with at most 1 missing element
  
  console.log(`Request analysis: type=${type}, canQuote=${canQuote}, missing=${missingContext.length}`);
  
  return {
    type,
    missingContext,
    suggestedQuestions,
    canQuote,
    detectedElements
  };
}

// ============ SHIPMENT DATA EXTRACTION ============
interface ExtractedShipmentData {
  weight_kg: number | null;
  volume_cbm: number | null;
  container_type: string | null;
  incoterm: string | null;
  carrier: string | null;
  origin: string | null;
  destination: string | null;
  cargo_description: string | null;
  value: number | null;
  currency: string | null;
  eta_date: string | null;
  // NEW: Transport mode detection
  transport_mode: 'air' | 'maritime' | 'road' | 'multimodal' | 'unknown';
  transport_mode_evidence: string[];
}

// IATA airport codes for West Africa and common origins
const IATA_CODES: Record<string, string> = {
  'DKR': 'Dakar', 'DSS': 'Dakar AIBD', 'ABJ': 'Abidjan', 'BKO': 'Bamako',
  'OUA': 'Ouagadougou', 'NIM': 'Niamey', 'CKY': 'Conakry', 'LFW': 'Lomé',
  'COO': 'Cotonou', 'ACC': 'Accra', 'LOS': 'Lagos', 'NKC': 'Nouakchott',
  'BJL': 'Banjul', 'FNA': 'Freetown', 'ROB': 'Monrovia',
  'CDG': 'Paris', 'ORY': 'Paris Orly', 'FRA': 'Frankfurt', 'AMS': 'Amsterdam',
  'BRU': 'Bruxelles', 'DXB': 'Dubai', 'DOH': 'Doha', 'JFK': 'New York',
  'PVG': 'Shanghai', 'CAN': 'Guangzhou', 'SZX': 'Shenzhen', 'HKG': 'Hong Kong'
};

function extractShipmentData(content: string, attachments: any[]): ExtractedShipmentData {
  const fullContent = content + ' ' + attachments.map(a => 
    (a.extracted_text || '') + ' ' + JSON.stringify(a.extracted_data || {})
  ).join(' ');
  
  const contentLower = fullContent.toLowerCase();
  const transportEvidence: string[] = [];
  
  const result: ExtractedShipmentData = {
    weight_kg: null,
    volume_cbm: null,
    container_type: null,
    incoterm: null,
    carrier: null,
    origin: null,
    destination: null,
    cargo_description: null,
    value: null,
    currency: null,
    eta_date: null,
    transport_mode: 'unknown',
    transport_mode_evidence: [],
  };

  // Extract weight (kg)
  const weightMatch = fullContent.match(/(\d+[\s,.]?\d*)\s*(kg|kgs|kilos?|kilogrammes?)/i);
  if (weightMatch) {
    result.weight_kg = parseFloat(weightMatch[1].replace(/[\s,]/g, '').replace(',', '.'));
  }

  // Extract volume (cbm/m³)
  const volumeMatch = fullContent.match(/(\d+[\s,.]?\d*)\s*(cbm|m³|m3|cubic\s*met)/i);
  if (volumeMatch) {
    result.volume_cbm = parseFloat(volumeMatch[1].replace(/[\s,]/g, '').replace(',', '.'));
  }

  // ============ STRICT CONTAINER TYPE EXTRACTION ============
  // Only detect containers with EXPLICIT indicators - avoid matching random numbers
  const containerPatterns = [
    // Pattern 1: Size + explicit suffix (20DV, 40HC, 40'HC, etc.)
    /\b(20|40)['']?\s*(DV|GP|HC|HQ|RF|OT|FR|TK|PL)\b/i,
    // Pattern 2: Size + explicit "ft" or "feet" or "pieds"
    /\b(20|40)['']?\s*(ft|feet|pieds)\b/i,
    // Pattern 3: Size + "container/conteneur/ctnr"
    /\b(20|40)['']?\s*(container|conteneur|ctnr)\b/i,
    // Pattern 4: Explicit container keywords with size
    /\b(container|conteneur|ctnr)\s*(20|40)['']?\b/i,
    // Pattern 5: TEU/EVP with context
    /\b(1|2)\s*(TEU|EVP)\b/i,
  ];
  
  for (const pattern of containerPatterns) {
    const match = fullContent.match(pattern);
    if (match) {
      // Normalize the container type
      let size = match[1] || match[2];
      if (size === '1' || size === '2') {
        // TEU case: 1 TEU = 20', 2 TEU = 40'
        size = size === '1' ? '20' : '40';
      }
      let suffix = (match[2] || match[1] || '').toUpperCase();
      
      // Normalize suffixes
      if (['FT', 'FEET', 'PIEDS', 'CONTAINER', 'CONTENEUR', 'CTNR', 'TEU', 'EVP'].includes(suffix)) {
        suffix = 'DV'; // Default to Dry Van
      }
      if (suffix === 'HQ') suffix = 'HC';
      if (suffix === 'GP') suffix = 'DV';
      
      result.container_type = `${size}${suffix || 'DV'}`;
      transportEvidence.push(`container_${result.container_type}`);
      break;
    }
  }

  // Extract Incoterm
  const incotermMatch = fullContent.match(/\b(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP)\b/i);
  if (incotermMatch) {
    result.incoterm = incotermMatch[1].toUpperCase();
  }

  // ============ STRICT CARRIER EXTRACTION ============
  // More specific patterns to avoid false positives (e.g., "ONE" in text)
  const carrierPatterns: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /\b(CMA\s*CGM|CMA-CGM)\b/i, name: 'CMA-CGM' },
    { pattern: /\bMSC\b(?!\s*cruises)/i, name: 'MSC' },
    { pattern: /\b(MAERSK|MÆRSK)\b/i, name: 'MAERSK' },
    { pattern: /\b(HAPAG[-\s]?LLOYD)\b/i, name: 'HAPAG-LLOYD' },
    { pattern: /\b(ONE\s+LINE|OCEAN\s+NETWORK\s+EXPRESS)\b/i, name: 'ONE' },
    { pattern: /\bEVERGREEN\b/i, name: 'EVERGREEN' },
    { pattern: /\bGRIMALDI\b/i, name: 'GRIMALDI' },
    { pattern: /\bCOSCO\b/i, name: 'COSCO' },
    { pattern: /\bPIL\b(?=\s+shipping|\s+line|\s+container)/i, name: 'PIL' },
    { pattern: /\bYANG\s*MING\b/i, name: 'YANG-MING' },
    { pattern: /\bZIM\b(?=\s+shipping|\s+line|\s+container)/i, name: 'ZIM' },
    // Airlines
    { pattern: /\b(AIR\s+FRANCE|AF)\s+cargo\b/i, name: 'AIR-FRANCE-CARGO' },
    { pattern: /\b(EMIRATES|EK)\s+(sky)?cargo\b/i, name: 'EMIRATES-CARGO' },
    { pattern: /\bQATAR\s+CARGO\b/i, name: 'QATAR-CARGO' },
    { pattern: /\bTURKISH\s+(CARGO|AIRLINES)\b/i, name: 'TURKISH-CARGO' },
    { pattern: /\bETHIOPIAN\s+CARGO\b/i, name: 'ETHIOPIAN-CARGO' },
    { pattern: /\bAIR\s+SENEGAL\b/i, name: 'AIR-SENEGAL' },
    { pattern: /\bROYAL\s+AIR\s+MAROC\b/i, name: 'RAM-CARGO' },
    { pattern: /\bASKY\b/i, name: 'ASKY' },
    { pattern: /\bAIR\s+COTE\s+D['']?IVOIRE\b/i, name: 'AIR-COTE-IVOIRE' },
  ];
  
  for (const { pattern, name } of carrierPatterns) {
    if (pattern.test(fullContent)) {
      result.carrier = name;
      if (name.includes('CARGO') || name.includes('AIR')) {
        transportEvidence.push(`air_carrier_${name}`);
      } else {
        transportEvidence.push(`maritime_carrier_${name}`);
      }
      break;
    }
  }

  // ============ INTELLIGENT ORIGIN/DESTINATION EXTRACTION ============
  // Use contextual patterns: "de/from" → origin, "à/to/vers/destination" → destination
  
  // West African cities/countries
  const westAfricaLocations = [
    'Dakar', 'Sénégal', 'Senegal', 'Bamako', 'Mali', 'Ouagadougou', 'Burkina', 'Burkina Faso',
    'Niamey', 'Niger', 'Conakry', 'Guinée', 'Guinea', 'Abidjan', 'Côte d\'Ivoire', 'Ivory Coast',
    'Lomé', 'Togo', 'Cotonou', 'Benin', 'Bénin', 'Accra', 'Ghana', 'Lagos', 'Nigeria',
    'Nouakchott', 'Mauritanie', 'Mauritania', 'Banjul', 'Gambie', 'Gambia', 'Bissau',
    'Freetown', 'Sierra Leone', 'Monrovia', 'Liberia'
  ];
  
  // Common origin locations (ports, countries)
  const originLocations = [
    'Shanghai', 'Ningbo', 'Shenzhen', 'Guangzhou', 'Qingdao', 'Tianjin', 'Xiamen',
    'Rotterdam', 'Hamburg', 'Anvers', 'Antwerp', 'Marseille', 'Le Havre', 'Fos',
    'Chine', 'China', 'France', 'Turquie', 'Turkey', 'Inde', 'India', 'Italie', 'Italy',
    'Espagne', 'Spain', 'Dubai', 'UAE', 'Allemagne', 'Germany', 'Belgique', 'Belgium',
    'Pays-Bas', 'Netherlands', 'UK', 'Royaume-Uni', 'USA', 'États-Unis'
  ];
  
  // Check IATA codes first
  for (const [code, city] of Object.entries(IATA_CODES)) {
    const iataPattern = new RegExp(`\\b${code}\\b`, 'i');
    if (iataPattern.test(fullContent)) {
      transportEvidence.push(`iata_code_${code}`);
      // Determine if origin or destination
      const originPattern = new RegExp(`(from|de|départ|origine|EXW|FCA|FAS|FOB)\\s*:?\\s*${code}`, 'i');
      const destPattern = new RegExp(`(to|à|vers|destination|livraison|DAP|DDP|CIF)\\s*:?\\s*${code}`, 'i');
      
      if (originPattern.test(fullContent)) {
        result.origin = city;
      } else if (destPattern.test(fullContent)) {
        result.destination = city;
      } else if (westAfricaLocations.some(loc => city.toLowerCase().includes(loc.toLowerCase()))) {
        result.destination = city;
      } else {
        result.origin = city;
      }
    }
  }
  
  // ============ PRIORITY: AOL/AOD EXTRACTION (Air-specific) ============
  const aolMatch = fullContent.match(/AOL\s*:?\s*([A-ZÀ-Ÿa-zà-ÿ]+(?:[\s-][A-ZÀ-Ÿa-zà-ÿ]+)*)/i);
  const aodMatch = fullContent.match(/AOD\s*:?\s*([A-ZÀ-Ÿa-zà-ÿ]+(?:[\s-][A-ZÀ-Ÿa-zà-ÿ]+)*)/i);
  
  if (aolMatch && aolMatch[1]) {
    result.origin = aolMatch[1].trim();
    transportEvidence.push(`aol_detected_${result.origin}`);
  }
  if (aodMatch && aodMatch[1]) {
    result.destination = aodMatch[1].trim();
    transportEvidence.push(`aod_detected_${result.destination}`);
  }
  
  // Pattern-based origin detection (if AOL not found)
  const originPatterns = [
    /(?:from|de|départ|origine|EXW|enlèvement\s+(?:à|chez|:))\s*:?\s*([A-ZÀ-Ÿ][a-zà-ÿ]+(?:[\s-][A-ZÀ-Ÿ][a-zà-ÿ]+)*)/i,
    /(?:port\s+(?:of\s+)?loading|POL)\s*:?\s*([A-ZÀ-Ÿ][a-zà-ÿ]+(?:[\s-][A-ZÀ-Ÿ][a-zà-ÿ]+)*)/i,
    /adresse\s+d['']enlèvement[^:]*:\s*[^,\n]*,?\s*([A-ZÀ-Ÿ][a-zà-ÿ]+(?:[\s-][A-ZÀ-Ÿ][a-zà-ÿ]+)*)/i,
  ];
  
  const destPatterns = [
    /(?:to|à|vers|destination|livraison|DAP|DDP|CIF)\s+:?\s*([A-ZÀ-Ÿ][a-zà-ÿ]+(?:[\s-][A-ZÀ-Ÿ][a-zà-ÿ]+)*)/i,
    /(?:port\s+(?:of\s+)?discharge|POD)\s*:?\s*([A-ZÀ-Ÿ][a-zà-ÿ]+(?:[\s-][A-ZÀ-Ÿ][a-zà-ÿ]+)*)/i,
  ];
  
  // All valid locations (merged list - no import-only restriction for origin)
  const allValidLocations = [...new Set([...originLocations, ...westAfricaLocations])];
  
  // Try to extract origin (if not already set by AOL)
  if (!result.origin) {
    for (const pattern of originPatterns) {
      const match = fullContent.match(pattern);
      if (match && match[1]) {
        const extracted = match[1].trim();
        // Accept any valid location as origin (removed import-only restriction)
        if (allValidLocations.some(loc => extracted.toLowerCase().includes(loc.toLowerCase()))) {
          result.origin = extracted;
          break;
        }
      }
    }
  }
  
  // Try to extract destination (if not already set by AOD)
  if (!result.destination) {
    for (const pattern of destPatterns) {
      const match = fullContent.match(pattern);
      if (match && match[1]) {
        const extracted = match[1].trim();
        if (westAfricaLocations.some(loc => extracted.toLowerCase().includes(loc.toLowerCase()))) {
          result.destination = extracted;
          break;
        }
      }
    }
  }
  
  // Fallback: scan for known locations
  if (!result.origin) {
    for (const origin of originLocations) {
      if (new RegExp(`\\b${origin}\\b`, 'i').test(fullContent)) {
        result.origin = origin;
        break;
      }
    }
  }
  
  if (!result.destination) {
    for (const dest of westAfricaLocations) {
      if (new RegExp(`\\b${dest}\\b`, 'i').test(fullContent)) {
        result.destination = dest;
        break;
      }
    }
  }

  // Extract value and currency
  const valueMatch = fullContent.match(/(USD|EUR|FCFA|XOF|\$|€)\s*([\d\s,.]+)|([\d\s,.]+)\s*(USD|EUR|FCFA|XOF)/i);
  if (valueMatch) {
    const curr = (valueMatch[1] || valueMatch[4] || 'USD').toUpperCase();
    const val = (valueMatch[2] || valueMatch[3]).replace(/[\s,]/g, '').replace(',', '.');
    result.value = parseFloat(val);
    result.currency = curr === '$' ? 'USD' : curr === '€' ? 'EUR' : curr;
  }

  // Extract ETA date
  const etaMatch = fullContent.match(/(?:ETA|arrivée|arrival)[:\s]*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i);
  if (etaMatch) {
    const day = etaMatch[1].padStart(2, '0');
    const month = etaMatch[2].padStart(2, '0');
    let year = etaMatch[3];
    if (year.length === 2) year = '20' + year;
    result.eta_date = `${year}-${month}-${day}`;
  }

  // Extract cargo description from attachments
  for (const att of attachments) {
    if (att.extracted_data?.descriptions?.length > 0) {
      result.cargo_description = att.extracted_data.descriptions.slice(0, 3).join(', ');
      break;
    }
  }
  
  // ============ INTELLIGENT TRANSPORT MODE DETECTION ============
  
  // STEP 1: Strip signature/footer from content for mode detection
  const signatureMarkers = [
    /(?:^|\n)\s*(?:best regards|cordialement|sincères salutations|bien à vous|cdlt|regards|thanks|merci)/i,
    /(?:^|\n)\s*--\s*$/m,
    /(?:^|\n)\s*_{3,}/m,
    /<html/i,
  ];
  
  let contentForModeDetection = contentLower;
  for (const marker of signatureMarkers) {
    const match = contentForModeDetection.match(marker);
    if (match && match.index !== undefined) {
      contentForModeDetection = contentForModeDetection.substring(0, match.index);
      transportEvidence.push('signature_stripped');
      break;
    }
  }
  
  // STEP 2: Define keywords with word boundaries (stricter matching)
  const airKeywordsStrong = [
    'fret aérien', 'fret aerien', 'air freight', 'air cargo', 'cargo aérien', 'par avion', 'by air',
    'expédition aérienne', 'envoi aérien', 'livraison aérienne', 'vol cargo',
    'awb', 'airway bill', 'lta', 'lettre de transport aérien',
    'aéroport', 'airport', 'aibd'
  ];
  
  // Standalone "aérien/aerien" only with word boundary (not in "fret aérien" which is already counted)
  const airKeywordsWeak = ['aérien', 'aerien'];
  
  // Maritime keywords - REMOVED "ship" (too ambiguous: shipping, shipment)
  // "bl" is now strict: only "B/L" or standalone "BL" with word boundaries
  const maritimeKeywordsStrong = [
    'fret maritime', 'sea freight', 'ocean freight', 'maritime', 'par mer', 'by sea',
    'fcl', 'lcl', 'conteneur', 'container', 'navire', 'vessel', 'bateau',
    'bill of lading', 'connaissement', 'port de chargement', 'port of loading',
    'embarquement maritime', 'chargement maritime'
  ];
  
  const roadKeywords = [
    'transport routier', 'road transport', 'camion', 'truck', 'remorque', 'trailer',
    'livraison terrestre', 'transit routier'
  ];
  
  let airScore = 0;
  let maritimeScore = 0;
  let roadScore = 0;
  
  // Check STRONG air keywords
  for (const kw of airKeywordsStrong) {
    if (contentForModeDetection.includes(kw)) {
      airScore += 15;
      transportEvidence.push(`air_strong_${kw.replace(/\s+/g, '_')}`);
    }
  }
  
  // Check weak air keywords with word boundary
  for (const kw of airKeywordsWeak) {
    const regex = new RegExp(`\\b${kw}\\b`, 'i');
    if (regex.test(contentForModeDetection) && !contentForModeDetection.includes('fret ' + kw)) {
      airScore += 8;
      transportEvidence.push(`air_weak_${kw}`);
    }
  }
  
  // Check STRONG maritime keywords
  for (const kw of maritimeKeywordsStrong) {
    if (contentForModeDetection.includes(kw)) {
      maritimeScore += 15;
      transportEvidence.push(`maritime_strong_${kw.replace(/\s+/g, '_')}`);
    }
  }
  
  // Check B/L specifically (strict pattern)
  if (/\bB\/L\b/i.test(contentForModeDetection) || /\bBL\s*n[°o]?\s*\d/i.test(contentForModeDetection)) {
    maritimeScore += 15;
    transportEvidence.push('maritime_bl_strict');
  }
  
  // Check road keywords
  for (const kw of roadKeywords) {
    if (contentForModeDetection.includes(kw)) {
      roadScore += 10;
      transportEvidence.push(`road_keyword_${kw.replace(/\s+/g, '_')}`);
    }
  }
  
  // AOL/AOD presence strongly indicates AIR
  if (aolMatch || aodMatch) {
    airScore += 20;
    transportEvidence.push('aol_aod_indicates_air');
  }
  
  // Container detection strongly indicates maritime
  if (result.container_type) {
    maritimeScore += 30;
    transportEvidence.push(`container_detected_${result.container_type}`);
  }
  
  // Weight-based heuristics (ONLY if no strong keywords and as tie-breaker)
  if (result.weight_kg && result.weight_kg <= 300 && !result.container_type) {
    if (airScore > 0 && maritimeScore === 0) {
      // Strong air with light weight - reinforce
      airScore += 10;
      transportEvidence.push(`weight_reinforces_air_${result.weight_kg}kg`);
    } else if (airScore === 0 && maritimeScore === 0 && roadScore === 0) {
      // No keywords, light weight - default to air
      airScore += 10;
      transportEvidence.push(`weight_heuristic_${result.weight_kg}kg_likely_air`);
    }
  }
  
  // Carrier type boost
  if (result.carrier) {
    const airCarriers = ['AIR-FRANCE-CARGO', 'EMIRATES-CARGO', 'QATAR-CARGO', 'TURKISH-CARGO', 
                         'ETHIOPIAN-CARGO', 'AIR-SENEGAL', 'RAM-CARGO', 'ASKY', 'AIR-COTE-IVOIRE'];
    if (airCarriers.includes(result.carrier)) {
      airScore += 20;
      transportEvidence.push(`carrier_air_${result.carrier}`);
    } else {
      maritimeScore += 15;
      transportEvidence.push(`carrier_maritime_${result.carrier}`);
    }
  }
  
  // IATA codes presence
  if (transportEvidence.some(e => e.startsWith('iata_code_'))) {
    airScore += 5;
  }
  
  // ============ INTELLIGENT TIE-BREAKER ============
  // If strong air markers AND light weight AND no container => force AIR
  const hasStrongAirMarkers = airScore >= 15;
  const isLightWeight = !result.weight_kg || result.weight_kg <= 500;
  const noContainer = !result.container_type;
  const noStrongMaritimeMarkers = maritimeScore < 15;
  
  if (hasStrongAirMarkers && isLightWeight && noContainer && noStrongMaritimeMarkers) {
    result.transport_mode = 'air';
    transportEvidence.push('tiebreaker_forced_air');
  } else {
    // Standard logic
    const maxScore = Math.max(airScore, maritimeScore, roadScore);
    
    if (maxScore === 0) {
      result.transport_mode = 'unknown';
      transportEvidence.push('no_transport_indicators');
    } else if (airScore === maxScore && maritimeScore === maxScore) {
      // True tie - prefer air if light weight
      result.transport_mode = isLightWeight ? 'air' : 'maritime';
      transportEvidence.push(`tie_resolved_${result.transport_mode}`);
    } else if (airScore === maxScore) {
      result.transport_mode = 'air';
    } else if (maritimeScore === maxScore) {
      result.transport_mode = 'maritime';
    } else if (roadScore === maxScore) {
      result.transport_mode = 'road';
    } else {
      result.transport_mode = 'unknown';
    }
  }
  
  result.transport_mode_evidence = transportEvidence;
  
  console.log(`Transport mode detection: ${result.transport_mode} (air=${airScore}, maritime=${maritimeScore}, road=${roadScore})`);
  console.log(`Evidence: ${transportEvidence.join(', ')}`);

  return result;
}

const EXPERT_SYSTEM_PROMPT = `Tu es l'ASSISTANT VIRTUEL de SODATRA, transitaire et commissionnaire en douane sénégalais.

=== CONTEXTE ENTREPRISE (CRITIQUE) ===
- **SODATRA** est notre entreprise - nous faisons les cotations et le dédouanement
- **2HL Group** (propriété de Taleb HOBALLAH) est notre PARTENAIRE commercial
  - 2HL sous-traite des opérations de dédouanement à SODATRA
  - Emails de @2hl, @2hlgroup, Taleb = communications avec notre partenaire
- CLIENTS = ceux qui nous demandent des cotations/services
- Quand tu rédiges une réponse, tu parles AU NOM DE SODATRA

=== RÈGLE DE LANGUE ABSOLUE ===
🌍 TU RÉPONDS DANS LA MÊME LANGUE QUE L'EMAIL ORIGINAL.
- detected_language = "FR" → Réponse 100% en français (sauf abréviations pro)
- detected_language = "EN" → Réponse 100% en anglais
⛔ INTERDIT: Mélanger les langues. Si l'email est en anglais, la réponse est ENTIÈREMENT en anglais.

=== RÈGLE DE CONTEXTUALISATION (CRITIQUE) ===
AVANT de donner des prix, vérifie si tu as TOUTES ces informations:
1. Origine (port/pays de départ)
2. Destination finale
3. Incoterm souhaité (FOB, CIF, DAP, DDP...)
4. Type de marchandise (HS code ou description)
5. Mode de transport (container, breakbulk, air)

📋 SI can_quote_now = FALSE (informations manquantes):
- N'invente PAS de prix
- Accuse réception du document (PI, demande, etc.)
- Pose les questions de clarification fournies
- Imagine le contexte opérationnel probable
- NE SAUTE PAS aux tarifs prématurément

📋 SI SEULE UNE PI EST FOURNIE SANS CONTEXTE (request_type = "PI_ONLY"):
1. Accuse réception de la PI
2. Analyse ce que le client attend CONCRÈTEMENT
3. Pose 2-3 questions clés pour clarifier la demande
4. NE DONNE PAS de prix à ce stade - c'est ILLOGIQUE et IRRELEVANT

=== RÈGLES DE STYLE ABSOLUES ===

📏 LONGUEUR MAXIMALE: 15-20 lignes dans le corps du mail. PAS PLUS.
📎 TARIFS EN PIÈCE JOINTE: Les détails chiffrés vont dans un fichier Excel, PAS dans le mail.
✍️ STYLE TÉLÉGRAPHIQUE: Phrases courtes, bullet points, abréviations professionnelles.

🗣️ ABRÉVIATIONS OBLIGATOIRES:
- pls = please / veuillez
- vsl = vessel / navire  
- ctnr = container / conteneur
- docs = documents
- tcs = terms and conditions
- bav = bien à vous
- asap = as soon as possible
- fyi = for your information
- w/ = with
- thks = thanks

👥 DÉLÉGATION D'ÉQUIPE (utiliser quand approprié):
- Pour questions douane/HS codes: "@Équipe Douane pls confirm..."
- Pour suivi opérationnel: "@Équipe Opérations to follow up..."
- Pour booking/shipping: "@Équipe Shipping pls check..."

📝 FORMULE DE CLÔTURE:
- EN: "With we remain," ou "With we remain,\\nBest Regards"
- FR: "Bien à vous," ou "Meilleures Salutations"

⛔ INTERDIT:
- Phrases longues explicatives
- "Je reste à votre entière disposition pour tout renseignement complémentaire"
- "N'hésitez pas à me contacter si vous avez des questions"
- Inclure des tableaux de tarifs détaillés DANS le mail (→ pièce jointe)
- Ton robotique ou trop formel
- Explications réglementaires longues (sauf si demandé)
- DONNER DES PRIX SANS CONTEXTE SUFFISANT

=== RÈGLE TARIFAIRE ABSOLUE ===
TU N'INVENTES JAMAIS DE TARIF.
- Si tarif exact absent → "À CONFIRMER" ou "TBC"
- Utilise UNIQUEMENT: PORT_TARIFFS, CARRIER_BILLING, TAX_RATES, HS_CODES
- Si contexte insuffisant → PAS DE PRIX, pose des questions

=== FORMAT DE SORTIE JSON ===
{
  "detected_language": "FR" | "EN",
  "request_type": "PI_ONLY" | "QUOTATION_REQUEST" | "QUESTION" | "ACKNOWLEDGMENT" | "FOLLOW_UP",
  "can_quote_now": true | false,
  "clarification_questions": ["Question 1?", "Question 2?"],
  "subject": "Re: [sujet original]",
  "greeting": "Gd day Dear [Prénom]," (EN) ou "Bonjour [Prénom]," (FR),
  "body_short": "Corps CONCIS (15-20 lignes MAX). Style télégraphique. Si can_quote_now=false, pose les questions au lieu de donner des prix.",
  "delegation": "@Cherif pls confirm HS codes" | "@Eric to follow up" | null,
  "closing": "With we remain,\\nBest Regards" (EN) ou "Bien à vous,\\nMeilleures Salutations" (FR),
  "signature": "SODATRA\\nTransit & Dédouanement",
  "attachment_needed": true | false,
  "attachment_type": "excel_quotation | rate_sheet | proforma | none",
  "attachment_data": {
    "filename": "Quotation_[Client]_[Date].xlsx",
    "posts": [
      { "description": "THC 40'", "montant": 310000, "devise": "FCFA", "source": "PORT_TARIFFS" }
    ],
    "total": 850000,
    "currency": "FCFA"
  },
  "response_template_used": "quotation_standard | pi_only_needs_clarification | quotation_exempt | regime_question | acknowledgment | custom",
  "carrier_detected": "MSC | HAPAG-LLOYD | MAERSK | CMA CGM | GRIMALDI | UNKNOWN",
  "container_info": { "type": "40", "evp_multiplier": 2 },
  "regulatory_analysis": {
    "requested_regime": "ATE",
    "recommended_regime": "TRIE",
    "regime_code": "S120",
    "regime_appropriate": false,
    "correction_needed": true,
    "correction_explanation": "BREF: Mali = TRIE obligatoire (Art. 161-169)",
    "legal_references": { "articles_cited": ["Art. 161-169"], "code_source": "Loi 2014-10" }
  },
  "quotation_summary": {
    "total_debours": 850000,
    "total_honoraires": 150000,
    "total_general": 1000000,
    "devise": "FCFA",
    "confidence": 0.85
  },
  "missing_info": ["Valeur CAF", "Code HS exact"],
  "follow_up_needed": true,
  "two_step_response": {
    "is_two_step": false,
    "step_1_content": "Container rates attached. Breakbulk to follow.",
    "step_2_pending": "Breakbulk rates"
  }
}`;

// Helper function to select the best expert based on email content
function selectExpertForResponse(emailContent: string, subject: string): 'taleb' | 'cherif' {
  const douaneKeywords = ['douane', 'hs code', 'customs', 'dédouanement', 'tarif douanier', 'nomenclature', 'duty', 'tax', 'droits de douane', 'clearance', 'declaration'];
  const transportKeywords = ['transport', 'fret', 'shipping', 'thc', 'dam', 'transit', 'incoterm', 'booking', 'bl', 'conteneur', 'container', 'vessel', 'freight', 'port', 'logistique'];
  
  const content = (emailContent + ' ' + subject).toLowerCase();
  
  const douaneScore = douaneKeywords.filter(k => content.includes(k)).length;
  const transportScore = transportKeywords.filter(k => content.includes(k)).length;
  
  // Cherif for customs-focused, Taleb for transport/global quotations
  return douaneScore > transportScore ? 'cherif' : 'taleb';
}

// Build the style injection prompt from expert profile - REINFORCES CONCISE STYLE
function buildStyleInjection(expert: any): string {
  if (!expert || !expert.communication_style) {
    return '';
  }
  
  const style = expert.communication_style;
  const patterns = expert.response_patterns || [];
  
  let injection = `

=== STYLE OBLIGATOIRE: ${expert.name.toUpperCase()} ===

📏 RAPPEL CRITIQUE: 15-20 LIGNES MAXIMUM. Style télégraphique.

📝 TON: ${style.tone || 'professionnel, direct'}
🌍 LANGUE: ${style.language || 'bilingue FR/EN'}

`;

  if (style.formulas) {
    if (style.formulas.opening && style.formulas.opening.length > 0) {
      injection += `📨 OUVERTURE (choisir UNE):\n`;
      style.formulas.opening.slice(0, 3).forEach((f: string) => {
        injection += `   • "${f}"\n`;
      });
    }
    if (style.formulas.closing && style.formulas.closing.length > 0) {
      injection += `📨 CLÔTURE (choisir UNE):\n`;
      style.formulas.closing.slice(0, 3).forEach((f: string) => {
        injection += `   • "${f}"\n`;
      });
    }
    if (style.formulas.signature) {
      injection += `✍️ SIGNATURE:\n${style.formulas.signature}\n\n`;
    }
  }

  if (style.distinctive_traits && style.distinctive_traits.length > 0) {
    injection += `🎯 TRAITS À REPRODUIRE: ${style.distinctive_traits.slice(0, 5).join(' | ')}\n`;
  }

  if (patterns.length > 0) {
    injection += `\n📋 EXEMPLES RÉELS (imiter ce style):\n`;
    patterns.slice(0, 2).forEach((p: any) => {
      if (p.trigger && p.examples && p.examples.length > 0) {
        const example = p.examples[0].substring(0, 80).replace(/\n/g, ' ');
        injection += `   "${p.trigger}" → "${example}..."\n`;
      }
    });
  }

  injection += `
⛔ INTERDIT: phrases longues, ton robotique, "Je reste à votre disposition...", tableaux dans le mail
✅ OBLIGATOIRE: abréviations (pls, vsl, ctnr), "With we remain,", tarifs en pièce jointe
`;

  return injection;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { emailId, customInstructions, expertStyle } = await req.json();
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the original email
    const { data: email, error: emailError } = await supabase
      .from('emails')
      .select('*')
      .eq('id', emailId)
      .single();

    if (emailError || !email) {
      throw new Error("Email non trouvé");
    }

    console.log("Generating expert response for email:", email.subject);

    // ============ FETCH OFFICIAL PORT TARIFFS (PRIMARY SOURCE) ============
    const { data: portTariffs } = await supabase
      .from('port_tariffs')
      .select('*')
      .eq('is_active', true)
      .order('provider')
      .order('operation_type');

    let portTariffsContext = '\n\n=== TARIFS PORTUAIRES OFFICIELS (port_tariffs) ===\n';
    portTariffsContext += '⚠️ UTILISER CES MONTANTS EXACTS - NE PAS ESTIMER\n\n';
    
    if (portTariffs && portTariffs.length > 0) {
      // Group by provider
      const byProvider = portTariffs.reduce((acc: Record<string, typeof portTariffs>, t) => {
        if (!acc[t.provider]) acc[t.provider] = [];
        acc[t.provider].push(t);
        return acc;
      }, {});

      for (const [provider, tariffs] of Object.entries(byProvider)) {
        portTariffsContext += `## ${provider} (Source: ${tariffs[0]?.source_document || 'Officiel'})\n`;
        portTariffsContext += '| Opération | Classification | Cargo | Montant (FCFA) | Surcharge |\n';
        portTariffsContext += '|-----------|----------------|-------|----------------|------------|\n';
        for (const t of tariffs) {
          const surcharge = t.surcharge_percent > 0 ? `+${t.surcharge_percent}% (${t.surcharge_conditions || 'conditions'})` : '-';
          portTariffsContext += `| ${t.operation_type} | ${t.classification} | ${t.cargo_type || 'N/A'} | ${t.amount.toLocaleString('fr-FR')} | ${surcharge} |\n`;
        }
        portTariffsContext += '\n';
      }
    } else {
      portTariffsContext += '⚠️ AUCUN TARIF PORTUAIRE CONFIGURÉ - TOUS LES THC/MANUTENTION À CONFIRMER\n';
    }

    // ============ FETCH CARRIER BILLING TEMPLATES ============
    const { data: carrierTemplates } = await supabase
      .from('carrier_billing_templates')
      .select('*')
      .eq('is_active', true)
      .order('carrier')
      .order('invoice_sequence')
      .order('charge_code');

    let carrierBillingContext = '\n\n=== TEMPLATES DE FACTURATION PAR COMPAGNIE (carrier_billing_templates) ===\n';
    carrierBillingContext += '⚠️ UTILISER CETTE STRUCTURE POUR IDENTIFIER LES FRAIS SELON LE TRANSPORTEUR\n\n';
    
    if (carrierTemplates && carrierTemplates.length > 0) {
      // Group by carrier
      const byCarrier = carrierTemplates.reduce((acc: Record<string, typeof carrierTemplates>, t) => {
        if (!acc[t.carrier]) acc[t.carrier] = [];
        acc[t.carrier].push(t);
        return acc;
      }, {});

      for (const [carrier, templates] of Object.entries(byCarrier)) {
        // Check if multi-invoice structure
        const invoiceTypes = [...new Set(templates.map(t => t.invoice_type))];
        const isMultiInvoice = invoiceTypes.length > 1 || templates.some(t => t.invoice_sequence > 1);
        
        carrierBillingContext += `## ${carrier.replace('_', '-')}`;
        if (isMultiInvoice) {
          carrierBillingContext += ` (${invoiceTypes.length} factures séparées)`;
        } else {
          carrierBillingContext += ' (facture unique consolidée)';
        }
        carrierBillingContext += '\n';

        // Group by invoice_type for multi-invoice carriers
        const byInvoiceType = templates.reduce((acc: Record<string, typeof templates>, t) => {
          const key = `${t.invoice_type}_${t.invoice_sequence}`;
          if (!acc[key]) acc[key] = [];
          acc[key].push(t);
          return acc;
        }, {});

        for (const [invoiceKey, charges] of Object.entries(byInvoiceType)) {
          const firstCharge = charges[0];
          if (isMultiInvoice) {
            carrierBillingContext += `\n### Facture ${firstCharge.invoice_sequence}: ${firstCharge.invoice_type}\n`;
          }
          carrierBillingContext += '| Code | Frais | Méthode | Montant | Devise | TVA | Notes |\n';
          carrierBillingContext += '|------|-------|---------|---------|--------|-----|-------|\n';
          for (const c of charges) {
            const montant = c.is_variable ? 'VARIABLE' : (c.default_amount?.toLocaleString('fr-FR') || 'À CONFIRMER');
            const notes = [c.base_reference, c.notes].filter(Boolean).join(' - ') || '-';
            carrierBillingContext += `| ${c.charge_code} | ${c.charge_name} | ${c.calculation_method} | ${montant} | ${c.currency} | ${c.vat_rate}% | ${notes.substring(0, 50)} |\n`;
          }
        }
        carrierBillingContext += '\n';
      }
    } else {
      carrierBillingContext += '⚠️ AUCUN TEMPLATE DE FACTURATION CONFIGURÉ\n';
    }

    // ============ FETCH OFFICIAL TAX RATES ============
    const { data: taxRates } = await supabase
      .from('tax_rates')
      .select('*')
      .eq('is_active', true);

    let taxRatesContext = '\n\n=== TAUX OFFICIELS (tax_rates) ===\n';
    if (taxRates && taxRates.length > 0) {
      taxRatesContext += '| Code | Nom | Taux (%) | Base de calcul | Applicable à |\n';
      taxRatesContext += '|------|-----|----------|----------------|---------------|\n';
      for (const rate of taxRates) {
        taxRatesContext += `| ${rate.code} | ${rate.name} | ${rate.rate}% | ${rate.base_calculation} | ${rate.applies_to || 'Tous'} |\n`;
      }
    }

    // ============ FETCH AND ANALYZE ATTACHMENTS ============
    let { data: attachments } = await supabase
      .from('email_attachments')
      .select('*')
      .eq('email_id', emailId);

    // Auto-analyze unanalyzed attachments
    if (attachments && attachments.some(att => !att.is_analyzed)) {
      console.log("Found unanalyzed attachments, triggering analysis...");
      
      const unanalyzedIds = attachments.filter(att => !att.is_analyzed).map(att => att.id);
      
      for (const attId of unanalyzedIds) {
        try {
          console.log(`Analyzing attachment ${attId}...`);
          
          // Get the attachment details
          const attachment = attachments.find(a => a.id === attId);
          if (!attachment) continue;
          
          const isImage = attachment.content_type?.startsWith('image/');
          const isPdf = attachment.content_type === 'application/pdf';
          
          if (!isImage && !isPdf) {
            // Mark non-visual files as analyzed
            await supabase
              .from('email_attachments')
              .update({ 
                is_analyzed: true,
                extracted_data: { type: 'unsupported', content_type: attachment.content_type }
              })
              .eq('id', attId);
            continue;
          }
          
          // Skip files larger than 4MB (API limit)
          const MAX_FILE_SIZE = 4 * 1024 * 1024;
          if (attachment.size && attachment.size > MAX_FILE_SIZE) {
            console.log(`Skipping ${attachment.filename} - file too large (${attachment.size} bytes)`);
            await supabase
              .from('email_attachments')
              .update({ 
                is_analyzed: true,
                extracted_text: `Fichier trop volumineux (${Math.round(attachment.size / 1024)}KB) - analyse manuelle requise`,
                extracted_data: { type: 'too_large', size: attachment.size, filename: attachment.filename }
              })
              .eq('id', attId);
            continue;
          }
          
          // Download the file
          const { data: fileData, error: downloadError } = await supabase
            .storage
            .from('documents')
            .download(attachment.storage_path);
          
          if (downloadError || !fileData) {
            console.error(`Failed to download ${attachment.filename}:`, downloadError);
            await supabase
              .from('email_attachments')
              .update({ 
                is_analyzed: true,
                extracted_data: { type: 'download_failed', error: downloadError?.message || 'Unknown error' }
              })
              .eq('id', attId);
            continue;
          }
          
          // Convert to base64
          const arrayBuffer = await fileData.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          const CHUNK_SIZE = 8192;
          let base64 = '';
          for (let i = 0; i < uint8Array.length; i += CHUNK_SIZE) {
            const chunk = uint8Array.slice(i, i + CHUNK_SIZE);
            base64 += String.fromCharCode.apply(null, Array.from(chunk));
          }
          base64 = btoa(base64);
          
          const mimeType = attachment.content_type || 'image/jpeg';
          const dataUrl = `data:${mimeType};base64,${base64}`;
          
          console.log(`Sending ${attachment.filename} to AI (${Math.round(arrayBuffer.byteLength / 1024)}KB)...`);
          
          // Analyze with AI
          const aiAnalysisResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${LOVABLE_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash',
              messages: [
                {
                  role: 'system',
                  content: `Tu es un assistant expert en analyse de documents commerciaux et logistiques.
Analyse l'image fournie et extrais TOUTES les informations pertinentes pour une cotation:
- Valeur CAF/FOB des marchandises
- Description des produits
- Codes SH si visibles
- Nom du fournisseur/client
- Coordonnées bancaires
- Quantités et poids
- Conditions de paiement
Réponds en JSON: { "type": "facture|proforma|bl|signature|logo|autre", "valeur_caf": number|null, "devise": "USD|EUR|FCFA", "descriptions": [], "codes_hs": [], "fournisseur": "", "quantites": "", "poids": "", "text_content": "texte visible", "confidence": 0.0-1.0 }`
                },
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: `Analyse cette pièce jointe (${attachment.filename}) pour en extraire les données commerciales.` },
                    { type: 'image_url', image_url: { url: dataUrl } }
                  ]
                }
              ]
            }),
          });
          
          if (aiAnalysisResponse.ok) {
            const aiData = await aiAnalysisResponse.json();
            const content = aiData.choices?.[0]?.message?.content || '';
            
            let extractedData: any = { raw_response: content };
            let extractedText = '';
            
            try {
              const jsonMatch = content.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                extractedData = JSON.parse(jsonMatch[0]);
                extractedText = extractedData.text_content || extractedData.descriptions?.join('\n') || '';
              }
            } catch {
              extractedText = content;
            }
            
            await supabase
              .from('email_attachments')
              .update({
                is_analyzed: true,
                extracted_text: extractedText,
                extracted_data: extractedData
              })
              .eq('id', attId);
              
            console.log(`Successfully analyzed: ${attachment.filename}`);
          } else {
            const errorText = await aiAnalysisResponse.text();
            console.error(`AI analysis failed for ${attachment.filename}:`, aiAnalysisResponse.status, errorText);
            
            // Mark as analyzed with error info
            await supabase
              .from('email_attachments')
              .update({ 
                is_analyzed: true,
                extracted_text: `Analyse AI échouée (${aiAnalysisResponse.status})`,
                extracted_data: { type: 'ai_error', status: aiAnalysisResponse.status, error: errorText.substring(0, 500) }
              })
              .eq('id', attId);
          }
        } catch (error) {
          console.error(`Error analyzing attachment ${attId}:`, error);
        }
      }
      
      // Re-fetch attachments after analysis
      const { data: updatedAttachments } = await supabase
        .from('email_attachments')
        .select('*')
        .eq('email_id', emailId);
      
      if (updatedAttachments) {
        attachments = updatedAttachments;
      }
    }

    let attachmentsContext = '';
    if (attachments && attachments.length > 0) {
      attachmentsContext = '\n\n=== PIÈCES JOINTES ANALYSÉES ===\n';
      for (const att of attachments) {
        attachmentsContext += `📎 ${att.filename} (${att.content_type})\n`;
        if (att.extracted_text) {
          attachmentsContext += `Contenu extrait:\n${att.extracted_text.substring(0, 3000)}\n`;
        }
        if (att.extracted_data) {
          const data = att.extracted_data as any;
          if (data.valeur_caf) {
            attachmentsContext += `💰 VALEUR CAF: ${data.valeur_caf} ${data.devise || ''}\n`;
          }
          if (data.descriptions?.length) {
            attachmentsContext += `📦 Descriptions: ${data.descriptions.join(', ')}\n`;
          }
          if (data.codes_hs?.length) {
            attachmentsContext += `🏷️ Codes HS: ${data.codes_hs.join(', ')}\n`;
          }
          if (data.fournisseur) {
            attachmentsContext += `🏢 Fournisseur: ${data.fournisseur}\n`;
          }
          attachmentsContext += `Données complètes: ${JSON.stringify(data)}\n`;
        }
        if (!att.is_analyzed) {
          attachmentsContext += `⚠️ Analyse impossible - format non supporté\n`;
        }
      }
    }

    // ============ FETCH CUSTOMS REGIMES ============
    const { data: regimes } = await supabase
      .from('customs_regimes')
      .select('*')
      .eq('is_active', true);

    let regimesContext = '\n\n=== RÉGIMES DOUANIERS ===\n';
    if (regimes && regimes.length > 0) {
      regimesContext += '| Code | Nom | DD | TVA | COSEC | PCS | PCC | RS | Usage |\n';
      regimesContext += '|------|-----|----|----|-------|-----|-----|----|---------|\n';
      for (const r of regimes) {
        regimesContext += `| ${r.code} | ${r.name} | ${r.dd ? 'Oui' : 'Non'} | ${r.tva ? 'Oui' : 'Non'} | ${r.cosec ? 'Oui' : 'Non'} | ${r.pcs ? 'Oui' : 'Non'} | ${r.pcc ? 'Oui' : 'Non'} | ${r.rs ? 'Oui' : 'Non'} | ${r.use_case || ''} |\n`;
      }
    }

    // ============ FETCH LEARNED TARIFFS (validated only) ============
    const { data: knowledge } = await supabase
      .from('learned_knowledge')
      .select('*')
      .eq('is_validated', true)
      .in('category', ['tarif', 'tariff', 'rate', 'frais', 'honoraires'])
      .order('confidence', { ascending: false })
      .limit(50);

    let tariffKnowledgeContext = '';
    if (knowledge && knowledge.length > 0) {
      tariffKnowledgeContext = '\n\n=== TARIFS VALIDÉS (opérations précédentes) ===\n';
      for (const k of knowledge) {
        tariffKnowledgeContext += `• ${k.name}: ${k.description}\n`;
        if (k.data) {
          const data = k.data as any;
          if (data.montant) {
            tariffKnowledgeContext += `  Montant: ${data.montant} ${data.devise || 'FCFA'}\n`;
          }
          if (data.conditions) {
            tariffKnowledgeContext += `  Conditions: ${data.conditions}\n`;
          }
        }
      }
    }

    // ============ FETCH EXPERT PROFILES AND SELECT STYLE ============
    const { data: allExperts } = await supabase
      .from('expert_profiles')
      .select('*');

    // Find Taleb and Cherif profiles
    const talebProfile = allExperts?.find(e => 
      e.email?.toLowerCase().includes('taleb') || 
      e.name?.toLowerCase().includes('taleb') ||
      e.is_primary
    );
    const cherifProfile = allExperts?.find(e => 
      e.email?.toLowerCase().includes('douane@sodatra') || 
      e.name?.toLowerCase().includes('cherif')
    );

    // Determine which expert style to use
    let selectedExpert = talebProfile; // Default to Taleb
    let expertName = 'taleb';
    
    if (expertStyle === 'cherif' && cherifProfile) {
      selectedExpert = cherifProfile;
      expertName = 'cherif';
    } else if (expertStyle === 'auto' || !expertStyle) {
      // Auto-detect based on email content
      const emailContent = (email.body_text || '') + ' ' + (email.subject || '');
      expertName = selectExpertForResponse(emailContent, email.subject || '');
      selectedExpert = expertName === 'cherif' ? cherifProfile : talebProfile;
    } else if (expertStyle === 'taleb') {
      selectedExpert = talebProfile;
      expertName = 'taleb';
    }

    console.log(`Selected expert style: ${expertName} (${selectedExpert?.name || 'default'})`);

    // Build the style injection for the selected expert
    const styleInjection = buildStyleInjection(selectedExpert);
    
    let expertContext = '';
    if (selectedExpert) {
      expertContext = `\n\n=== PROFIL EXPERT SÉLECTIONNÉ: ${selectedExpert.name} ===\n`;
      expertContext += `Email: ${selectedExpert.email}\n`;
      expertContext += `Role: ${selectedExpert.role || 'Expert'}\n`;
      expertContext += styleInjection;
    }

    // ============ GET THREAD CONTEXT WITH ROLE IDENTIFICATION ============
    let threadContext = '';
    let threadRoleContext = '';
    
    // Récupérer les infos du fil de discussion
    if (email.thread_ref) {
      const { data: threadInfo } = await supabase
        .from('email_threads')
        .select('*')
        .eq('id', email.thread_ref)
        .single();
      
      if (threadInfo) {
        threadRoleContext = `\n\n=== CONTEXTE FIL DE DISCUSSION ===\n`;
        threadRoleContext += `📌 Sujet normalisé: ${threadInfo.subject_normalized}\n`;
        if (threadInfo.project_name) {
          threadRoleContext += `📋 Projet: ${threadInfo.project_name}\n`;
        }
        threadRoleContext += `👥 Participants: ${(threadInfo.participants || []).join(', ')}\n`;
        
        if (threadInfo.client_email) {
          threadRoleContext += `\n🏢 CLIENT FINAL: ${threadInfo.client_company || 'N/A'} (${threadInfo.client_email})\n`;
        }
        
        if (threadInfo.our_role === 'assist_partner') {
          threadRoleContext += `\n⚠️ RÔLE SODATRA: ASSISTER LE PARTENAIRE\n`;
          threadRoleContext += `👤 Partenaire: ${threadInfo.partner_email || '2HL Group'}\n`;
          threadRoleContext += `📝 Action: Préparer une cotation que le PARTENAIRE transmettra au client final.\n`;
          threadRoleContext += `   → Ne pas répondre directement au client.\n`;
          threadRoleContext += `   → Adresser la réponse au partenaire.\n`;
        } else {
          threadRoleContext += `\n✅ RÔLE SODATRA: COTATION DIRECTE\n`;
          threadRoleContext += `📝 Action: Répondre directement au client avec notre cotation.\n`;
        }
        
        threadRoleContext += `\n📊 Statistiques fil:\n`;
        threadRoleContext += `   • ${threadInfo.email_count || 1} message(s) dans le fil\n`;
        threadRoleContext += `   • Premier message: ${threadInfo.first_message_at ? new Date(threadInfo.first_message_at).toLocaleDateString('fr-FR') : 'N/A'}\n`;
        threadRoleContext += `   • Dernier message: ${threadInfo.last_message_at ? new Date(threadInfo.last_message_at).toLocaleDateString('fr-FR') : 'N/A'}\n`;
      }
    }
    
    // Récupérer les infos du contact expéditeur
    const { data: senderContact } = await supabase
      .from('contacts')
      .select('*')
      .eq('email', email.from_address.toLowerCase())
      .maybeSingle();
    
    if (senderContact) {
      threadRoleContext += `\n\n=== PROFIL EXPÉDITEUR ===\n`;
      threadRoleContext += `📧 Email: ${senderContact.email}\n`;
      threadRoleContext += `🏢 Entreprise: ${senderContact.company || 'N/A'}\n`;
      threadRoleContext += `👤 Rôle: ${senderContact.role?.toUpperCase() || 'PROSPECT'}\n`;
      threadRoleContext += `📊 Interactions: ${senderContact.interaction_count || 1}\n`;
      if (senderContact.is_trusted) {
        threadRoleContext += `✅ Contact de confiance\n`;
      }
    }
    
    // Historique du fil
    if (email.thread_id) {
      const { data: threadEmails } = await supabase
        .from('emails')
        .select('from_address, subject, body_text, sent_at')
        .eq('thread_id', email.thread_id)
        .order('sent_at', { ascending: true });

      if (threadEmails && threadEmails.length > 1) {
        threadContext = '\n\n=== HISTORIQUE DU FIL (du plus ancien au plus récent) ===\n';
        for (const e of threadEmails) {
          const senderRole = await identifySenderRole(supabase, e.from_address);
          threadContext += `--- [${senderRole}] ${e.from_address} (${new Date(e.sent_at).toLocaleDateString('fr-FR')}) ---\n`;
          threadContext += e.body_text?.substring(0, 1500) + '\n\n';
        }
      }
    }

// Helper function pour identifier le rôle d'un expéditeur
async function identifySenderRole(supabase: any, email: string): Promise<string> {
  const { data: contact } = await supabase
    .from('contacts')
    .select('role')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  
  if (contact?.role) {
    const roleMap: Record<string, string> = {
      'client': 'CLIENT',
      'partner': 'PARTENAIRE',
      'supplier': 'FOURNISSEUR',
      'internal': 'SODATRA',
      'agent': 'AGENT',
      'prospect': 'PROSPECT',
    };
    return roleMap[contact.role] || contact.role.toUpperCase();
  }
  
  if (email.toLowerCase().includes('@sodatra')) return 'SODATRA';
  if (email.toLowerCase().includes('2hl')) return 'PARTENAIRE';
  return 'EXTERNE';
}

    // ============ DETECT REGIME AND ADD LEGAL CONTEXT ============
    const emailContent = (email.body_text || '') + ' ' + (email.subject || '');
    const detectedRegimes: string[] = [];
    
    // Detect mentioned regimes
    if (/\bATE\b|admission\s+temporaire/i.test(emailContent)) {
      detectedRegimes.push('ATE');
    }
    if (/\bTRIE\b|S120|transit\s+international/i.test(emailContent)) {
      detectedRegimes.push('TRIE');
    }
    if (/\bC10\b|mise\s+à\s+la\s+consommation|import\s+définitif/i.test(emailContent)) {
      detectedRegimes.push('C10');
    }
    if (/\bMali\b|Burkina|Niger|Guinée/i.test(emailContent)) {
      detectedRegimes.push('TRIE'); // Transit likely needed for these destinations
    }
    
    // Generate legal context based on detected regimes
    let legalContext = '';
    if (detectedRegimes.length > 0) {
      legalContext = '\n\n=== RÉFÉRENCE LÉGALE - CODE DES DOUANES (Loi 2014-10) ===\n';
      legalContext += `Source: ${CUSTOMS_CODE_REFERENCE.source}\n`;
      
      for (const regime of [...new Set(detectedRegimes)]) {
        legalContext += getLegalContextForRegime(regime);
      }
      
      // Add regime appropriateness analysis for detected destinations
      const maliMatch = emailContent.match(/\b(Mali|Bamako)\b/i);
      const burkinaMatch = emailContent.match(/\b(Burkina|Ouagadougou)\b/i);
      const destination = maliMatch?.[1] || burkinaMatch?.[1] || '';
      
      if (destination && detectedRegimes.includes('ATE')) {
        const analysis = analyzeRegimeAppropriateness('ATE', destination, 'import');
        if (!analysis.isAppropriate) {
          legalContext += `\n\n⚠️ ALERTE RÉGIME INAPPROPRIÉ:\n`;
          legalContext += `${analysis.explanation}\n`;
          legalContext += `📋 Régime recommandé: ${analysis.recommendedRegime}\n`;
          legalContext += `📖 Base légale: ${analysis.legalBasis}\n`;
        }
      }
    } else {
      // Add general legal context
      legalContext = '\n\n=== RÉFÉRENCE LÉGALE DISPONIBLE ===\n';
      legalContext += 'Code des Douanes du Sénégal (Loi 2014-10 du 28 février 2014)\n';
      legalContext += '- Admission Temporaire (ATE): Articles 217-218\n';
      legalContext += '- Transit International (TRIE): Articles 161-169\n';
      legalContext += '- Mise à la consommation: Articles 155-160\n';
      legalContext += '- Valeur en douane: Articles 18-19\n';
    }

    // ============ CTU CODE CONTEXT (Container Loading Best Practices) ============
    let ctuContext = '';
    const fullEmailContent = (email.body_text || '') + ' ' + (email.subject || '') + ' ' + 
      (attachments?.map(a => a.extracted_text || '').join(' ') || '');
    
    if (isCTURelevant(fullEmailContent)) {
      const relevantCTUContexts = getAllRelevantCTUContexts(fullEmailContent);
      if (relevantCTUContexts.length > 0) {
        ctuContext = '\n\n=== CODE CTU - BONNES PRATIQUES EMPOTAGE/CHARGEMENT ===\n';
        ctuContext += 'Source: Code de bonnes pratiques OMI/OIT/CEE-ONU pour le chargement des cargaisons (Janvier 2014)\n';
        ctuContext += 'Document: public/data/CTU_Code_French_01.pdf\n\n';
        ctuContext += relevantCTUContexts.join('\n---\n');
        console.log(`CTU context added: ${relevantCTUContexts.length} sections`);
      }
    }

    // ============ LANGUAGE & REQUEST ANALYSIS ============
    const detectedLanguage = detectEmailLanguage(email.body_text, email.subject);
    const requestAnalysis = analyzeRequestType(email, attachments || []);
    
    console.log(`Language: ${detectedLanguage}, Request type: ${requestAnalysis.type}, Can quote: ${requestAnalysis.canQuote}`);

    // ============ V5 WORKFLOW: EXTRACT DATA FOR ANALYSIS ============
    // Extract weight, volume, container, carrier, incoterm from email and attachments
    const extractedData = extractShipmentData(fullEmailContent, attachments || []);
    console.log("Extracted shipment data:", JSON.stringify(extractedData));

    // ============ V5 WORKFLOW: CALL NEW ANALYSIS FUNCTIONS ============
    let coherenceResult: any = null;
    let incotermResult: any = null;
    let riskResult: any = null;
    let v5AnalysisContext = '';

    try {
      // 1. Audit Coherence (poids/volume validation)
      if (extractedData.weight_kg || extractedData.volume_cbm || extractedData.container_type) {
        console.log("Calling audit-coherence...");
        const coherenceResponse = await fetch(`${supabaseUrl}/functions/v1/audit-coherence`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            weight_kg: extractedData.weight_kg,
            volume_cbm: extractedData.volume_cbm,
            container_type: extractedData.container_type,
            cargo_description: extractedData.cargo_description,
          }),
        });
        if (coherenceResponse.ok) {
          coherenceResult = await coherenceResponse.json();
          console.log("Coherence result:", JSON.stringify(coherenceResult));
        }
      }

      // 2. Arbitrage Incoterm
      if (extractedData.incoterm) {
        console.log("Calling arbitrage-incoterm...");
        const incotermResponse = await fetch(`${supabaseUrl}/functions/v1/arbitrage-incoterm`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            incoterm: extractedData.incoterm,
            origin_country: extractedData.origin,
            destination_country: extractedData.destination,
            fob_value: extractedData.value,
            currency: extractedData.currency,
          }),
        });
        if (incotermResponse.ok) {
          incotermResult = await incotermResponse.json();
          console.log("Incoterm result:", JSON.stringify(incotermResult));
        }
      }

      // 3. Analyze Risks (temps, nature, provisions)
      console.log("Calling analyze-risks...");
      const riskResponse = await fetch(`${supabaseUrl}/functions/v1/analyze-risks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          eta_date: extractedData.eta_date,
          cargo_nature: extractedData.cargo_description,
          destination: extractedData.destination,
          container_type: extractedData.container_type,
          carrier: extractedData.carrier,
          is_transit: /mali|bamako|burkina|ouaga|niger|guinée/i.test(extractedData.destination || ''),
          transit_destination: extractedData.destination,
        }),
      });
      if (riskResponse.ok) {
        riskResult = await riskResponse.json();
        console.log("Risk result:", JSON.stringify(riskResult));
      }

    } catch (analysisError) {
      console.error("V5 analysis error (non-blocking):", analysisError);
    }

    // ============ BUILD V5 ANALYSIS CONTEXT ============
    if (coherenceResult || incotermResult || riskResult) {
      v5AnalysisContext = '\n\n=== ANALYSE V5 WORKFLOW ===\n';

      // Coherence analysis
      if (coherenceResult) {
        v5AnalysisContext += '\n📦 AUDIT COHÉRENCE POIDS/VOLUME:\n';
        v5AnalysisContext += `   Cohérent: ${coherenceResult.is_coherent ? '✅ OUI' : '❌ NON'}\n`;
        if (coherenceResult.density_kg_cbm) {
          v5AnalysisContext += `   Densité: ${coherenceResult.density_kg_cbm} kg/m³\n`;
        }
        if (coherenceResult.alerts?.length > 0) {
          v5AnalysisContext += `   ⚠️ ALERTES:\n`;
          for (const alert of coherenceResult.alerts) {
            v5AnalysisContext += `      • ${alert.message_fr}\n`;
          }
        }
        if (coherenceResult.ctu_code_check_needed) {
          v5AnalysisContext += `   📋 Vérification CTU Code recommandée\n`;
        }
      }

      // Incoterm analysis
      if (incotermResult?.incoterm) {
        v5AnalysisContext += `\n📋 ARBITRAGE INCOTERM ${incotermResult.incoterm.code} (Groupe ${incotermResult.incoterm.groupe}):\n`;
        v5AnalysisContext += `   ${incotermResult.incoterm.description_fr}\n`;
        v5AnalysisContext += `   Méthode CAF: ${incotermResult.caf_calculation?.method}\n`;
        if (incotermResult.quotation_guidance?.what_to_include_fr?.length > 0) {
          v5AnalysisContext += `   COÛTS À INCLURE DANS LA COTATION:\n`;
          for (const cost of incotermResult.quotation_guidance.what_to_include_fr) {
            v5AnalysisContext += `      ${cost}\n`;
          }
        }
        if (incotermResult.quotation_guidance?.vigilance_points_fr?.length > 0) {
          v5AnalysisContext += `   ⚠️ POINTS DE VIGILANCE:\n`;
          for (const point of incotermResult.quotation_guidance.vigilance_points_fr) {
            v5AnalysisContext += `      ${point}\n`;
          }
        }
      }

      // Risk analysis
      if (riskResult) {
        v5AnalysisContext += '\n🎯 ANALYSE DES RISQUES:\n';
        v5AnalysisContext += `   Risque temps: ${riskResult.time_risk?.level?.toUpperCase() || 'N/A'} - ${riskResult.time_risk?.risk_explanation_fr || ''}\n`;
        v5AnalysisContext += `   Risque nature: ${riskResult.nature_risk?.level?.toUpperCase() || 'N/A'} - ${riskResult.nature_risk?.risk_explanation_fr || ''}\n`;
        
        if (riskResult.provisions?.total_provisions_fcfa > 0) {
          v5AnalysisContext += `   💰 PROVISIONS RECOMMANDÉES: ${riskResult.provisions.total_provisions_fcfa.toLocaleString('fr-FR')} FCFA\n`;
          for (const line of riskResult.provisions.breakdown || []) {
            v5AnalysisContext += `      • ${line.item}: ${line.amount.toLocaleString('fr-FR')} ${line.currency} (${line.reason})\n`;
          }
        }

        if (riskResult.vigilance_points?.length > 0) {
          v5AnalysisContext += `   📌 POINTS DE VIGILANCE À MENTIONNER:\n`;
          for (const vp of riskResult.vigilance_points) {
            v5AnalysisContext += `      [${vp.severity.toUpperCase()}] ${vp.message_fr}\n`;
          }
        }

        if (riskResult.demurrage_info) {
          v5AnalysisContext += `   🚢 SURESTARIES ${riskResult.demurrage_info.carrier}: ${riskResult.demurrage_info.free_days}j franchise, puis ${riskResult.demurrage_info.rate_after_free_days_usd} USD/jour\n`;
        }
      }
    }

    // Build analysis context for AI
    let analysisContext = `\n\n=== ANALYSE AUTOMATIQUE DE LA DEMANDE ===
📌 LANGUE DÉTECTÉE: ${detectedLanguage}
   → Tu DOIS répondre 100% en ${detectedLanguage === 'FR' ? 'FRANÇAIS' : 'ANGLAIS'}
   
📌 TYPE DE DEMANDE: ${requestAnalysis.type}
📌 PEUT COTER MAINTENANT: ${requestAnalysis.canQuote ? 'OUI' : 'NON - CONTEXTE INSUFFISANT'}

${!requestAnalysis.canQuote ? `
⚠️ INFORMATIONS MANQUANTES - NE PAS DONNER DE PRIX:
${requestAnalysis.missingContext.map(m => `   • ${m}`).join('\n')}

📋 QUESTIONS À POSER AU CLIENT:
${requestAnalysis.suggestedQuestions.join('\n')}
` : ''}

📊 ÉLÉMENTS DÉTECTÉS:
   • PI jointe: ${requestAnalysis.detectedElements.hasPI ? 'OUI' : 'NON'}
   • Incoterm: ${extractedData.incoterm || (requestAnalysis.detectedElements.hasIncoterm ? 'OUI (non identifié)' : 'NON')}
   • Destination: ${extractedData.destination || (requestAnalysis.detectedElements.hasDestination ? 'OUI' : 'NON')}
   • Origine: ${extractedData.origin || (requestAnalysis.detectedElements.hasOrigin ? 'OUI' : 'NON')}
   • Type conteneur: ${extractedData.container_type || (requestAnalysis.detectedElements.hasContainerType ? 'OUI' : 'NON')}
   • Poids: ${extractedData.weight_kg ? extractedData.weight_kg + ' kg' : 'NON'}
   • Volume: ${extractedData.volume_cbm ? extractedData.volume_cbm + ' m³' : 'NON'}
   • Transporteur: ${extractedData.carrier || 'NON DÉTECTÉ'}
   • Code HS: ${requestAnalysis.detectedElements.hasHsCode ? 'OUI' : 'NON'}
   • Valeur: ${extractedData.value ? extractedData.value + ' ' + (extractedData.currency || '') : (requestAnalysis.detectedElements.hasValue ? 'OUI' : 'NON')}
${v5AnalysisContext}`;

    // ============ BUILD PROMPT ============
    const userPrompt = `
=== PARAMÈTRES CRITIQUES ===
detected_language: "${detectedLanguage}"
request_type: "${requestAnalysis.type}"
can_quote_now: ${requestAnalysis.canQuote}
clarification_questions_suggested: ${JSON.stringify(requestAnalysis.suggestedQuestions)}

DEMANDE CLIENT À ANALYSER:
De: ${email.from_address}
Objet: ${email.subject}
Date: ${email.sent_at}

${email.body_text}

${analysisContext}
${portTariffsContext}
${carrierBillingContext}
${taxRatesContext}
${regimesContext}
${legalContext}
${ctuContext}
${attachmentsContext}
${tariffKnowledgeContext}
${threadRoleContext}
${threadContext}
${expertContext}

${customInstructions ? `INSTRUCTIONS SUPPLÉMENTAIRES: ${customInstructions}` : ''}

RAPPELS CRITIQUES:
1. 🌍 LANGUE: Réponds 100% en ${detectedLanguage === 'FR' ? 'FRANÇAIS' : 'ANGLAIS'} - NE MÉLANGE PAS LES LANGUES
2. 📋 SI can_quote_now = false: 
   - N'invente PAS de prix
   - Accuse réception (PI, demande)
   - Pose les questions de clarification
   - C'est ILLOGIQUE de donner des prix sans contexte
3. Si can_quote_now = true:
   - IDENTIFIER LE TRANSPORTEUR (MSC, Hapag-Lloyd, Maersk, CMA CGM, Grimaldi)
   - Pour les THC DP World: utilise EXACTEMENT les montants de PORT_TARIFFS
   - Pour les frais compagnie: utilise les templates de CARRIER_BILLING
   - Pour tout tarif non disponible → "À CONFIRMER" ou "TBC"
`;

    console.log("Calling AI with language and context analysis...");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: EXPERT_SYSTEM_PROMPT },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" },
        max_tokens: 8192
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", errorText);
      throw new Error("Erreur de génération IA");
    }

    const aiResult = await response.json();
    const generatedContent = aiResult.choices?.[0]?.message?.content;
    
    console.log("AI response received, parsing...");
    
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(generatedContent);
    } catch (e) {
      console.error("Parse error, raw content:", generatedContent?.substring(0, 500));
      throw new Error("Erreur de parsing de la réponse");
    }

    // Build the complete email body from structured response
    const greeting = parsedResponse.greeting || (detectedLanguage === 'FR' ? 'Bonjour,' : 'Dear Sir/Madam,');
    const bodyShort = parsedResponse.body_short || parsedResponse.body || '';
    const delegation = parsedResponse.delegation ? `\n\n${parsedResponse.delegation}` : '';
    const closing = parsedResponse.closing || (detectedLanguage === 'FR' ? 'Meilleures Salutations' : 'Best Regards');
    const signature = parsedResponse.signature || 'Taleb HOBALLAH\n2HL Group';
    
    const fullBodyText = `${greeting}\n\n${bodyShort}${delegation}\n\n${closing}\n\n${signature}`;

    // Create draft
    const { data: draft, error: draftError } = await supabase
      .from('email_drafts')
      .insert({
        original_email_id: emailId,
        to_addresses: [email.from_address],
        subject: parsedResponse.subject || `Re: ${email.subject}`,
        body_text: fullBodyText,
        status: 'draft',
        ai_generated: true
      })
      .select()
      .single();

    if (draftError) {
      console.error("Error creating draft:", draftError);
      throw new Error("Erreur de création du brouillon");
    }

    console.log(`Generated ${detectedLanguage} draft (type: ${requestAnalysis.type}, canQuote: ${requestAnalysis.canQuote}):`, draft.id);

    // ============ GENERATE ATTACHMENT IF NEEDED ============
    let attachmentResult: any = null;
    if (parsedResponse.attachment_needed && parsedResponse.attachment_data?.posts?.length > 0) {
      console.log("Generating quotation attachment...");
      try {
        // Enrich attachment data with extracted info
        const enrichedAttachmentData = {
          ...parsedResponse.attachment_data,
          client_name: email.from_address.split('@')[0].replace(/[._]/g, ' '),
          destination: extractedData.destination,
          incoterm: extractedData.incoterm,
        };

        const attachmentResponse = await fetch(`${supabaseUrl}/functions/v1/generate-quotation-attachment`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            attachment_data: enrichedAttachmentData,
            email_id: emailId,
            draft_id: draft.id,
          }),
        });

        if (attachmentResponse.ok) {
          attachmentResult = await attachmentResponse.json();
          console.log("Attachment generated:", attachmentResult?.attachment?.public_url);
        } else {
          const errorText = await attachmentResponse.text();
          console.error("Attachment generation failed:", errorText);
        }
      } catch (attachmentError) {
        console.error("Attachment generation error (non-blocking):", attachmentError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        draft: draft,
        // New analysis fields
        detected_language: detectedLanguage,
        request_type: requestAnalysis.type,
        can_quote_now: requestAnalysis.canQuote,
        clarification_questions: parsedResponse.clarification_questions || requestAnalysis.suggestedQuestions,
        detected_elements: requestAnalysis.detectedElements,
        // V5 Workflow: Extracted shipment data
        extracted_data: extractedData,
        // NEW: Transport mode from intelligent detection
        transport_mode: extractedData.transport_mode,
        transport_mode_evidence: extractedData.transport_mode_evidence,
        // V5 Workflow: Analysis results
        v5_analysis: {
          coherence_audit: coherenceResult,
          incoterm_analysis: incotermResult,
          risk_analysis: riskResult,
        },
        // V5 Workflow: Vigilance points (combined from all analyses)
        vigilance_points: [
          ...(coherenceResult?.alerts?.map((a: any) => ({ type: 'coherence', ...a })) || []),
          ...(incotermResult?.quotation_guidance?.vigilance_points_fr?.map((p: string) => ({ type: 'incoterm', message_fr: p })) || []),
          ...(riskResult?.vigilance_points || []),
        ],
        // V5 Workflow: Provisions summary
        provisions: riskResult?.provisions || null,
        // Existing fields
        structured_response: {
          greeting: parsedResponse.greeting,
          body_short: parsedResponse.body_short,
          delegation: parsedResponse.delegation,
          closing: parsedResponse.closing,
          signature: parsedResponse.signature
        },
        attachment_needed: parsedResponse.attachment_needed,
        attachment_data: parsedResponse.attachment_data,
        // Generated attachment info (NEW)
        generated_attachment: attachmentResult?.attachment || null,
        quotation_summary: parsedResponse.quotation_summary,
        regulatory_analysis: parsedResponse.regulatory_analysis,
        carrier_detected: extractedData.carrier || parsedResponse.carrier_detected,
        response_template_used: parsedResponse.response_template_used,
        two_step_response: parsedResponse.two_step_response,
        confidence: parsedResponse.quotation_summary?.confidence || parsedResponse.confidence,
        missing_info: parsedResponse.missing_info || requestAnalysis.missingContext
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Expert response generation error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur de génération" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});