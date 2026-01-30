/**
 * Service centralisé pour les appels API Railway
 * Gère: Intake (analyse complexité), Workflow (CaseView), Truck loading
 * Refactor Phase 1 - Étape 1.5
 */

const API_BASE = import.meta.env.VITE_TRUCK_LOADING_API_URL || 'https://web-production-8afea.up.railway.app';

// ============= Types =============

export interface IntakeSource {
  type: 'email_text' | 'email_id' | 'file';
  text?: string;
  email_id?: string;
  file_path?: string;
}

export interface IntakeRequest {
  source: IntakeSource;
  client_name?: string;
  client_email?: string;
  customer_ref?: string;
}

export interface IntakeResponse {
  success: boolean;
  case_id: string;
  status: string;
  workflow_key: string;
  complexity_level: number;
  confidence: number;
  missing_fields: Array<{
    field: string;
    question: string;
    priority: string;
  }>;
  assumptions: string[];
  normalized_request: any;
  error?: string;
}

export interface CaseFileResponse {
  success: boolean;
  case: {
    id: string;
    status: string;
    workflow_key: string;
    complexity_level: number;
    confidence: number | null;
    missing_fields: any[];
    assumptions: any[];
    normalized_request: any;
    client_name: string | null;
    client_email: string | null;
    customer_ref: string | null;
    created_at: string | null;
    updated_at: string | null;
  };
  inputs: any[];
  tasks: any[];
  outputs: any[];
  events: any[];
  error?: string;
}

export interface WorkflowRunResponse {
  success: boolean;
  error?: string;
}

// ============= API Functions =============

/**
 * Créer un nouveau dossier via l'analyse d'intake
 */
export async function createIntake(request: IntakeRequest): Promise<IntakeResponse> {
  const response = await fetch(`${API_BASE}/api/casefiles/intake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || "Erreur lors de l'analyse");
  }

  return data;
}

/**
 * Récupérer les détails d'un dossier
 */
export async function fetchCaseFile(caseId: string): Promise<CaseFileResponse> {
  const response = await fetch(`${API_BASE}/api/casefiles/${caseId}`);
  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Dossier non trouvé');
  }

  return data;
}

/**
 * Lancer l'exécution du workflow pour un dossier
 */
export async function runWorkflow(caseId: string): Promise<WorkflowRunResponse> {
  const response = await fetch(`${API_BASE}/api/casefiles/${caseId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || "Erreur lors de l'exécution");
  }

  return data;
}

/**
 * URL de base pour les appels API (export pour usage legacy si nécessaire)
 */
export { API_BASE };
