/**
 * H2-b — Résolveur pur des honoraires paramétrables (tables `fee_lines` /
 * `fee_rules`, migration 20260909120000).
 *
 * Doctrine (décisions CTO du 9 septembre 2026) :
 *   * une règle = conditions toutes facultatives et CUMULATIVES ; NULL = indifférent ;
 *   * pour chaque ligne active, il faut EXACTEMENT une règle applicable dans le
 *     scope retenu : zéro règle ⇒ comportement de la ligne (« à confirmer » ou
 *     ligne absente), plusieurs ⇒ conflit « à confirmer » ;
 *   * la règle client (client_code = client du dossier) prime sur la règle
 *     générique ; une règle d'un autre client n'est jamais visible (anti-fuite) ;
 *   * une condition qui ne peut pas être évaluée (fait absent du dossier) ne
 *     vaut ni oui ni non : si aucune règle n'est certaine, la ligne est
 *     « à confirmer » avec la donnée manquante nommée — jamais 0, jamais devinée ;
 *   * tranches [min, max) : borne haute exclusive ; tranche de valeur sur la CAF ;
 *   * par conteneur : montant 20' pour les 20', montant 40' pour les 40' et 45' ;
 *     si la règle vise une famille (sec / frigo / spécial), seules les boîtes de
 *     cette famille sont comptées ;
 *   * par tonne : toute tonne entamée est due ;
 *   * pourcentage : assiette CAF ou valeur marchandise ; assiette absente ⇒ à confirmer ;
 *   * minimum puis maximum, résultat arrondi au franc CFA.
 *
 * Module pur : aucune I/O, aucune horloge implicite (`asOfDate` fourni).
 */

import { resolveContainerProfile } from "./dpw-dthc-tariff.ts";

export type FeeTransportMode = "SEA" | "AIR" | "ROAD";
export type FeeDirection = "IMPORT" | "EXPORT" | "TRANSIT";
export type FeeShipmentType = "FCL" | "LCL" | "BREAKBULK" | "RORO" | "AIR";
export type FeeContainerFamily = "DRY" | "REEFER" | "SPECIAL";
export type FeeMethod = "FIXED" | "PER_CONTAINER" | "PER_TONNE" | "PERCENT_OF_VALUE";
export type FeeValueBasis = "CAF" | "CARGO_VALUE";
export type FeeMissingRuleBehavior = "TO_CONFIRM" | "SKIP";

/** Ligne `fee_lines` telle que lue en base (champs utiles). */
export interface FeeLineRow {
  id: string;
  code: string;
  label_fr: string;
  vat_applicable?: boolean | null;
  missing_rule_behavior?: FeeMissingRuleBehavior | string | null;
  display_order?: number | null;
  is_active?: boolean | null;
}

/** Règle `fee_rules` telle que lue en base (numériques possiblement en texte). */
export interface FeeRuleRow {
  id: string;
  fee_line_id: string;
  label?: string | null;
  transport_mode?: string | null;
  direction?: string | null;
  shipment_type?: string | null;
  customs_regime_code?: string | null;
  container_family?: string | null;
  dangerous_goods?: boolean | null;
  weight_min_kg?: number | string | null;
  weight_max_kg?: number | string | null;
  value_min?: number | string | null;
  value_max?: number | string | null;
  client_code?: string | null;
  method: FeeMethod | string;
  amount?: number | string | null;
  amount_20?: number | string | null;
  amount_40?: number | string | null;
  percent?: number | string | null;
  value_basis?: string | null;
  min_amount?: number | string | null;
  max_amount?: number | string | null;
  currency?: string | null;
  effective_from: string;
  effective_to?: string | null;
  is_active?: boolean | null;
}

/** Contexte du dossier, dérivé des faits par l'appelant. `null` = inconnu. */
export interface FeeCaseContext {
  transportMode: FeeTransportMode | null;
  direction: FeeDirection | null;
  shipmentType: FeeShipmentType | null;
  customsRegimeCode: string | null;
  containers: ReadonlyArray<{ type?: unknown; quantity?: unknown }> | null;
  dangerousGoods: boolean | null;
  weightKg: number | null;
  cafValue: number | null;
  cargoValue: number | null;
  clientCode: string | null;
  /** Date d'évaluation `YYYY-MM-DD`. */
  asOfDate: string;
}

export type FeeToConfirmReason =
  | "NO_APPLICABLE_RULE"
  | "CONFLICTING_RULES"
  | "CONDITION_UNKNOWN"
  | "CONTAINERS_MISSING"
  | "CONTAINER_TYPE_UNSUPPORTED"
  | "WEIGHT_MISSING"
  | "VALUE_BASIS_MISSING"
  | "RULE_INVALID";

export interface FeeLineResolution {
  lineId: string;
  lineCode: string;
  label: string;
  vatApplicable: boolean;
  status: "RESOLVED" | "TO_CONFIRM" | "SKIPPED";
  amount: number | null;
  currency: "XOF";
  ruleId: string | null;
  ruleLabel: string | null;
  clientSpecific: boolean;
  reason: FeeToConfirmReason | null;
  /** Explication FR prête pour la ligne de devis. */
  message: string;
  /** Détail technique du calcul (journal / explication opérateur). */
  detail: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function num(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

function upper(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim().toUpperCase() : null;
}

const formatXof = (n: number): string =>
  `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} XOF`;

type Match = "yes" | "no" | "unknown";

function matchDiscrete(ruleValue: string | null | undefined, ctxValue: string | null): Match {
  const r = upper(ruleValue);
  if (r === null) return "yes";
  if (ctxValue === null) return "unknown";
  return r === ctxValue.toUpperCase() ? "yes" : "no";
}

function matchBoolean(ruleValue: boolean | null | undefined, ctxValue: boolean | null): Match {
  if (ruleValue === null || ruleValue === undefined) return "yes";
  if (ctxValue === null) return "unknown";
  return ruleValue === ctxValue ? "yes" : "no";
}

/** Tranche [min, max) ; bornes NULL = ouvertes. */
function matchRange(min: unknown, max: unknown, ctxValue: number | null): Match {
  const lo = num(min);
  const hi = num(max);
  if (lo === null && hi === null) return "yes";
  if (ctxValue === null) return "unknown";
  if (lo !== null && ctxValue < lo) return "no";
  if (hi !== null && ctxValue >= hi) return "no";
  return "yes";
}

function isRuleInForce(rule: FeeRuleRow, asOf: string): boolean {
  if (rule.is_active === false) return false;
  const from = typeof rule.effective_from === "string" ? rule.effective_from.slice(0, 10) : "";
  if (!ISO_DATE.test(from) || from > asOf) return false;
  const to = typeof rule.effective_to === "string" ? rule.effective_to.slice(0, 10) : null;
  if (to && ISO_DATE.test(to) && to < asOf) return false;
  return true;
}

interface ContainerInventory {
  status: "OK" | "EMPTY" | "UNSUPPORTED";
  /** Par famille : nombre de 20' et de 40'/45'. */
  byFamily: Record<FeeContainerFamily, { c20: number; c40: number }>;
  families: Set<FeeContainerFamily>;
  detail: string;
}

export function inventoryContainers(
  containers: FeeCaseContext["containers"],
): ContainerInventory {
  const byFamily: ContainerInventory["byFamily"] = {
    DRY: { c20: 0, c40: 0 },
    REEFER: { c20: 0, c40: 0 },
    SPECIAL: { c20: 0, c40: 0 },
  };
  const families = new Set<FeeContainerFamily>();
  const list = Array.isArray(containers) ? containers : [];
  if (list.length === 0) return { status: "EMPTY", byFamily, families, detail: "" };
  const parts: string[] = [];
  for (const container of list) {
    const profile = resolveContainerProfile(container?.type);
    const quantity = num(container?.quantity ?? 1);
    if (!profile || quantity === null || quantity <= 0 || !Number.isInteger(quantity)) {
      return { status: "UNSUPPORTED", byFamily, families, detail: String(container?.type ?? "") };
    }
    const bucket = byFamily[profile.equipment];
    if (profile.sizeFt === 20) bucket.c20 += quantity;
    else bucket.c40 += quantity;
    families.add(profile.equipment);
    parts.push(`${quantity}x${profile.key}`);
  }
  return { status: "OK", byFamily, families, detail: parts.join("+") };
}

function evaluateRule(rule: FeeRuleRow, ctx: FeeCaseContext, inventory: ContainerInventory): Match {
  const checks: Match[] = [
    matchDiscrete(rule.transport_mode, ctx.transportMode),
    matchDiscrete(rule.direction, ctx.direction),
    matchDiscrete(rule.shipment_type, ctx.shipmentType),
    matchDiscrete(rule.customs_regime_code, ctx.customsRegimeCode),
    matchBoolean(rule.dangerous_goods, ctx.dangerousGoods),
    matchRange(rule.weight_min_kg, rule.weight_max_kg, ctx.weightKg),
    matchRange(rule.value_min, rule.value_max, ctx.cafValue),
  ];
  const family = upper(rule.container_family) as FeeContainerFamily | null;
  if (family !== null) {
    if (inventory.status === "UNSUPPORTED") checks.push("unknown");
    else checks.push(inventory.families.has(family) ? "yes" : "no");
  }
  if (checks.includes("no")) return "no";
  if (checks.includes("unknown")) return "unknown";
  return "yes";
}

function describeUnknown(rule: FeeRuleRow, ctx: FeeCaseContext, inventory: ContainerInventory): string {
  const missing: string[] = [];
  if (upper(rule.transport_mode) && ctx.transportMode === null) missing.push("mode de transport");
  if (upper(rule.direction) && ctx.direction === null) missing.push("sens (import / export / transit)");
  if (upper(rule.shipment_type) && ctx.shipmentType === null) missing.push("type d'envoi");
  if (upper(rule.customs_regime_code) && ctx.customsRegimeCode === null) missing.push("régime douanier");
  if ((rule.dangerous_goods === true || rule.dangerous_goods === false) && ctx.dangerousGoods === null) {
    missing.push("marchandise dangereuse (oui / non)");
  }
  if ((num(rule.weight_min_kg) !== null || num(rule.weight_max_kg) !== null) && ctx.weightKg === null) missing.push("poids");
  if ((num(rule.value_min) !== null || num(rule.value_max) !== null) && ctx.cafValue === null) missing.push("valeur CAF");
  if (upper(rule.container_family) && inventory.status === "UNSUPPORTED") missing.push("type de conteneur reconnu");
  return missing.length > 0 ? missing.join(", ") : "donnée du dossier";
}

function toConfirm(
  line: FeeLineRow,
  reason: FeeToConfirmReason,
  message: string,
  detail: string | null = null,
  rule: FeeRuleRow | null = null,
): FeeLineResolution {
  return {
    lineId: line.id,
    lineCode: line.code,
    label: line.label_fr,
    vatApplicable: line.vat_applicable !== false,
    status: "TO_CONFIRM",
    amount: null,
    currency: "XOF",
    ruleId: rule?.id ?? null,
    ruleLabel: rule?.label ?? null,
    clientSpecific: !!rule?.client_code,
    reason,
    message,
    detail,
  };
}

function computeAmount(
  line: FeeLineRow,
  rule: FeeRuleRow,
  ctx: FeeCaseContext,
  inventory: ContainerInventory,
): FeeLineResolution {
  const method = upper(rule.method);
  let raw: number;
  let detail: string;

  if (method === "FIXED") {
    const amount = num(rule.amount);
    if (amount === null) return toConfirm(line, "RULE_INVALID", "Règle d'honoraires invalide : forfait sans montant.", null, rule);
    raw = amount;
    detail = `forfait ${formatXof(amount)}`;
  } else if (method === "PER_CONTAINER") {
    const a20 = num(rule.amount_20);
    const a40 = num(rule.amount_40);
    if (a20 === null || a40 === null) return toConfirm(line, "RULE_INVALID", "Règle d'honoraires invalide : montants 20' / 40' incomplets.", null, rule);
    if (inventory.status === "EMPTY") return toConfirm(line, "CONTAINERS_MISSING", "Honoraires par conteneur : aucun conteneur connu sur le dossier — à confirmer.", null, rule);
    if (inventory.status === "UNSUPPORTED") return toConfirm(line, "CONTAINER_TYPE_UNSUPPORTED", `Honoraires par conteneur : type de conteneur non reconnu (${inventory.detail}) — à confirmer.`, null, rule);
    const family = upper(rule.container_family) as FeeContainerFamily | null;
    const families: FeeContainerFamily[] = family ? [family] : ["DRY", "REEFER", "SPECIAL"];
    let c20 = 0;
    let c40 = 0;
    for (const f of families) {
      c20 += inventory.byFamily[f].c20;
      c40 += inventory.byFamily[f].c40;
    }
    raw = c20 * a20 + c40 * a40;
    detail = `${c20} x 20' à ${formatXof(a20)} + ${c40} x 40' à ${formatXof(a40)}${family ? ` (famille ${family})` : ""}`;
  } else if (method === "PER_TONNE") {
    const perTonne = num(rule.amount);
    if (perTonne === null) return toConfirm(line, "RULE_INVALID", "Règle d'honoraires invalide : montant par tonne absent.", null, rule);
    if (ctx.weightKg === null || ctx.weightKg <= 0) return toConfirm(line, "WEIGHT_MISSING", "Honoraires à la tonne : poids du dossier inconnu — à confirmer.", null, rule);
    const tonnes = Math.ceil(ctx.weightKg / 1000);
    raw = tonnes * perTonne;
    detail = `${tonnes} t entamée(s) x ${formatXof(perTonne)}`;
  } else if (method === "PERCENT_OF_VALUE") {
    const percent = num(rule.percent);
    const basisKey = upper(rule.value_basis) as FeeValueBasis | null;
    if (percent === null || basisKey === null) return toConfirm(line, "RULE_INVALID", "Règle d'honoraires invalide : pourcentage ou assiette absents.", null, rule);
    const basis = basisKey === "CAF" ? ctx.cafValue : ctx.cargoValue;
    const basisLabel = basisKey === "CAF" ? "valeur CAF" : "valeur marchandise";
    if (basis === null || basis <= 0) return toConfirm(line, "VALUE_BASIS_MISSING", `Honoraires en pourcentage : ${basisLabel} absente du dossier — à confirmer, jamais 0.`, null, rule);
    raw = basis * percent / 100;
    detail = `${percent} % de la ${basisLabel} ${formatXof(basis)}`;
  } else {
    return toConfirm(line, "RULE_INVALID", `Règle d'honoraires invalide : méthode « ${String(rule.method)} » inconnue.`, null, rule);
  }

  const minAmount = num(rule.min_amount);
  const maxAmount = num(rule.max_amount);
  let amount = raw;
  const clamps: string[] = [];
  if (minAmount !== null && amount < minAmount) {
    amount = minAmount;
    clamps.push(`minimum ${formatXof(minAmount)} appliqué`);
  }
  if (maxAmount !== null && amount > maxAmount) {
    amount = maxAmount;
    clamps.push(`maximum ${formatXof(maxAmount)} appliqué`);
  }
  amount = Math.round(amount);
  const fullDetail = `${detail} = ${formatXof(raw)}${clamps.length ? ` ; ${clamps.join(" ; ")}` : ""}`;

  return {
    lineId: line.id,
    lineCode: line.code,
    label: line.label_fr,
    vatApplicable: line.vat_applicable !== false,
    status: "RESOLVED",
    amount,
    currency: "XOF",
    ruleId: rule.id,
    ruleLabel: rule.label ?? null,
    clientSpecific: !!rule.client_code,
    reason: null,
    message: `${line.label_fr} : ${formatXof(amount)}${rule.client_code ? ` (règle client ${rule.client_code})` : ""}.`,
    detail: fullDetail,
  };
}

/**
 * Résout une ligne : scope client d'abord (règles dont client_code = client du
 * dossier), puis scope générique (client_code NULL). Dans chaque scope, il faut
 * exactement une règle certaine.
 */
export function resolveFeeLine(
  line: FeeLineRow,
  rules: ReadonlyArray<FeeRuleRow>,
  ctx: FeeCaseContext,
): FeeLineResolution {
  const asOf = ISO_DATE.test(ctx.asOfDate ?? "") ? ctx.asOfDate : "";
  const inventory = inventoryContainers(ctx.containers);
  const clientCode = upper(ctx.clientCode);
  const inForce = asOf === "" ? [] : rules.filter((r) => r.fee_line_id === line.id && isRuleInForce(r, asOf));

  const scopes: Array<{ name: "client" | "generic"; rules: FeeRuleRow[] }> = [];
  if (clientCode !== null) {
    scopes.push({ name: "client", rules: inForce.filter((r) => upper(r.client_code) === clientCode) });
  }
  scopes.push({ name: "generic", rules: inForce.filter((r) => upper(r.client_code) === null) });

  for (const scope of scopes) {
    if (scope.rules.length === 0) continue;
    const yes: FeeRuleRow[] = [];
    const unknown: FeeRuleRow[] = [];
    for (const rule of scope.rules) {
      const m = evaluateRule(rule, ctx, inventory);
      if (m === "yes") yes.push(rule);
      else if (m === "unknown") unknown.push(rule);
    }
    if (yes.length === 1) return computeAmount(line, yes[0], ctx, inventory);
    if (yes.length > 1) {
      return toConfirm(
        line,
        "CONFLICTING_RULES",
        `${line.label_fr} : ${yes.length} règles s'appliquent au dossier (${yes.map((r) => r.label ?? r.id.slice(0, 8)).join(", ")}) — paramétrage à corriger, ligne à confirmer.`,
        `scope ${scope.name}`,
      );
    }
    if (unknown.length > 0) {
      const missing = [...new Set(unknown.map((r) => describeUnknown(r, ctx, inventory)))].join(" ; ");
      return toConfirm(
        line,
        "CONDITION_UNKNOWN",
        `${line.label_fr} : donnée manquante pour appliquer la grille (${missing}) — à confirmer.`,
        `scope ${scope.name}, ${unknown.length} règle(s) indéterminée(s)`,
      );
    }
    // Scope entièrement « non » : le scope client sans règle certaine laisse la
    // place au scope générique ; le scope générique tombe au comportement de ligne.
  }

  const behavior = upper(line.missing_rule_behavior) === "SKIP" ? "SKIP" : "TO_CONFIRM";
  if (behavior === "SKIP") {
    return {
      lineId: line.id,
      lineCode: line.code,
      label: line.label_fr,
      vatApplicable: line.vat_applicable !== false,
      status: "SKIPPED",
      amount: null,
      currency: "XOF",
      ruleId: null,
      ruleLabel: null,
      clientSpecific: false,
      reason: null,
      message: `${line.label_fr} : aucune règle ne vise ce dossier — ligne non applicable.`,
      detail: null,
    };
  }
  return toConfirm(
    line,
    "NO_APPLICABLE_RULE",
    `${line.label_fr} : aucune règle d'honoraires ne couvre ce dossier${asOf === "" ? " (date d'évaluation invalide)" : ""} — à confirmer.`,
  );
}

/** Résout toutes les lignes actives, dans l'ordre d'affichage. */
export function resolveFeeLines(
  lines: ReadonlyArray<FeeLineRow>,
  rules: ReadonlyArray<FeeRuleRow>,
  ctx: FeeCaseContext,
): FeeLineResolution[] {
  return [...lines]
    .filter((l) => l.is_active !== false)
    .sort((a, b) => (a.display_order ?? 100) - (b.display_order ?? 100) || a.code.localeCompare(b.code))
    .map((line) => resolveFeeLine(line, rules, ctx));
}

/**
 * Profil d'envoi dérivé du type de demande et du package (valeurs canoniques
 * du dossier : `SEA_FCL_IMPORT`, `SEA_LCL_IMPORT`, `SEA_BREAKBULK_IMPORT`,
 * `AIR_IMPORT*`, `ROAD_IMPORT` ; packages `TRANSIT_*` / `EXPORT_*`). Tout ce
 * qui n'est pas reconnu reste null (inconnu), jamais deviné.
 */
export function deriveShipmentProfile(
  requestType: unknown,
  servicePackage: unknown,
): { transportMode: FeeTransportMode | null; direction: FeeDirection | null; shipmentType: FeeShipmentType | null } {
  const rt = upper(requestType) ?? "";
  const pkg = upper(servicePackage) ?? "";

  let transportMode: FeeTransportMode | null = null;
  if (rt.startsWith("SEA_")) transportMode = "SEA";
  else if (rt.startsWith("AIR_")) transportMode = "AIR";
  else if (rt.startsWith("ROAD_")) transportMode = "ROAD";
  else if (pkg.startsWith("AIR_")) transportMode = "AIR";
  else if (pkg.startsWith("EXPORT_") || pkg.startsWith("LCL_") || pkg.startsWith("DAP_PROJECT") || pkg.startsWith("DDP_PROJECT") || pkg.startsWith("BREAKBULK") || pkg.startsWith("TRANSIT_")) transportMode = "SEA";

  let direction: FeeDirection | null = null;
  if (pkg.startsWith("TRANSIT_")) direction = "TRANSIT";
  else if (pkg.startsWith("EXPORT_") || rt.includes("_EXPORT")) direction = "EXPORT";
  else if (rt.includes("_IMPORT") || pkg.includes("IMPORT")) direction = "IMPORT";

  let shipmentType: FeeShipmentType | null = null;
  if (rt.includes("_FCL_")) shipmentType = "FCL";
  else if (rt.includes("_LCL_") || pkg.startsWith("LCL_")) shipmentType = "LCL";
  else if (rt.includes("BREAKBULK") || pkg.startsWith("BREAKBULK")) shipmentType = "BREAKBULK";
  else if (rt.includes("RORO") || pkg.includes("RORO")) shipmentType = "RORO";
  else if (transportMode === "AIR") shipmentType = "AIR";
  else if (pkg.startsWith("DAP_PROJECT") || pkg.startsWith("DDP_PROJECT") || pkg.startsWith("TRANSIT_")) shipmentType = "FCL";

  return { transportMode, direction, shipmentType };
}

/**
 * H2-c : contexte du dossier pour le résolveur, construit par price-service-lines
 * depuis les faits (jamais deviné). `scope` (import / export / transit, déjà
 * dérivé par l'appelant) complète le sens quand le type de demande ne le dit pas.
 */
export function buildFeeCaseContext(input: {
  requestType: unknown;
  servicePackage: unknown;
  scope?: unknown;
  containers: ReadonlyArray<{ type?: unknown; quantity?: unknown }> | null | undefined;
  weightKg: unknown;
  cafValue: unknown;
  cargoValue: unknown;
  clientCode: unknown;
  customsRegimeCode: unknown;
  dangerousGoods?: boolean | null;
  asOfDate: string;
}): FeeCaseContext {
  const profile = deriveShipmentProfile(input.requestType, input.servicePackage);
  let direction = profile.direction;
  if (direction === null) {
    const scope = upper(input.scope);
    if (scope === "IMPORT" || scope === "EXPORT" || scope === "TRANSIT") direction = scope;
  }
  const positive = (raw: unknown): number | null => {
    const n = num(raw);
    return n !== null && n > 0 ? n : null;
  };
  return {
    transportMode: profile.transportMode,
    direction,
    shipmentType: profile.shipmentType,
    customsRegimeCode: upper(input.customsRegimeCode),
    containers: Array.isArray(input.containers) ? input.containers : [],
    dangerousGoods: input.dangerousGoods === true || input.dangerousGoods === false ? input.dangerousGoods : null,
    weightKg: positive(input.weightKg),
    cafValue: positive(input.cafValue),
    cargoValue: positive(input.cargoValue),
    clientCode: upper(input.clientCode),
    asOfDate: input.asOfDate,
  };
}
