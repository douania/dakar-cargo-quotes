/** IMO-UN-AUTO : projection en lecture seule, partagée UI / honoraires / pricing. */
import { IMO_CLASS_FACT_KEY, UN_NUMBER_FACT_KEY } from "./imo-classification.ts";
import { DANGEROUS_GOODS_FACT_KEY, normalizeDangerousGoodsFactValue, resolveDangerousGoods } from "./dangerous-goods.ts";
import { resolveImoFromUn } from "./imo-un-resolution.ts";

export interface ImoFact {
  fact_key: string;
  value_text?: unknown;
}

export const IMO_CLASSIFICATION_CONFLICT = "IMO_CLASSIFICATION_CONFLICT";
export const IMO_CLASSIFICATION_REQUIRED = "IMO_CLASSIFICATION_REQUIRED";
export const IMO_LOT_CLASSIFICATION_REQUIRED = "IMO_LOT_CLASSIFICATION_REQUIRED";
const IMO_KEYS = new Set([UN_NUMBER_FACT_KEY, IMO_CLASS_FACT_KEY, DANGEROUS_GOODS_FACT_KEY]);

export function resolveImoPricingFacts(facts: readonly ImoFact[]) {
  const byKey = new Map(facts.map(f => [f.fact_key, f.value_text]));
  const classification = resolveImoFromUn(byKey.get(UN_NUMBER_FACT_KEY), byKey.get(IMO_CLASS_FACT_KEY));
  const blockers: string[] = [];
  let message = classification.message;
  if (classification.status === "CONFLICT") blockers.push(IMO_CLASSIFICATION_CONFLICT);
  if (classification.status === "INVALID" || classification.status === "NEEDS_DIVISION" ||
      (classification.status === "UNKNOWN_UN" && !classification.imdgClass)) {
    blockers.push(IMO_CLASSIFICATION_REQUIRED);
  }
  // Ne pas laisser le fait NO neutraliser un ONU reconnu par le référentiel.
  // Hors ONU, conserver la précédence DG-1 existante (pas de changement de doctrine).
  if (classification.referenceClass && normalizeDangerousGoodsFactValue(byKey.get(DANGEROUS_GOODS_FACT_KEY)) === "NO") {
    blockers.push(IMO_CLASSIFICATION_CONFLICT);
    message += " Le numéro ONU désigne une marchandise dangereuse, mais le dossier indique « non dangereuse ».";
  }
  const dangerousGoods = blockers.length ? null : resolveDangerousGoods(
    byKey.get(DANGEROUS_GOODS_FACT_KEY), byKey.get("pricing.dthc_family"), classification.imdgClass,
  ).dangerous;
  return { classification, dangerousGoods, blockers: [...new Set(blockers)], message };
}

/**
 * Dès qu'un ONU intervient, le triplet ONU/classe/danger doit porter sur le lot.
 * Un ONU global ne peut pas être attribué à chacun des lots par défaut.
 * Les autres faits et la fusion historique des dossiers sans ONU sont préservés.
 */
export function scopeImoFactsForLot<T extends ImoFact>(mergedFacts: readonly T[], lotFacts: readonly { key?: unknown; value?: unknown }[]) {
  const present = (v: unknown) => v != null && String(v).trim() !== "";
  const hasUn = mergedFacts.some(f => f.fact_key === UN_NUMBER_FACT_KEY && present(f.value_text));
  if (!hasUn) return { facts: [...mergedFacts], blockers: [] as string[] };
  const localKeys = new Set(lotFacts.filter(f => typeof f.key === "string" && present(f.value)).map(f => f.key));
  const localDg = lotFacts.find(f => f.key === DANGEROUS_GOODS_FACT_KEY)?.value;
  const hasLocalClassification = localKeys.has(UN_NUMBER_FACT_KEY) || localKeys.has(IMO_CLASS_FACT_KEY) ||
    normalizeDangerousGoodsFactValue(localDg) === "NO";
  return {
    facts: mergedFacts.filter(f => !IMO_KEYS.has(f.fact_key) || localKeys.has(f.fact_key)),
    blockers: hasLocalClassification ? [] : [IMO_LOT_CLASSIFICATION_REQUIRED],
  };
}
