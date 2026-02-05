import { supabase } from '@/integrations/supabase/client';
import type { EmailConfig, Email, EmailDraft } from '@/types';

export async function fetchEmailConfigs() {
  const { data, error } = await supabase
    .from('email_configs')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return data as EmailConfig[];
}

export async function fetchEmails(page = 0, pageSize = 20) {
  const from = page * pageSize;
  const to = from + pageSize - 1;
  
  const { data, error, count } = await supabase
    .from('emails')
    .select('*', { count: 'exact' })
    .order('sent_at', { ascending: false })
    .range(from, to);
  
  if (error) throw error;
  return { emails: data as Email[], totalCount: count || 0 };
}

export async function fetchEmailDrafts() {
  const { data, error } = await supabase
    .from('email_drafts')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return data as EmailDraft[];
}

export async function fetchAttachmentCounts() {
  const { data, error } = await supabase
    .from('email_attachments')
    .select('email_id');
  
  if (error) throw error;
  
  const counts: Record<string, number> = {};
  data?.forEach((att) => {
    if (att.email_id) {
      counts[att.email_id] = (counts[att.email_id] || 0) + 1;
    }
  });
  return counts;
}

export async function addEmailConfig(config: {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
}) {
  const { error } = await supabase.from('email_configs').insert({
    name: config.name,
    host: config.host,
    port: config.port,
    username: config.username,
    password_encrypted: config.password,
  });
  
  if (error) throw error;
}

export async function deleteEmailConfig(id: string) {
  const { error } = await supabase.from('email_configs').delete().eq('id', id);
  if (error) throw error;
}

export async function syncEmails(configId: string) {
  const { data, error } = await supabase.functions.invoke('sync-emails', {
    body: { configId },
  });
  
  if (error) throw error;
  return data;
}

export async function learnFromEmail(emailId: string) {
  const { data, error } = await supabase.functions.invoke('learn-from-content', {
    body: { contentType: 'email', contentId: emailId },
  });
  
  if (error) throw error;
  return data;
}

export type ExpertStyle = 'auto' | 'taleb' | 'cherif';

export async function generateEmailResponse(
  emailId: string, 
  customInstructions?: string,
  expertStyle: ExpertStyle = 'auto'
) {
  // Phase 14: Correlation header
  const correlationId = crypto.randomUUID();
  
  const { data, error } = await supabase.functions.invoke('generate-response', {
    body: { emailId, customInstructions, expertStyle },
    headers: { 'x-correlation-id': correlationId }
  });
  
  if (error) throw error;
  
  // Phase 14: Handle new response format
  if (data?.ok === false) {
    throw new Error(data.error?.message || 'Generation failed');
  }
  
  return data?.data || data;
}

export async function searchEmails(configId: string, searchType: string, query: string, limit = 50) {
  const { data, error } = await supabase.functions.invoke('search-emails', {
    body: { configId, searchType, query: query.trim(), limit },
  });
  
  if (error) throw error;
  if (data.error) throw new Error(data.error);
  return data;
}

export async function importThread(configId: string, uids: number[]) {
  const { data, error } = await supabase.functions.invoke('import-thread', {
    body: { configId, uids, learningCase: 'quotation' },
  });
  
  if (error) throw error;
  if (data.error) throw new Error(data.error);
  return data;
}

// Puzzle Analysis types
export interface PuzzlePiece {
  key: string;
  label: string;
  value: string | null;
  source: 'email' | 'attachment' | 'learned' | 'manual';
  confidence?: number;
}

export interface MissingClientInfo {
  key: string;
  label: string;
  question: string;
  priority: 'high' | 'medium' | 'low';
}

export interface ResearchItem {
  key: string;
  label: string;
  searchType: 'tariff' | 'hs_code' | 'customs_duty' | 'carrier' | 'contact' | 'historical';
  suggestedActions: string[];
  status: 'pending' | 'searching' | 'found' | 'not_found';
  result?: string;
}

export interface Suggestion {
  type: 'carrier' | 'historical_quote' | 'contact' | 'tip';
  title: string;
  items: { label: string; detail?: string; action?: string }[];
}

export interface PuzzleAnalysis {
  provided: PuzzlePiece[];
  needsFromClient: MissingClientInfo[];
  needsResearch: ResearchItem[];
  suggestions: Suggestion[];
  completeness: number;
  canGenerateQuote: boolean;
  transportMode: 'maritime' | 'air' | 'road' | 'multimodal' | 'unknown';
}

export interface RegulatoryAnalysis {
  requested_regime?: string;
  recommended_regime?: string;
  regime_code?: string;
  regime_appropriate?: boolean;
  correction_needed?: boolean;
  correction_explanation?: string;
}

export interface AttachmentsAnalysis {
  analyzed: boolean;
  extracted_info?: string;
  missing_info?: string[];
}

export interface Feasibility {
  is_feasible: boolean;
  concerns?: string[];
  recommendations?: string[];
}

export interface V5Analysis {
  coherence_audit?: {
    container_type?: string;
    declared_weight_kg?: number;
    declared_volume_cbm?: number;
    max_payload_kg?: number;
    max_volume_cbm?: number;
    alerts: Array<{
      type: string;
      severity: 'critical' | 'warning' | 'info';
      message_fr: string;
      message_en: string;
      ctu_reference?: string;
    }>;
    is_compliant: boolean;
    recommendations_fr?: string[];
    recommendations_en?: string[];
  };
  incoterm_analysis?: {
    detected_incoterm?: string;
    incoterm_details?: {
      code: string;
      name_fr: string;
      name_en: string;
      group_name: string;
      transfer_risk_point: string;
      seller_pays_transport: boolean;
      seller_pays_insurance: boolean;
    };
    quotation_guidance?: {
      include_freight: boolean;
      include_insurance: boolean;
      include_origin_charges: boolean;
      include_destination_charges: boolean;
      include_customs_export: boolean;
      include_customs_import: boolean;
    };
    responsibility_map?: {
      seller_responsibilities: string[];
      buyer_responsibilities: string[];
    };
    caf_calculation?: {
      method: string;
      includes_fob: boolean;
      includes_freight: boolean;
      includes_insurance: boolean;
    };
  };
  risk_analysis?: {
    time_risk?: {
      type: string;
      level: 'low' | 'medium' | 'high';
      message_fr: string;
      message_en: string;
    };
    nature_risk?: {
      type: string;
      level: 'low' | 'medium' | 'high';
      message_fr: string;
      message_en: string;
    };
  };
  vigilance_points?: Array<{
    category: string;
    message_fr: string;
    message_en: string;
    priority: 'high' | 'medium' | 'low';
  }>;
}

export interface ExtractedData {
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
  // NEW: Transport mode from backend
  transport_mode?: 'air' | 'maritime' | 'road' | 'multimodal' | 'unknown';
  transport_mode_evidence?: string[];
}

export interface DetectedElements {
  hasPI: boolean;
  hasIncoterm: boolean;
  hasDestination: boolean;
  hasOrigin: boolean;
  hasContainerType: boolean;
  hasGoodsDescription: boolean;
  hasHsCode: boolean;
  hasValue: boolean;
}

export interface GeneratedAttachment {
  filename: string;
  storage_path: string;
  public_url: string;
  csv_url?: string;
  content_type: string;
}

export interface QuotationProcessResult {
  importedEmailId: string;
  originalEmail: {
    subject: string;
    from: string;
    body: string;
    date: string;
  };
  draft: {
    id: string;
    subject: string;
    body: string;
    to: string[];
  };
  analysis: {
    confidence: number;
    missingInfo: string[];
    quotationDetails: Record<string, unknown>;
    regulatoryAnalysis?: RegulatoryAnalysis;
    attachmentsAnalysis?: AttachmentsAnalysis;
    feasibility?: Feasibility;
    v5Analysis?: V5Analysis;
    generatedAttachment?: GeneratedAttachment;
  };
  // New puzzle-related fields
  extractedData?: ExtractedData;
  detectedElements?: DetectedElements;
  canQuoteNow?: boolean;
  requestType?: string;
  clarificationQuestions?: string[];
  // NEW: Transport mode from backend intelligent detection
  transportMode?: 'air' | 'maritime' | 'road' | 'multimodal' | 'unknown';
  transportModeEvidence?: string[];
}

export async function processQuotationRequest(
  configId: string, 
  uids: number[]
): Promise<QuotationProcessResult> {
  // Step 1: Import the email(s)
  const importResult = await importThread(configId, uids);
  
  // FIX: import-thread returns "emails" array, not "emailIds"
  const importedEmails = importResult.emails || [];
  if (importedEmails.length === 0) {
    throw new Error('Aucun email importé');
  }
  
  const emailId = importedEmails[0].id;
  
  // Step 2: Get the imported email details
  const { data: email, error: emailError } = await supabase
    .from('emails')
    .select('*')
    .eq('id', emailId)
    .single();
  
  if (emailError) throw emailError;
  
  // Step 3: Generate the expert response
  const { data: responseData, error: responseError } = await supabase.functions.invoke('generate-response', {
    body: { emailId },
  });
  
  if (responseError) throw responseError;
  if (responseData.error) throw new Error(responseData.error);
  
  // Map the response data to the expected format
  const draft = responseData.draft || {};
  
  return {
    importedEmailId: emailId,
    originalEmail: {
      subject: email.subject || 'Sans sujet',
      from: email.from_address,
      body: email.body_text || email.body_html || '',
      date: email.sent_at || email.received_at || email.created_at,
    },
    draft: {
      id: draft.id || '',
      subject: draft.subject || `Re: ${email.subject}`,
      body: draft.body_text || draft.body || '',
      to: draft.to_addresses || [email.from_address],
    },
    analysis: {
      confidence: responseData.confidence || 0.5,
      missingInfo: responseData.missing_info || [],
      quotationDetails: responseData.quotation || {},
      regulatoryAnalysis: responseData.regulatory_analysis,
      attachmentsAnalysis: responseData.attachments_analysis,
      feasibility: responseData.feasibility,
      v5Analysis: responseData.v5_analysis,
      generatedAttachment: responseData.generated_attachment,
    },
    // Puzzle-related fields from backend
    extractedData: responseData.extracted_data,
    detectedElements: responseData.detected_elements,
    canQuoteNow: responseData.can_quote_now,
    requestType: responseData.request_type,
    clarificationQuestions: responseData.clarification_questions,
    // NEW: Transport mode from backend intelligent detection
    transportMode: responseData.transport_mode,
    transportModeEvidence: responseData.transport_mode_evidence,
  };
}
