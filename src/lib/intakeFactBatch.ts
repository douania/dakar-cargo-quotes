/**
 * DCQ-P0-INTAKE-ATOMIC-BATCH — constructeur PUR du lot de faits Intake.
 *
 * Reprend à l'identique la dérivation de l'ancien `injectFacts` de
 * src/pages/Intake.tsx (priorité overrides texte > analyse document, garde
 * inland Dakar/Kaolack, fail-closed conteneurs) mais produit un payload UNIQUE
 * pour l'Edge Function set-intake-facts-batch au lieu de N appels
 * set-case-fact. Aucune E/S ici : testable directement.
 *
 * Provenance (contrat serveur, jamais manual_input par ce chemin) :
 *   - texte collé/saisi sans document analysé   → source_type=email_body ;
 *   - extraction d'un document importé          → source_type=attachment_extracted ;
 *   - les faits synthétiques dérivés (service.mode, routing.transport_mode)
 *     héritent de la provenance du lot dont ils sont issus.
 * La CONFIANCE n'apparaît pas ici : elle est imposée côté SQL par source_type
 * (toujours < 1) et toute tentative de la fournir est refusée par le contrat.
 *
 * Invariant « FIDÉLITÉ ou RIEN » conservé :
 *   - PHNX : « deux conteneurs de 20 pieds » → container_count=2 +
 *     containers=[{type:"20'",quantity:2}], jamais type:null ;
 *   - INT Nordic : « 80x60x75 cm » est une dimension, aucune donnée conteneur
 *     inventée ;
 *   - aucune valeur canonique null : chaque fait porte exactement UNE colonne
 *     de valeur, définie (les clés absentes sont omises, jamais null).
 */

import {
  resolveContainerPlan,
  toCanonicalContainers,
  type IntakeTextOverrides,
} from "@/lib/intakeTextOverrides";

export const INTAKE_BATCH_KEY_VERSION = "v1";
export const MAX_SOURCE_EXCERPT = 400;

export type IntakeBatchSourceType = "email_body" | "attachment_extracted";

export interface IntakeBatchFact {
  fact_key: string;
  value_text?: string;
  value_number?: number;
  value_json?: unknown;
}

export interface IntakeFactBatchPayload {
  case_id: string;
  batch_key: string;
  source_type: IntakeBatchSourceType;
  source_excerpt: string | null;
  workflow_key: string | null;
  facts: IntakeBatchFact[];
}

export interface BuildIntakeFactBatchInput {
  caseId: string;
  /** Texte de la demande (zone de saisie) — sert d'extrait de provenance. */
  text: string;
  /** Analyse IA du document importé, ou null si aucun document analysé. */
  analysis: Record<string, unknown> | null;
  /** Overrides opérateur extraits du texte (parseTextOverrides). */
  textOverrides: IntakeTextOverrides;
  /** true dès qu'une extraction document existe (extractedAnalysis/extractionSource). */
  hasExtractedDocument: boolean;
  /** Workflow proposé par Railway ; le serveur le réduit à son allowlist. */
  workflowKey?: string | null;
}

/** Pays de destination connus — un pays route vers destination_country. */
const KNOWN_COUNTRIES = new Set([
  "MALI", "SENEGAL", "SÉNÉGAL", "GUINEE", "GUINÉE", "GAMBIE",
  "MAURITANIE", "BURKINA", "BURKINA FASO", "NIGER",
  "COTE D'IVOIRE", "CÔTE D'IVOIRE", "GHANA", "TOGO",
  "BENIN", "BÉNIN", "NIGERIA", "CAMEROUN",
]);

/** Clé d'idempotence déterministe : un dossier Railway = un lot Intake. */
export function buildIntakeBatchKey(caseId: string): string {
  return `intake:${caseId}:${INTAKE_BATCH_KEY_VERSION}`;
}

export function buildIntakeFactBatch(
  input: BuildIntakeFactBatchInput,
): IntakeFactBatchPayload {
  const analysis = input.analysis || {};
  const overrides = input.textOverrides || {};

  // Merge : overrides texte > analyse document (contrat historique injectFacts).
  const containerPlan = resolveContainerPlan(overrides, analysis);
  const weightKg = Number(analysis.weight_kg) || 0;
  // Garde inland : si une destination finale est requise mais non extraite
  // localement, la destination IA (ex. Dakar) ne doit JAMAIS masquer le gap.
  const destination = (overrides.destination as string | undefined)
    ?? (overrides.requires_final_destination
      ? null
      : ((analysis.destination as string | undefined) ?? null));
  const originPort = (overrides.origin_port as string | undefined)
    ?? (analysis.origin_port as string | undefined)
    ?? null;
  const pod = (overrides.pod as string | undefined) ?? null;

  const facts: IntakeBatchFact[] = [];

  // Conteneurs — une déclaration ambiguë donne totalCount=0 : rien n'est
  // publié et le puzzle garde la question ouverte (fail-closed).
  if (containerPlan.totalCount >= 1) {
    facts.push({ fact_key: "cargo.container_count", value_number: containerPlan.totalCount });
    // Type legacy uniquement pour un dossier mono-type : un dossier mixte
    // 20'/40' n'a pas de type unique honnête.
    if (containerPlan.legacyType) {
      facts.push({ fact_key: "cargo.container_type", value_text: containerPlan.legacyType });
    }
    // Canonique : publié SEULEMENT si chaque groupe porte un type déclaré.
    // Un groupe sans type est OMIS du canonique (jamais type:null).
    if (containerPlan.groups.every((g) => g.type)) {
      facts.push({
        fact_key: "cargo.containers",
        value_json: toCanonicalContainers(containerPlan),
      });
    }
  }

  if (weightKg > 0) {
    facts.push({ fact_key: "cargo.weight_kg", value_number: weightKg });
  }

  // Faits synthétiques dérivés du plan conteneurs — même provenance que le lot.
  if (containerPlan.isFcl) {
    facts.push({ fact_key: "service.mode", value_text: "SEA_FCL_IMPORT" });
    facts.push({ fact_key: "routing.transport_mode", value_text: "MARITIME" });
  }

  if (originPort) {
    facts.push({ fact_key: "routing.origin_port", value_text: String(originPort) });
  }

  if (pod) {
    facts.push({ fact_key: "routing.destination_port", value_text: String(pod) });
  }

  if (destination) {
    const upper = destination.toUpperCase().trim();
    if (KNOWN_COUNTRIES.has(upper)) {
      facts.push({ fact_key: "routing.destination_country", value_text: destination });
    } else {
      facts.push({ fact_key: "routing.destination_city", value_text: destination });
    }
  }

  // cargo.description — uniquement si extraite de façon fiable (aucune invention).
  const cargoDesc = typeof analysis.cargo_description === "string"
    ? analysis.cargo_description.trim()
    : "";
  if (cargoDesc.length > 0) {
    facts.push({ fact_key: "cargo.description", value_text: cargoDesc.slice(0, 2000) });
  }

  const excerpt = input.text.trim().slice(0, MAX_SOURCE_EXCERPT);

  return {
    case_id: input.caseId,
    batch_key: buildIntakeBatchKey(input.caseId),
    source_type: input.hasExtractedDocument ? "attachment_extracted" : "email_body",
    // Ne jamais fabriquer un extrait lorsque la demande n'en contient pas.
    source_excerpt: excerpt.length > 0 ? excerpt : null,
    workflow_key: input.workflowKey ?? null,
    facts,
  };
}
