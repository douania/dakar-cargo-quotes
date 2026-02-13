/**
 * Constantes métier pour le domaine Quotation
 * Refactor Phase 1 - Étape 1.3/1.4
 */

export const containerTypes = [
  { value: '20DV', label: "20' Dry" },
  { value: '40DV', label: "40' Dry" },
  { value: '40HC', label: "40' HC" },
  { value: '40HC-OT', label: "40' HC Open Top" },
  { value: '40FR', label: "40' Flat Rack" },
  { value: '20RF', label: "20' Reefer" },
  { value: '40RF', label: "40' Reefer" },
];

export const incoterms = [
  'EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'
];

export const serviceTemplates = [
  { service: 'DTHC', description: 'Destination Terminal Handling', unit: 'EVP' },
  { service: 'ON_CARRIAGE', description: 'Transport vers site', unit: 'voyage' },
  { service: 'EMPTY_RETURN', description: 'Retour conteneur vide', unit: 'EVP' },
  { service: 'DISCHARGE', description: 'Déchargement navire (breakbulk)', unit: 'tonne' },
  { service: 'PORT_CHARGES', description: 'Frais de port Dakar', unit: 'tonne' },
  { service: 'TRUCKING', description: 'Transport routier vers site', unit: 'voyage' },
  { service: 'CUSTOMS', description: 'Dédouanement', unit: 'déclaration' },
  { service: 'PORT_DAKAR_HANDLING', description: 'Frais port Dakar', unit: 'tonne' },
  { service: 'CUSTOMS_DAKAR', description: 'Dédouanement Dakar', unit: 'déclaration' },
  { service: 'CUSTOMS_EXPORT', description: 'Dédouanement export', unit: 'déclaration' },
  { service: 'BORDER_FEES', description: 'Frais frontière', unit: 'forfait' },
  { service: 'AGENCY', description: 'Frais agence', unit: 'forfait' },
  { service: 'SURVEY', description: 'Survey port + site', unit: 'forfait' },
  { service: 'CUSTOMS_BAMAKO', description: 'Dédouanement Bamako', unit: 'déclaration' },
  { service: 'AIR_HANDLING', description: 'Manutention aéroportuaire', unit: 'kg' },
  { service: 'AIR_FREIGHT', description: 'Fret aérien', unit: 'kg' },
];

/**
 * Mapping package métier → services à injecter automatiquement
 * Utilisé par l'overlay M3.6 pour pré-remplir les lignes de service
 */
export const SERVICE_PACKAGES: Record<string, string[]> = {
  DAP_PROJECT_IMPORT: ['PORT_DAKAR_HANDLING', 'DTHC', 'TRUCKING', 'EMPTY_RETURN', 'CUSTOMS_DAKAR'],
  TRANSIT_GAMBIA_ALL_IN: ['PORT_DAKAR_HANDLING', 'DTHC', 'TRUCKING', 'BORDER_FEES', 'AGENCY'],
  EXPORT_SENEGAL: ['PORT_CHARGES', 'CUSTOMS_EXPORT', 'AGENCY'],
  BREAKBULK_PROJECT: ['DISCHARGE', 'PORT_DAKAR_HANDLING', 'TRUCKING', 'SURVEY', 'CUSTOMS_DAKAR'],
  AIR_IMPORT_DAP: ['AIR_HANDLING', 'CUSTOMS_DAKAR', 'TRUCKING', 'AGENCY'],
  LCL_IMPORT_DAP: ['PORT_DAKAR_HANDLING', 'CUSTOMS_DAKAR', 'TRUCKING', 'AGENCY'],
};

/**
 * Domaines internes de l'entreprise
 * Utilisés pour détecter les emails internes vs externes
 */
export const INTERNAL_DOMAINS = ['sodatra.sn', '2hlgroup.com', '2hl.sn'];

/**
 * Mots-clés indiquant une offre de cotation
 * Utilisés pour la détection automatique des réponses de partenaires
 */
export const OFFER_KEYWORDS = [
  'please find our rates',
  'please find attached our rates',
  'attached our rates',
  'voici notre offre',
  'ci-joint notre cotation',
  'veuillez trouver notre offre',
  'please find attached our offer',
  'please find our offer',
  'attached our offer',
  'please find the rates',
  'please find rates',
  'attached our quotation',
  'please find our quotation',
  'please see attached',
  'kindly find attached',
  'please find enclosed',
];

/**
 * Labels des workflows pour l'affichage
 */
export const WORKFLOW_LABELS: Record<string, { label: string; color: string }> = {
  WF_SIMPLE_QUOTE: { label: 'Devis Simple', color: 'bg-green-100 text-green-800' },
  WF_STANDARD_QUOTE: { label: 'Devis Standard', color: 'bg-blue-100 text-blue-800' },
  WF_PROJECT_CARGO: { label: 'Project Cargo', color: 'bg-orange-100 text-orange-800' },
  WF_TENDER: { label: "Appel d'Offres", color: 'bg-purple-100 text-purple-800' },
};

/**
 * Statuts des tâches du workflow avec leurs styles
 */
export const TASK_STATUS_COLORS: Record<string, string> = {
  intake: 'bg-gray-100 text-gray-800',
  needs_info: 'bg-orange-100 text-orange-800',
  ready: 'bg-blue-100 text-blue-800',
  running: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};
