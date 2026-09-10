/**
 * H2-d2 — Dérivation du contexte d'honoraires depuis les faits d'un dossier.
 *
 * Pourquoi ce module : le résolveur H2-b (`fee-rules.ts`) est pur et prend un
 * `FeeCaseContext` déjà construit. Jusqu'ici, seul `price-service-lines`
 * construisait ce contexte, à partir de son `PricingContext` interne. L'écran
 * de simulation (H2-d2) doit produire EXACTEMENT le même contexte, sinon il
 * annoncerait un montant que le chiffrage réel ne produirait pas — une
 * simulation qui ment est pire que pas de simulation.
 *
 * Ce module porte donc la lecture des faits canoniques, et les deux appelants
 * l'utilisent : `price-service-lines` (chiffrage réel) et `simulate-fee-lines`
 * (simulation). Les faits lus sont ceux de `buildPricingContext` pour les seuls
 * champs qui alimentent les honoraires.
 *
 * Module pur : aucune I/O, aucune horloge implicite (`asOfDate` fourni).
 */

import { buildFeeCaseContext, type FeeCaseContext } from "./fee-rules.ts";
import { DANGEROUS_GOODS_FACT_KEY, resolveDangerousGoods } from "./dangerous-goods.ts";

/** Une ligne de `quote_facts` telle que lue en base (champs utiles). */
export interface FeeFactRow {
  value_text?: string | null;
  value_json?: unknown;
  value_number?: number | null;
}

export type FeeFactsMap = ReadonlyMap<string, FeeFactRow>;

/**
 * Champs du contexte de chiffrage susceptibles de primer sur les faits.
 * En multi-lot, `run-pricing` transmet à `price-service-lines` un
 * `pricing_context_override` porté par le lot (conteneurs et poids du lot, et
 * non ceux du dossier entier) : cet override doit primer ici aussi.
 */
export interface FeeContextOverride {
  scope?: unknown;
  service_package?: unknown;
  containers?: ReadonlyArray<{ type?: unknown; quantity?: unknown }> | null;
  weight_kg?: unknown;
  caf_value?: unknown;
  cargo_value?: unknown;
  client_code?: unknown;
  customs_regime_code?: unknown;
}

function text(fact: FeeFactRow | undefined): string | null {
  const raw = fact?.value_text;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

function numberOf(fact: FeeFactRow | undefined): number | null {
  const raw = fact?.value_number;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/**
 * Conteneurs du dossier. Miroir de `buildPricingContext` : le fait
 * `cargo.containers` est un tableau JSON, parfois doublement encodé (chaîne
 * JSON dans un champ JSON) — le parse défensif est conservé.
 */
export function readContainersFact(
  factsMap: FeeFactsMap,
): Array<{ type: string; quantity: number }> {
  let raw: unknown = factsMap.get("cargo.containers")?.value_json;

  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }

  if (!Array.isArray(raw)) return [];

  const containers: Array<{ type: string; quantity: number }> = [];
  for (const entry of raw as Array<{ type?: unknown; quantity?: unknown }>) {
    const type = typeof entry?.type === "string" ? entry.type : "";
    const quantity = Number(entry?.quantity ?? 1);
    containers.push({ type, quantity: Number.isFinite(quantity) ? quantity : 1 });
  }
  return containers;
}

/**
 * Périmètre du dossier (import / export / transit), miroir de
 * `buildPricingContext`. Sert de repli au sens (`direction`) quand le type de
 * demande ne le porte pas.
 */
export function readScopeFact(factsMap: FeeFactsMap): string {
  const flowType = text(factsMap.get("service.flow_type")) ?? "";
  const servicePackage = (text(factsMap.get("service.package")) ?? "").toUpperCase();
  if (/EXPORT/i.test(flowType)) return "export";
  if (/TRANSIT/i.test(flowType)) return "transit";
  if (servicePackage === "EXPORT_SENEGAL") return "export";
  return "import";
}

/**
 * Contexte d'honoraires d'un dossier.
 *
 * DG-1 : `dangerousGoods` provient du fait `cargo.dangerous_goods`, avec repli
 * unidirectionnel sur la famille tarifaire DP World `DANGEROUS`. Fait absent ou
 * illisible ⇒ `null` : une règle conditionnée sur ce critère reste « à
 * confirmer », jamais devinée.
 */
export function buildFeeCaseContextFromFacts(input: {
  factsMap: FeeFactsMap;
  requestType: unknown;
  asOfDate: string;
  override?: FeeContextOverride | null;
}): FeeCaseContext {
  const { factsMap, override } = input;

  const has = (key: keyof FeeContextOverride) =>
    override != null && override[key] !== undefined;

  const chargeableWeight = numberOf(factsMap.get("cargo.chargeable_weight_kg"));
  const rawWeight = numberOf(factsMap.get("cargo.weight_kg"));

  return buildFeeCaseContext({
    requestType: input.requestType,
    servicePackage: has("service_package")
      ? override!.service_package
      : (text(factsMap.get("service.package")) ?? "").toUpperCase() || null,
    scope: has("scope") ? override!.scope : readScopeFact(factsMap),
    containers: has("containers")
      ? (override!.containers ?? [])
      : readContainersFact(factsMap),
    weightKg: has("weight_kg") ? override!.weight_kg : (chargeableWeight ?? rawWeight),
    cafValue: has("caf_value") ? override!.caf_value : numberOf(factsMap.get("cargo.caf_value")),
    cargoValue: has("cargo_value") ? override!.cargo_value : numberOf(factsMap.get("cargo.value")),
    clientCode: has("client_code") ? override!.client_code : text(factsMap.get("client.code")),
    customsRegimeCode: has("customs_regime_code")
      ? override!.customs_regime_code
      : (text(factsMap.get("customs.regime_code")) ?? "").toUpperCase() || null,
    dangerousGoods: readDangerousGoodsFact(factsMap),
    asOfDate: input.asOfDate,
  });
}

/**
 * Caractère dangereux du dossier (DG-1), lu du fait canonique puis, à défaut,
 * de la famille tarifaire DP World. `null` quand l'information n'est pas
 * établie — le résolveur laisse alors la ligne « à confirmer ».
 */
export function readDangerousGoodsFact(factsMap: FeeFactsMap): boolean | null {
  return resolveDangerousGoods(
    factsMap.get(DANGEROUS_GOODS_FACT_KEY)?.value_text,
    factsMap.get("pricing.dthc_family")?.value_text,
  ).dangerous;
}
