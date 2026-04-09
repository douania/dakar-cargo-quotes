/**
 * COCKPIT-10 / 11B / 11C — Génération déterministe d'email partenaire professionnel.
 * Logique identique à src/lib/partnerEmailTemplate.ts.
 * Les deux fichiers DOIVENT rester synchronisés en structure, ordre de blocs,
 * et variations par purpose.
 */

export interface PartnerEmailFacts {
  [key: string]: string | null | undefined;
}

// ---------------------------------------------------------------------------
// PURPOSE_INCLUDES — COCKPIT-11C: enriched freight, SODATRA-adapted origin
// ---------------------------------------------------------------------------

const PURPOSE_INTRO: Record<string, string> = {
  freight_rate: "votre meilleure cotation fret maritime",
  origin_charges: "votre offre pour les frais d'origine",
  air_tariff: "votre meilleur tarif aérien",
  freight_maritime: "votre meilleure cotation fret maritime",
  freight_aerien: "votre meilleur tarif aérien",
  pre_carriage: "votre offre de pré-acheminement",
  documentation: "votre offre pour les frais de documentation",
  stuffing_factory: "votre offre d'empotage usine (factory stuffing)",
  stuffing_port_cfs: "votre offre d'empotage port / CFS",
  general: "votre meilleure offre",
};

const PURPOSE_INCLUDES: Record<string, string[]> = {
  freight_rate: [
    "Taux de fret maritime",
    "Transit time",
    "Vessel schedule disponible",
    "Free days / detention-demurrage",
    "Origin charges détaillés (THC, manutention, documentation)",
    "Port surcharges / local charges",
    "Surcharges éventuelles (BAF, CAF, etc.)",
    "Validité de l'offre",
  ],
  origin_charges: [
    "THC / manutention au départ",
    "Documentation / BL fees",
    "VGM si applicable",
    "Port handling / terminal handling",
    "Frais de pesée si applicable",
    "Surcharges locales / port surcharges",
    "Conditions locales applicables",
    "Validité de l'offre",
  ],
  air_tariff: [
    "Tarif aérien",
    "Transit time",
    "Poids taxable / base de calcul",
    "Validité de l'offre",
  ],
  freight_maritime: [
    "Taux de fret maritime",
    "Transit time",
    "Vessel schedule disponible",
    "Free days / detention-demurrage",
    "Origin charges détaillés (THC, manutention, documentation)",
    "Port surcharges / local charges",
    "Surcharges éventuelles (BAF, CAF, etc.)",
    "Validité de l'offre",
  ],
  freight_aerien: [
    "Tarif aérien",
    "Transit time",
    "Poids taxable / base de calcul",
    "Validité de l'offre",
  ],
  pre_carriage: [
    "Tarif de pré-acheminement",
    "Délai de mise à disposition",
    "Validité",
  ],
  documentation: [
    "Frais de documentation",
    "Délai de traitement",
    "Validité",
  ],
  stuffing_factory: [
    "Repositionnement conteneur vide",
    "Transport usine → port",
    "Scellage / sealing",
    "Manutention / handling",
    "Conditions et tarif",
    "Validité de l'offre",
  ],
  stuffing_port_cfs: [
    "Réception marchandise au port / CFS",
    "Entreposage / magasinage",
    "Empotage / stuffing",
    "Manutention",
    "Inspection si applicable",
    "Conditions et tarif",
    "Validité de l'offre",
  ],
  general: [
    "Détail de l'offre",
    "Conditions applicables",
    "Validité de l'offre",
  ],
};

// ---------------------------------------------------------------------------
// COCKPIT-11C: Promotion labels for structurally important scope blocks
// ---------------------------------------------------------------------------

const PROMOTION_LABELS: Record<string, string> = {
  origin_charges: "Origin charges détaillés au départ",
  stuffing_factory: "Conditions pour Factory Stuffing / Pre-Stuffed Containers",
  stuffing_port_cfs: "Conditions pour Port Stuffing / CFS Handling",
};

// ---------------------------------------------------------------------------
// COCKPIT-11C: Deduplication helper
// ---------------------------------------------------------------------------

function normalizeForDedup(text: string): string {
  let s = text.toLowerCase().trim();
  s = s.replace(/[.,;:!?]+$/, "");
  s = s.replace(/free days\s*\/?\s*detention[\s-]*demurrage/g, "free days");
  s = s.replace(/surcharges\s+[eé]ventuelles(\s*\(.*?\))?/g, "surcharges");
  s = s.replace(/port surcharges\s*\/?\s*local charges(\s+[eé]ventuels)?/g, "port surcharges");
  s = s.replace(/origin charges\s+d[eé]taill[eé]s(\s*\(.*?\))?(\s+au départ)?/g, "origin charges");
  return s;
}

// ---------------------------------------------------------------------------
// Resolve helpers
// ---------------------------------------------------------------------------

function resolveOrigin(facts: PartnerEmailFacts): string | null {
  return (facts["routing.origin_port"] || facts["routing.origin_country"]) ?? null;
}

function resolveDestination(facts: PartnerEmailFacts): string | null {
  const port = facts["routing.destination_port"];
  const city = facts["routing.destination_city"];
  const finalDest = facts["routing.final_destination"];
  const country = facts["routing.destination_country"];

  if (port && finalDest && port !== finalDest) {
    return `${port} / ${finalDest} — à confirmer`;
  }
  return port || finalDest || city || country || null;
}

function resolveTransportLabel(facts: PartnerEmailFacts, purpose: string): string {
  const mode = (facts["routing.transport_mode"] ?? "").toLowerCase();
  if (purpose === "air_tariff" || purpose === "freight_aerien" || mode.includes("air")) {
    return "aérienne";
  }
  if (purpose === "freight_rate" || purpose === "freight_maritime" || mode.includes("marit") || mode.includes("sea") || mode.includes("mer")) {
    return "maritime";
  }
  return "de transport";
}

// ---------------------------------------------------------------------------
// COCKPIT-11C: Scope type with optional confidence
// ---------------------------------------------------------------------------

interface ScopeBlock {
  purpose: string;
  label: string;
  requiredItems: string[];
  confidence?: string;
}

/**
 * COCKPIT-11C — scope-aware, hierarchized partner email generation.
 */
export function buildPartnerEmailBody(
  facts: PartnerEmailFacts,
  _partnerName: string,
  purpose: string,
  caseRef?: string,
  scope?: ScopeBlock[],
): string {
  const lines: string[] = [];
  const origin = resolveOrigin(facts);
  const destination = resolveDestination(facts);
  const transportLabel = resolveTransportLabel(facts, purpose);
  const introLabel = PURPOSE_INTRO[purpose] ?? PURPOSE_INTRO.general;

  lines.push("Bonjour,");
  lines.push("");

  let intro = `Nous souhaitons obtenir ${introLabel}`;
  if (origin || destination) {
    intro += ` pour une expédition ${transportLabel}`;
    if (origin) intro += ` au départ de ${origin}`;
    if (destination) intro += ` à destination de ${destination}`;
  }
  intro += ".";
  lines.push(intro);

  const cargoLines: string[] = [];
  const desc = facts["cargo.description"] || facts["cargo.articles_detail"];
  if (desc) cargoLines.push(`Marchandise : ${String(desc).slice(0, 200)}`);

  const fclLcl = facts["cargo.fcl_lcl"];
  const containerType = facts["cargo.container_type"];
  const containerCount = facts["cargo.container_count"];
  if (fclLcl || containerType || containerCount) {
    let containerLine = "Conteneurs : ";
    if (fclLcl) containerLine += String(fclLcl).toUpperCase();
    if (containerCount && containerType) containerLine += ` — ${containerCount}x ${containerType}`;
    else if (containerType) containerLine += ` — ${containerType}`;
    else if (containerCount) containerLine += ` — ${containerCount} unité(s)`;
    cargoLines.push(containerLine.trim());
  }

  const weight = facts["cargo.weight_kg"];
  const volume = facts["cargo.volume_cbm"];
  if (weight || volume) {
    const parts: string[] = [];
    if (weight) parts.push(`${weight} kg`);
    if (volume) parts.push(`${volume} m³`);
    cargoLines.push(parts.join(" | "));
  }

  const incoterm = facts["routing.incoterm"];
  if (incoterm) cargoLines.push(`Incoterm : ${incoterm}`);

  const loading = facts["timing.loading_date"];
  if (loading) cargoLines.push(`Date de chargement estimée : ${loading}`);

  if (cargoLines.length > 0) {
    lines.push("");
    lines.push(...cargoLines);
  }

  // Primary request block
  const primaryItems = PURPOSE_INCLUDES[purpose] ?? PURPOSE_INCLUDES.general;
  const dedupSet = new Set(primaryItems.map((i) => normalizeForDedup(i)));

  lines.push("");
  lines.push("Merci d'inclure dans votre offre :");
  for (const item of primaryItems) {
    lines.push(`- ${item}`);
  }

  // COCKPIT-11C: Scope promotion logic
  const isFreightPurpose = purpose === "freight_rate" || purpose === "freight_maritime";
  const secondaryBlocks = (scope ?? []).filter((s) => s.purpose !== purpose);

  if (secondaryBlocks.length > 0) {
    const promotedItems: string[] = [];
    const secondaryItems: string[] = [];

    for (const block of secondaryBlocks) {
      const confidence = block.confidence ?? "medium";
      const isPromotable = confidence === "high" || confidence === "medium";

      if (isPromotable && isFreightPurpose && PROMOTION_LABELS[block.purpose]) {
        const label = PROMOTION_LABELS[block.purpose];
        const key = normalizeForDedup(label);
        if (!dedupSet.has(key)) {
          dedupSet.add(key);
          promotedItems.push(label);
        }
      } else if (isPromotable) {
        for (const item of block.requiredItems) {
          const key = normalizeForDedup(item);
          if (!dedupSet.has(key)) {
            dedupSet.add(key);
            promotedItems.push(item);
          }
        }
      } else {
        for (const item of block.requiredItems) {
          const key = normalizeForDedup(item);
          if (!dedupSet.has(key)) {
            dedupSet.add(key);
            secondaryItems.push(item);
          }
        }
      }
    }

    for (const item of promotedItems) {
      lines.push(`- ${item}`);
    }

    if (secondaryItems.length > 0) {
      lines.push("");
      lines.push("Merci également de préciser, si applicable :");
      for (const item of secondaryItems) {
        lines.push(`- ${item}`);
      }
    }
  }

  // COCKPIT-11C: Enriched fallback when scope is empty
  if ((!scope || scope.length === 0) && isFreightPurpose) {
    const fallbackItems = [
      "Conditions d'empotage, si applicable",
    ];
    const newFallback = fallbackItems.filter((f) => !dedupSet.has(normalizeForDedup(f)));
    if (newFallback.length > 0) {
      lines.push("");
      lines.push("Merci également de préciser, si applicable :");
      for (const item of newFallback) {
        lines.push(`- ${item}`);
      }
    }
  }

  if (caseRef) {
    lines.push("");
    lines.push(`Référence dossier : ${caseRef}`);
  }

  lines.push("");
  lines.push("Bien cordialement,");
  lines.push("L'équipe transit — SODATRA");

  return lines.join("\n");
}
