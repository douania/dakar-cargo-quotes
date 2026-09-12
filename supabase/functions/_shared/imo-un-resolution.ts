/** IMO-UN-AUTO — résolution pure commune à la saisie et au pricing.
 * Aucun fait client écrit : le résultat dérivé garde sa propre provenance.
 * Les consommateurs utilisent imo-pricing-facts pour contrôler les contradictions.
 */
import { normalizeImdgClass, normalizeUnNumber, type ImdgClass } from "./imo-classification.ts";
import { IMDG_UN_NUMBERS_BY_CLASS, IMDG_UN_REFERENCE } from "./imo-un-reference.ts";

const unClasses = new Map<string, string>();
for (const [classification, numbers] of Object.entries(IMDG_UN_NUMBERS_BY_CLASS)) {
  for (const number of numbers.split(" ")) {
    if (unClasses.has(number)) throw new Error(`Référentiel IMDG : numéro ONU dupliqué ${number}`);
    unClasses.set(number, classification);
  }
}

export interface ImoUnResolution {
  status: "DERIVED" | "CONFIRMED" | "DECLARED" | "MISSING" | "UNKNOWN_UN" | "NEEDS_DIVISION" | "CONFLICT" | "INVALID";
  unNumber: string | null;
  imdgClass: ImdgClass | null;
  /** Classe brute BAM, y compris le groupe de compatibilité explosif. */
  referenceClass: string | null;
  source: typeof IMDG_UN_REFERENCE | null;
  message: string;
}

function isPresent(raw: unknown): boolean {
  return raw != null && !(typeof raw === "string" && raw.trim() === "");
}

/**
 * Une classe principale est déduite uniquement d'une entrée BAM précise.
 * Une classe déclarée contradictoire n'est jamais remplacée silencieusement.
 * UN0190 (classe 1), UN1950 et UN2037 (classe 2) exigent une division déclarée.
 * La classe 9A est une étiquette, pas une classe à créer dans le modèle.
 * L'absence du numéro dans cette édition ne prouve pas qu'il n'existe pas.
 */
export function resolveImoFromUn(unRaw: unknown, declaredClassRaw?: unknown): ImoUnResolution {
  const unNumber = normalizeUnNumber(unRaw);
  const declaredClass = normalizeImdgClass(declaredClassRaw);
  const base = { unNumber, imdgClass: null, referenceClass: null, source: null };

  if ((isPresent(unRaw) && !unNumber) || (isPresent(declaredClassRaw) && !declaredClass)) {
    return { ...base, status: "INVALID", message: "Numéro ONU ou classe IMDG au format invalide." };
  }
  if (!unNumber) {
    return declaredClass
      ? { ...base, status: "DECLARED", imdgClass: declaredClass, message: `Classe IMDG ${declaredClass} déclarée ; numéro ONU absent.` }
      : { ...base, status: "MISSING", message: "Numéro ONU et classe IMDG absents." };
  }
  const referenceClass = unClasses.get(unNumber.slice(2));
  if (!referenceClass) {
    return { ...base, status: "UNKNOWN_UN", imdgClass: declaredClass,
      message: `${unNumber} absent du référentiel IMDG ${IMDG_UN_REFERENCE.amendment} ; aucune classe déduite.` };
  }
  const sourced = { ...base, referenceClass, source: IMDG_UN_REFERENCE };
  // La division suffit au modèle existant ; conserver la lettre dans la preuve.
  const inferredClass = normalizeImdgClass(referenceClass.replace(/^(1\.[1-6])[A-Z]$/, "$1"));
  if (!inferredClass) {
    if (declaredClass && declaredClass.startsWith(`${referenceClass}.`)) {
      return { ...sourced, status: "DECLARED", imdgClass: declaredClass,
        message: `${unNumber} : classe générale ${referenceClass} au référentiel ; division ${declaredClass} déclarée, non déduite.` };
    }
    return { ...sourced, status: declaredClass ? "CONFLICT" : "NEEDS_DIVISION",
      message: `${unNumber} relève de la classe ${referenceClass} ; une division compatible doit être précisée.` };
  }
  if (declaredClass && declaredClass !== inferredClass) {
    return { ...sourced, status: "CONFLICT",
      message: `${unNumber} correspond à la classe IMDG ${inferredClass} (${IMDG_UN_REFERENCE.source}), mais la classe ${declaredClass} est déclarée.` };
  }
  return { ...sourced, status: declaredClass ? "CONFIRMED" : "DERIVED", imdgClass: inferredClass,
    message: `${unNumber} → classe IMDG ${inferredClass} — ${IMDG_UN_REFERENCE.source}.` };
}
