/**
 * COCKPIT-10 — Génération déterministe d'email partenaire professionnel.
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
    "Taux de fret",
    "Transit time",
    "Free days",
    "Validité de l'offre",
  ],
  origin_charges: [
    "Frais d'origine détaillés",
    "THC / manutention / documentation si applicable",
    "Validité",
    "Conditions locales",
  ],
  air_tariff: [
    "Tarif aérien",
    "Transit time",
    "Poids taxable / base de calcul",
    "Validité de l'offre",
  ],
  freight_maritime: [
    "Taux de fret",
    "Transit time",
    "Free days",
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

function resolveOrigin(facts: PartnerEmailFacts): string | null {
  return facts["routing.origin_port"] || facts["routing.origin_country"] || null;
}

function resolveDestination(facts: PartnerEmailFacts): string | null {
  const port = facts["routing.destination_port"];
  const city = facts["routing.destination_city"];
  const finalDest = facts["routing.final_destination"];
  const country = facts["routing.destination_country"];

  // If we have both port and final_destination and they differ → ambiguity
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

/**
 * COCKPIT-11B — scope-aware partner email generation.
 * @param scope  Optional detected scope items. When provided with >1 block,
 *               secondary blocks are aggregated as "Merci également de préciser".
 */
export function buildPartnerEmailBody(
  facts: PartnerEmailFacts,
  partnerName: string,
  purpose: string,
  caseRef?: string,
  scope?: Array<{ purpose: string; label: string; requiredItems: string[] }>,
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

  // --- Primary request block (purpose principal) ---
  const primaryItems = PURPOSE_INCLUDES[purpose] ?? PURPOSE_INCLUDES.general;
  lines.push("");
  lines.push("Merci d'inclure dans votre offre :");
  for (const item of primaryItems) {
    lines.push(`- ${item}`);
  }

  // --- COCKPIT-11B: Secondary blocks from scope (aggregated, deduplicated) ---
  const secondaryBlocks = (scope ?? []).filter((s) => s.purpose !== purpose);
  if (secondaryBlocks.length > 0) {
    const alreadyIncluded = new Set(primaryItems.map((i) => i.toLowerCase()));
    const extraItems: string[] = [];
    for (const block of secondaryBlocks) {
      for (const item of block.requiredItems) {
        const key = item.toLowerCase();
        if (!alreadyIncluded.has(key)) {
          alreadyIncluded.add(key);
          extraItems.push(item);
        }
      }
    }
    if (extraItems.length > 0) {
      lines.push("");
      lines.push("Merci également de préciser, si applicable :");
      for (const item of extraItems) {
        lines.push(`- ${item}`);
      }
    }
  }

  // --- COCKPIT-11B: Prudent fallback when scope is empty ---
  if ((!scope || scope.length === 0) && (purpose === "freight_rate" || purpose === "freight_maritime")) {
    const fallbackItems = [
      "Frais d'origine / THC si applicable",
      "Surcharges éventuelles",
      "Vessel schedule disponible",
    ];
    const alreadyInPrimary = new Set(primaryItems.map((i) => i.toLowerCase()));
    const newFallback = fallbackItems.filter((f) => !alreadyInPrimary.has(f.toLowerCase()));
    if (newFallback.length > 0) {
      lines.push("");
      lines.push("Merci également de préciser, si applicable :");
      for (const item of newFallback) {
        lines.push(`- ${item}`);
      }
    }
  }

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
