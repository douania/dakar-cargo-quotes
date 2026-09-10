/**
 * IMO-STORAGE-1 — Ligne d'information « séjour au terminal » pour un conteneur
 * de marchandise dangereuse.
 *
 * Problème traité : le moteur annonce aujourd'hui la franchise magasinage
 * standard (15 jours en FCL au barème PAD, 10 au barème DP World). Pour un
 * conteneur IMO, cette annonce est fausse et coûteuse : la procédure DP World
 * impose la livraison directe sous palan (aucun séjour) ou 3 jours maximum.
 * Un client qui se croit couvert 15 jours découvre la pénalité au 4e.
 *
 * Ce module ne facture RIEN. Le montant est nul et la ligne est informative :
 * aucun tarif de dépassement propre aux conteneurs IMO n'est documenté dans
 * l'Annexe 1. Inventer un montant serait pire que ne rien annoncer.
 *
 * Il ne touche pas non plus aux surestaries : celles-ci relèvent du barème de
 * l'armateur (`demurrage_rates`), pas du terminal, et aucune source ne lie les
 * deux.
 *
 * Module pur : aucune I/O.
 */

import type { ImoTerminalResolution } from "./imo-terminal-rules.ts";

/** Clé de service de la ligne produite. Réservée côté `fee_lines`. */
export const IMO_STORAGE_SERVICE_KEY = "IMO_TERMINAL_STORAGE_REGIME";

export interface ImoStorageNotice {
  serviceKey: string;
  label: string;
  description: string;
  /** Toujours 0 : ligne informative, aucun tarif de dépassement documenté. */
  amount: number;
  /** `OFFICIAL` quand la procédure tranche, `TO_CONFIRM` sinon. */
  sourceType: "OFFICIAL" | "TO_CONFIRM";
  sourceReference: string;
  notes: string;
  /** Vrai quand le conteneur ne peut pas être traité au terminal. */
  blocking: boolean;
}

const SOURCE_REFERENCE =
  "ANNEXE 1 — Procédure de gestion des conteneurs IMO, version 4.0 (QHSSE, DP World Dakar)";

/**
 * Compose la ligne à partir de la résolution des règles terminal.
 *
 * @param resolution sortie de `resolveImoTerminalRule`
 * @param standardFreeDays franchise magasinage annoncée par ailleurs sur le
 *   dossier, quand elle est connue. Sert uniquement à avertir de l'écart ;
 *   elle n'est jamais utilisée pour calculer quoi que ce soit.
 */
export function buildImoStorageNotice(
  resolution: ImoTerminalResolution,
  standardFreeDays?: number | null,
): ImoStorageNotice {
  const base: Pick<ImoStorageNotice, "serviceKey" | "amount"> = {
    serviceKey: IMO_STORAGE_SERVICE_KEY,
    amount: 0,
  };

  if (resolution.status === "FORBIDDEN") {
    return {
      ...base,
      label: "Marchandise interdite au terminal à conteneurs",
      description:
        `${resolution.message} Le dossier ne peut pas être traité en l'état : ` +
        "une solution alternative doit être trouvée avec l'armateur et le port.",
      sourceType: "OFFICIAL",
      sourceReference: SOURCE_REFERENCE,
      notes: "Blocage réglementaire, pas un coût. Aucun chiffrage de séjour possible.",
      blocking: true,
    };
  }

  if (resolution.status === "TO_CONFIRM") {
    const missing = resolution.missing.includes("UN_NUMBER")
      ? "Renseignez le numéro ONU du dossier."
      : resolution.missing.includes("IMO_CLASS")
      ? "Renseignez la classe IMDG du dossier."
      : "À confirmer auprès du terminal.";

    return {
      ...base,
      label: "Séjour au terminal (conteneur IMO) — à confirmer",
      description: `${resolution.message} ${missing}`,
      sourceType: "TO_CONFIRM",
      sourceReference: SOURCE_REFERENCE,
      notes:
        "Tant que le régime n'est pas établi, ne pas se fier à la franchise magasinage standard : " +
        "elle ne s'applique pas aux conteneurs de marchandises dangereuses.",
      blocking: false,
    };
  }

  const days = resolution.storageMaxDays;
  const transshipment = resolution.transshipmentMaxDays;

  const headline = resolution.storageRegime === "UNDER_TACKLE"
    ? "Livraison directe sous palan — aucun séjour au terminal"
    : `Séjour au terminal limité à ${days} jour${(days ?? 0) > 1 ? "s" : ""}`;

  const details: string[] = [resolution.message];

  if (typeof standardFreeDays === "number" && standardFreeDays > (days ?? 0)) {
    details.push(
      `La franchise magasinage de ${standardFreeDays} jours annoncée par ailleurs ne s'applique PAS à ce conteneur : ` +
        `la procédure IMO du terminal prime et limite le séjour à ${days ?? 0} jour${(days ?? 0) > 1 ? "s" : ""}.`,
    );
  }

  if (transshipment === 0) {
    details.push("Le transbordement de cette marchandise n'est pas autorisé au terminal.");
  }

  return {
    ...base,
    label: `Séjour au terminal (conteneur IMO) — ${headline}`,
    description: details.join(" "),
    sourceType: "OFFICIAL",
    sourceReference: SOURCE_REFERENCE,
    notes:
      "Ligne informative, sans montant : la procédure fixe une contrainte de délai, " +
      "aucun tarif de dépassement propre aux conteneurs IMO n'y est publié. " +
      "Les surestaries restent celles du barème de l'armateur.",
    blocking: false,
  };
}
