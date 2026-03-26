/**
 * C1.1 — Constantes statiques extraites de CaseView.tsx
 * Aucune logique métier, données pures uniquement.
 */

import { SERVICE_PACKAGES } from "@/features/quotation/constants";

/** Fact keys rendered as Select dropdown instead of Input */
export const SELECT_FACT_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  "service.package": Object.keys(SERVICE_PACKAGES).map((pkg) => ({
    value: pkg,
    label: pkg.replace(/_/g, " "),
  })),
  "cargo.freight_currency": [
    { value: "XOF", label: "XOF (FCFA)" },
    { value: "EUR", label: "EUR" },
    { value: "USD", label: "USD" },
  ],
  "routing.transport_mode": [
    { value: "AIR", label: "Air" },
    { value: "MARITIME", label: "Maritime" },
    { value: "ROUTE", label: "Route" },
  ],
};

/** P1a — Global fact keys ambiguous on multi-lot cases */
export const MULTI_LOT_AMBIGUOUS_FACTS = new Set([
  "cargo.weight_kg",
  "cargo.pieces_count",
  "cargo.description",
  "service.package",
]);

/**
 * Mirror of supabase/functions/_shared/client-gap-policy.ts
 * Keep in sync with backend client-resolvable gap keys.
 */
export const CLIENT_RESOLVABLE_GAP_KEYS = new Set([
  "cargo.description", "cargo.value", "cargo.weight_kg", "cargo.volume_cbm",
  "cargo.hs_code", "cargo.pieces_count", "routing.origin_port",
  "routing.destination_port", "routing.destination_city",
  "routing.destination_country", "routing.transport_mode",
]);

/** Editable fact keys (must match set-case-fact whitelist) */
export const EDITABLE_FACT_KEYS = new Set([
  "cargo.weight_kg",
  "cargo.container_count",
  "cargo.container_type",
  "cargo.caf_value",
  "cargo.chargeable_weight_kg",
  "cargo.weight_per_container_kg",
  "cargo.articles_detail",
  "client.code",
  "routing.incoterm",
  "routing.destination_city",
  "service.mode",
  "service.package",
  "cargo.value",
  "cargo.pieces_count",
  "cargo.hs_code",
  "customs.regime_code",
  "regulatory.exemption_title",
  "cargo.freight_cost",
  "cargo.freight_currency",
  "cargo.freight_exchange_rate",
  "routing.transport_mode",
]);

export const NUMERIC_FACT_KEYS = new Set([
  "cargo.weight_kg",
  "cargo.container_count",
  "cargo.caf_value",
  "cargo.chargeable_weight_kg",
  "cargo.weight_per_container_kg",
  "cargo.value",
  "cargo.pieces_count",
  "cargo.freight_cost",
  "cargo.freight_exchange_rate",
]);

/** Category labels for display */
export const CATEGORY_LABELS: Record<string, string> = {
  cargo: "Cargo",
  routing: "Routing",
  timing: "Timing",
  pricing: "Tarification",
  documents: "Documents",
  contacts: "Contacts",
  service: "Service",
  regulatory: "Réglementaire",
  carrier: "Transporteur",
  survey: "Survey",
  other: "Autre",
};

export const STATUS_LABELS: Record<string, string> = {
  INTAKE: "Réception",
  NEW_THREAD: "Nouveau fil",
  RFQ_DETECTED: "RFQ détectée",
  FACTS_PARTIAL: "Données incomplètes",
  NEED_INFO: "Infos manquantes",
  READY_TO_PRICE: "Prêt à chiffrer",
  DECISIONS_PENDING: "Décisions en attente",
  DECISIONS_COMPLETE: "Décisions validées",
  ACK_READY_FOR_PRICING: "Prêt confirmé",
  PRICING_RUNNING: "Chiffrage en cours",
  PRICED_DRAFT: "Brouillon chiffré",
  HUMAN_REVIEW: "Revue humaine",
  QUOTED_VERSIONED: "Versionné",
  SENT: "Envoyé",
  ARCHIVED: "Archivé",
};

export const EXCLUSIVE_GROUPS = [
  ["TRUCKING", "ON_CARRIAGE"],
  ["PORT_DAKAR_HANDLING", "PORT_CHARGES"],
  ["CUSTOMS_DAKAR", "CUSTOMS"],
];
