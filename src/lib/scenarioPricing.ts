/** Présentation pure P1-A4 du pricing isolé par scénario. */

export type ScenarioPricingStatus = "success" | "blocked" | "failed" | "superseded";
export type ScenarioPricingQualification = "provisional" | "partial" | "blocked";

export interface ScenarioPricingRunSummary {
  id: string;
  scenario_id: string;
  run_seq: number;
  status: ScenarioPricingStatus;
  qualification: ScenarioPricingQualification;
  blockers: unknown;
  reservations: unknown;
  assumptions_snapshot: unknown;
  firm_total_ht: number | null;
  firm_total_ttc: number | null;
  indicative_total_ht: number | null;
  indicative_total_ttc: number | null;
  currency: string;
  completed_at: string;
}

export interface ScenarioPricingEdgeData {
  pricing_run_id: string;
  scenario_id: string;
  run_seq: number;
  status: "success" | "blocked" | "failed";
  qualification: ScenarioPricingQualification;
  blockers: string[];
  idempotent_replay: boolean;
}

export interface ScenarioQuotationOutputSummary {
  id: string;
  scenario_pricing_run_id: string;
  snapshot: unknown;
  created_at: string;
}

export interface ScenarioQuotationOutputEdgeData {
  version_id: string;
  version_number: number;
  scenario_reference: string;
  qualification: "provisional" | "partial";
  idempotent_replay: boolean;
}

export const SCENARIO_PRICING_STATUS_LABELS: Record<ScenarioPricingStatus, string> = {
  success: "Calcul terminé",
  blocked: "Calcul bloqué",
  failed: "Moteur indisponible",
  superseded: "Ancienne estimation",
};

export const SCENARIO_PRICING_QUALIFICATION_LABELS: Record<
  ScenarioPricingQualification,
  string
> = {
  provisional: "Provisoire",
  partial: "Partielle",
  blocked: "Non chiffrée",
};

export function scenarioPricingMutationSignature(
  caseId: string,
  scenarioId: string,
  scopeHash: string,
): string {
  return `${caseId}:${scenarioId}:${scopeHash}`;
}

export function scenarioOutputMutationSignature(
  caseId: string,
  scenarioId: string,
  pricingRunId: string,
): string {
  return `${caseId}:${scenarioId}:${pricingRunId}:output`;
}

export function scenarioOutputsByPricingRun(
  outputs: ScenarioQuotationOutputSummary[],
): Map<string, ScenarioQuotationOutputSummary> {
  return new Map((outputs ?? []).map((output) => [output.scenario_pricing_run_id, output]));
}

export function latestScenarioPricingRuns(
  runs: ScenarioPricingRunSummary[],
): Map<string, ScenarioPricingRunSummary> {
  const latest = new Map<string, ScenarioPricingRunSummary>();
  for (const run of runs ?? []) {
    const previous = latest.get(run.scenario_id);
    if (!previous || run.run_seq > previous.run_seq) latest.set(run.scenario_id, run);
  }
  return latest;
}

export function readScenarioPricingCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((entry) => {
    if (typeof entry === "string") return entry.trim();
    if (typeof entry === "object" && entry !== null && "code" in entry) {
      const code = (entry as { code?: unknown }).code;
      return typeof code === "string" ? code.trim() : "";
    }
    return "";
  }).filter(Boolean)));
}

export function countScenarioAssumptions(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export function formatScenarioPricingAmount(
  amount: number | null,
  currency = "XOF",
): string {
  if (amount === null || !Number.isFinite(Number(amount))) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: currency === "FCFA" ? "XOF" : currency,
    maximumFractionDigits: 0,
  }).format(Number(amount));
}

export function readScenarioPricingEdgeData(raw: unknown): ScenarioPricingEdgeData | null {
  if (typeof raw !== "object" || raw === null) return null;
  const envelope = raw as { ok?: unknown; data?: unknown };
  if (envelope.ok !== true || typeof envelope.data !== "object" || envelope.data === null) {
    return null;
  }
  const data = envelope.data as Record<string, unknown>;
  if (
    typeof data.pricing_run_id !== "string" ||
    typeof data.scenario_id !== "string" ||
    typeof data.run_seq !== "number" ||
    !["success", "blocked", "failed"].includes(String(data.status)) ||
    !["provisional", "partial", "blocked"].includes(String(data.qualification))
  ) return null;
  return {
    pricing_run_id: data.pricing_run_id,
    scenario_id: data.scenario_id,
    run_seq: data.run_seq,
    status: data.status as ScenarioPricingEdgeData["status"],
    qualification: data.qualification as ScenarioPricingQualification,
    blockers: readScenarioPricingCodes(data.blockers),
    idempotent_replay: data.idempotent_replay === true,
  };
}

export function readScenarioOutputEdgeData(raw: unknown): ScenarioQuotationOutputEdgeData | null {
  if (typeof raw !== "object" || raw === null) return null;
  const envelope = raw as { ok?: unknown; data?: unknown };
  if (envelope.ok !== true || typeof envelope.data !== "object" || envelope.data === null) {
    return null;
  }
  const data = envelope.data as Record<string, unknown>;
  if (
    typeof data.version_id !== "string" ||
    typeof data.version_number !== "number" || data.version_number >= 0 ||
    typeof data.scenario_reference !== "string" ||
    !["provisional", "partial"].includes(String(data.qualification))
  ) return null;
  return {
    version_id: data.version_id,
    version_number: data.version_number,
    scenario_reference: data.scenario_reference,
    qualification: data.qualification as "provisional" | "partial",
    idempotent_replay: data.idempotent_replay === true,
  };
}
