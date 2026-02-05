import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { CUSTOMS_CODE_REFERENCE, getLegalContextForRegime, analyzeRegimeAppropriateness } from "../_shared/customs-code-reference.ts";
import { CTU_CODE_REFERENCE, isCTURelevant, getAllRelevantCTUContexts } from "../_shared/ctu-code-reference.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============ SODATRA FEES CALCULATION ============
// Dynamic fee suggestion based on complexity factors

interface SodatraFeeParams {
  transport_mode: 'air' | 'maritime' | 'road' | 'multimodal' | 'unknown';
  cargo_value_caf?: number;
  weight_kg?: number;
  volume_cbm?: number;
  container_types?: string[];
  container_count?: number;
  is_exempt_project?: boolean;
  is_dangerous?: boolean;
  is_oog?: boolean;
  is_reefer?: boolean;
  destination_zone?: 'dakar' | 'banlieue' | 'region' | 'mali' | 'transit';
  services_requested?: string[];
  incoterm?: string;
}

interface SuggestedFee {
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

interface SodatraFeeSuggestion {
  fees: SuggestedFee[];
  total_suggested: number;
  complexity_factor: number;
  complexity_reasons: string[];
  transport_mode: string;
  can_calculate_commission: boolean;
  commission_note?: string;
}

const BASE_FEES = {
  dedouanement: {
    air: { base: 100000, min: 75000, max: 350000 },
    maritime_conteneur: { base: 150000, min: 120000, max: 400000 },
    maritime_vehicule: { base: 120000, min: 100000, max: 250000 },
    road: { base: 80000, min: 60000, max: 200000 },
    transit: { base: 180000, min: 150000, max: 500000 },
  },
  suivi_operationnel: { base: 35000, per_container: 25000, min: 35000, max: 150000 },
  ouverture_dossier: { base: 25000, min: 20000, max: 35000 },
  frais_documentaires: { per_document: 15000, min: 15000, max: 60000 },
  commission_debours: { percentage: 5, min: 25000 },
};

const COMPLEXITY_FACTORS: Record<string, { factor: number; label: string }> = {
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

const ZONE_MULTIPLIERS: Record<string, number> = {
  dakar: 1.0, banlieue: 1.1, region: 1.25, mali: 1.5, transit: 1.4,
};

function getDestinationZone(destination?: string | null): 'dakar' | 'banlieue' | 'region' | 'mali' | 'transit' {
  if (!destination) return 'dakar';
  const destLower = destination.toLowerCase();
  if (destLower.includes('mali') || destLower.includes('bamako')) return 'mali';
  if (destLower.includes('burkina') || destLower.includes('niger') || destLower.includes('guinée')) return 'transit';
  if (destLower.includes('thies') || destLower.includes('kaolack') || destLower.includes('saint-louis') || 
      destLower.includes('ziguinchor')) return 'region';
  if (destLower.includes('pikine') || destLower.includes('guediawaye') || destLower.includes('rufisque')) return 'banlieue';
  return 'dakar';
}

function roundToNearest5000(amount: number): number {
  return Math.round(amount / 5000) * 5000;
}

function calculateComplexityFactor(params: SodatraFeeParams): { factor: number; reasons: string[] } {
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
  if (params.destination_zone === 'mali') {
    factor += COMPLEXITY_FACTORS.transit_mali.factor;
    reasons.push(COMPLEXITY_FACTORS.transit_mali.label);
  } else if (params.destination_zone === 'transit') {
    factor += COMPLEXITY_FACTORS.transit_other.factor;
    reasons.push(COMPLEXITY_FACTORS.transit_other.label);
  }
  if (params.cargo_value_caf && params.cargo_value_caf > 100000000) {
    factor += COMPLEXITY_FACTORS.high_value.factor;
    reasons.push(COMPLEXITY_FACTORS.high_value.label);
  }
  if (params.weight_kg && params.weight_kg > 20000) {
    factor += COMPLEXITY_FACTORS.heavy_cargo.factor;
    reasons.push(COMPLEXITY_FACTORS.heavy_cargo.label);
  }
  if (params.container_count && params.container_count > 2) {
    factor += COMPLEXITY_FACTORS.multiple_containers.factor;
    reasons.push(COMPLEXITY_FACTORS.multiple_containers.label);
  }

  return { factor, reasons };
}

function calculateSodatraFees(params: SodatraFeeParams): SodatraFeeSuggestion {
  const fees: SuggestedFee[] = [];
  const { factor: complexityFactor, reasons: complexityReasons } = calculateComplexityFactor(params);
  
  const zone = params.destination_zone || getDestinationZone(undefined);
  const zoneMultiplier = ZONE_MULTIPLIERS[zone] || 1.0;
  const containerCount = params.container_count || params.container_types?.length || 1;
  
  // 1. Dédouanement
  let dedouanementBase: { base: number; min: number; max: number };
  let dedouanementLabel = 'Honoraires dédouanement';
  
  if (zone === 'mali' || zone === 'transit') {
    dedouanementBase = BASE_FEES.dedouanement.transit;
    dedouanementLabel = 'Honoraires dédouanement transit';
  } else if (params.transport_mode === 'air') {
    dedouanementBase = BASE_FEES.dedouanement.air;
    dedouanementLabel = 'Honoraires dédouanement aérien';
  } else {
    dedouanementBase = BASE_FEES.dedouanement.maritime_conteneur;
    dedouanementLabel = 'Honoraires dédouanement maritime';
  }
  
  let volumeFactor = 1.0;
  if (params.volume_cbm && params.volume_cbm > 30) {
    volumeFactor = Math.min(1 + (params.volume_cbm - 30) * 0.01, 1.5);
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
    formula: `Base ${dedouanementBase.base.toLocaleString('fr-FR')} × ${complexityFactor.toFixed(2)} × ${zoneMultiplier.toFixed(2)}`,
    is_editable: true,
    factors_applied: complexityReasons.length > 0 ? complexityReasons : ['Standard'],
  });
  
  // 2. Suivi opérationnel
  const suiviBase = params.transport_mode === 'maritime' && containerCount > 1
    ? BASE_FEES.suivi_operationnel.base + ((containerCount - 1) * BASE_FEES.suivi_operationnel.per_container)
    : BASE_FEES.suivi_operationnel.base;
  
  fees.push({
    key: 'suivi_operationnel',
    label: 'Suivi opérationnel',
    suggested_amount: Math.min(Math.max(roundToNearest5000(suiviBase * zoneMultiplier), BASE_FEES.suivi_operationnel.min), BASE_FEES.suivi_operationnel.max),
    min_amount: BASE_FEES.suivi_operationnel.min,
    max_amount: BASE_FEES.suivi_operationnel.max,
    unit: containerCount > 1 ? `${containerCount} conteneurs` : 'dossier',
    formula: `Forfait ${BASE_FEES.suivi_operationnel.base.toLocaleString('fr-FR')}`,
    is_editable: true,
    factors_applied: ['Standard'],
  });
  
  // 3. Ouverture dossier
  fees.push({
    key: 'ouverture_dossier',
    label: 'Ouverture dossier',
    suggested_amount: BASE_FEES.ouverture_dossier.base,
    min_amount: BASE_FEES.ouverture_dossier.min,
    max_amount: BASE_FEES.ouverture_dossier.max,
    unit: 'dossier',
    formula: `Forfait ${BASE_FEES.ouverture_dossier.base.toLocaleString('fr-FR')}`,
    is_editable: true,
    factors_applied: ['Standard'],
  });
  
  // 4. Frais documentaires
  let docCount = params.transport_mode === 'air' ? 2 : 2;
  if (params.is_exempt_project) docCount += 1;
  
  fees.push({
    key: 'frais_documentaires',
    label: 'Frais documentaires',
    suggested_amount: Math.min(Math.max(roundToNearest5000(BASE_FEES.frais_documentaires.per_document * docCount), BASE_FEES.frais_documentaires.min), BASE_FEES.frais_documentaires.max),
    min_amount: BASE_FEES.frais_documentaires.min,
    max_amount: BASE_FEES.frais_documentaires.max,
    unit: `${docCount} documents`,
    formula: `${docCount} × ${BASE_FEES.frais_documentaires.per_document.toLocaleString('fr-FR')}`,
    is_editable: true,
    factors_applied: [`${docCount} docs`],
  });
  
  // 5. Commission débours (if CAF value available)
  const canCalculateCommission = Boolean(params.cargo_value_caf);
  let commissionNote: string | undefined;
  
  if (canCalculateCommission && params.cargo_value_caf) {
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
      max_amount: 9999999999,
      unit: 'sur D&T',
      formula: `${BASE_FEES.commission_debours.percentage}% des D&T`,
      is_percentage: true,
      percentage_base: 'debours_douaniers',
      is_editable: true,
      factors_applied: [`CAF: ${params.cargo_value_caf.toLocaleString('fr-FR')}`],
    });
  } else {
    commissionNote = 'Commission débours: 5% des D&T (à calculer sur factures)';
  }
  
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

// ============ AI-POWERED DATA EXTRACTION ============
// Replaces ALL regex-based extraction with intelligent AI analysis

interface AIExtractedData {
  // Language
  detected_language: 'FR' | 'EN';
  
  // Request type - ENRICHED with tender/partner types
  request_type: 'PI_ONLY' | 'QUOTATION_REQUEST' | 'QUESTION' | 'ACKNOWLEDGMENT' | 'FOLLOW_UP' | 'TENDER_REQUEST' | 'PARTNER_RATE_SUBMISSION' | 'RATE_CONFIRMATION';
  can_quote_now: boolean;
  offer_type: 'full_quotation' | 'indicative_dap' | 'rate_only' | 'info_response' | 'tender_preparation' | 'partner_acknowledgment';
  
  // NEW: Email context for smart workflow routing
  email_context: {
    sender_role: 'client' | 'partner' | 'supplier' | 'internal';
    action_required: 'quote_client' | 'integrate_rates' | 'acknowledge' | 'prepare_tender' | 'forward_to_tender';
    is_tender: boolean;
    tender_indicators: string[];
    partner_indicators: string[];
  };
  
  // Transport mode (KEY FIX: AI decides this intelligently)
  transport_mode: 'air' | 'maritime' | 'road' | 'multimodal' | 'unknown';
  transport_mode_evidence: string;
  
  // Locations
  origin: string | null;
  destination: string | null;
  
  // Cargo details
  weight_kg: number | null;
  volume_cbm: number | null;
  dimensions: string | null;
  cargo_description: string | null;
  
  // Containers (maritime only) - NOW SUPPORTS MULTIPLE with quantities
  containers: Array<{
    type: string;
    quantity: number;
    coc_soc?: 'COC' | 'SOC' | 'unknown';
    notes?: string;
  }>;
  // Legacy field for backwards compatibility
  container_type: string | null;
  
  // Commercial
  incoterm: string | null;
  value: number | null;
  currency: string | null;
  hs_codes: string[];
  
  // Carrier
  carrier: string | null;
  
  // Parties
  client_name: string | null;
  client_company: string | null;
  client_email: string | null;
  
  // Services requested
  services_requested: string[];
  
  // Missing info
  missing_info: string[];
  questions_to_ask: string[];
  
  // Detected elements (for backwards compatibility)
  detected_elements: {
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

const AI_EXTRACTION_PROMPT = `Tu es un expert en logistique maritime et aérienne au Sénégal (SODATRA).
Analyse cette demande de cotation et extrais TOUTES les informations disponibles.

=== CONTEXTE ENTREPRISE SODATRA ===

📧 IDENTIFICATION DES INTERLOCUTEURS:
- **2HL Group / 2HL / @2hl / @2hlgroup / Taleb / Taleb Hoballah** = PARTENAIRE de SODATRA (pas un client!)
- Les partenaires ENVOIENT des tarifs/cotations pour que SODATRA les intègre
- Les CLIENTS demandent des cotations à SODATRA
- Les FOURNISSEURS (compagnies maritimes, manutentionnaires) envoient des offres

📋 RÈGLES D'IDENTIFICATION SENDER_ROLE:
- sender_role = 'partner' si email de @2hl, @2hlgroup, ou nom "Taleb"
- sender_role = 'supplier' si compagnie maritime (MSC, MAERSK, HAPAG...)
- sender_role = 'client' si demande de cotation à SODATRA
- sender_role = 'internal' si @sodatra

🎯 DÉTECTION TENDER / APPEL D'OFFRES:
Indicateurs clés (is_tender = true si 2+ présents):
- RFPS, RFQ, Appel d'offres, Tender, Consultation
- MINUSCA, UNMISS, MONUSCO, MINUSMA, UN Peacekeeping
- Multi-contingents, multi-destinations (Bangui, Ndele, Bambari...)
- PAM, WFP, UNHCR, UNICEF, UNDP
- Demobilization, Repatriation, Rotation, Battalion
- Deadline formelle, cahier des charges

📋 ACTION_REQUIRED selon contexte:
- Si partenaire envoie tarifs → action_required = 'integrate_rates'
- Si tender détecté → action_required = 'forward_to_tender' ou 'prepare_tender'
- Si client demande cotation classique → action_required = 'quote_client'
- Si simple confirmation → action_required = 'acknowledge'

=== HYPOTHÈSES PAR DÉFAUT (NE PAS DEMANDER) ===

📍 ORIGINE:
- Si l'origine n'est pas mentionnée, NE PAS LA DEMANDER
- Assumer par défaut: marchandise hors zone UEMOA/CEDEAO (droits de douane standard)
- Si le client fournit l'origine plus tard, l'application s'adaptera
- NE JAMAIS inclure "origin" dans missing_info ou questions_to_ask

📅 DATE DE LIVRAISON:
- NE PAS demander la date de livraison souhaitée
- C'est une demande de cotation, pas encore un booking
- Les délais standards seront indiqués dans l'offre
- NE JAMAIS inclure "delivery_date" ou "date souhaitée" dans questions_to_ask

⚠️ INFORMATIONS VRAIMENT NÉCESSAIRES pour coter:
- cargo_description ✓ (pour codes HS et tarifs)
- destination ✓ (pour frais locaux)
- service_type ✓ (DDP/DAP, customs clearance, etc.)

📋 INFORMATIONS À DEMANDER UNIQUEMENT SI VRAIMENT BLOQUANTES:
- Valeur CAF → seulement pour calcul EXACT des DD/TVA (mais on peut coter avec taux indicatifs)
- Factures commerciales → pour vérification HS codes précis

🎯 COMPORTEMENT ATTENDU:
Pour "Import customs clearance + local delivery" sans valeur CAF:
→ can_quote_now = true (offre indicative possible)
→ Proposer offre DAP/DDP avec frais fixes (handling, THC, transit, livraison)
→ Donner taux indicatifs DD/TVA par catégorie de marchandise
→ Indiquer documents requis pour calcul final
→ PAS DE QUESTION sur origine ou date

=== RÈGLES CRITIQUES POUR LE MODE DE TRANSPORT ===

🛫 TRANSPORT AÉRIEN si tu détectes UN de ces éléments:
- "fret aérien", "air freight", "cargo aérien", "avion"
- AWB, LTA, "Lettre de Transport Aérien"
- "AOL" (Airport of Loading), "AOD" (Airport of Departure/Destination)
- Poids très léger (< 100kg) SANS mention de conteneur
- "enlèvement aérien", "envoi par avion"
- Urgence extrême ("urgent", "express", "24h", "48h")

🚢 TRANSPORT MARITIME si tu détectes UN de ces éléments:
- Conteneur explicite: "20DV", "40HC", "conteneur", "container", "20'", "40'"
- FCL, LCL, "groupage maritime"
- B/L, "Bill of Lading", "Connaissement"
- Noms de navires, ETAs
- Ports maritimes explicites ("Port de Dakar", "Le Havre")
- Volumes importants (> 10 m³) ou poids lourds (> 1000kg) avec conteneur

⚠️ ATTENTION AUX FAUX POSITIFS:
- "shipping" dans une signature email = PAS un indicateur maritime
- "ship" peut signifier "expédier" en anglais = vérifier le contexte
- "Exploitation-Shipping" = département, pas mode de transport
- Un poids de "40kg" n'est PAS un conteneur "40'"
- Dimensions en mm (ex: "40mm x 30mm") ≠ conteneur

=== RÈGLES POUR ORIGINE/DESTINATION ===
- "AOL: Dakar" → origin = "Dakar" (aérien)
- "AOD: Abidjan" → destination = "Abidjan" (aérien)
- "de Shanghai" / "from Shanghai" → origin
- "à destination de Bamako" → destination
- Incoterm EXW + ville → origin (ex: "EXW Paris" → origin = "Paris")
- Si origin non mentionnée → NE PAS DEMANDER, laisser null

=== RÈGLES POUR LES SERVICES ET INCOTERMS ===

📦 INTERPRÉTER LES SERVICES DEMANDÉS:
- "local delivery (DDU/DDP)" → incoterm = "DDP" ou "DAP" (DDU est obsolète depuis Incoterms 2020, utiliser DAP ou DDP)
- "Import customs clearance" → service dédouanement import = DDP probable
- "door to door" / "porte à porte" → incoterm = DDP ou DAP
- "Duty Tax checking" → calcul droits/taxes demandé, implique DDP
- "CIF + delivery" → incoterm = DDP (puisque livraison incluse)
- "customs clearance + local delivery" → incoterm = DDP (service complet)

📋 MAPPING SERVICES → INCOTERMS:
- "Import clearance only" → client gère le transport → FOB ou CFR probable côté fournisseur
- "Full service / clé en main / all inclusive" → DDP
- "DAP" ou "DDU" demandé explicitement → utiliser "DAP" (DDU obsolète depuis 2020)
- "Port to door" → CIF ou CFR + livraison locale = DAP ou DDP
- "DDP" mentionné → incoterm = "DDP"

📋 SERVICES À EXTRAIRE (services_requested):
- "customs_clearance" : dédouanement import/export
- "local_delivery" : livraison locale finale
- "duty_tax_calculation" : calcul des droits et taxes
- "pickup" : enlèvement à l'origine
- "warehousing" : stockage/entreposage
- "insurance" : assurance marchandise

⚠️ NE PAS POSER DE QUESTION SUR L'INCOTERM SI:
- Le client a clairement indiqué un service type "local delivery (DDU/DDP)"
- Le contexte implique DDP (dédouanement + livraison demandés ensemble)
- Le client demande "all inclusive", "tout compris", "clé en main"
- Les services demandés incluent customs clearance + local delivery

=== EXTRACTION MULTI-CONTENEURS ===
CRITIQUE: Extrais TOUS les conteneurs avec leurs quantités dans un tableau "containers".
Exemples:
- "09 X 40' HC + 1 X 40' open top" → containers: [{type: "40HC", quantity: 9}, {type: "40OT", quantity: 1, notes: "OOG"}]
- "2 x 20DV + 1 x 40FR" → containers: [{type: "20DV", quantity: 2}, {type: "40FR", quantity: 1}]
- "40 HC" sans quantité → containers: [{type: "40HC", quantity: 1}]
- Cherche les patterns: "X x", "X ×", "X pcs", "X conteneurs", "X units"

=== EXTRACTION À FAIRE ===
Extrais ces informations de l'email et des pièces jointes fournies.
Si une information n'est pas disponible, utilise null.
RAPPEL: NE JAMAIS demander l'origine ou la date de livraison.

=== RÈGLES CRITIQUES POUR CONTEXTE EMAIL ===

🔴 SI EMAIL D'UN PARTENAIRE (2HL, Taleb):
- request_type = 'PARTNER_RATE_SUBMISSION' si tarifs/cotations fournis
- action_required = 'integrate_rates'
- NE PAS inclure les honoraires SODATRA dans la réponse
- Réponse = courte acknowledgment au partenaire

🔴 SI TENDER DÉTECTÉ (MINUSCA, UN, multi-contingents):
- request_type = 'TENDER_REQUEST'
- action_required = 'forward_to_tender'
- is_tender = true
- NE PAS générer de cotation email classique
- Indiquer "Utiliser le module Tender"

🟢 SI COTATION CLASSIQUE (client demande):
- request_type = 'QUOTATION_REQUEST' 
- action_required = 'quote_client'
- is_tender = false
- Appliquer le workflow standard avec honoraires SODATRA`;

async function extractWithAI(
  emailContent: string, 
  emailSubject: string,
  attachmentsText: string,
  LOVABLE_API_KEY: string
): Promise<AIExtractedData> {
  const fullContent = `
EMAIL SUBJECT: ${emailSubject}

EMAIL BODY:
${emailContent}

ATTACHMENTS CONTENT:
${attachmentsText || 'Aucune pièce jointe ou contenu non extrait'}
`;

  console.log("Calling AI for extraction...");
  
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: AI_EXTRACTION_PROMPT },
        { role: "user", content: fullContent }
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "extract_quotation_data",
            description: "Extraire les données de cotation d'un email et ses pièces jointes",
            parameters: {
              type: "object",
              properties: {
                detected_language: {
                  type: "string",
                  enum: ["FR", "EN"],
                  description: "Langue principale de l'email (FR=Français, EN=Anglais)"
                },
                request_type: {
                  type: "string",
                  enum: ["PI_ONLY", "QUOTATION_REQUEST", "QUESTION", "ACKNOWLEDGMENT", "FOLLOW_UP", "TENDER_REQUEST", "PARTNER_RATE_SUBMISSION", "RATE_CONFIRMATION"],
                  description: "Type de la demande. TENDER_REQUEST si appel d'offres UN/MINUSCA. PARTNER_RATE_SUBMISSION si partenaire (2HL/Taleb) envoie des tarifs."
                },
                can_quote_now: {
                  type: "boolean",
                  description: `VRAI si on peut produire une offre (même indicative).
                    VRAI si on a: cargo_description + destination + type de service
                    VRAI MÊME SI on n'a pas: origine (assumée hors UEMOA), valeur CAF (taux indicatifs), date souhaitée (délais standards)
                    FAUX si TENDER détecté (utiliser module Tender à la place)`
                },
                offer_type: {
                  type: "string",
                  enum: ["full_quotation", "indicative_dap", "rate_only", "info_response", "tender_preparation", "partner_acknowledgment"],
                  description: `Type d'offre à générer:
                    - full_quotation: toutes infos disponibles (CAF, HS codes confirmés)
                    - indicative_dap: pas de valeur CAF, offre DAP/DDP avec frais fixes + taux indicatifs DD/TVA
                    - rate_only: simple demande de tarif
                    - info_response: réponse informative (question régime, documents, etc.)
                    - tender_preparation: tender détecté, rediriger vers module Tender
                    - partner_acknowledgment: partenaire envoie tarifs, courte acknowledgment`
                },
                // NEW: Email context for smart routing
                email_context: {
                  type: "object",
                  properties: {
                    sender_role: {
                      type: "string",
                      enum: ["client", "partner", "supplier", "internal"],
                      description: "Role de l'expéditeur. partner si @2hl, @2hlgroup ou Taleb"
                    },
                    action_required: {
                      type: "string",
                      enum: ["quote_client", "integrate_rates", "acknowledge", "prepare_tender", "forward_to_tender"],
                      description: "Action requise. integrate_rates si partenaire envoie tarifs. forward_to_tender si tender détecté."
                    },
                    is_tender: {
                      type: "boolean",
                      description: "TRUE si appel d'offres UN, MINUSCA, multi-contingents, multi-destinations"
                    },
                    tender_indicators: {
                      type: "array",
                      items: { type: "string" },
                      description: "Mots-clés tender détectés (RFPS, MINUSCA, contingent, etc.)"
                    },
                    partner_indicators: {
                      type: "array",
                      items: { type: "string" },
                      description: "Indicateurs partenaire (2HL, Taleb, etc.)"
                    }
                  },
                  required: ["sender_role", "action_required", "is_tender"]
                },
                transport_mode: {
                  type: "string",
                  enum: ["air", "maritime", "road", "multimodal", "unknown"],
                  description: "Mode de transport demandé. CRITIQUE: 'fret aérien'='air', 'conteneur'='maritime'"
                },
                transport_mode_evidence: {
                  type: "string",
                  description: "Explication courte de pourquoi ce mode a été choisi (ex: 'fret aérien mentionné explicitement')"
                },
                origin: {
                  type: "string",
                  description: "Ville/port/aéroport de départ (null si non spécifié)"
                },
                destination: {
                  type: "string",
                  description: "Ville/port/aéroport de destination (null si non spécifié)"
                },
                weight_kg: {
                  type: "number",
                  description: "Poids total en kg (null si non spécifié)"
                },
                volume_cbm: {
                  type: "number",
                  description: "Volume en m³ (null si non spécifié)"
                },
                dimensions: {
                  type: "string",
                  description: "Dimensions L x l x H en cm ou mm (null si non spécifié)"
                },
                cargo_description: {
                  type: "string",
                  description: "Description des marchandises"
                },
                containers: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      type: { 
                        type: "string", 
                        description: "Type: 20DV, 40HC, 40OT (open top), 40FR (flat rack), etc." 
                      },
                      quantity: { 
                        type: "number", 
                        description: "Nombre de conteneurs de ce type" 
                      },
                      coc_soc: { 
                        type: "string", 
                        enum: ["COC", "SOC", "unknown"],
                        description: "Carrier Owned ou Shipper Owned Container"
                      },
                      notes: { 
                        type: "string", 
                        description: "Notes: OOG, dimensions spéciales, reefer, etc." 
                      }
                    },
                    required: ["type", "quantity"]
                  },
                  description: "Liste des conteneurs avec quantités. Ex: [{type: '40HC', quantity: 9}, {type: '40OT', quantity: 1}]"
                },
                container_type: {
                  type: "string",
                  description: "DEPRECATED: Utiliser 'containers' à la place. Type de conteneur principal si un seul type."
                },
                incoterm: {
                  type: "string",
                  enum: ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"],
                  description: "Incoterm demandé ou DÉDUIT des services. DDU obsolète depuis 2020 → utiliser DAP ou DDP. Si 'local delivery (DDU/DDP)' ou 'customs clearance + delivery' → DDP"
                },
                services_requested: {
                  type: "array",
                  items: { 
                    type: "string",
                    enum: ["customs_clearance", "local_delivery", "duty_tax_calculation", "pickup", "warehousing", "insurance"]
                  },
                  description: "Services explicitement demandés: customs_clearance, local_delivery, duty_tax_calculation, pickup, warehousing, insurance"
                },
                value: {
                  type: "number",
                  description: "Valeur des marchandises (null si non spécifié)"
                },
                currency: {
                  type: "string",
                  description: "Devise (USD, EUR, FCFA, XOF)"
                },
                hs_codes: {
                  type: "array",
                  items: { type: "string" },
                  description: "Codes HS détectés"
                },
                carrier: {
                  type: "string",
                  description: "Compagnie de transport détectée (MSC, MAERSK, AIR-FRANCE-CARGO, etc.)"
                },
                client_name: {
                  type: "string",
                  description: "Nom du contact client"
                },
                client_company: {
                  type: "string",
                  description: "Nom de l'entreprise cliente"
                },
                client_email: {
                  type: "string",
                  description: "Email du client"
                },
                missing_info: {
                  type: "array",
                  items: { type: "string" },
                  description: `Informations VRAIMENT manquantes pour coter.
                    NE PAS INCLURE:
                    - 'origin' / 'origine' (on assume hors UEMOA/CEDEAO par défaut)
                    - 'delivery_date' / 'date de livraison' (c'est juste une cotation)
                    - 'incoterm' si les services demandés impliquent déjà DDP/DAP
                    INCLURE SEULEMENT SI BLOQUANT:
                    - 'caf_value' si calcul droits PRÉCIS requis (mais offre indicative possible sans)
                    - 'commercial_invoice' pour vérifier HS codes exacts`
                },
                questions_to_ask: {
                  type: "array",
                  items: { type: "string" },
                  description: `Questions essentielles UNIQUEMENT.
                    NE JAMAIS DEMANDER:
                    - L'origine (assumée hors UEMOA/CEDEAO)
                    - La date de livraison souhaitée
                    - L'incoterm si services clairs (customs + delivery = DDP)
                    DEMANDER SEULEMENT:
                    - Confirmation marchandise si description ambiguë
                    - Factures commerciales pour calcul droits précis`
                },
                has_pi: {
                  type: "boolean",
                  description: "Une facture proforma (PI) est-elle jointe?"
                }
              },
              required: [
                "detected_language", "request_type", "can_quote_now",
                "transport_mode", "transport_mode_evidence",
                "missing_info", "questions_to_ask", "has_pi", "services_requested",
                "email_context"
              ]
            }
          }
        }
      ],
      tool_choice: { type: "function", function: { name: "extract_quotation_data" } }
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("AI extraction error:", response.status, errorText);
    throw new Error(`AI extraction failed: ${response.status}`);
  }

  const result = await response.json();
  const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
  
  if (!toolCall || toolCall.function.name !== 'extract_quotation_data') {
    console.error("Unexpected AI response format:", JSON.stringify(result).substring(0, 500));
    throw new Error("AI did not return expected tool call");
  }

  let extracted: any;
  try {
    extracted = JSON.parse(toolCall.function.arguments);
  } catch (e) {
    console.error("Failed to parse tool arguments:", toolCall.function.arguments);
    throw new Error("Failed to parse AI extraction result");
  }

  console.log("AI Extraction result:", JSON.stringify(extracted, null, 2));

  // Build the result with backwards-compatible structure
  // Also filter out any questions about origin or delivery date that might slip through
  const filteredQuestions = (extracted.questions_to_ask || []).filter((q: string) => {
    const lower = q.toLowerCase();
    return !lower.includes('origin') && 
           !lower.includes('origine') && 
           !lower.includes('provenance') &&
           !lower.includes('date de livraison') &&
           !lower.includes('delivery date') &&
           !lower.includes('date souhaitée') &&
           !lower.includes('desired date');
  });
  
  const filteredMissing = (extracted.missing_info || []).filter((m: string) => {
    const lower = m.toLowerCase();
    return !lower.includes('origin') && 
           !lower.includes('origine') && 
           !lower.includes('provenance') &&
           !lower.includes('date de livraison') &&
           !lower.includes('delivery_date') &&
           !lower.includes('date souhaitée');
  });

  // Build email_context with defaults if not provided by AI
  const emailContext = extracted.email_context || {
    sender_role: 'client',
    action_required: 'quote_client',
    is_tender: false,
    tender_indicators: [],
    partner_indicators: []
  };

  return {
    detected_language: extracted.detected_language || 'FR',
    request_type: extracted.request_type || 'QUOTATION_REQUEST',
    can_quote_now: extracted.can_quote_now ?? false,
    offer_type: extracted.offer_type || 'indicative_dap',
    email_context: {
      sender_role: emailContext.sender_role || 'client',
      action_required: emailContext.action_required || 'quote_client',
      is_tender: emailContext.is_tender ?? false,
      tender_indicators: emailContext.tender_indicators || [],
      partner_indicators: emailContext.partner_indicators || []
    },
    transport_mode: extracted.transport_mode || 'unknown',
    transport_mode_evidence: extracted.transport_mode_evidence || '',
    origin: extracted.origin || null,
    destination: extracted.destination || null,
    weight_kg: extracted.weight_kg || null,
    volume_cbm: extracted.volume_cbm || null,
    dimensions: extracted.dimensions || null,
    cargo_description: extracted.cargo_description || null,
    containers: extracted.containers || [],
    container_type: extracted.container_type || (extracted.containers?.[0]?.type || null),
    incoterm: extracted.incoterm || null,
    value: extracted.value || null,
    currency: extracted.currency || null,
    hs_codes: extracted.hs_codes || [],
    carrier: extracted.carrier || null,
    client_name: extracted.client_name || null,
    client_company: extracted.client_company || null,
    client_email: extracted.client_email || null,
    services_requested: extracted.services_requested || [],
    missing_info: filteredMissing,
    questions_to_ask: filteredQuestions,
    detected_elements: {
      hasPI: extracted.has_pi ?? false,
      hasIncoterm: !!extracted.incoterm,
      hasDestination: !!extracted.destination,
      hasOrigin: !!extracted.origin,
      hasContainerType: !!extracted.container_type,
      hasGoodsDescription: !!extracted.cargo_description,
      hasHsCode: (extracted.hs_codes?.length || 0) > 0,
      hasValue: !!extracted.value
    }
  };
}

// ============ HELPER: DETECT LANGUAGE (fallback) ============
function detectEmailLanguage(body: string, subject: string): 'FR' | 'EN' {
  const content = ((body || '') + ' ' + (subject || '')).toLowerCase();
  
  const frenchWords = ['bonjour', 'cher', 'madame', 'monsieur', 'veuillez', 'merci', 
    'cordialement', 'pièce jointe', 'en attaché', 'prière de', 's\'il vous plaît',
    'ci-joint', 'nous vous prions', 'salutations', 'meilleures', 'sincères',
    'objet', 'demande', 'concernant', 'suite à', 'selon', 'notre offre'];
  const englishWords = ['dear', 'please', 'kindly', 'attached', 'regards', 'thank you',
    'find below', 'best regards', 'looking forward', 'further to', 'as per',
    'herewith', 'enclosed', 'subject', 'request', 'concerning', 'following'];
  
  const frScore = frenchWords.filter(w => content.includes(w)).length;
  const enScore = englishWords.filter(w => content.includes(w)).length;
  
  return frScore > enScore ? 'FR' : 'EN';
}

// Helper function to select the best expert based on email content
function selectExpertForResponse(emailContent: string, subject: string): 'taleb' | 'cherif' {
  const douaneKeywords = ['douane', 'hs code', 'customs', 'dédouanement', 'tarif douanier', 'nomenclature', 'duty', 'tax', 'droits de douane', 'clearance', 'declaration'];
  const transportKeywords = ['transport', 'fret', 'shipping', 'thc', 'dam', 'transit', 'incoterm', 'booking', 'bl', 'conteneur', 'container', 'vessel', 'freight', 'port', 'logistique'];
  
  const content = (emailContent + ' ' + subject).toLowerCase();
  
  const douaneScore = douaneKeywords.filter(k => content.includes(k)).length;
  const transportScore = transportKeywords.filter(k => content.includes(k)).length;
  
  return douaneScore > transportScore ? 'cherif' : 'taleb';
}

// Build the style injection prompt from expert profile
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
⛔ INTERDIT: phrases longues, ton robotique, "Je reste à votre disposition...", tableaux dans le mail, mentionner des pièces jointes
✅ OBLIGATOIRE: abréviations (pls, vsl, ctnr), "With we remain,"
`;

  return injection;
}

// ============ EXPERT SYSTEM PROMPT ============
const EXPERT_SYSTEM_PROMPT = `Tu es l'assistant IA de SODATRA, un des plus grands transitaires du Sénégal.
Tu génères des réponses professionnelles aux demandes de cotation et questions logistiques.

=== CONTEXTE OPÉRATIONNEL ===

Tu as accès à:
- PORT_TARIFFS: Tarifs officiels du Port de Dakar (DPW, Bolloré, etc.)
- CARRIER_BILLING: Templates de facturation par compagnie maritime/aérienne
- TAX_RATES: Taux douaniers officiels (DD, TVA, COSEC, etc.)
- HS_CODES: Base TEC UEMOA avec taux applicables

=== TYPES DE DEMANDES ===

1. QUOTATION_REQUEST - Demande de cotation complète
2. PI_ONLY - Seulement une PI jointe, contexte insuffisant
3. QUESTION - Question technique ou de suivi
4. ACKNOWLEDGMENT - Accusé de réception
5. FOLLOW_UP - Suite à conversation précédente
6. TENDER_REQUEST - Appel d'offres formel (UN, MINUSCA, ONG)
7. PARTNER_RATE_SUBMISSION - Partenaire (2HL/Taleb) fournit des tarifs
8. RATE_CONFIRMATION - Confirmation de tarifs à intégrer

=== RÈGLES CONTEXTUELLES CRITIQUES ===

📧 SI L'EMAIL VIENT D'UN PARTENAIRE (2HL, Taleb, @2hl, @2hlgroup):
- Ce n'est PAS un client final - c'est notre partenaire commercial
- S'il fournit des tarifs → courte réponse d'accusé réception UNIQUEMENT
- NE PAS inclure les honoraires SODATRA dans la réponse
- Style: "Thks Taleb, bien reçu. On intègre dans notre offre."
- NE PAS coter au partenaire comme si c'était un client

🏢 SI C'EST UN TENDER (MINUSCA, UN, multi-destinations, multi-contingents):
- NE PAS répondre avec une cotation email classique
- Indiquer UNIQUEMENT: "Demande analysée. Veuillez utiliser le module Tender pour préparer une offre consolidée multi-segments."
- Ne PAS appliquer les honoraires dédouanement sénégalais standard (contexte transit international multi-pays)
- NE PAS générer de tableau de tarifs dans l'email

💼 SI C'EST UNE COTATION CLASSIQUE (client demande directement):
- Appliquer le workflow standard
- Inclure les honoraires SODATRA (bloc 2)
- Structure 3 blocs (Opérationnel, Honoraires, D&T)

=== INFORMATIONS REQUISES POUR COTER ===

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

⛔ INTERDIT ABSOLUMENT:
- Phrases longues explicatives
- "Je reste à votre entière disposition pour tout renseignement complémentaire"
- "N'hésitez pas à me contacter si vous avez des questions"
- Inclure des tableaux de tarifs détaillés DANS le mail
- Ton robotique ou trop formel
- Explications réglementaires longues (sauf si demandé)
- DONNER DES PRIX SANS CONTEXTE SUFFISANT
- ⛔ MENTIONNER DES PIÈCES JOINTES ("attached", "ci-joint", "en pièce jointe", "pls find attached") - LE SYSTÈME NE GÉNÈRE PAS AUTOMATIQUEMENT DE FICHIER JOINT

=== RÈGLE TARIFAIRE ABSOLUE ===
TU N'INVENTES JAMAIS DE TARIF.
- Si tarif exact absent → "À CONFIRMER" ou "TBC"
- Utilise UNIQUEMENT: PORT_TARIFFS, CARRIER_BILLING, TAX_RATES, HS_CODES
- Si contexte insuffisant → PAS DE PRIX, pose des questions

=== STRUCTURE COTATION DAP/DDP PROGRESSIVE ===

Quand le client demande DDP mais que la valeur CAF n'est pas disponible,
génère une cotation PROGRESSIVE avec deux options:

📊 STRUCTURE EN 3 BLOCS (OBLIGATOIRE pour cotations):

**BLOC 1 - COÛTS OPÉRATIONNELS** (fixes, connus)
- Transport local / Livraison
- Handling portuaire/aéroportuaire (THC DP World ou DSS)
- Manutention, relevage, magasinage
- Frais documentaires (BL/AWB, ECTN, certificats)

**BLOC 2 - HONORAIRES SODATRA** (suggérés par système)
- Dédouanement (selon mode transport et complexité)
- Suivi opérationnel
- Ouverture dossier
- Commission débours (5% sur D&T)

**BLOC 3 - DÉBOURS DOUANIERS** (estimés ou TBC)
- DD (droits de douane) - taux selon HS code
- RS (redevance statistique) - 1%
- PCS - 0.8%
- TVA - 18%
- Autres taxes (COSEC, TIN...)
→ Si valeur CAF absente: "À CALCULER SUR FACTURES COMMERCIALES"

📋 FORMAT COTATION DAP vs DDP:

Pour DAP (sans taxes):
| Poste                      | Montant (FCFA) |
|----------------------------|----------------|
| [Coûts opérationnels]      | XXX            |
| [Honoraires SODATRA]       | XXX            |
| **TOTAL DAP**              | XXX            |

Pour DDP (avec taxes):
| Poste                      | Montant (FCFA) |
|----------------------------|----------------|
| [Total DAP ci-dessus]      | XXX            |
| [Débours D&T estimés]      | TBC/sur CAF    |
| **TOTAL DDP ESTIMÉ**       | TBC            |

📝 MENTION OBLIGATOIRE SI VALEUR CAF MANQUANTE:
"Pour calcul définitif des D&T, merci de nous transmettre les factures commerciales."

=== FORMAT DE SORTIE JSON ===
{
  "detected_language": "FR" | "EN",
  "request_type": "PI_ONLY" | "QUOTATION_REQUEST" | "QUESTION" | "ACKNOWLEDGMENT" | "FOLLOW_UP",
  "can_quote_now": true | false,
  "offer_type": "full_quotation" | "indicative_dap" | "rate_only" | "info_response",
  "clarification_questions": ["Question 1?", "Question 2?"],
  "subject": "Re: [sujet original]",
  "greeting": "Gd day Dear [Prénom]," (EN) ou "Bonjour [Prénom]," (FR),
  "body_short": "Corps CONCIS (15-20 lignes MAX). Style télégraphique.",
  "delegation": "@Cherif pls confirm HS codes" | "@Eric to follow up" | null,
  "closing": "With we remain,\\nBest Regards" (EN) ou "Bien à vous,\\nMeilleures Salutations" (FR),
  "signature": "SODATRA\\nTransit & Dédouanement",
  "attachment_needed": true | false,
  "attachment_type": "excel_quotation | rate_sheet | proforma | none",
  "attachment_data": {
    "filename": "Quotation_[Client]_[Date].xlsx",
    "posts": [
      { "description": "THC 40'", "montant": 310000, "devise": "FCFA", "source": "PORT_TARIFFS", "bloc": "operationnel" },
      { "description": "Honoraires dédouanement", "montant": 150000, "devise": "FCFA", "source": "SODATRA_FEES", "bloc": "honoraires" },
      { "description": "DD estimé (20%)", "montant": null, "devise": "FCFA", "source": "ESTIMATE", "bloc": "debours", "note": "Sur valeur CAF" }
    ],
    "total_dap": 350000,
    "total_debours_estimate": "TBC",
    "total_ddp": "TBC",
    "currency": "FCFA"
  },
  "cost_structure": {
    "bloc_operationnel": { "total": 200000, "items": [] },
    "bloc_honoraires": { "total": 150000, "items": [], "complexity_factor": 1.3 },
    "bloc_debours": { "total": null, "items": [], "note": "À calculer sur CAF" }
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
    "total_dap": 350000,
    "total_debours": null,
    "total_ddp": null,
    "devise": "FCFA",
    "confidence": 0.85,
    "is_progressive": true
  },
  "missing_info": ["Valeur CAF", "Code HS exact"],
  "follow_up_needed": true,
  "two_step_response": {
    "is_two_step": false,
    "step_1_content": "Container rates attached. Breakbulk to follow.",
    "step_2_pending": "Breakbulk rates"
  }
}`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { emailId, customInstructions, expertStyle, quotationData } = await req.json();
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // BUG #2 Fix: Rendre emailId optionnel pour cotation directe
    let email: any = null;

    if (emailId) {
      const { data: emailData, error: emailError } = await supabase
        .from('emails')
        .select('*')
        .eq('id', emailId)
        .single();

      if (emailError || !emailData) {
        throw new Error("Email non trouvé");
      }
      email = emailData;
    }

    // Fallbacks pour cotation directe (email = null)
    const emailSubject = email?.subject || quotationData?.projectContext?.project_name || 'Cotation directe';
    const emailFromAddress = email?.from_address || 'direct@quotation.local';
    const emailBodyText = email?.body_text || '';
    const emailSentAt = email?.sent_at || new Date().toISOString();
    const emailThreadRef = email?.thread_ref || null;
    const emailThreadId = email?.thread_id || null;

    console.log("Generating expert response for:", emailSubject);

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
      const byCarrier = carrierTemplates.reduce((acc: Record<string, typeof carrierTemplates>, t) => {
        if (!acc[t.carrier]) acc[t.carrier] = [];
        acc[t.carrier].push(t);
        return acc;
      }, {});

      for (const [carrier, templates] of Object.entries(byCarrier)) {
        const invoiceTypes = [...new Set(templates.map(t => t.invoice_type))];
        const isMultiInvoice = invoiceTypes.length > 1 || templates.some(t => t.invoice_sequence > 1);
        
        carrierBillingContext += `## ${carrier.replace('_', '-')}`;
        if (isMultiInvoice) {
          carrierBillingContext += ` (${invoiceTypes.length} factures séparées)`;
        } else {
          carrierBillingContext += ' (facture unique consolidée)';
        }
        carrierBillingContext += '\n';

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
          
          const attachment = attachments.find(a => a.id === attId);
          if (!attachment) continue;
          
          const isImage = attachment.content_type?.startsWith('image/');
          const isPdf = attachment.content_type === 'application/pdf';
          
          if (!isImage && !isPdf) {
            await supabase
              .from('email_attachments')
              .update({ 
                is_analyzed: true,
                extracted_data: { type: 'unsupported', content_type: attachment.content_type }
              })
              .eq('id', attId);
            continue;
          }
          
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
- Quantités et unités
- Poids et volumes
- Codes HS si mentionnés
- Pays d'origine/destination
- Incoterm
- Fournisseur

Réponds en JSON:
{
  "type": "proforma_invoice|packing_list|bill_of_lading|quotation|other",
  "valeur_caf": number | null,
  "devise": "USD|EUR|FCFA",
  "descriptions": ["description1", "description2"],
  "quantites": [{"item": "...", "qty": ..., "unit": "..."}],
  "poids_net_kg": number | null,
  "poids_brut_kg": number | null,
  "volume_cbm": number | null,
  "codes_hs": ["8471.30.00", ...],
  "origine": "China",
  "destination": "Senegal",
  "incoterm": "FOB|CIF|...",
  "fournisseur": "Company Name",
  "summary_text": "Résumé en 2-3 lignes du document"
}`
                },
                {
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: `Analyse ce document: ${attachment.filename}`
                    },
                    {
                      type: 'image_url',
                      image_url: { url: dataUrl }
                    }
                  ]
                }
              ],
              max_tokens: 2000
            }),
          });

          if (aiAnalysisResponse.ok) {
            const aiResult = await aiAnalysisResponse.json();
            const analysisContent = aiResult.choices?.[0]?.message?.content || '';
            
            let extractedData = {};
            let extractedText = analysisContent;
            
            try {
              const jsonMatch = analysisContent.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                extractedData = JSON.parse(jsonMatch[0]);
                extractedText = (extractedData as any).summary_text || analysisContent;
              }
            } catch (e) {
              console.log("Could not parse JSON from analysis, using raw text");
            }
            
            await supabase
              .from('email_attachments')
              .update({
                is_analyzed: true,
                extracted_text: extractedText,
                extracted_data: extractedData
              })
              .eq('id', attId);
              
            console.log(`Successfully analyzed ${attachment.filename}`);
          } else {
            const errorText = await aiAnalysisResponse.text();
            console.error(`AI analysis failed for ${attachment.filename}:`, errorText);
            
            await supabase
              .from('email_attachments')
              .update({
                is_analyzed: true,
                extracted_data: { type: 'analysis_failed', error: 'AI analysis failed' }
              })
              .eq('id', attId);
          }
        } catch (analysisError) {
          console.error(`Error analyzing attachment ${attId}:`, analysisError);
        }
      }
      
      // Refresh attachments after analysis
      const { data: refreshedAttachments } = await supabase
        .from('email_attachments')
        .select('*')
        .eq('email_id', emailId);
      
      if (refreshedAttachments) {
        attachments = refreshedAttachments;
      }
    }

    // Build attachments text for AI extraction
    let attachmentsText = '';
    let attachmentsContext = '';
    if (attachments && attachments.length > 0) {
      attachmentsContext = '\n\n=== PIÈCES JOINTES ANALYSÉES ===\n';
      for (const att of attachments) {
        attachmentsContext += `📎 ${att.filename} (${att.content_type})\n`;
        if (att.extracted_text) {
          attachmentsContext += `Contenu extrait:\n${att.extracted_text.substring(0, 3000)}\n`;
          attachmentsText += `\n--- ${att.filename} ---\n${att.extracted_text}\n`;
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
          attachmentsText += `Extracted data: ${JSON.stringify(data)}\n`;
        }
        if (!att.is_analyzed) {
          attachmentsContext += `⚠️ Analyse impossible - format non supporté\n`;
        }
      }
    }

    // ============ AI-POWERED EXTRACTION (REPLACES ALL REGEX) ============
    console.log("=== STARTING AI EXTRACTION ===");
    const aiExtracted = await extractWithAI(
      email.body_text || '',
      email.subject || '',
      attachmentsText,
      LOVABLE_API_KEY
    );
    console.log("AI Extraction complete:", JSON.stringify({
      transport_mode: aiExtracted.transport_mode,
      transport_mode_evidence: aiExtracted.transport_mode_evidence,
      origin: aiExtracted.origin,
      destination: aiExtracted.destination,
      can_quote_now: aiExtracted.can_quote_now
    }));

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

    // ============ FETCH LEARNED TARIFFS WITH CONTEXTUAL MATCHING ============
    // Build contextual query based on AI extracted data
    let tariffQuery = supabase
      .from('learned_knowledge')
      .select('*')
      .eq('is_validated', true)
      .in('category', ['tarif', 'tariff', 'rate', 'frais', 'honoraires']);
    
    // Apply contextual filters based on extracted data
    const tariffFilters: string[] = [];
    if (aiExtracted.destination) {
      tariffFilters.push(aiExtracted.destination.toLowerCase());
    }
    if (aiExtracted.transport_mode && aiExtracted.transport_mode !== 'unknown') {
      tariffFilters.push(aiExtracted.transport_mode);
    }
    if (aiExtracted.container_type) {
      tariffFilters.push(aiExtracted.container_type.toLowerCase());
    }
    
    const { data: allKnowledge } = await tariffQuery
      .order('confidence', { ascending: false })
      .limit(100);
    
    // Smart filtering: prioritize tariffs matching context
    let relevantTariffs: any[] = [];
    let genericTariffs: any[] = [];
    
    if (allKnowledge && allKnowledge.length > 0) {
      for (const k of allKnowledge) {
        const kName = (k.name || '').toLowerCase();
        const kDesc = (k.description || '').toLowerCase();
        const kData = JSON.stringify(k.data || {}).toLowerCase();
        const fullText = `${kName} ${kDesc} ${kData}`;
        
        // Check if matches any filter
        const matchesContext = tariffFilters.some(filter => fullText.includes(filter));
        
        if (matchesContext) {
          relevantTariffs.push(k);
        } else {
          genericTariffs.push(k);
        }
      }
    }
    
    // Use relevant tariffs first, then fill with generics (max 30 total)
    const knowledge = [...relevantTariffs.slice(0, 20), ...genericTariffs.slice(0, 10)];
    
    let tariffKnowledgeContext = '';
    if (knowledge.length > 0) {
      if (relevantTariffs.length > 0) {
        tariffKnowledgeContext = `\n\n=== TARIFS PERTINENTS POUR CETTE DEMANDE (${aiExtracted.destination || 'destination non précisée'}, ${aiExtracted.transport_mode}) ===\n`;
        for (const k of relevantTariffs.slice(0, 20)) {
          tariffKnowledgeContext += `✓ ${k.name}: ${k.description}\n`;
          if (k.data) {
            const data = k.data as any;
            if (data.montant) {
              tariffKnowledgeContext += `  💰 Montant: ${data.montant} ${data.devise || 'FCFA'}\n`;
            }
            if (data.conditions) {
              tariffKnowledgeContext += `  📋 Conditions: ${data.conditions}\n`;
            }
          }
        }
      }
      
      if (genericTariffs.length > 0 && relevantTariffs.length < 10) {
        tariffKnowledgeContext += '\n--- Autres tarifs disponibles ---\n';
        for (const k of genericTariffs.slice(0, 10)) {
          tariffKnowledgeContext += `• ${k.name}: ${k.description}\n`;
          if (k.data) {
            const data = k.data as any;
            if (data.montant) {
              tariffKnowledgeContext += `  Montant: ${data.montant} ${data.devise || 'FCFA'}\n`;
            }
          }
        }
      }
    }
    
    // ============ FETCH VALIDATED RESPONSE TEMPLATES ============
    const { data: templates } = await supabase
      .from('learned_knowledge')
      .select('*')
      .eq('is_validated', true)
      .eq('category', 'template')
      .order('usage_count', { ascending: false })
      .limit(5);
    
    let templatesContext = '';
    if (templates && templates.length > 0) {
      templatesContext = '\n\n=== TEMPLATES DE RÉPONSE VALIDÉS ===\n';
      templatesContext += 'Utilise ces templates comme référence pour le style et la structure de ta réponse:\n\n';
      for (const t of templates) {
        templatesContext += `📝 ${t.name}\n`;
        if (t.description) {
          templatesContext += `   Usage: ${t.description}\n`;
        }
        if (t.data) {
          const data = t.data as any;
          if (data.structure) {
            templatesContext += `   Structure: ${data.structure}\n`;
          }
          if (data.exemple) {
            templatesContext += `   Exemple: ${data.exemple.substring(0, 200)}...\n`;
          }
        }
        templatesContext += '\n';
      }
    }
    
    // Add templates context to tariff context
    tariffKnowledgeContext += templatesContext;

    // ============ FETCH EXPERT PROFILES AND SELECT STYLE ============
    const { data: allExperts } = await supabase
      .from('expert_profiles')
      .select('*');

    const talebProfile = allExperts?.find(e => 
      e.email?.toLowerCase().includes('taleb') || 
      e.name?.toLowerCase().includes('taleb') ||
      e.is_primary
    );
    const cherifProfile = allExperts?.find(e => 
      e.email?.toLowerCase().includes('douane@sodatra') || 
      e.name?.toLowerCase().includes('cherif')
    );

    let selectedExpert = talebProfile;
    let expertName = 'taleb';
    
    if (expertStyle === 'cherif' && cherifProfile) {
      selectedExpert = cherifProfile;
      expertName = 'cherif';
    } else if (expertStyle === 'auto' || !expertStyle) {
      const emailContent = emailBodyText + ' ' + emailSubject;
      expertName = selectExpertForResponse(emailContent, emailSubject);
      selectedExpert = expertName === 'cherif' ? cherifProfile : talebProfile;
    } else if (expertStyle === 'taleb') {
      selectedExpert = talebProfile;
      expertName = 'taleb';
    }

    console.log(`Selected expert style: ${expertName} (${selectedExpert?.name || 'default'})`);

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
    
    if (emailThreadRef) {
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
    
    // Skip sender contact lookup if no email source
    if (emailFromAddress !== 'direct@quotation.local') {
      const { data: senderContact } = await supabase
        .from('contacts')
        .select('*')
        .eq('email', emailFromAddress.toLowerCase())
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
    }
    
    // Helper function to identify sender role
    async function identifySenderRole(supabase: any, emailAddr: string): Promise<string> {
      const { data: contact } = await supabase
        .from('contacts')
        .select('role')
        .eq('email', emailAddr.toLowerCase())
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
      
      if (emailAddr.toLowerCase().includes('@sodatra')) return 'SODATRA';
      if (emailAddr.toLowerCase().includes('2hl')) return 'PARTENAIRE';
      return 'EXTERNE';
    }

    if (emailThreadId) {
      const { data: threadEmails } = await supabase
        .from('emails')
        .select('from_address, subject, body_text, sent_at')
        .eq('thread_id', emailThreadId)
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

    // ============ DETECT REGIME AND ADD LEGAL CONTEXT ============
    const emailContentForRegime = emailBodyText + ' ' + emailSubject;
    const detectedRegimes: string[] = [];
    
    if (/\bATE\b|admission\s+temporaire/i.test(emailContentForRegime)) {
      detectedRegimes.push('ATE');
    }
    if (/\bTRIE\b|S120|transit\s+international/i.test(emailContentForRegime)) {
      detectedRegimes.push('TRIE');
    }
    if (/\bC10\b|mise\s+à\s+la\s+consommation|import\s+définitif/i.test(emailContentForRegime)) {
      detectedRegimes.push('C10');
    }
    if (/\bMali\b|Burkina|Niger|Guinée/i.test(emailContentForRegime)) {
      detectedRegimes.push('TRIE');
    }
    
    let legalContext = '';
    if (detectedRegimes.length > 0) {
      legalContext = '\n\n=== RÉFÉRENCE LÉGALE - CODE DES DOUANES (Loi 2014-10) ===\n';
      legalContext += `Source: ${CUSTOMS_CODE_REFERENCE.source}\n`;
      
      for (const regime of [...new Set(detectedRegimes)]) {
        legalContext += getLegalContextForRegime(regime);
      }
      
      const maliMatch = emailContentForRegime.match(/\b(Mali|Bamako)\b/i);
      const burkinaMatch = emailContentForRegime.match(/\b(Burkina|Ouagadougou)\b/i);
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
      legalContext = '\n\n=== RÉFÉRENCE LÉGALE DISPONIBLE ===\n';
      legalContext += 'Code des Douanes du Sénégal (Loi 2014-10 du 28 février 2014)\n';
      legalContext += '- Admission Temporaire (ATE): Articles 217-218\n';
      legalContext += '- Transit International (TRIE): Articles 161-169\n';
      legalContext += '- Mise à la consommation: Articles 155-160\n';
      legalContext += '- Valeur en douane: Articles 18-19\n';
    }

    // ============ CTU CODE CONTEXT (Container Loading Best Practices) ============
    let ctuContext = '';
    const fullEmailContent = emailBodyText + ' ' + emailSubject + ' ' + 
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

    // ============ HS CODE SUGGESTIONS (Proactive AI) ============
    let hsSuggestionsResult: any = null;
    let hsSuggestionsContext = '';

    // Call suggest-hs-codes if we have cargo description
    if (aiExtracted.cargo_description && aiExtracted.cargo_description.length > 3) {
      console.log("Calling suggest-hs-codes for proactive HS code suggestions...");
      try {
        const hsSuggestResponse = await fetch(`${supabaseUrl}/functions/v1/suggest-hs-codes`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            cargo_description: aiExtracted.cargo_description,
            destination: aiExtracted.destination,
            context: (aiExtracted.services_requested || []).join(', ')
          }),
        });
        
        if (hsSuggestResponse.ok) {
          hsSuggestionsResult = await hsSuggestResponse.json();
          console.log("HS suggestions result:", JSON.stringify({
            count: hsSuggestionsResult?.suggestions?.length || 0,
            work_scope: hsSuggestionsResult?.work_scope
          }));
          
          // Build context for AI prompt
          if (hsSuggestionsResult?.success && hsSuggestionsResult?.suggestions?.length > 0) {
            hsSuggestionsContext = '\n\n=== SUGGESTIONS CODES HS AUTOMATIQUES ===\n';
            hsSuggestionsContext += '⚠️ Ces codes sont des SUGGESTIONS à valider par le client. Inclure dans la réponse.\n\n';
            hsSuggestionsContext += '| Article | Code HS | Description | DD | TVA | Confiance |\n';
            hsSuggestionsContext += '|---------|---------|-------------|-----|-----|------------|\n';
            for (const s of hsSuggestionsResult.suggestions) {
              hsSuggestionsContext += `| ${s.item} | ${s.hs_code} | ${(s.description || '').substring(0, 30)} | ${s.dd}% | ${s.tva}% | ${s.confidence} |\n`;
            }
            
            // Work scope
            if (hsSuggestionsResult.work_scope) {
              hsSuggestionsContext += `\n📋 SCOPE DU TRAVAIL:\n`;
              hsSuggestionsContext += `   Notre travail commence: ${hsSuggestionsResult.work_scope.starts_at}\n`;
              hsSuggestionsContext += `   Fret à organiser: ${hsSuggestionsResult.work_scope.includes_freight ? 'OUI' : 'NON (client gère le transport)'}\n`;
              hsSuggestionsContext += `   Services: ${hsSuggestionsResult.work_scope.services.join(', ')}\n`;
              if (hsSuggestionsResult.work_scope.notes?.length > 0) {
                hsSuggestionsContext += `   Notes: ${hsSuggestionsResult.work_scope.notes.join(' | ')}\n`;
              }
            }
            
            // Required documents
            if (hsSuggestionsResult.required_documents?.length > 0) {
              hsSuggestionsContext += `\n📄 DOCUMENTS REQUIS:\n`;
              for (const doc of hsSuggestionsResult.required_documents) {
                hsSuggestionsContext += `   • ${doc}\n`;
              }
            }
            
            // Regulatory notes
            if (hsSuggestionsResult.regulatory_notes?.length > 0) {
              hsSuggestionsContext += `\n📜 NOTES RÉGLEMENTAIRES:\n`;
              for (const note of hsSuggestionsResult.regulatory_notes) {
                hsSuggestionsContext += `   ${note}\n`;
              }
            }
            
            // DAP offer guidance
            if (hsSuggestionsResult.can_provide_dap_offer) {
              hsSuggestionsContext += `\n💡 OFFRE DAP POSSIBLE:\n`;
              hsSuggestionsContext += `   - Même sans valeur CAF, on peut proposer une offre avec taux DD/TVA indicatifs\n`;
              hsSuggestionsContext += `   - Demander les factures commerciales pour estimation précise des D&T\n`;
              hsSuggestionsContext += `   - Proposer les frais fixes: manutention, magasinage, transit, livraison\n`;
            }
          }
        } else {
          console.error("suggest-hs-codes failed:", await hsSuggestResponse.text());
        }
      } catch (hsError) {
        console.error("suggest-hs-codes error (non-blocking):", hsError);
      }
    }

    // ============ WORK SCOPE ANALYSIS (Based on services_requested) ============
    let workScopeContext = '';
    const servicesRequested = aiExtracted.services_requested || [];
    
    if (servicesRequested.length > 0) {
      workScopeContext = '\n\n=== ANALYSE DU SCOPE DE TRAVAIL ===\n';
      
      // Check if freight is needed
      const needsFreight = !servicesRequested.includes('customs_clearance') || 
                           servicesRequested.includes('pickup') ||
                           (aiExtracted.incoterm && ['EXW', 'FCA', 'FOB'].includes(aiExtracted.incoterm));
      
      // If only customs_clearance + local_delivery, work starts at port
      if (servicesRequested.includes('customs_clearance') && servicesRequested.includes('local_delivery') && !servicesRequested.includes('pickup')) {
        workScopeContext += '📍 NOTRE TRAVAIL COMMENCE: Arrivée au Port de Dakar\n';
        workScopeContext += '🚢 FRET MARITIME/AÉRIEN: NON NÉCESSAIRE - Le client organise le transport\n';
        workScopeContext += '   → Ne pas contacter les compagnies maritimes/aériennes pour cette opération\n';
        workScopeContext += '   → Estimer: débarquement, magasinage, dédouanement, livraison locale\n';
      } else if (needsFreight) {
        workScopeContext += '📍 NOTRE TRAVAIL COMMENCE: Origine\n';
        workScopeContext += '🚢 FRET: À ORGANISER\n';
      }
      
      workScopeContext += `\n📋 SERVICES DEMANDÉS: ${servicesRequested.join(', ')}\n`;
      
      // Add guidance based on services
      if (servicesRequested.includes('duty_tax_calculation')) {
        workScopeContext += '\n💰 CALCUL D&T DEMANDÉ:\n';
        if (!aiExtracted.value) {
          workScopeContext += '   ⚠️ Valeur CAF non fournie - Donner les TAUX INDICATIFS\n';
          workScopeContext += '   → "Pour estimation précise, merci de fournir les factures commerciales"\n';
        }
      }
    }

    // ============ V5 WORKFLOW: CALL ANALYSIS FUNCTIONS ============
    let coherenceResult: any = null;
    let incotermResult: any = null;
    let riskResult: any = null;
    let v5AnalysisContext = '';

    try {
      // 1. Audit Coherence (poids/volume validation)
      if (aiExtracted.weight_kg || aiExtracted.volume_cbm || aiExtracted.container_type) {
        console.log("Calling audit-coherence...");
        const coherenceResponse = await fetch(`${supabaseUrl}/functions/v1/audit-coherence`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            weight_kg: aiExtracted.weight_kg,
            volume_cbm: aiExtracted.volume_cbm,
            container_type: aiExtracted.container_type,
            cargo_description: aiExtracted.cargo_description,
          }),
        });
        if (coherenceResponse.ok) {
          coherenceResult = await coherenceResponse.json();
          console.log("Coherence result:", JSON.stringify(coherenceResult));
        }
      }

      // 2. Arbitrage Incoterm
      if (aiExtracted.incoterm) {
        console.log("Calling arbitrage-incoterm...");
        const incotermResponse = await fetch(`${supabaseUrl}/functions/v1/arbitrage-incoterm`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            incoterm: aiExtracted.incoterm,
            origin_country: aiExtracted.origin,
            destination_country: aiExtracted.destination,
            fob_value: aiExtracted.value,
            currency: aiExtracted.currency,
          }),
        });
        if (incotermResponse.ok) {
          incotermResult = await incotermResponse.json();
          console.log("Incoterm result:", JSON.stringify(incotermResult));
        }
      }

      // 3. Analyze Risks
      console.log("Calling analyze-risks...");
      const riskResponse = await fetch(`${supabaseUrl}/functions/v1/analyze-risks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cargo_nature: aiExtracted.cargo_description,
          destination: aiExtracted.destination,
          container_type: aiExtracted.container_type,
          carrier: aiExtracted.carrier,
          is_transit: /mali|bamako|burkina|ouaga|niger|guinée/i.test(aiExtracted.destination || ''),
          transit_destination: aiExtracted.destination,
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
      }

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
      }

      if (riskResult) {
        v5AnalysisContext += '\n🎯 ANALYSE DES RISQUES:\n';
        v5AnalysisContext += `   Risque temps: ${riskResult.time_risk?.level?.toUpperCase() || 'N/A'}\n`;
        v5AnalysisContext += `   Risque nature: ${riskResult.nature_risk?.level?.toUpperCase() || 'N/A'}\n`;
        
        if (riskResult.provisions?.total_provisions_fcfa > 0) {
          v5AnalysisContext += `   💰 PROVISIONS RECOMMANDÉES: ${riskResult.provisions.total_provisions_fcfa.toLocaleString('fr-FR')} FCFA\n`;
        }
      }
    }

    // ============ CALL QUOTATION-ENGINE FOR STRUCTURED TARIFFS ============
    let quotationEngineResult: any = null;
    
    if (aiExtracted.can_quote_now && aiExtracted.destination) {
      console.log("Calling quotation-engine for structured tariffs...");
      
      // Prepare containers array from AI extraction
      const containersForEngine = aiExtracted.containers?.length 
        ? aiExtracted.containers.map((c: any) => ({
            type: c.type,
            quantity: c.quantity || 1,
            cocSoc: c.coc_soc,
            notes: c.notes
          }))
        : aiExtracted.container_type 
          ? [{ type: aiExtracted.container_type, quantity: 1 }]
          : undefined;
      
      // Calculate total weight from containers if available
      const totalWeightTonnes = aiExtracted.weight_kg 
        ? aiExtracted.weight_kg / 1000 
        : undefined;
      
      try {
        const qeResponse = await fetch(`${supabaseUrl}/functions/v1/quotation-engine`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'generate',
            params: {
              finalDestination: aiExtracted.destination,
              originPort: aiExtracted.origin,
              transportMode: aiExtracted.transport_mode === 'maritime' ? 'maritime' : 
                             aiExtracted.transport_mode === 'air' ? 'aerien' : 'routier',
              incoterm: aiExtracted.incoterm || 'CIF',
              cargoType: aiExtracted.cargo_description || 'general',
              cargoDescription: aiExtracted.cargo_description,
              cargoValue: aiExtracted.value || 10000000,
              cargoCurrency: aiExtracted.currency || 'FCFA',
              cargoWeight: totalWeightTonnes,
              // Multi-container support
              containers: containersForEngine,
              containerType: aiExtracted.container_type, // Legacy fallback
              containerCount: aiExtracted.containers?.reduce((s: number, c: any) => s + (c.quantity || 1), 0) || 1,
              // Carrier info for THD/carrier charges
              carrier: aiExtracted.carrier,
              shippingLine: aiExtracted.carrier,
              // Weight and volume
              weightTonnes: totalWeightTonnes,
              volumeM3: aiExtracted.volume_cbm,
              // HS Code
              hsCode: aiExtracted.hs_codes?.[0],
              // Services
              includeCustomsClearance: aiExtracted.services_requested?.includes('customs_clearance') !== false,
              includeLocalTransport: aiExtracted.services_requested?.includes('local_delivery') !== false,
              // Client
              clientCompany: aiExtracted.client_company,
              // Transit detection from email context
              isTransit: aiExtracted.email_context?.is_tender || 
                         /mali|bamako|burkina|niger|guinée|mauritanie/i.test(aiExtracted.destination || ''),
            }
          }),
        });

        if (qeResponse.ok) {
          quotationEngineResult = await qeResponse.json();
          console.log("Quotation engine result:", JSON.stringify({
            success: quotationEngineResult?.success,
            linesCount: quotationEngineResult?.lines?.length,
            totals: quotationEngineResult?.totals,
            isTransit: quotationEngineResult?.metadata?.isTransit,
            transitCountry: quotationEngineResult?.metadata?.transitCountry
          }));
        } else {
          console.error("Quotation engine call failed:", await qeResponse.text());
        }
      } catch (qeError) {
        console.error("quotation-engine call failed (non-blocking):", qeError);
      }
    }

    // ============ BUILD STRUCTURED QUOTATION CONTEXT ============
    let quotationContext = '';
    
    if (quotationEngineResult?.success && quotationEngineResult?.lines?.length > 0) {
      quotationContext = '\n\n=== 💰 COTATION STRUCTURÉE (quotation-engine) ===\n';
      quotationContext += '🔴 UTILISE CES MONTANTS EXACTS DANS TA RÉPONSE\n\n';
      
      // Bloc Opérationnel
      const opLines = quotationEngineResult.lines.filter((l: any) => l.bloc === 'operationnel');
      if (opLines.length > 0) {
        quotationContext += '📦 BLOC 1 - COÛTS OPÉRATIONNELS:\n';
        quotationContext += '| Service | Montant | Source | Confiance |\n';
        quotationContext += '|---------|---------|--------|------------|\n';
        for (const line of opLines) {
          const source = line.source.type === 'OFFICIAL' ? '✅ OFFICIEL' :
                         line.source.type === 'HISTORICAL' ? '📊 HISTORIQUE' :
                         line.source.type === 'CALCULATED' ? '📐 CALCULÉ' : '⚠️ À CONFIRMER';
          quotationContext += `| ${line.description} | ${line.amount ? line.amount.toLocaleString('fr-FR') + ' FCFA' : 'TBC'} | ${source} | ${Math.round(line.source.confidence * 100)}% |\n`;
        }
        quotationContext += `\n→ TOTAL OPÉRATIONNEL: ${quotationEngineResult.totals.operationnel.toLocaleString('fr-FR')} FCFA\n\n`;
      }
      
      // NOUVEAU: Bloc Frontière Mali
      const borderLines = quotationEngineResult.lines.filter((l: any) => l.bloc === 'border');
      if (borderLines.length > 0) {
        quotationContext += '🚧 BLOC FRONTIÈRE MALI:\n';
        quotationContext += '=== FRAIS FRONTIÈRE MALI (Moussala/Kidira) ===\n';
        for (const line of borderLines) {
          quotationContext += `• ${line.description}: ${line.amount?.toLocaleString('fr-FR')} FCFA\n`;
          if (line.notes) quotationContext += `  ↳ ${line.notes}\n`;
        }
        quotationContext += `→ TOTAL FRONTIÈRE: ${quotationEngineResult.totals.border?.toLocaleString('fr-FR') || borderLines.reduce((s: number, l: any) => s + (l.amount || 0), 0).toLocaleString('fr-FR')} FCFA\n\n`;
      }
      
      // NOUVEAU: Bloc Terminal Destination (Kati/Bamako)
      const terminalLines = quotationEngineResult.lines.filter((l: any) => l.bloc === 'terminal');
      if (terminalLines.length > 0) {
        quotationContext += '🏭 BLOC CLEARING DESTINATION (KATI/BAMAKO):\n';
        quotationContext += '=== FRAIS TERMINAL MALI ===\n';
        for (const line of terminalLines) {
          quotationContext += `• ${line.description}: ${line.amount?.toLocaleString('fr-FR')} FCFA\n`;
          if (line.notes) quotationContext += `  ↳ ${line.notes}\n`;
        }
        quotationContext += `→ TOTAL TERMINAL: ${quotationEngineResult.totals.terminal?.toLocaleString('fr-FR') || terminalLines.reduce((s: number, l: any) => s + (l.amount || 0), 0).toLocaleString('fr-FR')} FCFA\n\n`;
      }
      
      // Bloc Honoraires
      const honorairesLines = quotationEngineResult.lines.filter((l: any) => l.bloc === 'honoraires');
      if (honorairesLines.length > 0) {
        quotationContext += '🏢 BLOC 2 - HONORAIRES SODATRA:\n';
        for (const line of honorairesLines) {
          quotationContext += `• ${line.description}: ${line.amount?.toLocaleString('fr-FR')} FCFA\n`;
        }
        quotationContext += `→ TOTAL HONORAIRES: ${quotationEngineResult.totals.honoraires.toLocaleString('fr-FR')} FCFA\n\n`;
      }
      
      // Bloc Débours
      const deboursLines = quotationEngineResult.lines.filter((l: any) => l.bloc === 'debours');
      if (deboursLines.length > 0) {
        quotationContext += '🏛️ BLOC 3 - DÉBOURS (DROITS & TAXES):\n';
        for (const line of deboursLines) {
          quotationContext += `• ${line.description}: ${line.amount ? line.amount.toLocaleString('fr-FR') + ' FCFA' : 'À CALCULER'}\n`;
          if (line.notes) quotationContext += `  ↳ Note: ${line.notes}\n`;
        }
        quotationContext += `→ TOTAL DÉBOURS: ${quotationEngineResult.totals.debours.toLocaleString('fr-FR')} FCFA\n\n`;
      }
      
      // Totaux
      quotationContext += '═══════════════════════════════════════\n';
      quotationContext += `📍 TOTAL DAP (sans D&T): ${quotationEngineResult.totals.dap.toLocaleString('fr-FR')} FCFA\n`;
      quotationContext += `📍 TOTAL DDP (avec D&T): ${quotationEngineResult.totals.ddp.toLocaleString('fr-FR')} FCFA\n`;
      
      // Warnings
      if (quotationEngineResult.warnings?.length > 0) {
        quotationContext += '\n⚠️ POINTS D\'ATTENTION:\n';
        for (const w of quotationEngineResult.warnings) {
          quotationContext += `   • ${w}\n`;
        }
      }
    }
    
    // ============ FETCH AND INJECT CGV CLAUSES (NEW) ============
    let cgvContext = '';
    const isTransitMali = /mali|bamako|sirakoro|sikasso|kayes|kati|koulikoro/i.test(aiExtracted.destination || '');
    const destinationType = isTransitMali ? 'MALI_TRANSIT' : 'SENEGAL_IMPORT';
    
    try {
      const { data: cgvClauses } = await supabase
        .from('quotation_clauses')
        .select('*')
        .in('destination_type', [destinationType, 'ALL'])
        .eq('is_active', true)
        .order('sort_order');
      
      if (cgvClauses && cgvClauses.length > 0) {
        const conditions = cgvClauses.filter((c: any) => !c.is_exclusion);
        const exclusions = cgvClauses.filter((c: any) => c.is_exclusion);
        
        cgvContext = `\n\n=== CONDITIONS ${isTransitMali ? 'TRANSIT MALI' : 'IMPORT SÉNÉGAL'} ===\n`;
        cgvContext += '🔴 INCLURE CES CONDITIONS DANS LA COTATION:\n\n';
        
        // Conditions principales
        for (const clause of conditions) {
          const prefix = clause.is_warning ? '⚠️ ' : '• ';
          cgvContext += `${prefix}${clause.clause_title}: ${clause.clause_content}\n`;
        }
        
        // Exclusions
        if (exclusions.length > 0) {
          cgvContext += '\n📋 EXCLUSIONS (À LISTER DANS L\'EMAIL):\n';
          for (const excl of exclusions) {
            cgvContext += `• ${excl.clause_title}: ${excl.clause_content}\n`;
          }
        }
        
        console.log(`Injected ${cgvClauses.length} CGV clauses for ${destinationType}`);
      }
    } catch (cgvError) {
      console.error("CGV fetch error (non-blocking):", cgvError);
    }

    // ============ CALCULATE SODATRA FEES (from quotation-engine or fallback) ============
    let sodatraFeesSuggestion: SodatraFeeSuggestion;
    
    if (quotationEngineResult?.success) {
      // Build sodatraFeesSuggestion from quotation-engine output
      const honorairesLines = quotationEngineResult.lines?.filter((l: any) => l.bloc === 'honoraires') || [];
      sodatraFeesSuggestion = {
        fees: honorairesLines.map((l: any) => ({
          key: l.id,
          label: l.description,
          suggested_amount: l.amount || 0,
          min_amount: 0,
          max_amount: 999999999,
          unit: 'dossier',
          formula: `Source: ${l.source?.reference || 'quotation-engine'}`,
          is_editable: l.isEditable ?? true,
          factors_applied: l.notes ? [l.notes] : ['Standard'],
        })),
        total_suggested: quotationEngineResult.totals?.honoraires || 0,
        complexity_factor: quotationEngineResult.metadata?.zone?.multiplier || 1.0,
        complexity_reasons: quotationEngineResult.warnings || [],
        transport_mode: aiExtracted.transport_mode,
        can_calculate_commission: true,
        commission_note: undefined,
      };
      console.log("Using SODATRA fees from quotation-engine");
    } else {
      // Fallback to inline calculation
      sodatraFeesSuggestion = calculateSodatraFees({
        transport_mode: aiExtracted.transport_mode as any,
        cargo_value_caf: aiExtracted.value || undefined,
        weight_kg: aiExtracted.weight_kg || undefined,
        volume_cbm: aiExtracted.volume_cbm || undefined,
        container_types: aiExtracted.container_type ? [aiExtracted.container_type] : [],
        container_count: aiExtracted.containers?.length || 1,
        is_exempt_project: hsSuggestionsResult?.work_scope?.notes?.some((n: string) => 
          n.toLowerCase().includes('exonér') || n.toLowerCase().includes('exempt')
        ) || false,
        is_dangerous: riskResult?.nature_risk?.is_imo || false,
        is_oog: riskResult?.nature_risk?.is_oog || false,
        is_reefer: riskResult?.nature_risk?.is_reefer || false,
        destination_zone: getDestinationZone(aiExtracted.destination),
        services_requested: aiExtracted.services_requested,
        incoterm: aiExtracted.incoterm || undefined,
      });
      console.log("Using FALLBACK SODATRA fees calculation");
    }

    console.log("SODATRA fees (final):", JSON.stringify({ total: sodatraFeesSuggestion.total_suggested }));

    // ============ BUILD SODATRA FEES CONTEXT FOR AI ============
    let sodatraFeesContext = '\n\n=== ⚠️ HONORAIRES SODATRA - À INCLURE DANS LA COTATION ===\n';
    sodatraFeesContext += '🔴 RÈGLE ABSOLUE: Tu DOIS inclure ces montants dans le body_short avec le format ci-dessous\n\n';
    
    sodatraFeesContext += '| Service | Montant (FCFA) | Formule |\n';
    sodatraFeesContext += '|---------|----------------|----------|\n';
    for (const fee of sodatraFeesSuggestion.fees) {
      sodatraFeesContext += `| ${fee.label} | ${fee.suggested_amount.toLocaleString('fr-FR')} | ${fee.formula} |\n`;
    }
    sodatraFeesContext += `| **TOTAL HONORAIRES** | **${sodatraFeesSuggestion.total_suggested.toLocaleString('fr-FR')}** | |\n`;
    
    if (sodatraFeesSuggestion.complexity_reasons.length > 0) {
      sodatraFeesContext += `\n⚙️ Facteurs de complexité appliqués:\n`;
      for (const reason of sodatraFeesSuggestion.complexity_reasons) {
        sodatraFeesContext += `   • ${reason}\n`;
      }
    }
    
    if (sodatraFeesSuggestion.commission_note) {
      sodatraFeesContext += `\n💰 ${sodatraFeesSuggestion.commission_note}\n`;
    }
    
    sodatraFeesContext += `\n📋 FORMAT OBLIGATOIRE DANS LE BODY:\n`;
    sodatraFeesContext += `=== SODATRA FEES ===\n`;
    for (const fee of sodatraFeesSuggestion.fees) {
      const labelEN = fee.key === 'dedouanement' ? 'Customs clearance' :
                      fee.key === 'suivi_operationnel' ? 'Operational follow-up' :
                      fee.key === 'ouverture_dossier' ? 'File opening' :
                      fee.key === 'frais_documentaires' ? 'Documentation fees' :
                      fee.key === 'commission_debours' ? 'Disbursement commission (5%)' : fee.label;
      sodatraFeesContext += `• ${labelEN}: ${fee.suggested_amount.toLocaleString('fr-FR')} FCFA\n`;
    }
    sodatraFeesContext += `\nTOTAL SODATRA FEES: ${sodatraFeesSuggestion.total_suggested.toLocaleString('fr-FR')} FCFA\n`;

    // Build analysis context for AI (using AI-extracted data)
    let analysisContext = `\n\n=== ANALYSE AUTOMATIQUE DE LA DEMANDE (AI-POWERED) ===
📌 LANGUE DÉTECTÉE: ${aiExtracted.detected_language}
   → Tu DOIS répondre 100% en ${aiExtracted.detected_language === 'FR' ? 'FRANÇAIS' : 'ANGLAIS'}
   
📌 TYPE DE DEMANDE: ${aiExtracted.request_type}
📌 PEUT COTER MAINTENANT: ${aiExtracted.can_quote_now ? 'OUI' : 'NON - CONTEXTE INSUFFISANT'}

📌 MODE DE TRANSPORT: ${aiExtracted.transport_mode.toUpperCase()}
   Evidence: ${aiExtracted.transport_mode_evidence}

${!aiExtracted.can_quote_now ? `
⚠️ INFORMATIONS MANQUANTES - NE PAS DONNER DE PRIX:
${aiExtracted.missing_info.map(m => `   • ${m}`).join('\n')}

📋 QUESTIONS À POSER AU CLIENT:
${aiExtracted.questions_to_ask.map(q => `   • ${q}`).join('\n')}
` : ''}

📊 ÉLÉMENTS DÉTECTÉS:
   • PI jointe: ${aiExtracted.detected_elements.hasPI ? 'OUI' : 'NON'}
   • Incoterm: ${aiExtracted.incoterm || 'NON'}
   • Destination: ${aiExtracted.destination || 'NON'}
   • Origine: ${aiExtracted.origin || 'NON'}
   • Type conteneur: ${aiExtracted.container_type || 'N/A (fret aérien?)'}
   • Poids: ${aiExtracted.weight_kg ? aiExtracted.weight_kg + ' kg' : 'NON'}
   • Volume: ${aiExtracted.volume_cbm ? aiExtracted.volume_cbm + ' m³' : 'NON'}
   • Transporteur: ${aiExtracted.carrier || 'NON DÉTECTÉ'}
   • Code HS: ${aiExtracted.hs_codes.length > 0 ? aiExtracted.hs_codes.join(', ') : 'NON'}
   • Valeur: ${aiExtracted.value ? aiExtracted.value + ' ' + (aiExtracted.currency || '') : 'NON'}
${v5AnalysisContext}`;

    // ============ BUILD PROMPT ============
    const userPrompt = `
=== PARAMÈTRES CRITIQUES ===
detected_language: "${aiExtracted.detected_language}"
request_type: "${aiExtracted.request_type}"
can_quote_now: ${aiExtracted.can_quote_now}
transport_mode: "${aiExtracted.transport_mode}"
clarification_questions_suggested: ${JSON.stringify(aiExtracted.questions_to_ask)}

DEMANDE CLIENT À ANALYSER:
De: ${emailFromAddress}
Objet: ${emailSubject}
Date: ${emailSentAt}

${emailBodyText}

${analysisContext}
${portTariffsContext}
${carrierBillingContext}
${taxRatesContext}
${regimesContext}
${legalContext}
${ctuContext}
${hsSuggestionsContext}
${workScopeContext}
${attachmentsContext}
${tariffKnowledgeContext}
${threadRoleContext}
${threadContext}
${expertContext}
${quotationContext}
${cgvContext}
${sodatraFeesContext}

${customInstructions ? `INSTRUCTIONS SUPPLÉMENTAIRES: ${customInstructions}` : ''}

RAPPELS CRITIQUES:
1. 🌍 LANGUE: Réponds 100% en ${aiExtracted.detected_language === 'FR' ? 'FRANÇAIS' : 'ANGLAIS'} - NE MÉLANGE PAS LES LANGUES
2. 📋 SI can_quote_now = false: 
   - N'invente PAS de prix
   - Accuse réception (PI, demande)
   - Pose les questions de clarification
   - C'est ILLOGIQUE de donner des prix sans contexte
3. Si can_quote_now = true:
   - IDENTIFIER LE TRANSPORTEUR
   - Pour les THC DP World: utilise EXACTEMENT les montants de PORT_TARIFFS
   - Pour les frais compagnie: utilise les templates de CARRIER_BILLING
   - Pour tout tarif non disponible → "À CONFIRMER" ou "TBC"
4. 🔴 HONORAIRES SODATRA OBLIGATOIRES:
   - Inclure TOUS les honoraires listés dans SODATRA FEES CONTEXT
   - Utiliser les montants EXACTS fournis (pas d'estimation)
   - Format structuré: "=== SODATRA FEES ===" suivi de la liste
   - TOUJOURS inclure le TOTAL SODATRA FEES
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
    const greeting = parsedResponse.greeting || (aiExtracted.detected_language === 'FR' ? 'Bonjour,' : 'Dear Sir/Madam,');
    const bodyShort = parsedResponse.body_short || parsedResponse.body || '';
    const delegation = parsedResponse.delegation ? `\n\n${parsedResponse.delegation}` : '';
    const closing = parsedResponse.closing || (aiExtracted.detected_language === 'FR' ? 'Meilleures Salutations' : 'Best Regards');
    const signature = parsedResponse.signature || 'Taleb HOBALLAH\n2HL Group';
    
    const fullBodyText = `${greeting}\n\n${bodyShort}${delegation}\n\n${closing}\n\n${signature}`;

    // Create draft
    const { data: draft, error: draftError } = await supabase
      .from('email_drafts')
      .insert({
        original_email_id: emailId,
        to_addresses: [emailFromAddress],
        subject: parsedResponse.subject || `Re: ${emailSubject}`,
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

    console.log(`Generated ${aiExtracted.detected_language} draft (type: ${aiExtracted.request_type}, canQuote: ${aiExtracted.can_quote_now}, transport: ${aiExtracted.transport_mode}):`, draft.id);

    // ============ GENERATE ATTACHMENT IF NEEDED ============
    let attachmentResult: any = null;
    if (parsedResponse.attachment_needed && parsedResponse.attachment_data?.posts?.length > 0) {
      console.log("Generating quotation attachment...");
      try {
        const enrichedAttachmentData = {
          ...parsedResponse.attachment_data,
          client_name: emailFromAddress.split('@')[0].replace(/[._]/g, ' '),
          destination: aiExtracted.destination,
          incoterm: aiExtracted.incoterm,
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

    // Build backwards-compatible extracted_data object
    const extractedData = {
      weight_kg: aiExtracted.weight_kg,
      volume_cbm: aiExtracted.volume_cbm,
      container_type: aiExtracted.container_type,
      incoterm: aiExtracted.incoterm,
      carrier: aiExtracted.carrier,
      origin: aiExtracted.origin,
      destination: aiExtracted.destination,
      cargo_description: aiExtracted.cargo_description,
      value: aiExtracted.value,
      currency: aiExtracted.currency,
      eta_date: null,
      transport_mode: aiExtracted.transport_mode,
      transport_mode_evidence: [aiExtracted.transport_mode_evidence],
    };

    // SODATRA fees already calculated before AI call (see line ~1926)

    return new Response(
      JSON.stringify({
        success: true,
        draft: draft,
        // Analysis fields
        detected_language: aiExtracted.detected_language,
        request_type: aiExtracted.request_type,
        can_quote_now: aiExtracted.can_quote_now,
        clarification_questions: parsedResponse.clarification_questions || aiExtracted.questions_to_ask,
        detected_elements: aiExtracted.detected_elements,
        // Extracted shipment data (AI-powered)
        extracted_data: extractedData,
        // Transport mode (KEY: AI-determined)
        transport_mode: aiExtracted.transport_mode,
        transport_mode_evidence: [aiExtracted.transport_mode_evidence],
        // V5 Workflow: Analysis results
        v5_analysis: {
          coherence_audit: coherenceResult,
          incoterm_analysis: incotermResult,
          risk_analysis: riskResult,
        },
        // HS Code Suggestions (Proactive AI)
        hs_suggestions: hsSuggestionsResult?.suggestions || [],
        work_scope: hsSuggestionsResult?.work_scope || null,
        required_documents: hsSuggestionsResult?.required_documents || [],
        regulatory_notes: hsSuggestionsResult?.regulatory_notes || [],
        services_requested: aiExtracted.services_requested || [],
        // SODATRA fees suggestion
        sodatra_fees: sodatraFeesSuggestion,
        // Quotation engine structured output (NEW)
        quotation_lines: quotationEngineResult?.lines || [],
        quotation_totals: quotationEngineResult?.totals || null,
        quotation_metadata: quotationEngineResult?.metadata || null,
        quotation_warnings: quotationEngineResult?.warnings || [],
        // Vigilance points
        vigilance_points: [
          ...(coherenceResult?.alerts?.map((a: any) => ({ type: 'coherence', ...a })) || []),
          ...(incotermResult?.quotation_guidance?.vigilance_points_fr?.map((p: string) => ({ type: 'incoterm', message_fr: p })) || []),
          ...(riskResult?.vigilance_points || []),
        ],
        provisions: riskResult?.provisions || null,
        // Response structure
        structured_response: {
          greeting: parsedResponse.greeting,
          body_short: parsedResponse.body_short,
          delegation: parsedResponse.delegation,
          closing: parsedResponse.closing,
          signature: parsedResponse.signature
        },
        attachment_needed: parsedResponse.attachment_needed,
        attachment_data: parsedResponse.attachment_data,
        generated_attachment: attachmentResult?.attachment || null,
        quotation_summary: parsedResponse.quotation_summary,
        regulatory_analysis: parsedResponse.regulatory_analysis,
        carrier_detected: aiExtracted.carrier || parsedResponse.carrier_detected,
        response_template_used: parsedResponse.response_template_used,
        two_step_response: parsedResponse.two_step_response,
        confidence: parsedResponse.quotation_summary?.confidence || parsedResponse.confidence,
        missing_info: parsedResponse.missing_info || aiExtracted.missing_info
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
