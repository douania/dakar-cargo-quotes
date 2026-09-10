/**
 * IMO-RULES-1 (partie normative) — classe IMDG et numéro ONU d'un dossier.
 *
 * Complète DG-1 : le fait `cargo.dangerous_goods` dit SI la marchandise est
 * dangereuse, ces deux faits disent LAQUELLE. Ils conditionnent la
 * documentation exigée par le terminal (déclaration IMO, FDS), la ségrégation,
 * et — dès que la table de référence DP World sera fournie — le mode de séjour
 * et la franchise applicables.
 *
 * Source : nomenclature IMDG de l'Organisation maritime internationale, norme
 * publique et stable (classes 1 à 9 et leurs divisions). Aucune valeur
 * commerciale n'est encodée ici : les surcharges, franchises et modes de séjour
 * relèvent de la table de référence DP World, qui n'est pas dans ce module.
 *
 * Le numéro ONU est validé sur son FORMAT seulement (UN suivi de quatre
 * chiffres). Ce module ne prétend pas connaître la liste officielle des numéros
 * attribués : il refuse ce qui n'est manifestement pas un numéro ONU, il ne
 * certifie pas qu'un numéro bien formé existe.
 *
 * Module pur : aucune I/O.
 */

/** Clés des faits canoniques. */
export const IMO_CLASS_FACT_KEY = "cargo.imo_class";
export const UN_NUMBER_FACT_KEY = "cargo.un_number";

/**
 * Classes et divisions IMDG. Une division est indissociable de sa classe :
 * la classe 1 sans division ne suffit pas à décrire un explosif, alors que les
 * classes 3, 7, 8 et 9 n'ont pas de division.
 */
export const IMDG_CLASSES = [
  "1.1", "1.2", "1.3", "1.4", "1.5", "1.6",
  "2.1", "2.2", "2.3",
  "3",
  "4.1", "4.2", "4.3",
  "5.1", "5.2",
  "6.1", "6.2",
  "7",
  "8",
  "9",
] as const;

export type ImdgClass = (typeof IMDG_CLASSES)[number];

/** Libellés français officiels, pour l'affichage et les explications. */
export const IMDG_CLASS_LABELS_FR: Readonly<Record<ImdgClass, string>> = {
  "1.1": "Explosifs — risque d'explosion en masse",
  "1.2": "Explosifs — risque de projection",
  "1.3": "Explosifs — risque d'incendie",
  "1.4": "Explosifs — risque faible",
  "1.5": "Explosifs — matières très peu sensibles",
  "1.6": "Explosifs — objets extrêmement peu sensibles",
  "2.1": "Gaz inflammables",
  "2.2": "Gaz non inflammables, non toxiques",
  "2.3": "Gaz toxiques",
  "3": "Liquides inflammables",
  "4.1": "Matières solides inflammables",
  "4.2": "Matières sujettes à inflammation spontanée",
  "4.3": "Matières dégageant des gaz inflammables au contact de l'eau",
  "5.1": "Matières comburantes",
  "5.2": "Peroxydes organiques",
  "6.1": "Matières toxiques",
  "6.2": "Matières infectieuses",
  "7": "Matières radioactives",
  "8": "Matières corrosives",
  "9": "Matières et objets dangereux divers",
};

/**
 * Normalise une classe IMDG saisie. Accepte les écritures usuelles
 * (« 1.4 », « classe 3 », « IMDG 6.1 », « 6,1 »), refuse tout le reste.
 * Une classe à divisions saisie sans division est refusée : « 4 » ne désigne
 * aucune classe utilisable, il faut 4.1, 4.2 ou 4.3.
 */
export function normalizeImdgClass(raw: unknown): ImdgClass | null {
  if (typeof raw !== "string") return null;

  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/^(IMDG|IMO|CLASSE|CLASS)\s*/g, "")
    .replace(",", ".")
    .replace(/\s+/g, "");

  if (cleaned === "") return null;

  return (IMDG_CLASSES as readonly string[]).includes(cleaned)
    ? (cleaned as ImdgClass)
    : null;
}

/**
 * Normalise un numéro ONU saisi. Accepte « UN1203 », « un 1203 », « 1203 » ;
 * renvoie toujours la forme canonique `UN1203`. Refuse ce qui n'a pas quatre
 * chiffres, ainsi que « UN0000 » qui n'est attribué à aucune matière.
 */
export function normalizeUnNumber(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;

  const cleaned = String(raw).trim().toUpperCase().replace(/^UN\s*/, "").replace(/\s+/g, "");

  if (!/^\d{4}$/.test(cleaned)) return null;
  if (cleaned === "0000") return null;

  return `UN${cleaned}`;
}

/** Libellé français d'une classe, ou `null` si la classe n'est pas reconnue. */
export function describeImdgClass(raw: unknown): string | null {
  const cls = normalizeImdgClass(raw);
  return cls ? IMDG_CLASS_LABELS_FR[cls] : null;
}
