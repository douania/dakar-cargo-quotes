/**
 * COCKPIT-10 — Génération déterministe d'email partenaire professionnel.
 * Logique identique à src/lib/partnerEmailTemplate.ts.
 * Les deux fichiers DOIVENT rester synchronisés en structure, ordre de blocs,
 * et variations par purpose.
 */

export interface PartnerEmailFacts {
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

export function buildPartnerEmailBody(
  facts: PartnerEmailFacts,
  _partnerName: string,
  purpose: string,
  caseRef?: string,
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

  const includes = PURPOSE_INCLUDES[purpose] ?? PURPOSE_INCLUDES.general;
  lines.push("");
  lines.push("Merci d'inclure dans votre offre :");
  for (const item of includes) {
    lines.push(`- ${item}`);
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
