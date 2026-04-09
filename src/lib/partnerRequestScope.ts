/**
 * COCKPIT-11 — Dérivation de scope fournisseur multi-postes.
 *
 * Règle de priorité (garde-fou CTO) :
 *   1. Facts structurés = source primaire
 *   2. Texte email client = signal complémentaire uniquement
 *   3. En cas de conflit : les facts structurés priment
 */

export interface PartnerScopeItem {
  purpose: string;
  label: string;
  requiredItems: string[];
  confidence: "high" | "medium" | "low";
}

interface ScopeInput {
  facts: Record<string, string | null>;
  /** Signal complémentaire — ne tranche jamais seul */
  latestClientEmailText?: string;
}

// ---------------------------------------------------------------------------
// Keyword detection helpers (case-insensitive)
// ---------------------------------------------------------------------------

function textContainsAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Scope derivation — Phase 1 (deterministic, no AI)
// ---------------------------------------------------------------------------

export function derivePartnerRequestScope(input: ScopeInput): PartnerScopeItem[] {
  const { facts, latestClientEmailText } = input;
  const scope: PartnerScopeItem[] = [];

  const transportMode = (facts["routing.transport_mode"] ?? "").toLowerCase();
  const isMaritime =
    transportMode.includes("marit") ||
    transportMode.includes("sea") ||
    transportMode.includes("mer");
  const isAir = transportMode.includes("air") || transportMode.includes("aéri");
  const hasContainers =
    !!facts["cargo.container_type"] || !!facts["cargo.container_count"];
  const text = latestClientEmailText ?? "";

  // ── 1. Freight rate — always present if transport mode is known ──
  if (isMaritime) {
    const items = [
      "Taux de fret maritime",
      "Transit time",
      "Free days / detention-demurrage",
      "Vessel schedule disponible",
      "Validité de l'offre",
    ];
    // Enrich with surcharges signal from text (complementary)
    if (textContainsAny(text, ["surcharge", "port surcharge", "local charge"])) {
      items.push("Surcharges / port surcharges éventuels");
    }
    scope.push({
      purpose: "freight_rate",
      label: "Fret maritime",
      requiredItems: items,
      confidence: "high",
    });
  } else if (isAir) {
    scope.push({
      purpose: "air_tariff",
      label: "Fret aérien",
      requiredItems: [
        "Tarif aérien",
        "Transit time",
        "Poids taxable / base de calcul",
        "Validité de l'offre",
      ],
      confidence: "high",
    });
  }

  // ── 2. Origin charges — from facts or text signal ──
  const originChargesKeywords = [
    "origin charges",
    "origin charge",
    "frais d'origine",
    "thc",
    "local charges",
    "port handling",
    "customs clearance",
    "vgm",
    "documentation",
  ];
  // Fact-based: if we have an origin port, origin charges are likely needed for maritime exports
  const hasOriginPort = !!facts["routing.origin_port"];
  const originFromFacts = isMaritime && hasOriginPort && hasContainers;
  const originFromText = textContainsAny(text, originChargesKeywords);

  if (originFromFacts || originFromText) {
    scope.push({
      purpose: "origin_charges",
      label: "Frais d'origine",
      requiredItems: [
        "THC / manutention",
        "Documentation / BL fees",
        "VGM si applicable",
        "Port handling",
        "Surcharges locales",
        "Customs clearance si applicable",
        "Validité",
      ],
      confidence: originFromFacts ? "medium" : "low",
    });
  }

  // ── 3. Stuffing factory — primarily from text signal ──
  const stuffingFactoryKeywords = [
    "factory stuffing",
    "pre-stuffed",
    "pre stuffed",
    "empty repositioning",
    "factory to port",
    "usine",
    "empotage usine",
  ];
  if (textContainsAny(text, stuffingFactoryKeywords)) {
    scope.push({
      purpose: "stuffing_factory",
      label: "Empotage usine (Factory Stuffing)",
      requiredItems: [
        "Repositionnement conteneur vide",
        "Transport usine → port",
        "Scellage / sealing",
        "Manutention / handling",
      ],
      confidence: "medium",
    });
  }

  // ── 4. Stuffing port / CFS — primarily from text signal ──
  const stuffingCfsKeywords = [
    "cfs",
    "port stuffing",
    "warehousing",
    "receiving cargo",
    "stripping",
    "re-stuffing",
    "empotage port",
    "magasinage",
  ];
  if (textContainsAny(text, stuffingCfsKeywords)) {
    scope.push({
      purpose: "stuffing_port_cfs",
      label: "Empotage port / CFS",
      requiredItems: [
        "Réception marchandise",
        "Entreposage / magasinage",
        "Empotage / stuffing",
        "Manutention",
        "Inspection si applicable",
      ],
      confidence: "medium",
    });
  }

  return scope;
}
