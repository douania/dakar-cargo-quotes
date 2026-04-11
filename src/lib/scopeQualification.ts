/**
 * P2-D Lot 1 — Modèle dérivé de scope courant.
 * Helper pur, zéro dépendance React.
 *
 * Catégories strictes :
 *   confirmed     — scope === true ET facts structurants présents
 *   unconfirmed   — scope === true mais facts manquants, OU scope === null
 *   out_of_scope  — scope === false
 */

export type ScopeQualification = "confirmed" | "unconfirmed" | "out_of_scope";

export interface QualifiedScopeItem {
  service: string;
  qualification: ScopeQualification;
  reason: string;
}

export interface QualifiedScope {
  items: QualifiedScopeItem[];
  /** At least one service that would normally be expected is unconfirmed */
  hasCriticalUnconfirmed: boolean;
}

interface QualifyScopeInput {
  serviceScope: {
    freightScope: boolean | null;
    customsScope: boolean | null;
    transitScope: boolean | null;
    documentScope: boolean | null;
  } | null;
  facts: Record<string, string | null>;
  caseStatus: string;
}

// ---------------------------------------------------------------------------
// Fact presence helpers
// ---------------------------------------------------------------------------

function hasAny(facts: Record<string, string | null>, keys: string[]): boolean {
  return keys.some((k) => !!facts[k]);
}

const FREIGHT_FACTS = [
  "routing.transport_mode",
  "routing.origin_port",
  "routing.destination_port",
];
const CUSTOMS_FACTS = ["cargo.hs_code", "cargo.value"];
const TRANSIT_FACTS = [
  "routing.destination_city",
  "routing.final_destination",
];

// ---------------------------------------------------------------------------
// Services that the system can reason about
// ---------------------------------------------------------------------------
interface ServiceDef {
  service: string;
  scopeKey: keyof NonNullable<QualifyScopeInput["serviceScope"]>;
  requiredFacts: string[];
  /** If true, this service is normally expected on most dossiers */
  critical: boolean;
}

const SERVICE_DEFS: ServiceDef[] = [
  { service: "freight", scopeKey: "freightScope", requiredFacts: FREIGHT_FACTS, critical: true },
  { service: "customs", scopeKey: "customsScope", requiredFacts: CUSTOMS_FACTS, critical: false },
  { service: "transit", scopeKey: "transitScope", requiredFacts: TRANSIT_FACTS, critical: false },
  { service: "document", scopeKey: "documentScope", requiredFacts: [], critical: false },
];

// ---------------------------------------------------------------------------
// Main qualifier
// ---------------------------------------------------------------------------

export function qualifyScope(input: QualifyScopeInput): QualifiedScope {
  const { serviceScope, facts } = input;
  const items: QualifiedScopeItem[] = [];

  for (const def of SERVICE_DEFS) {
    const scopeValue = serviceScope?.[def.scopeKey] ?? null;

    if (scopeValue === false) {
      items.push({
        service: def.service,
        qualification: "out_of_scope",
        reason: `${def.service} explicitement hors périmètre`,
      });
      continue;
    }

    if (scopeValue === true) {
      const hasFacts = def.requiredFacts.length === 0 || hasAny(facts, def.requiredFacts);
      items.push({
        service: def.service,
        qualification: hasFacts ? "confirmed" : "unconfirmed",
        reason: hasFacts
          ? `${def.service} confirmé (scope + facts)`
          : `${def.service} dans le scope mais facts insuffisants`,
      });
      continue;
    }

    // scopeValue === null → no signal
    items.push({
      service: def.service,
      qualification: "unconfirmed",
      reason: `${def.service} : signal scope absent`,
    });
  }

  const hasCriticalUnconfirmed = items.some(
    (i) => i.qualification === "unconfirmed" && SERVICE_DEFS.find((d) => d.service === i.service)?.critical,
  );

  return { items, hasCriticalUnconfirmed };
}

/**
 * Check if a specific service is out of scope.
 * Convenience helper for components that only need a boolean check.
 */
export function isServiceOutOfScope(scope: QualifiedScope, service: string): boolean {
  return scope.items.some((i) => i.service === service && i.qualification === "out_of_scope");
}

/**
 * Check if a specific service is confirmed.
 */
export function isServiceConfirmed(scope: QualifiedScope, service: string): boolean {
  return scope.items.some((i) => i.service === service && i.qualification === "confirmed");
}
