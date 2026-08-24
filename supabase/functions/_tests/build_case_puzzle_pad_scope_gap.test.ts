/**
 * PAD-SCOPE-GAP — cohérence build-case-puzzle ↔ run-pricing.
 *
 * PORTÉE LIMITÉE :
 *   Teste UNIQUEMENT la décision PURE `resolvePadScopeGapState` de
 *   build-case-puzzle, qui rejoue la résolution de périmètre de run-pricing
 *   (service.package + service.overrides → effectiveServiceKeys) puis appelle
 *   `resolvePadScopeBlocker`. La création/résolution réelle du gap (I/O
 *   Supabase) reste dans le handler serve et n'est pas couverte ici.
 *
 *   La parité avec run-pricing est vérifiée en rejouant la MÊME entrée à
 *   travers les helpers partagés de `_shared/service-scope.ts` (ceux que
 *   run-pricing importe désormais).
 *
 * Exécution :
 *   deno test --no-check --config supabase/functions/deno.json \
 *     supabase/functions/_tests/build_case_puzzle_pad_scope_gap.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  readOverridesFromFacts,
  resolveEffectiveServiceKeys,
  SERVICE_PACKAGES,
} from "../_shared/service-scope.ts";
import {
  PAD_CATEGORY_REQUIRED_MESSAGE,
  type PadScopeFact,
  resolvePadScopeBlocker,
} from "../_shared/pad-scope-blocker.ts";

// Empêche le serveur de démarrer lors de l'import (pattern existant build-case-puzzle).
Deno.env.set("BUILD_CASE_PUZZLE_DISABLE_SERVE", "1");

const {
  resolvePadScopeGapState,
  PAD_SCOPE_GAP_KEY,
  PAD_SCOPE_FACT_KEYS,
} = await import("../build-case-puzzle/index.ts");

// ─── Fixtures ─────────────────────────────────────────────────────────────

function fact(fact_key: string, value: Partial<PadScopeFact> = {}): PadScopeFact {
  return { fact_key, ...value };
}

/** LCL_IMPORT_DAP contient PORT_DAKAR_HANDLING → périmètre PAD. */
const PKG_PAD = fact("service.package", { value_text: "LCL_IMPORT_DAP" });
/** AIR_IMPORT_DAP ne contient aucun service portuaire PAD. */
const PKG_NON_PAD = fact("service.package", { value_text: "AIR_IMPORT_DAP" });

const INCOTERM_CIF = fact("routing.incoterm", { value_text: "CIF" });
const CATEGORY_CARGO = fact("cargo.pad_category", { value_text: "CATEGORIE_2" });
const CATEGORY_PRICING = fact("pricing.pad_category", { value_text: "CATEGORIE_2" });
const RATE_POSITIVE = fact("cargo.pad_rate_fcfa_per_ton", { value_number: 1250 });
const RATE_ZERO = fact("cargo.pad_rate_fcfa_per_ton", { value_number: 0 });

// ─── 1. Hors périmètre PAD → aucun gap ────────────────────────────────────

Deno.test("1 - scope hors PAD => aucun blocage", () => {
  const state = resolvePadScopeGapState([PKG_NON_PAD, INCOTERM_CIF]);
  assertEquals(state.effectiveServiceKeys, SERVICE_PACKAGES.AIR_IMPORT_DAP);
  assertEquals(state.blocker, null);
});

Deno.test("1b - service.package inconnu => perimetre vide => aucun blocage", () => {
  const state = resolvePadScopeGapState([
    fact("service.package", { value_text: "PACKAGE_INEXISTANT" }),
  ]);
  assertEquals(state.effectiveServiceKeys, []);
  assertEquals(state.blocker, null);
});

Deno.test("1c - aucun fait de scope => aucun blocage", () => {
  const state = resolvePadScopeGapState([]);
  assertEquals(state.servicePackage, "");
  assertEquals(state.effectiveServiceKeys, []);
  assertEquals(state.blocker, null);
});

// ─── 2. Périmètre PAD sans catégorie → gap bloquant ───────────────────────

Deno.test("2 - scope PAD sans categorie => blocage PAD_CATEGORY_REQUIRED", () => {
  const state = resolvePadScopeGapState([PKG_PAD, INCOTERM_CIF, RATE_POSITIVE]);
  assertEquals(state.blocker?.pricing_blockers, ["PAD_CATEGORY_REQUIRED"]);
  assertEquals(state.blocker?.message, PAD_CATEGORY_REQUIRED_MESSAGE);
  assertEquals(state.blocker?.scope_debug, {
    servicePackage: "LCL_IMPORT_DAP",
    incoterm: "CIF",
    effectiveServiceKeys: SERVICE_PACKAGES.LCL_IMPORT_DAP,
  });
});

// ─── 3. Catégorie sans taux strictement positif → gap ─────────────────────

Deno.test("3 - categorie sans taux => blocage", () => {
  const state = resolvePadScopeGapState([PKG_PAD, INCOTERM_CIF, CATEGORY_CARGO]);
  assertEquals(state.blocker?.pricing_blockers, ["PAD_CATEGORY_REQUIRED"]);
});

Deno.test("3b - categorie avec taux zero => blocage", () => {
  const state = resolvePadScopeGapState([PKG_PAD, INCOTERM_CIF, CATEGORY_CARGO, RATE_ZERO]);
  assertEquals(state.blocker?.pricing_blockers, ["PAD_CATEGORY_REQUIRED"]);
});

Deno.test("3c - categorie vide (espaces) avec taux positif => blocage", () => {
  const state = resolvePadScopeGapState([
    PKG_PAD,
    INCOTERM_CIF,
    fact("cargo.pad_category", { value_text: "   " }),
    RATE_POSITIVE,
  ]);
  assertEquals(state.blocker?.pricing_blockers, ["PAD_CATEGORY_REQUIRED"]);
});

// ─── 4. Catégorie + taux positif → plus de blocage (gap stale résolu) ─────

Deno.test("4 - cargo.pad_category + taux positif => aucun blocage", () => {
  const state = resolvePadScopeGapState([PKG_PAD, INCOTERM_CIF, CATEGORY_CARGO, RATE_POSITIVE]);
  assertEquals(state.blocker, null);
});

Deno.test("4b - pricing.pad_category + taux positif => aucun blocage", () => {
  const state = resolvePadScopeGapState([PKG_PAD, INCOTERM_CIF, CATEGORY_PRICING, RATE_POSITIVE]);
  assertEquals(state.blocker, null);
});

// ─── 5. value_json / value_number / value_text ────────────────────────────
// Même précédence que le garde existant: value_json ?? value_number ?? value_text.

Deno.test("5 - categorie portee par value_json et taux par value_text", () => {
  const state = resolvePadScopeGapState([
    PKG_PAD,
    INCOTERM_CIF,
    fact("cargo.pad_category", { value_json: "CATEGORIE_3" }),
    fact("cargo.pad_rate_fcfa_per_ton", { value_text: "1500" }),
  ]);
  assertEquals(state.blocker, null);
});

Deno.test("5b - categorie non-string (value_json numerique) => blocage", () => {
  const state = resolvePadScopeGapState([
    PKG_PAD,
    INCOTERM_CIF,
    fact("cargo.pad_category", { value_json: 3 }),
    RATE_POSITIVE,
  ]);
  assertEquals(state.blocker?.pricing_blockers, ["PAD_CATEGORY_REQUIRED"]);
});

Deno.test("5c - taux non numerique => blocage", () => {
  const state = resolvePadScopeGapState([
    PKG_PAD,
    INCOTERM_CIF,
    CATEGORY_CARGO,
    fact("cargo.pad_rate_fcfa_per_ton", { value_text: "n/a" }),
  ]);
  assertEquals(state.blocker?.pricing_blockers, ["PAD_CATEGORY_REQUIRED"]);
});

// ─── 6. service.overrides add / remove ────────────────────────────────────

Deno.test("6 - overrides.add fait entrer un scope non-PAD dans le perimetre PAD", () => {
  const state = resolvePadScopeGapState([
    PKG_NON_PAD,
    INCOTERM_CIF,
    fact("service.overrides", { value_json: { add: ["PORT_DAKAR_HANDLING"], remove: [] } }),
  ]);
  assertEquals(state.effectiveServiceKeys.includes("PORT_DAKAR_HANDLING"), true);
  assertEquals(state.blocker?.pricing_blockers, ["PAD_CATEGORY_REQUIRED"]);
});

Deno.test("6b - overrides.remove sort le scope du perimetre PAD", () => {
  const state = resolvePadScopeGapState([
    PKG_PAD,
    INCOTERM_CIF,
    fact("service.overrides", { value_json: { add: [], remove: ["PORT_DAKAR_HANDLING"] } }),
  ]);
  assertEquals(state.effectiveServiceKeys.includes("PORT_DAKAR_HANDLING"), false);
  assertEquals(state.blocker, null);
});

Deno.test("6c - overrides serialise en JSON string (value_text) traite identiquement", () => {
  const state = resolvePadScopeGapState([
    PKG_NON_PAD,
    INCOTERM_CIF,
    fact("service.overrides", { value_text: JSON.stringify({ add: ["PORT_DAKAR_HANDLING"] }) }),
  ]);
  assertEquals(state.blocker?.pricing_blockers, ["PAD_CATEGORY_REQUIRED"]);
});

Deno.test("6d - overrides invalides ignores (fallback perimetre de base)", () => {
  const state = resolvePadScopeGapState([
    PKG_PAD,
    INCOTERM_CIF,
    fact("service.overrides", { value_text: "{pas du json" }),
  ]);
  assertEquals(state.effectiveServiceKeys, SERVICE_PACKAGES.LCL_IMPORT_DAP);
  assertEquals(state.blocker?.pricing_blockers, ["PAD_CATEGORY_REQUIRED"]);
});

Deno.test("6e - cle de service inconnue dans overrides.add ignoree", () => {
  const state = resolvePadScopeGapState([
    PKG_NON_PAD,
    INCOTERM_CIF,
    fact("service.overrides", { value_json: { add: ["SERVICE_QUI_NEXISTE_PAS"] } }),
  ]);
  assertEquals(state.effectiveServiceKeys, SERVICE_PACKAGES.AIR_IMPORT_DAP);
  assertEquals(state.blocker, null);
});

// ─── 7. Idempotence de la décision pure ───────────────────────────────────

Deno.test("7 - decision stable sur appels repetes (memes faits)", () => {
  const facts = [PKG_PAD, INCOTERM_CIF];
  const a = resolvePadScopeGapState(facts);
  const b = resolvePadScopeGapState(facts);
  assertEquals(a, b);
  // La lecture ne mute pas l'entrée.
  assertEquals(facts.length, 2);
});

// ─── 8. Parité stricte avec le calcul de run-pricing ──────────────────────

Deno.test("8 - parite: meme perimetre et meme blocage que run-pricing", () => {
  const cases: PadScopeFact[][] = [
    [PKG_PAD, INCOTERM_CIF],
    [PKG_PAD, INCOTERM_CIF, CATEGORY_CARGO, RATE_POSITIVE],
    [PKG_NON_PAD, INCOTERM_CIF, fact("service.overrides", { value_json: { add: ["PAD_DROIT_PASSAGE"] } })],
    [PKG_PAD, INCOTERM_CIF, fact("service.overrides", { value_json: { remove: ["PORT_DAKAR_HANDLING"] } })],
    [fact("service.package", { value_text: "breakbulk_project" }), INCOTERM_CIF],
  ];

  for (const facts of cases) {
    // Reproduction littérale de run-pricing/index.ts (§4 + appel du garde).
    const pkg = String(
      facts.find((f) => f.fact_key === "service.package")?.value_text ?? "",
    ).trim().toUpperCase();
    const incoterm = String(
      facts.find((f) => f.fact_key === "routing.incoterm")?.value_text ?? "",
    ).trim().toUpperCase();
    const effectiveServiceKeys = resolveEffectiveServiceKeys(pkg, readOverridesFromFacts(facts));
    const expected = resolvePadScopeBlocker({
      facts,
      servicePackage: pkg,
      effectiveServiceKeys,
      incoterm,
    });

    const state = resolvePadScopeGapState(facts);
    assertEquals(state.effectiveServiceKeys, effectiveServiceKeys);
    assertEquals(state.blocker, expected);
  }
});

// ─── 9. Contrat de clés lu par le handler ─────────────────────────────────

Deno.test("9 - gap key et clefs de faits alignees sur run-pricing", () => {
  assertEquals(PAD_SCOPE_GAP_KEY, "pricing.pad_category");
  assertEquals(PAD_SCOPE_FACT_KEYS, [
    "service.package",
    "service.overrides",
    "routing.incoterm",
    "cargo.hs_code",
    "cargo.pad_category",
    "pricing.pad_category",
    "cargo.pad_rate_fcfa_per_ton",
  ]);
});
