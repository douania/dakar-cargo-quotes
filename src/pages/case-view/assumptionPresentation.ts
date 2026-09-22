import {
  ASSUMPTION_TYPE_LABELS,
  ASSUMPTION_VALUE_TYPE_LABELS,
  formatAssumptionValue,
} from "@/lib/scenarioAssumptions";
import { CONTAINER_STAY_KEY } from "../../../supabase/functions/_shared/container-stay-estimate";
import { LOCAL_TRANSPORT_ESTIMATE_KEY } from "../../../supabase/functions/_shared/local-transport-estimate";

export interface AssumptionPresentationRow {
  label: string;
  value: string;
}

export interface AssumptionPresentationGroup {
  title?: string;
  rows: AssumptionPresentationRow[];
}

export interface AssumptionValuePresentation {
  scopeLabel: string;
  typeLabel: string;
  groups: AssumptionPresentationGroup[];
  fallback: boolean;
}

const objectValue = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const number = (value: unknown): string | null =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("fr-FR")
    : null;

const yesNo = (value: unknown): string | null =>
  typeof value === "boolean" ? (value ? "Oui" : "Non") : null;

const shown = (value: string | null, fallback = "Non renseigné"): string => value ?? fallback;

export function assumptionScopeLabel(scopeKey: string): string {
  if (scopeKey === "case") return "Dossier";
  const [kind, reference] = scopeKey.split(":", 2);
  if (kind === "lot" && reference) return `Lot ${reference}`;
  if (kind === "commodity" && reference) return `Marchandise ${reference}`;
  return scopeKey;
}

export function assumptionTypeLabel(assumptionType: string, assumedFactKey: string | null): string {
  if (assumedFactKey === LOCAL_TRANSPORT_ESTIMATE_KEY) return "Estimation du transport local";
  if (assumedFactKey === CONTAINER_STAY_KEY) return "Estimation du séjour conteneur";
  return ASSUMPTION_TYPE_LABELS[assumptionType] ?? "Hypothèse";
}

function localTransportGroups(value: Record<string, unknown>): AssumptionPresentationGroup[] | null {
  if (!Array.isArray(value.groups)) return null;
  const overview: AssumptionPresentationGroup = {
    rows: [
      { label: "Origine", value: shown(text(value.origin)) },
      { label: "Destination", value: shown(text(value.destination)) },
      { label: "Distance", value: number(value.distance_km) ? `${number(value.distance_km)} km` : "Non renseignée" },
      { label: "Source de la distance", value: shown(text(value.distance_source)) },
      { label: "Date de vérification", value: shown(text(value.verified_on)) },
      { label: "TVA fournisseur", value: "Non stockée dans cette hypothèse" },
    ],
  };
  const groups = value.groups.map((raw, index) => {
    const group = objectValue(raw);
    if (!group) return null;
    return {
      title: `Lot ${index + 1}`,
      rows: [
        { label: "Référence", value: shown(text(group.unit_ref)) },
        { label: "Équipement", value: shown(text(group.equipment_code)) },
        { label: "Quantité", value: shown(number(group.quantity)) },
        { label: "Poids par conteneur", value: number(group.weight_per_container_kg) ? `${number(group.weight_per_container_kg)} kg` : "Non renseigné" },
        { label: "Charge admissible", value: number(group.max_payload_kg) ? `${number(group.max_payload_kg)} kg` : "Non renseignée" },
        { label: "Transport ordinaire", value: shown(yesNo(group.ordinary_transport)) },
        { label: "Base de qualification", value: shown(text(group.qualification_source)) },
      ],
    };
  });
  if (groups.some((group) => group === null)) return null;
  return [overview, ...groups as AssumptionPresentationGroup[]];
}

function stayGroups(value: Record<string, unknown>): AssumptionPresentationGroup[] | null {
  if (!Array.isArray(value.groups)) return null;
  const overview: AssumptionPresentationGroup = {
    rows: [
      { label: "Source", value: shown(text(value.source)) },
      { label: "Date de vérification", value: shown(text(value.verified_on)) },
      { label: "Franchise", value: "Non stockée dans cette hypothèse" },
      { label: "Tranches", value: "Non stockées dans cette hypothèse" },
    ],
  };
  const groups = value.groups.map((raw, index) => {
    const group = objectValue(raw);
    if (!group) return null;
    return {
      title: `Lot ${index + 1}`,
      rows: [
        { label: "Référence", value: shown(text(group.unit_ref)) },
        { label: "Équipement", value: shown(text(group.equipment_code)) },
        { label: "Quantité", value: shown(number(group.quantity)) },
        { label: "Propriété", value: shown(text(group.ownership)) },
        { label: "Opérateur terminal", value: shown(text(group.provider)) },
        { label: "Durée de magasinage", value: number(group.storage_days) ? `${number(group.storage_days)} jours` : "Non renseignée" },
        { label: "Durée de surestaries", value: number(group.demurrage_days) ? `${number(group.demurrage_days)} jours` : "Non renseignée" },
        { label: "Désignation magasinage", value: shown(text(group.storage_p1_code)) },
      ],
    };
  });
  if (groups.some((group) => group === null)) return null;
  return [overview, ...groups as AssumptionPresentationGroup[]];
}

export function presentAssumptionValue(input: {
  scopeKey: string;
  assumptionType: string;
  assumedFactKey: string | null;
  valueType: string | null;
  value: unknown;
}): AssumptionValuePresentation {
  const base = {
    scopeLabel: assumptionScopeLabel(input.scopeKey),
    typeLabel: assumptionTypeLabel(input.assumptionType, input.assumedFactKey),
  };
  const structured = objectValue(input.value);
  const groups = input.assumedFactKey === LOCAL_TRANSPORT_ESTIMATE_KEY && structured
    ? localTransportGroups(structured)
    : input.assumedFactKey === CONTAINER_STAY_KEY && structured
      ? stayGroups(structured)
      : null;
  if (groups) return { ...base, groups, fallback: false };

  if (input.valueType !== "json") {
    return {
      ...base,
      groups: [{ rows: [{
        label: ASSUMPTION_VALUE_TYPE_LABELS[input.valueType as keyof typeof ASSUMPTION_VALUE_TYPE_LABELS] ?? "Valeur",
        value: formatAssumptionValue(input.valueType, input.value),
      }] }],
      fallback: false,
    };
  }

  return {
    ...base,
    groups: [{ rows: [{ label: "Valeur", value: "Données structurées à consulter" }] }],
    fallback: true,
  };
}

export function technicalAssumptionValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "Données techniques illisibles";
  }
}
