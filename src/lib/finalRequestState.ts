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
export type FinalRequestCompleteness = "complete" | "partial";
// Valeur fermée, jamais déduite. Le serveur exige ce choix humain pour toute
// source non-email et le refuse pour un email, dont la complétude reste
// décidée en amont par captureMode=full_sanitized.
export const FINAL_REQUEST_COMPLETENESS_OPTIONS: ReadonlyArray<
  { value: FinalRequestCompleteness; label: string }
> = [
  {
    value: "complete",
    label:
      "Complet — j’ai consulté le document original et le texte capturé reprend intégralement les instructions utiles",
  },
  {
    value: "partial",
    label:
      "Partiel — extraction incomplète ou non vérifiée ; la source reste bloquante",
  },
];
// Fail-closed : tout ce qui n’est pas exactement un email exige l’attestation.
export function requiresCompletenessAttestation(
  source: FinalRequestSource,
): boolean {
  return source.kind !== "email";
}
// Un document autonome (case_documents) n’a aucune date en amont : l’inventaire
// serveur la donne à null et la capture pose SOURCE_DATE_UNKNOWN. Sans date
// attestée, une source « complete » resterait donc bloquée pour toujours. La
// question n’est posée que là où la date manque réellement, et seulement pour
// « complete » : « partial » laisse la source volontairement bloquante.
export function requiresAttestedSentAt(
  source: FinalRequestSource,
  completeness: FinalRequestCompleteness | null,
): boolean {
  return requiresCompletenessAttestation(source) && completeness === "complete" &&
    (source.sentAt === null || source.sentAt === undefined ||
      source.sentAt === "");
}
// `datetime-local` ne produit une valeur que si la date ET l’heure sont saisies.
// Rien n’est déduit : ni midi, ni minuit, ni la date du jour. Le fuseau du poste
// opérateur est explicité en UTC avant l’envoi, jamais laissé implicite.
const LOCAL_DATE_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
export function attestedSentAtIso(localValue: string): string | null {
  const match = LOCAL_DATE_TIME_RE.exec(localValue);
  if (!match) return null;
  const parsed = new Date(localValue);
  if (!Number.isFinite(parsed.getTime())) return null;
  const [, year, month, day, hour, minute, second = "00"] = match;
  // `Date` normalise silencieusement certaines dates impossibles (par exemple
  // le 30 février). Refuser tout instant dont les composantes locales relues ne
  // correspondent pas exactement à la saisie de l'opérateur.
  if (
    parsed.getFullYear() !== Number(year) ||
    parsed.getMonth() + 1 !== Number(month) ||
    parsed.getDate() !== Number(day) ||
    parsed.getHours() !== Number(hour) ||
    parsed.getMinutes() !== Number(minute) ||
    parsed.getSeconds() !== Number(second)
  ) return null;
  return parsed.toISOString();
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
