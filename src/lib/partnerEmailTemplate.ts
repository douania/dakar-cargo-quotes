/**
 * COCKPIT-10 / 11B / 11C — Génération déterministe d'email partenaire professionnel.
 * Logique identique à supabase/functions/_shared/partner-email-template.ts.
 * Les deux fichiers DOIVENT rester synchronisés en structure, ordre de blocs,
 * et variations par purpose.
 */

export interface PartnerEmailFacts {
  "routing.origin_port"?: string | null;
  "routing.origin_country"?: string | null;
  "routing.destination_port"?: string | null;
  "routing.destination_city"?: string | null;
  "routing.destination_country"?: string | null;
  "routing.final_destination"?: string | null;
  "routing.incoterm"?: string | null;
  "routing.transport_mode"?: string | null;
  "cargo.description"?: string | null;
  "cargo.articles_detail"?: string | null;
  "cargo.container_type"?: string | null;
  "cargo.container_count"?: string | null;
  "cargo.weight_kg"?: string | null;
  "cargo.volume_cbm"?: string | null;
  "cargo.fcl_lcl"?: string | null;
  "contacts.client_company"?: string | null;
  "timing.loading_date"?: string | null;
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
  // P0-3: resserré — origin charges et port surcharges retirés du noyau freight.
  // Ces items ne seront inclus que si le scope les confirme explicitement.
  freight_rate: [
    "Taux de fret maritime",
    "Transit time",
    "Vessel schedule disponible",
    "Free days / detention-demurrage",
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
  // P0-3: resserré — miroir de freight_rate
  freight_maritime: [
    "Taux de fret maritime",
    "Transit time",
    "Vessel schedule disponible",
    "Free days / detention-demurrage",
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
// When purpose is freight, these synthetic labels replace raw sub-items
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
  // Remove trailing punctuation
  s = s.replace(/[.,;:!?]+$/, "");
  // Normalize known synonyms for dedup
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
  return facts["routing.origin_port"] || facts["routing.origin_country"] || null;
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
  const mode = facts["routing.transport_mode"]?.toLowerCase() ?? "";
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
 * @param scope  Optional detected scope items with confidence.
 *               high/medium blocks are promoted to the primary request block.
 *               low blocks stay in the secondary "si applicable" section.
 *               Absent confidence is treated as "medium" (backward compatible).
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

  // --- Greeting ---
  lines.push("Bonjour,");
  lines.push("");

  // --- Introduction adapted to purpose ---
  let intro = `Nous souhaitons obtenir ${introLabel}`;
  if (origin || destination) {
    intro += ` pour une expédition ${transportLabel}`;
    if (origin) intro += ` au départ de ${origin}`;
    if (destination) intro += ` à destination de ${destination}`;
  }
  intro += ".";
  lines.push(intro);

  // --- Cargo details block ---
  const cargoLines: string[] = [];
  const desc = facts["cargo.description"] || facts["cargo.articles_detail"];
  if (desc) cargoLines.push(`Marchandise : ${desc.slice(0, 200)}`);

  const fclLcl = facts["cargo.fcl_lcl"];
  const containerType = facts["cargo.container_type"];
  const containerCount = facts["cargo.container_count"];
  if (fclLcl || containerType || containerCount) {
    let containerLine = "Conteneurs : ";
    if (fclLcl) containerLine += fclLcl.toUpperCase();
    if (containerCount && containerType) containerLine += ` — ${containerCount}x ${containerType}`;
    else if (containerType) containerLine += ` — ${containerType}`;
    else if (containerCount) containerLine += ` — ${containerCount} unité(s)`;
    cargoLines.push(containerLine.trim());
  }

  const weight = facts["cargo.weight_kg"];
  const volume = facts["cargo.volume_cbm"];
  if (weight || volume) {
    const parts: string[] = [];
    if (weight) parts.push(`Poids total : ${weight} kg`);
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

  // --- Primary request block (purpose principal) ---
  const primaryItems = PURPOSE_INCLUDES[purpose] ?? PURPOSE_INCLUDES.general;
  const dedupSet = new Set(primaryItems.map((i) => normalizeForDedup(i)));

  lines.push("");
  lines.push("Merci d'inclure dans votre offre :");
  for (const item of primaryItems) {
    lines.push(`- ${item}`);
  }

  // --- COCKPIT-11C: Scope promotion logic ---
  const isFreightPurpose = purpose === "freight_rate" || purpose === "freight_maritime";
  const secondaryBlocks = (scope ?? []).filter((s) => s.purpose !== purpose);

  if (secondaryBlocks.length > 0) {
    const promotedItems: string[] = [];
    const secondaryItems: string[] = [];

    for (const block of secondaryBlocks) {
      // P0-3: absent confidence = "low" — seuls les blocs explicitement high/medium sont promus
      const confidence = block.confidence ?? "low";
      const isPromotable = confidence === "high" || confidence === "medium";

      if (isPromotable && isFreightPurpose && PROMOTION_LABELS[block.purpose]) {
        // Use synthetic promotion label instead of raw sub-items
        const label = PROMOTION_LABELS[block.purpose];
        const key = normalizeForDedup(label);
        if (!dedupSet.has(key)) {
          dedupSet.add(key);
          promotedItems.push(label);
        }
      } else if (isPromotable) {
        // Non-freight purpose or no promotion label: promote raw items
        for (const item of block.requiredItems) {
          const key = normalizeForDedup(item);
          if (!dedupSet.has(key)) {
            dedupSet.add(key);
            promotedItems.push(item);
          }
        }
      } else {
        // Low confidence → secondary
        for (const item of block.requiredItems) {
          const key = normalizeForDedup(item);
          if (!dedupSet.has(key)) {
            dedupSet.add(key);
            secondaryItems.push(item);
          }
        }
      }
    }

    // Append promoted items to primary block
    for (const item of promotedItems) {
      lines.push(`- ${item}`);
    }

    // Secondary block
    if (secondaryItems.length > 0) {
      lines.push("");
      lines.push("Merci également de préciser, si applicable :");
      for (const item of secondaryItems) {
        lines.push(`- ${item}`);
      }
    }
  }

  // P0-3: Fallback automatique supprimé.
  // En absence de scope, l'email ne contient que le bloc purpose principal.
  // Pas de spéculation sur des services non confirmés.

  // --- Case reference ---
  if (caseRef) {
    lines.push("");
    lines.push(`Référence dossier : ${caseRef}`);
  }

  // --- Closing ---
  lines.push("");
  lines.push("Bien cordialement,");
  lines.push("L'équipe transit — SODATRA");

  return lines.join("\n");
}
