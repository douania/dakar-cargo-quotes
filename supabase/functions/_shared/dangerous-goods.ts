/**
 * DG-1 — Fait canonique « marchandise dangereuse ».
 *
 * Pourquoi ce fait : le modèle d'honoraires H2-a permet de conditionner une
 * règle au caractère dangereux de la marchandise (`fee_rules.dangerous_goods`),
 * mais aucun fait ne portait cette information : toute règle ainsi conditionnée
 * restait « à confirmer », faute de pouvoir être évaluée. Le programme IMO à
 * venir (franchises de séjour, documentation, transport routier HSSE) repose sur
 * la même information.
 *
 * Portée : ce lot crée le fait métier, rien d'autre. La classe IMDG et le numéro
 * ONU relèvent du lot IMO-RULES-1, non engagé à ce jour.
 *
 * Doctrine encodée ici :
 *   * valeur texte canonique stricte (`YES` / `NO`), jamais un booléen implicite
 *     ni une valeur numérique — même patron que `pricing.dthc_family` (DTHC-2)
 *     et `routing.terminal_operation_mode` (TERMINAL-GAP) ;
 *   * fait absent ⇒ INCONNU, jamais « non dangereux » : une règle conditionnée
 *     reste « à confirmer » plutôt que de produire un montant faux ;
 *   * repli SÛR ET UNIDIRECTIONNEL depuis la famille tarifaire DP World : une
 *     famille `DANGEROUS` est une déclaration explicite de l'opérateur que la
 *     marchandise est dangereuse, donc elle vaut « oui ». L'inverse n'est PAS
 *     vrai : une autre famille ne prouve pas l'absence de danger (elle peut ne
 *     concerner que la manutention conteneur), et laisse donc le fait inconnu.
 *
 * Module pur : aucune I/O.
 */

import { normalizeDpwDthcFamily } from "./dpw-dthc-tariff.ts";
import { normalizeImdgClass } from "./imo-classification.ts";

/** Clé du fait canonique. */
export const DANGEROUS_GOODS_FACT_KEY = "cargo.dangerous_goods";

/** Valeurs canoniques admises pour le fait. */
export const DANGEROUS_GOODS_VALUES = ["YES", "NO"] as const;

export type DangerousGoodsValue = (typeof DANGEROUS_GOODS_VALUES)[number];

/** Origine de la réponse, pour l'explication rendue à l'opérateur. */
export type DangerousGoodsOrigin = "FACT" | "IMO_CLASS" | "DTHC_FAMILY" | "UNKNOWN";

export interface DangerousGoodsResolution {
  /** `true` / `false` si l'information est établie, `null` si inconnue. */
  dangerous: boolean | null;
  origin: DangerousGoodsOrigin;
  /** Phrase française expliquant d'où vient la réponse. */
  message: string;
}

/**
 * Normalise une valeur écrite pour le fait. Accepte les formes courantes
 * saisies par un opérateur ou remontées d'un document, refuse tout le reste.
 * Retourne `null` si la valeur n'est pas interprétable — l'appelant refuse
 * alors l'écriture plutôt que d'inscrire une valeur douteuse.
 */
export function normalizeDangerousGoodsFactValue(raw: unknown): DangerousGoodsValue | null {
  if (typeof raw !== "string") return null;
  const upper = raw.trim().toUpperCase();
  if (upper === "") return null;

  if (upper === "YES" || upper === "OUI" || upper === "TRUE" || upper === "1") return "YES";
  if (upper === "NO" || upper === "NON" || upper === "FALSE" || upper === "0") return "NO";

  return null;
}

/**
 * Détermine le caractère dangereux d'un dossier à partir du fait explicite et,
 * à défaut, de la classe IMDG puis de la famille tarifaire DP World.
 *
 * @param factValue valeur du fait `cargo.dangerous_goods` (texte brut en base)
 * @param dthcFamily valeur du fait `pricing.dthc_family` (texte brut en base)
 * @param imoClass valeur du fait `cargo.imo_class` (texte brut en base)
 */
export function resolveDangerousGoods(
  factValue: unknown,
  dthcFamily?: unknown,
  imoClass?: unknown,
): DangerousGoodsResolution {
  const normalized = normalizeDangerousGoodsFactValue(factValue);

  if (normalized === "YES") {
    return {
      dangerous: true,
      origin: "FACT",
      message: "Marchandise déclarée dangereuse sur le dossier.",
    };
  }

  if (normalized === "NO") {
    return {
      dangerous: false,
      origin: "FACT",
      message: "Marchandise déclarée non dangereuse sur le dossier.",
    };
  }

  // Repli unidirectionnel : une classe IMDG renseignée classe la marchandise
  // comme dangereuse — c'est la définition même de la nomenclature. L'absence
  // de classe ne prouve rien en sens inverse.
  const declaredClass = normalizeImdgClass(imoClass);
  if (declaredClass) {
    return {
      dangerous: true,
      origin: "IMO_CLASS",
      message: `Marchandise dangereuse : classe IMDG ${declaredClass} déclarée sur le dossier.`,
    };
  }

  // Repli unidirectionnel : la famille DANGEROUS vaut déclaration de danger.
  if (normalizeDpwDthcFamily(dthcFamily) === "DANGEROUS") {
    return {
      dangerous: true,
      origin: "DTHC_FAMILY",
      message:
        "Marchandise réputée dangereuse : la famille tarifaire DP World du dossier est DANGEROUS. " +
        "Renseignez le fait « marchandise dangereuse » pour lever toute ambiguïté.",
    };
  }

  return {
    dangerous: null,
    origin: "UNKNOWN",
    message:
      "Caractère dangereux de la marchandise inconnu : le fait « marchandise dangereuse » n'est pas renseigné sur ce dossier.",
  };
}

/**
 * DTHC-4-A — Réponse booléenne attendue par `quotation-engine`, qui lit le
 * caractère dangereux sous `isIMO` / `isHazmat` (`:1460` pour le DTHC, `:1626`
 * pour la sûreté des frais armateur).
 *
 * Fail-closed, et c'est tout l'intérêt : seule une marchandise ÉTABLIE
 * dangereuse rend `true`. Un dossier dont le caractère dangereux est inconnu
 * rend `false` — le moteur reste alors sur sa propre inférence (jeton
 * DG/IMO/IMDG dans la désignation, ou famille DTHC fournie par l'opérateur) et
 * ses frais armateur DG restent « à confirmer », ce qui est le comportement
 * voulu tant que le dossier n'est pas déclaré.
 *
 * Les mêmes replis que `resolveDangerousGoods` s'appliquent : classe IMDG
 * déclarée, puis famille tarifaire DANGEROUS.
 */
export function isDangerousForEngine(
  factValue: unknown,
  dthcFamily?: unknown,
  imoClass?: unknown,
): boolean {
  return resolveDangerousGoods(factValue, dthcFamily, imoClass).dangerous === true;
}
