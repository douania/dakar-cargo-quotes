export interface FinalRequestHead {
  generation: number;
  revision_id: string | null;
  capture_id: string | null;
}
export interface FinalRequestSource {
  kind?: string;
  id?: string;
  fileName?: string;
  author?: string;
  sentAt?: string | null;
  text?: string | null;
  captureMode?: string | null;
}
export interface FinalRequestBaseInputSource {
  id: string;
  kind: string;
  authorRole: string;
  roleVerified: boolean;
  contentClass: string;
  sentAt: string | null;
  text: string;
}
export interface FinalRequestCandidate {
  assertionId: string;
  sourceId: string;
  actions: Array<
    "confirm_instruction" | "keep_protected_fact" | "request_clarification"
  >;
  needsFactReconciliation: boolean;
}
export interface FinalRequestReviewTarget {
  targetId: string;
  kind: "field" | "lifecycle" | "quote";
  field?: string;
  quotationVersionId?: string;
  protectedFact?:
    | { value: unknown; reference: string; validatedBy: string }
    | null;
  candidates: FinalRequestCandidate[];
}
export interface FinalRequestStateView {
  head: FinalRequestHead | null;
  revision: Record<string, unknown> | null;
  captureRecord: {
    capture?: {
      captureId?: string;
      limitations?: string[];
      baseInput?: {
        sources?: FinalRequestBaseInputSource[];
        lotIds?: string[];
        quotationVersionIds?: string[];
      };
    };
    inventory?: { sources?: FinalRequestSource[] };
    sourceAttestationRefs?: Array<{ originKind?: string; originId?: string }>;
  } | null;
  reviews: Array<Record<string, unknown>>;
  history: Array<Record<string, unknown>>;
  historyTruncated: boolean;
  selectedRevisionMatchesHeadCapture: boolean;
  reviewTargets: FinalRequestReviewTarget[];
  calculationStatus: Record<string, unknown>;
  pricingAuthorized: false;
}

export function unwrapFinalRequestResponse(
  value: unknown,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Réponse serveur invalide");
  }
  const envelope = value as Record<string, unknown>;
  if (
    envelope.ok !== true || !envelope.data ||
    typeof envelope.data !== "object" || Array.isArray(envelope.data)
  ) {
    throw new Error("Réponse serveur invalide");
  }
  const data = envelope.data as Record<string, unknown>;
  if (data.pricingAuthorized !== false) {
    throw new Error("Réponse non fail-closed refusée");
  }
  return data;
}

export async function finalRequestErrorMessage(
  error: unknown,
): Promise<string> {
  const context = (error as { context?: unknown })?.context;
  if (context && typeof (context as Response).json === "function") {
    try {
      const body = await (context as Response).json() as {
        error?: { message?: string };
      };
      if (body.error?.message) return body.error.message;
    } catch { /* use generic message */ }
  }
  return error instanceof Error ? error.message : "Opération impossible";
}

export function newFinalRequestKey(prefix: string): string {
  return `frs-ui-${prefix}-${crypto.randomUUID()}`;
}

export function targetLabel(target: FinalRequestReviewTarget): string {
  if (target.kind === "field") {
    return `Instruction : ${target.field ?? "champ"}`;
  }
  if (target.kind === "quote") {
    return `Réponse au devis ${target.quotationVersionId ?? ""}`.trim();
  }
  return "État de la demande";
}
