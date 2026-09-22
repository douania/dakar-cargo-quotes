import {
  readScenarioPricingCodes,
  scenarioPricingCodeMessage,
} from "@/lib/scenarioPricing";

export type EstimateLine = Record<string, unknown>;

export interface EstimateReservation {
  id: string;
  message: string;
  technicalCode: string | null;
}

export interface EstimateReservationGroups {
  actionable: EstimateReservation[];
  standard: EstimateReservation[];
}

const STANDARD_RESERVATION_CODES = new Set([
  "SCENARIO_CONTAINER_STAY_ESTIMATE",
  "SCENARIO_TRANSPORT_KM_ESTIMATE",
  "SCENARIO_CARGO_GROUP_ASSUMPTION",
  "SCENARIO_CARGO_ASSUMPTIONS",
  "SCENARIO_OWNERSHIP_SCOPE",
  "SCENARIO_EMPTY_RETURN_SCOPE",
  "SCENARIO_THC_BASE_ESTIMATE",
  "SCENARIO_DAP_SERVICES_ONLY",
  "SCENARIO_CONTAINER_THC_OPERATOR_INDEPENDENT",
]);

const objectValue = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

export const estimateLineSource = (line: EstimateLine): Record<string, unknown> =>
  objectValue(line.source) ?? {};

export const isExcludedEstimateLine = (line: EstimateLine): boolean =>
  estimateLineSource(line).type === "EXCLUDED_BY_RULE";

export const isPricedEstimateLine = (line: EstimateLine): boolean =>
  typeof line.amount === "number" &&
  Number.isFinite(line.amount) &&
  estimateLineSource(line).type !== "TO_CONFIRM" &&
  !isExcludedEstimateLine(line);

function firstSentence(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^.*?(?:[.!?](?=\s|$)|$)/);
  return match?.[0]?.trim() || trimmed;
}

export function estimateLineBase(line: EstimateLine): string {
  return firstSentence(line.notes) ??
    firstSentence(estimateLineSource(line).reference) ??
    "Base non renseignée";
}

export function estimateLineStatus(line: EstimateLine): string {
  if (isExcludedEstimateLine(line)) return "Exclu sous hypothèse";
  if (isPricedEstimateLine(line)) return "Chiffré";
  return "À confirmer";
}

function reservationFromCode(code: string, index: number): EstimateReservation {
  const message = scenarioPricingCodeMessage(code);
  return {
    id: `code-${index}-${code}`,
    message: message === code
      ? "Point de contrôle à examiner dans les détails techniques."
      : message,
    technicalCode: code,
  };
}

function reservationsFrom(value: unknown): EstimateReservation[] {
  return readScenarioPricingCodes(value).map(reservationFromCode);
}

/** Présentation pure : les entrées sont classées sans modifier le run ni leur contenu. */
export function classifyEstimateReservations(input: {
  lines: readonly EstimateLine[];
  blockers: unknown;
  reservations: unknown;
}): EstimateReservationGroups {
  const actionable: EstimateReservation[] = [];
  const standard: EstimateReservation[] = [];

  input.lines.forEach((line, index) => {
    if (isExcludedEstimateLine(line)) return;
    const note = typeof line.notes === "string" ? line.notes.trim() : "";
    if (!note) return;
    const item = { id: `line-${index}`, message: note, technicalCode: null };
    (isPricedEstimateLine(line) ? standard : actionable).push(item);
  });

  reservationsFrom(input.blockers).forEach((item) => actionable.push({
    ...item,
    id: `blocker-${item.id}`,
  }));

  reservationsFrom(input.reservations).forEach((item) => {
    const destination = item.technicalCode && STANDARD_RESERVATION_CODES.has(item.technicalCode)
      ? standard
      : actionable;
    destination.push({ ...item, id: `reservation-${item.id}` });
  });

  return { actionable, standard };
}
