import { useMemo } from 'react';

export type ComplexityLevel = 1 | 2 | 3 | 4;
export type WorkflowType = 'simple' | 'standard' | 'project' | 'tender';

export interface ComplexityAssessment {
  level: ComplexityLevel;
  workflow: WorkflowType;
  label: string;
  color: 'green' | 'yellow' | 'orange' | 'red';
  reasons: string[];
  warnings: string[];
  suggestedActions: string[];
}

interface EmailData {
  subject?: string;
  body?: string;
  from_address?: string;
  attachments?: { filename: string; content_type?: string }[];
}

interface ExtractedData {
  destination?: string;
  origin?: string;
  weight_kg?: number;
  volume_cbm?: number;
  container_type?: string;
  value?: number;
  cargo_description?: string;
}

// Keywords indicating tender/RFP
const TENDER_KEYWORDS = [
  'rfps', 'rfp', 'appel d\'offre', 'appel d\'offres', 'tender', 'consultation',
  'minusca', 'unmiss', 'monusco', 'minusma', 'minurso', 'unoci',
  'nations unies', 'united nations', 'un peacekeeping',
  'demobilization', 'repatriation', 'rotation',
  'contingent', 'battalion', 'peacekeeping',
  'pam', 'wfp', 'world food programme', 'unhcr', 'unicef', 'undp',
  'african union', 'union africaine', 'ua',
];

// Keywords indicating project cargo
const PROJECT_KEYWORDS = [
  'hors gabarit', 'hors-gabarit', 'oog', 'out of gauge',
  'project cargo', 'colis exceptionnel', 'convoi exceptionnel',
  'grue', 'crane', 'transformateur', 'transformer',
  'turbine', 'générateur', 'generator',
  'escort', 'escorte', 'permis spécial', 'autorisation',
  'surlargeur', 'surhauteur', 'overlength', 'overwidth', 'overheight',
];

// Keywords indicating special/complex cargo
const SPECIAL_CARGO_KEYWORDS = [
  'imo', 'dangereux', 'hazardous', 'dg cargo',
  'réfrigéré', 'reefer', 'frigo', 'température contrôlée',
  'fragile', 'précieux', 'valuable',
  'véhicule', 'vehicle', 'voiture', 'car', 'roro',
  'bétail', 'livestock', 'animaux vivants',
];

// Institutional clients (UN, governments, etc.)
const INSTITUTIONAL_DOMAINS = [
  'un.org', 'undp.org', 'wfp.org', 'unhcr.org', 'unicef.org',
  'worldbank.org', 'afdb.org', 'afd.fr',
  'gouv.', 'gov.', 'government',
  'minusca', 'unmiss', 'monusco',
];

function containsAny(text: string, keywords: string[]): string[] {
  const textLower = text.toLowerCase();
  return keywords.filter(kw => textLower.includes(kw.toLowerCase()));
}

function countDestinations(text: string): number {
  const destinations = new Set<string>();
  const countries = [
    'sénégal', 'senegal', 'mali', 'burkina', 'niger', 'guinée', 'guinea',
    'côte d\'ivoire', 'ivory coast', 'ghana', 'togo', 'bénin', 'benin',
    'cameroun', 'cameroon', 'gabon', 'congo', 'tchad', 'chad',
    'centrafrique', 'rca', 'car', 'soudan', 'sudan',
    'mauritanie', 'mauritania', 'gambie', 'gambia',
  ];
  const cities = [
    'dakar', 'bamako', 'ouagadougou', 'niamey', 'abidjan', 'accra',
    'conakry', 'freetown', 'monrovia', 'lomé', 'cotonou',
    'douala', 'yaoundé', 'libreville', 'brazzaville', 'kinshasa',
    'bangui', 'ndjamena', 'khartoum', 'juba',
    'ndele', 'bambari', 'alindao', 'bria', 'paoua',
  ];
  
  const textLower = text.toLowerCase();
  [...countries, ...cities].forEach(loc => {
    if (textLower.includes(loc)) destinations.add(loc);
  });
  
  return destinations.size;
}

export function assessComplexity(
  emailData?: EmailData,
  extractedData?: ExtractedData
): ComplexityAssessment {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const suggestedActions: string[] = [];
  
  let score = 0;
  
  const subject = emailData?.subject || '';
  const body = emailData?.body || '';
  const fromAddress = emailData?.from_address || '';
  const fullText = `${subject} ${body}`;
  const cargoDesc = extractedData?.cargo_description || '';
  
  // Check for tender indicators
  const tenderMatches = containsAny(fullText, TENDER_KEYWORDS);
  if (tenderMatches.length >= 2) {
    score += 40;
    reasons.push(`Mots-clés tender: ${tenderMatches.slice(0, 3).join(', ')}`);
  } else if (tenderMatches.length === 1) {
    score += 15;
    reasons.push(`Indicateur tender: ${tenderMatches[0]}`);
  }
  
  // Check for project cargo indicators
  const projectMatches = containsAny(`${fullText} ${cargoDesc}`, PROJECT_KEYWORDS);
  if (projectMatches.length > 0) {
    score += 25;
    reasons.push(`Cargo projet: ${projectMatches.slice(0, 2).join(', ')}`);
    warnings.push('Vérifier les dimensions et contraintes de transport');
  }
  
  // Check for special cargo
  const specialMatches = containsAny(`${fullText} ${cargoDesc}`, SPECIAL_CARGO_KEYWORDS);
  if (specialMatches.length > 0) {
    score += 15;
    reasons.push(`Cargo spécial: ${specialMatches.slice(0, 2).join(', ')}`);
  }
  
  // Check for multiple destinations
  const destCount = countDestinations(fullText);
  if (destCount >= 3) {
    score += 20;
    reasons.push(`Multi-destinations: ${destCount} lieux détectés`);
  } else if (destCount === 2) {
    score += 10;
    reasons.push('2 destinations identifiées');
  }
  
  // Check institutional client
  const isInstitutional = INSTITUTIONAL_DOMAINS.some(d => 
    fromAddress.toLowerCase().includes(d.toLowerCase()) ||
    fullText.toLowerCase().includes(d.toLowerCase())
  );
  if (isInstitutional) {
    score += 15;
    reasons.push('Client institutionnel détecté');
    suggestedActions.push('Vérifier format de réponse requis');
  }
  
  // Check for high value cargo
  if (extractedData?.value && extractedData.value > 100000000) { // > 100M FCFA
    score += 10;
    reasons.push(`Valeur élevée: ${(extractedData.value / 1000000).toFixed(0)}M`);
    warnings.push('Vérifier couverture assurance');
  }
  
  // Check for heavy cargo
  if (extractedData?.weight_kg && extractedData.weight_kg > 20000) { // > 20 tonnes
    score += 10;
    reasons.push(`Poids important: ${(extractedData.weight_kg / 1000).toFixed(1)}T`);
  }
  
  // Check for PDF attachments (likely formal documents)
  const hasFormalDoc = emailData?.attachments?.some(a => 
    a.filename?.toLowerCase().includes('.pdf') ||
    a.filename?.toLowerCase().includes('rfp') ||
    a.filename?.toLowerCase().includes('tender')
  );
  if (hasFormalDoc) {
    score += 5;
    reasons.push('Document formel joint');
  }
  
  // Determine level based on score
  let level: ComplexityLevel;
  let workflow: WorkflowType;
  let label: string;
  let color: 'green' | 'yellow' | 'orange' | 'red';
  
  if (score >= 50) {
    level = 4;
    workflow = 'tender';
    label = 'Tender';
    color = 'red';
    suggestedActions.push('Utiliser le module Tender pour une gestion multi-segments');
  } else if (score >= 30) {
    level = 3;
    workflow = 'project';
    label = 'Project Cargo';
    color = 'orange';
    suggestedActions.push('Validation multi-étapes recommandée');
  } else if (score >= 15) {
    level = 2;
    workflow = 'standard';
    label = 'Standard';
    color = 'yellow';
    suggestedActions.push('Vérifier les tarifs historiques');
  } else {
    level = 1;
    workflow = 'simple';
    label = 'Simple';
    color = 'green';
  }
  
  // Default reasons if none detected
  if (reasons.length === 0) {
    reasons.push('Demande standard détectée');
  }
  
  return {
    level,
    workflow,
    label,
    color,
    reasons,
    warnings,
    suggestedActions,
  };
}

export function useComplexityAssessment(
  emailData?: EmailData,
  extractedData?: ExtractedData
): ComplexityAssessment {
  return useMemo(() => {
    return assessComplexity(emailData, extractedData);
  }, [emailData, extractedData]);
}
