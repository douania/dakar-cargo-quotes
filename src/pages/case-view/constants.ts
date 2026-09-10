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
  /**
   * Mode d'opération terminal — saisie explicite, jamais déduite du transporteur.
   * Valeurs strictes attendues par supabase/functions/_shared/terminal-operation-mode.ts :
   * toute autre chaîne laisse run-pricing bloqué sur TERMINAL_OPERATION_MODE_REQUIRED.
   */
  "routing.terminal_operation_mode": [
    { value: "LOLO", label: "LoLo — terminal à conteneurs (DP World)" },
    { value: "RORO", label: "RoRo — navire roulier (Dakar Terminal)" },
    { value: "CONRO", label: "ConRo — roulier + conteneurs (Dakar Terminal)" },
  ],
  /**
   * DTHC-2 — famille tarifaire DP World choisie par l'opérateur (fait pricing.dthc_family).
   * Sans ce fait, un conteneur sec dont la désignation n'est pas validée reste
   * « tarif terminal à confirmer ». Valeurs strictes attendues par
   * supabase/functions/_shared/dpw-dthc-tariff.ts (DPW_DTHC_FAMILIES).
   */
  "pricing.dthc_family": [
    { value: "STANDARD", label: "STANDARD — produits standards (conteneur sec)" },
    { value: "BASIC", label: "BASIC — produits de base (huile alimentaire, pharma, riz, sucre, lait)" },
    { value: "DANGEROUS", label: "DANGEROUS — produits dangereux IMDG classes 1-9" },
    { value: "REEFER", label: "REEFER — conteneurs frigorifiques" },
    { value: "SPECIAL", label: "SPECIAL — conteneurs spéciaux (OOG, flat, open top, tank)" },
  ],
  /**
   * DG-1 — caractère dangereux de la marchandise (fait cargo.dangerous_goods).
   * Valeurs strictes attendues par supabase/functions/_shared/dangerous-goods.ts.
   * Fait absent : le caractère dangereux reste INCONNU et toute règle
   * d'honoraires conditionnée à ce critère sort « à confirmer » — l'absence de
   * saisie ne vaut jamais « non dangereux ».
   */
  "cargo.dangerous_goods": [
    { value: "YES", label: "Oui — marchandise dangereuse (IMDG / IATA DGR)" },
    { value: "NO", label: "Non — marchandise non dangereuse" },
  ],
  /**
   * IMO-RULES-1 — classe IMDG (fait cargo.imo_class). Nomenclature de
   * l'Organisation maritime internationale, valeurs strictes attendues par
   * supabase/functions/_shared/imo-classification.ts. Renseigner la classe
   * suffit à classer la marchandise comme dangereuse.
   */
  "cargo.imo_class": [
    { value: "1.1", label: "1.1 — Explosifs, risque d'explosion en masse" },
    { value: "1.2", label: "1.2 — Explosifs, risque de projection" },
    { value: "1.3", label: "1.3 — Explosifs, risque d'incendie" },
    { value: "1.4", label: "1.4 — Explosifs, risque faible" },
    { value: "1.5", label: "1.5 — Explosifs, matières très peu sensibles" },
    { value: "1.6", label: "1.6 — Explosifs, objets extrêmement peu sensibles" },
    { value: "2.1", label: "2.1 — Gaz inflammables" },
    { value: "2.2", label: "2.2 — Gaz non inflammables, non toxiques" },
    { value: "2.3", label: "2.3 — Gaz toxiques" },
    { value: "3", label: "3 — Liquides inflammables" },
    { value: "4.1", label: "4.1 — Matières solides inflammables" },
    { value: "4.2", label: "4.2 — Matières sujettes à inflammation spontanée" },
    { value: "4.3", label: "4.3 — Matières dégageant des gaz inflammables au contact de l'eau" },
    { value: "5.1", label: "5.1 — Matières comburantes" },
    { value: "5.2", label: "5.2 — Peroxydes organiques" },
    { value: "6.1", label: "6.1 — Matières toxiques" },
    { value: "6.2", label: "6.2 — Matières infectieuses" },
    { value: "7", label: "7 — Matières radioactives" },
    { value: "8", label: "8 — Matières corrosives" },
    { value: "9", label: "9 — Matières et objets dangereux divers" },
  ],
};

/** P1a — Global fact keys ambiguous on multi-lot cases */
export const MULTI_LOT_AMBIGUOUS_FACTS = new Set([
  "cargo.weight_kg",
  "cargo.pieces_count",
  "cargo.description",
  "service.package",
  // Le moteur multi-lot exige une valeur déclarée par lot et ignore volontairement
  // ce fait global : le badge avertit l'opérateur qu'il ne résout pas les lots.
  "routing.terminal_operation_mode",
  // DG-1 et IMO-RULES-1 : la dangerosité et la classe peuvent différer d'un lot
  // à l'autre ; une valeur globale s'appliquerait à tous les lots.
  "cargo.dangerous_goods",
  "cargo.imo_class",
  "cargo.un_number",
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
  "cargo.description",
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
  "routing.terminal_operation_mode",
  "cargo.pad_category",
  "cargo.pad_rate_fcfa_per_ton",
  "pricing.dthc_family",
  "cargo.dangerous_goods",
  // IMO-RULES-1 : classe IMDG (liste fermée) et numéro ONU (saisie libre au
  // format UN + quatre chiffres, validé par set-case-fact).
  "cargo.imo_class",
  "cargo.un_number",
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
  "cargo.pad_rate_fcfa_per_ton",
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
  ACCEPTED: "Accepté",
  REJECTED: "Refusé",
  ARCHIVED: "Archivé",
};

export const EXCLUSIVE_GROUPS = [
  ["TRUCKING", "ON_CARRIAGE"],
  ["PORT_DAKAR_HANDLING", "PORT_CHARGES"],
  ["CUSTOMS_DAKAR", "CUSTOMS"],
  ["STUFFING_FACTORY", "STUFFING_CFS"],
];
