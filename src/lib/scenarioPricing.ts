/** Présentation pure P1-A4 du pricing isolé par scénario. */

export type ScenarioPricingStatus = "success" | "blocked" | "failed" | "superseded";
export type ScenarioPricingQualification = "provisional" | "partial" | "blocked";

export interface ScenarioPricingRunSummary {
  tariff_lines?: unknown;
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

/** Keep persisted codes stable while making the required operator action explicit. */
export function scenarioPricingCodeMessage(code: string): string {
  switch (code) {
    case "SCENARIO_CONTAINER_STAY_ESTIMATE":
      return "Séjour estimé par lot : magasinage et surestaries ont des durées distinctes. Les conditions de franchise, montants calculés et frais encore non chiffrés sont précisés dans le détail ; aucun montant n’est ferme.";
    case "SCENARIO_TRANSPORT_KM_ESTIMATE":
      return "Transport estimé à partir d’une distance routière sourcée pour les lots ordinaires qualifiés. Ce calcul reste indicatif ; retour vide et autres prestations sont examinés séparément.";
    case "SCENARIO_CARGO_GROUP_ASSUMPTION":
      return "La répartition de la marchandise entre les groupes est une hypothèse à vérifier.";
    case "SCENARIO_CARGO_ASSUMPTIONS":
      return "Le calcul utilise les hypothèses de quantité, de poids et d’équipement du scénario.";
    case "SCENARIO_DG_UNKNOWN":
      return "Le caractère dangereux de certains groupes reste à préciser ; toute base chiffrée est indicative et ne comprend pas le supplément IMO éventuel.";
    case "SCENARIO_OWNERSHIP_SCOPE":
      return "Les surestaries armateur concernent les lots COC ; le retour vide est examiné par lot. Les exclusions ne signifient pas que les transports ou autres frais de séjour sont gratuits.";
    case "SCENARIO_EMPTY_RETURN_SCOPE":
      return "Vérifier les conditions de retour vide de chaque lot dans le détail : responsabilité du client et éventuel repositionnement restent distincts du transport de livraison.";
    case "SCENARIO_THC_BASE_ESTIMATE":
      return "La base de manutention repose sur une famille tarifaire indicative, précisée par lot ; aucun supplément IMO éventuel n’est inclus dans cette base.";
    case "OPEN_POINT":
      return "Des informations restent à compléter dans ce scénario.";
    case "RATE_PENDING_CONFIRMATION":
      return "Certains tarifs restent à confirmer et ne sont pas inclus dans le sous-total.";
    case "SCENARIO_DAP_SERVICES_ONLY":
      return "Estimation des prestations DAP : droits et taxes douaniers et calcul CAF exclus, sans valeur marchandise fictive. Le montant affiché est un sous-total des postes chiffrés.";
    case "SCENARIO_PAD_PENDING":
      return "Droit de passage PAD à déterminer : poste non chiffré, exclu du sous-total et non considéré comme gratuit.";
    case "PAD_CATALOG_UNAVAILABLE":
      return "Lecture complète du catalogue PAD impossible : postes PAD non chiffrés, réessayer avant de conclure à un tarif manquant.";
    case "SCENARIO_FEE_CATALOG_UNAVAILABLE":
      return "Lecture complète du catalogue d’honoraires impossible : honoraires non chiffrés, réessayer avant de conclure à une règle manquante.";
    case "SCENARIO_PAD_PRICING_SCOPE_UNSUPPORTED":
      return "Le calcul PAD par groupe est disponible pour l’estimation maritime import DAP. Les choix PAD ne peuvent pas être ignorés dans un autre périmètre.";
    case "QUOTATION_ENGINE_MODE_NOT_ACKNOWLEDGED":
      return "Le moteur ne confirme pas le mode estimation DAP. Aucun montant retenu ; vérifier la concordance des versions déployées.";
    case "SCENARIO_CARGO_V2_REQUIRED":
      return "Recalcul à conteneurs : créer une révision maritime v2 et vérifier les hypothèses par lot. Les résultats historiques restent conservés.";
    case "SCENARIO_DG_FACTS_UNSCOPED":
      return "Données de danger non rattachées aux lots : renseigner une révision maritime v2, sans modifier les faits client.";
    case "SCENARIO_DG_FACTS_UNSCOPED_AIR":
      return "Calcul aérien avec données de danger non pris en charge par ce parcours. Revue métier nécessaire ; le contrat v2 est réservé au maritime.";
    case "SCENARIO_CONTAINERS_UNSCOPED_AIR":
      return "Scénario aérien avec données de conteneurs : périmètre à revoir avant calcul. Aucune conversion de mode ni suppression automatique des faits client.";
    case "SCENARIO_OWNERSHIP_NOT_PRICED":
      return "Propriété conservée sans ajustement tarifaire SOC/COC dans cette version ; frais dépendants à vérifier.";
    case "SCENARIO_CONTAINER_THC_OPERATOR_INDEPENDENT":
      return "Manutention conteneurs : barème homologué retenu indépendamment de l’opérateur, sans déduire le mode terminal.";
    case "SCENARIO_TERMINAL_ANCILLARIES_TO_CONFIRM":
      return "Magasinage et frais annexes terminal : consulter le détail par lot pour les montants calculés et les réserves. Seuls les postes non chiffrés sont exclus du sous-total ; ils ne sont pas considérés comme gratuits. Les montants estimés restent non fermes.";
    case "SCENARIO_TERMINAL_FACT_INVALID":
      return "Mode terminal renseigné mais non reconnu : vérifier cette information avant calcul.";
    default:
      return code;
  }
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
