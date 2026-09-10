/**
 * IMO-RULES-1 — Résolveur des règles terminal DP World pour conteneurs IMO.
 *
 * Répond à : « ce conteneur, de cette classe IMDG et de ce numéro ONU, combien
 * de jours peut-il séjourner au terminal, et à quelles conditions ? »
 *
 * Enjeu : le séjour standard de 15 jours ne s'applique pas aux conteneurs IMO.
 * Selon la matière, c'est la livraison sous palan (aucun séjour) ou 3 jours.
 * Se tromper, c'est facturer ou omettre des surestaries.
 *
 * Doctrine encodée ici :
 *   * une règle visant explicitement le numéro ONU prime sur « les autres »,
 *     qui prime sur une règle valant pour toute la classe ;
 *   * classe connue mais numéro ONU inconnu, alors que la classe distingue ses
 *     numéros : AUCUNE règle n'est retenue, la donnée manquante est nommée. On
 *     ne choisit pas « au hasard » entre sous palan et 3 jours ;
 *   * deux règles explicites contradictoires (chevauchements connus du document
 *     en classes 4.1 et 5.2) : la PLUS RESTRICTIVE est retenue et le conflit est
 *     signalé, jamais tranché en silence ;
 *   * régime non précisé au document : « à confirmer », jamais un repli
 *     implicite sur la franchise standard.
 *
 * Module pur : aucune I/O, les règles sont fournies par l'appelant.
 */

import { normalizeImdgClass, normalizeUnNumber } from "./imo-classification.ts";

export type ImoStorageRegime = "UNDER_TACKLE" | "MAX_3_DAYS" | "NOT_SPECIFIED";
export type ImoUnScope = "ALL" | "LIST" | "OTHERS";
export type ImoPadApproval = "YES" | "NO" | "FORBIDDEN";

/** Ligne de `imo_terminal_rules` telle que lue en base. */
export interface ImoTerminalRuleRow {
  id?: string;
  imdg_class: string;
  un_scope: ImoUnScope | string;
  un_numbers?: ReadonlyArray<number> | null;
  pad_prior_approval?: ImoPadApproval | string | null;
  firefighter_supervision?: boolean | null;
  storage_regime: ImoStorageRegime | string;
  storage_max_days?: number | null;
  transshipment_max_days?: number | null;
  loading_gate_in_hours_before_vessel?: number | null;
  source_reference?: string | null;
  notes?: string | null;
}

export type ImoResolutionStatus = "RESOLVED" | "TO_CONFIRM" | "FORBIDDEN";

export type ImoMissingFact = "IMO_CLASS" | "UN_NUMBER";

export interface ImoTerminalResolution {
  status: ImoResolutionStatus;
  /** Règle retenue, `null` si aucune ne peut l'être. */
  rule: ImoTerminalRuleRow | null;
  storageRegime: ImoStorageRegime | null;
  /** Jours de séjour au chargement et déchargement, `null` si non établi. */
  storageMaxDays: number | null;
  /** Jours en transbordement ; 0 signifie transbordement non autorisé. */
  transshipmentMaxDays: number | null;
  padPriorApproval: ImoPadApproval | null;
  firefighterSupervision: boolean | null;
  /** Faits du dossier qui manquent pour trancher. */
  missing: ImoMissingFact[];
  /** Vrai quand le document lui-même se contredit sur ce numéro. */
  conflicting: boolean;
  /** Phrase française expliquant la réponse. */
  message: string;
}

/** Du plus restrictif au moins restrictif. */
const REGIME_SEVERITY: Readonly<Record<ImoStorageRegime, number>> = {
  UNDER_TACKLE: 3,
  MAX_3_DAYS: 2,
  NOT_SPECIFIED: 1,
};

function normalizeRegime(raw: unknown): ImoStorageRegime {
  return raw === "UNDER_TACKLE" || raw === "MAX_3_DAYS" ? raw : "NOT_SPECIFIED";
}

function normalizePad(raw: unknown): ImoPadApproval | null {
  return raw === "YES" || raw === "NO" || raw === "FORBIDDEN" ? raw : null;
}

/** Numéro ONU sous forme entière, ou `null` si non exploitable. */
function unNumberAsInt(raw: unknown): number | null {
  const canonical = normalizeUnNumber(raw);
  return canonical ? Number(canonical.slice(2)) : null;
}

/**
 * Classe telle qu'écrite dans une RÈGLE. La procédure exprime certaines règles
 * au niveau de la classe entière (« 1 — Explosifs, pour tous les numéros NU »)
 * et d'autres au niveau de la division (« 2.1 — Gaz inflammables »). Une classe
 * nue est donc légitime ici, alors qu'elle ne l'est pas pour décrire la
 * marchandise d'un dossier.
 */
function normalizeRuleClass(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(",", ".");
  return /^[1-9](\.[1-6])?$/.test(cleaned) ? cleaned : null;
}

/**
 * Une règle vise-t-elle la classe du dossier ? Une règle écrite au niveau de la
 * classe couvre toutes ses divisions : la règle « 1 » s'applique à un conteneur
 * de classe 1.4. L'inverse est faux — la règle « 2.1 » ne dit rien de 2.2.
 */
function ruleAppliesToClass(ruleClass: unknown, caseClass: string): boolean {
  const rule = normalizeRuleClass(ruleClass);
  if (!rule) return false;
  return rule === caseClass || caseClass.startsWith(`${rule}.`);
}

function describeRegime(regime: ImoStorageRegime): string {
  switch (regime) {
    case "UNDER_TACKLE":
      return "livraison directe sous palan au déchargement, entrée au terminal 12 h avant l'arrivée du navire au chargement, transbordement non autorisé";
    case "MAX_3_DAYS":
      return "3 jours maximum au chargement et au déchargement, 7 jours maximum en transbordement";
    default:
      return "régime de séjour non précisé par la procédure";
  }
}

/**
 * Règle applicable à un conteneur.
 *
 * @param rules lignes actives de `imo_terminal_rules`
 * @param imdgClass fait `cargo.imo_class` (texte brut)
 * @param unNumber fait `cargo.un_number` (texte brut), facultatif
 */
export function resolveImoTerminalRule(
  rules: ReadonlyArray<ImoTerminalRuleRow>,
  imdgClass: unknown,
  unNumber?: unknown,
): ImoTerminalResolution {
  const cls = normalizeImdgClass(imdgClass);

  if (!cls) {
    return {
      status: "TO_CONFIRM",
      rule: null,
      storageRegime: null,
      storageMaxDays: null,
      transshipmentMaxDays: null,
      padPriorApproval: null,
      firefighterSupervision: null,
      missing: ["IMO_CLASS"],
      conflicting: false,
      message:
        "Classe IMDG absente ou non reconnue : le régime de séjour au terminal ne peut pas être établi.",
    };
  }

  const classRules = rules.filter((r) => ruleAppliesToClass(r.imdg_class, cls));

  if (classRules.length === 0) {
    return {
      status: "TO_CONFIRM",
      rule: null,
      storageRegime: null,
      storageMaxDays: null,
      transshipmentMaxDays: null,
      padPriorApproval: null,
      firefighterSupervision: null,
      missing: [],
      conflicting: false,
      message: `Aucune règle terminal connue pour la classe IMDG ${cls}.`,
    };
  }

  // Une classe interdite l'est quel que soit le numéro ONU.
  const forbidden = classRules.find((r) => normalizePad(r.pad_prior_approval) === "FORBIDDEN");
  if (forbidden) {
    return {
      status: "FORBIDDEN",
      rule: forbidden,
      storageRegime: null,
      storageMaxDays: null,
      transshipmentMaxDays: null,
      padPriorApproval: "FORBIDDEN",
      firefighterSupervision: forbidden.firefighter_supervision ?? null,
      missing: [],
      conflicting: false,
      message: `Classe IMDG ${cls} interdite au terminal à conteneurs de Dakar : le conteneur ne peut pas y être traité.`,
    };
  }

  // Classe traitée d'un bloc : le numéro ONU n'apporte rien.
  const allRule = classRules.find((r) => r.un_scope === "ALL");
  if (allRule) {
    return buildResolution(allRule, cls, false, []);
  }

  // La classe distingue ses numéros : il faut donc le numéro ONU du dossier.
  const un = unNumberAsInt(unNumber);
  if (un === null) {
    return {
      status: "TO_CONFIRM",
      rule: null,
      storageRegime: null,
      storageMaxDays: null,
      transshipmentMaxDays: null,
      padPriorApproval: null,
      firefighterSupervision: null,
      missing: ["UN_NUMBER"],
      conflicting: false,
      message:
        `La classe IMDG ${cls} applique des régimes différents selon le numéro ONU. ` +
        "Renseignez le numéro ONU du dossier pour déterminer le séjour autorisé.",
    };
  }

  const matching = classRules.filter(
    (r) => r.un_scope === "LIST" && (r.un_numbers ?? []).includes(un),
  );

  if (matching.length === 1) {
    return buildResolution(matching[0], cls, false, []);
  }

  if (matching.length > 1) {
    // Chevauchement connu du document : on retient la plus restrictive et on le dit.
    const strictest = [...matching].sort(
      (a, b) =>
        REGIME_SEVERITY[normalizeRegime(b.storage_regime)] -
        REGIME_SEVERITY[normalizeRegime(a.storage_regime)],
    )[0];
    return buildResolution(strictest, cls, true, []);
  }

  const others = classRules.find((r) => r.un_scope === "OTHERS");
  if (others) {
    return buildResolution(others, cls, false, []);
  }

  return {
    status: "TO_CONFIRM",
    rule: null,
    storageRegime: null,
    storageMaxDays: null,
    transshipmentMaxDays: null,
    padPriorApproval: null,
    firefighterSupervision: null,
    missing: [],
    conflicting: false,
    message: `Aucune règle de la classe IMDG ${cls} ne vise le numéro ONU UN${String(un).padStart(4, "0")}.`,
  };
}

function buildResolution(
  rule: ImoTerminalRuleRow,
  cls: string,
  conflicting: boolean,
  missing: ImoMissingFact[],
): ImoTerminalResolution {
  const regime = normalizeRegime(rule.storage_regime);
  const pad = normalizePad(rule.pad_prior_approval);

  const parts: string[] = [`Classe IMDG ${cls} : ${describeRegime(regime)}.`];

  if (pad === "YES") parts.push("Accord préalable du Port Autonome de Dakar requis.");
  else if (pad === "NO") parts.push("Aucun accord préalable du Port Autonome de Dakar requis.");
  else parts.push("Accord préalable du Port Autonome de Dakar non précisé par la procédure.");

  if (rule.firefighter_supervision === true) parts.push("Surveillance des sapeurs-pompiers requise.");
  else if (rule.firefighter_supervision === false) parts.push("Pas de surveillance des sapeurs-pompiers requise.");

  if (conflicting) {
    parts.push(
      "ATTENTION : la procédure prévoit deux régimes différents pour ce numéro ONU. Le plus restrictif est retenu ; faites confirmer par le terminal.",
    );
  }

  return {
    status: regime === "NOT_SPECIFIED" ? "TO_CONFIRM" : "RESOLVED",
    rule,
    storageRegime: regime,
    storageMaxDays: rule.storage_max_days ?? null,
    transshipmentMaxDays: rule.transshipment_max_days ?? null,
    padPriorApproval: pad,
    firefighterSupervision: rule.firefighter_supervision ?? null,
    missing,
    conflicting,
    message: parts.join(" "),
  };
}
