/**
 * Types centralisés pour le domaine Quotation
 * Refactor Phase 1 - Étape 1.1/1.2
 */

export interface CargoLine {
  id: string;
  description: string;
  origin: string;
  cargo_type: 'container' | 'breakbulk';
  container_type?: string;
  container_count?: number;
  coc_soc?: 'COC' | 'SOC';
  weight_kg?: number;
  volume_cbm?: number;
  dimensions?: string;
  pieces?: number;
}

export interface ServiceLine {
  id: string;
  service: string;
  description: string;
  unit: string;
  quantity: number;
  rate?: number;
  currency: string;
  source?: 'manual' | 'historical';
}

export interface HistoricalSuggestionLine {
  bloc: string;
  category: string;
  description: string;
  suggested_amount: number;
  currency: string;
  confidence: number;
  based_on: number;
}

export interface HistoricalSuggestions {
  suggested_lines: HistoricalSuggestionLine[];
  based_on_quotations: number;
}

export interface ProjectContext {
  requesting_party: string;
  requesting_company: string;
  end_client?: string;
  end_client_company?: string;
  our_role: 'direct' | 'partner_support';
  partner_email?: string;
  partner_company?: string;
  project_name?: string;
  project_location?: string;
}

export interface ExtractedData {
  client?: string;
  company?: string;
  cargo?: string;
  origin?: string;
  destination?: string;
  incoterm?: string;
  container_type?: string;
  container_count?: string;
  weight?: string;
  volume?: string;
  urgency?: string;
  hs_code?: string;
  special_requirements?: string;
}

export interface ThreadEmail {
  id: string;
  subject: string | null;
  from_address: string;
  to_addresses?: string[];
  cc_addresses?: string[];
  body_text: string | null;
  received_at: string;
  sent_at: string | null;
  extracted_data: ExtractedData | null;
  thread_ref?: string | null;
}

export interface ContainerDetail {
  type: string;
  quantity: number;
  coc_soc?: 'COC' | 'SOC' | 'unknown';
  notes?: string;
}

export interface ConsolidatedData {
  incoterm?: string;
  destination?: string;
  finalDestination?: string;
  cargoTypes: string[];
  containerTypes: string[];
  containers: ContainerDetail[];
  origins: string[];
  specialRequirements: string[];
  projectName?: string;
  projectLocation?: string;
  originalRequestor?: { email: string; name: string; company: string };
}

export interface Suggestion {
  field: string;
  value: string;
  source: string;
  confidence: number;
}

export interface Alert {
  type: 'warning' | 'info' | 'error' | 'success';
  message: string;
  field?: string;
}

export interface QuotationOffer {
  type: 'container' | 'breakbulk' | 'combined';
  email: ThreadEmail;
  sentAt: string;
  senderName: string;
  senderEmail: string;
  attachments: Array<{ id: string; filename: string; content_type: string }>;
  detectedContent: string[];
}

export interface RegulatoryInfo {
  projectTaxation?: { sea?: string; air?: string };
  dpiRequired?: boolean;
  dpiThreshold?: string;
  dpiDeadline?: string;
  apeAvailable?: boolean;
  customsNotes: string[];
  otherNotes: string[];
}
