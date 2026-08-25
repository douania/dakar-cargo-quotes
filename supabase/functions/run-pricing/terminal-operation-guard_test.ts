import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  DAKAR_TERMINAL_RATE_REQUIRED,
  resolveTerminalOperationBlockers,
  TERMINAL_OPERATION_MODE_FACT_KEY,
  TERMINAL_OPERATION_MODE_REQUIRED,
  type TerminalScopeFact,
} from "../_shared/terminal-operation-mode.ts";
import {
  type PadScopeFact,
  resolvePadScopeBlocker,
} from "../_shared/pad-scope-blocker.ts";
import {
  readOverridesFromFacts,
  resolveEffectiveServiceKeys,
  SERVICE_PACKAGES,
  type ServiceOverrides,
} from "../_shared/service-scope.ts";

/**
 * Câblage du garde terminal dans run-pricing (doctrine 2026-08-25).
 *
 * Le module partagé teste la DÉCISION ; ce fichier teste ce que run-pricing en
 * fait : sur quels périmètres réels il s'arme, ce qu'il laisse strictement
 * intact (PAD, DTHC LoLo, air, export), et comment il se comporte par lot.
 */

// L'Edge Function n'est importée que pour ses helpers purs — pas de listener HTTP.
Deno.env.set("RUN_PRICING_DISABLE_SERVE", "1");
const { resolveTerminalBlockersForLot, excludePadScopeKeysForEnrichment, resolvePadBlockersForLot } =
  await import("./index.ts") as {
    resolveTerminalBlockersForLot: (params: {
      lotExtractedFacts: Array<{ key?: string; value?: unknown }>;
      effectiveServiceKeys: string[];
    }) => string[];
    excludePadScopeKeysForEnrichment: (keys: string[]) => string[];
    resolvePadBlockersForLot: (params: {
      facts: PadScopeFact[];
      servicePackage: string;
      effectiveServiceKeys: string[];
      incoterm: string;
    }) => string[];
  };

const NO_OVERRIDES: ServiceOverrides = { add: [], remove: [] };

function scopeOf(pkg: string, overrides: ServiceOverrides = NO_OVERRIDES): string[] {
  return resolveEffectiveServiceKeys(pkg, overrides);
}

function modeFact(value: unknown): TerminalScopeFact {
  return { fact_key: TERMINAL_OPERATION_MODE_FACT_KEY, value_text: value };
}

/** Ce que le garde mono-lot calcule à partir du périmètre résolu d'un package. */
function monoLotBlockers(
  pkg: string,
  facts: TerminalScopeFact[],
  overrides: ServiceOverrides = NO_OVERRIDES,
): string[] {
  return resolveTerminalOperationBlockers({ facts, effectiveServiceKeys: scopeOf(pkg, overrides) });
}

/** Packages dont le périmètre résolu porte DTHC. */
const DTHC_PACKAGES = Object.keys(SERVICE_PACKAGES).filter((pkg) => scopeOf(pkg).includes("DTHC"));
/** Tous les autres. */
const NON_DTHC_PACKAGES = Object.keys(SERVICE_PACKAGES).filter((pkg) => !scopeOf(pkg).includes("DTHC"));

// ── Le garde s'arme sur les bons périmètres, et seulement sur eux ────────────

Deno.test("TERMINAL/run-pricing: les deux côtés du périmètre existent dans SERVICE_PACKAGES", () => {
  // Garde les cas suivants contre une vérité vide.
  assert(DTHC_PACKAGES.includes("DAP_PROJECT_IMPORT"), "package DTHC attendu");
  assert(NON_DTHC_PACKAGES.includes("AIR_IMPORT_DAP"), "package non-DTHC attendu");
});

Deno.test("TERMINAL/run-pricing: aucun package aérien ou export ne porte DTHC", () => {
  // Condition de sûreté centrale : le garde ne peut pas bloquer ces flux.
  for (const pkg of Object.keys(SERVICE_PACKAGES)) {
    if (pkg.startsWith("AIR_") || pkg.startsWith("EXPORT_")) {
      assertEquals(scopeOf(pkg).includes("DTHC"), false, `${pkg} ne doit pas porter DTHC`);
      assertEquals(monoLotBlockers(pkg, []), [], `${pkg} ne doit jamais être bloqué`);
    }
  }
});

Deno.test("TERMINAL/run-pricing: sans mode, tout package DTHC bloque sur le même code", () => {
  for (const pkg of DTHC_PACKAGES) {
    assertEquals(monoLotBlockers(pkg, []), [TERMINAL_OPERATION_MODE_REQUIRED], pkg);
  }
});

Deno.test("TERMINAL/run-pricing: sans mode, aucun package hors DTHC n'est bloqué", () => {
  for (const pkg of NON_DTHC_PACKAGES) {
    assertEquals(monoLotBlockers(pkg, []), [], pkg);
    assertEquals(monoLotBlockers(pkg, [modeFact("RORO")]), [], `${pkg} + RORO`);
  }
});

Deno.test("TERMINAL/run-pricing: LOLO libère, RORO/CONRO bloquent, sur tout package DTHC", () => {
  for (const pkg of DTHC_PACKAGES) {
    assertEquals(monoLotBlockers(pkg, [modeFact("LOLO")]), [], `${pkg} + LOLO`);
    assertEquals(monoLotBlockers(pkg, [modeFact("RORO")]), [DAKAR_TERMINAL_RATE_REQUIRED], `${pkg} + RORO`);
    assertEquals(monoLotBlockers(pkg, [modeFact("CONRO")]), [DAKAR_TERMINAL_RATE_REQUIRED], `${pkg} + CONRO`);
  }
});

Deno.test("TERMINAL/run-pricing: package inconnu ou vide → périmètre vide → aucun blocage", () => {
  assertEquals(monoLotBlockers("", []), []);
  assertEquals(monoLotBlockers("NOT_A_PACKAGE", []), []);
});

Deno.test("TERMINAL/run-pricing: service.overrides pilotent le garde comme le reste du périmètre", () => {
  const removed = readOverridesFromFacts([
    { fact_key: "service.overrides", value_json: { add: [], remove: ["DTHC"] } },
  ]);
  assertEquals(scopeOf("DAP_PROJECT_IMPORT", removed).includes("DTHC"), false);
  assertEquals(monoLotBlockers("DAP_PROJECT_IMPORT", [], removed), []);

  const added = readOverridesFromFacts([
    { fact_key: "service.overrides", value_json: { add: ["DTHC"], remove: [] } },
  ]);
  assertEquals(monoLotBlockers("LCL_IMPORT_DAP", [], added), [TERMINAL_OPERATION_MODE_REQUIRED]);
});

// ── DDP_PROJECT_IMPORT : non-régression du lot P0-E ─────────────────────────

Deno.test("TERMINAL/run-pricing: DDP_PROJECT_IMPORT garde le périmètre de DAP_PROJECT_IMPORT", () => {
  assertEquals(scopeOf("DDP_PROJECT_IMPORT"), scopeOf("DAP_PROJECT_IMPORT"));
});

Deno.test("TERMINAL/run-pricing: DDP_PROJECT_IMPORT suit exactement la même doctrine terminale", () => {
  for (const [facts, expected] of [
    [[], [TERMINAL_OPERATION_MODE_REQUIRED]],
    [[modeFact("LOLO")], []],
    [[modeFact("RORO")], [DAKAR_TERMINAL_RATE_REQUIRED]],
    [[modeFact("CONRO")], [DAKAR_TERMINAL_RATE_REQUIRED]],
  ] as Array<[TerminalScopeFact[], string[]]>) {
    assertEquals(monoLotBlockers("DDP_PROJECT_IMPORT", facts), expected);
    assertEquals(monoLotBlockers("DAP_PROJECT_IMPORT", facts), expected);
  }
});

Deno.test("TERMINAL/run-pricing: l'exclusion PAD de l'enrichissement est inchangée", () => {
  // Le garde terminal ne touche pas la liste d'enrichissement : DTHC y reste, les
  // marqueurs PAD en restent exclus, pour tous les packages.
  for (const pkg of Object.keys(SERVICE_PACKAGES)) {
    const effective = scopeOf(pkg);
    const enriched = excludePadScopeKeysForEnrichment(effective);
    assertEquals(enriched.includes("DTHC"), effective.includes("DTHC"), `${pkg}: DTHC a bougé`);
    assertEquals(enriched.includes("PORT_DAKAR_HANDLING"), false, `${pkg}: marqueur PAD réintroduit`);
  }
});

// ── Non-régression PAD : les deux gardes sont indépendants ──────────────────

const PAD_FACTS: PadScopeFact[] = [
  { fact_key: "cargo.pad_category", value_text: "T02" },
  { fact_key: "cargo.pad_rate_fcfa_per_ton", value_number: 9678 },
];

Deno.test("TERMINAL/run-pricing: le verdict PAD ne dépend pas du mode terminal", () => {
  for (const pkg of DTHC_PACKAGES) {
    const effectiveServiceKeys = scopeOf(pkg);
    for (const mode of [[], [modeFact("LOLO")], [modeFact("RORO")], [modeFact("CONRO")]]) {
      // Sans faits PAD: bloqué, avec ou sans mode terminal.
      const withoutPad = resolvePadScopeBlocker({
        facts: mode as PadScopeFact[],
        servicePackage: pkg,
        effectiveServiceKeys,
        incoterm: "CIF",
      });
      assert(withoutPad, `${pkg}: PAD doit encore bloquer`);
      assertEquals(withoutPad.pricing_blockers, ["PAD_CATEGORY_REQUIRED"]);

      // Avec faits PAD complets: libéré, avec ou sans mode terminal.
      assertEquals(
        resolvePadScopeBlocker({
          facts: [...PAD_FACTS, ...(mode as PadScopeFact[])],
          servicePackage: pkg,
          effectiveServiceKeys,
          incoterm: "CIF",
        }),
        null,
        `${pkg}: PAD doit encore libérer`,
      );
    }
  }
});

Deno.test("TERMINAL/run-pricing: le verdict terminal ne dépend pas des faits PAD", () => {
  const effectiveServiceKeys = scopeOf("DAP_PROJECT_IMPORT");
  const padOnly = resolveTerminalOperationBlockers({ facts: PAD_FACTS as TerminalScopeFact[], effectiveServiceKeys });
  assertEquals(padOnly, [TERMINAL_OPERATION_MODE_REQUIRED]);
  assertEquals(
    resolveTerminalOperationBlockers({
      facts: [...PAD_FACTS, modeFact("LOLO")] as TerminalScopeFact[],
      effectiveServiceKeys,
    }),
    [],
  );
});

Deno.test("TERMINAL/run-pricing: le garde PAD multi-lot P0-E est inchangé", () => {
  const params = {
    facts: PAD_FACTS,
    servicePackage: "DAP_PROJECT_IMPORT",
    effectiveServiceKeys: scopeOf("DAP_PROJECT_IMPORT"),
    incoterm: "CIF",
  };
  assertEquals(resolvePadBlockersForLot(params), ["PAD_MULTI_LOT_UNSUPPORTED"]);
  assertEquals(resolvePadBlockersForLot({ ...params, facts: [] }), ["PAD_CATEGORY_REQUIRED"]);
  // Ajouter le fait de mode ne change rien au verdict PAD.
  assertEquals(
    resolvePadBlockersForLot({ ...params, facts: [...PAD_FACTS, modeFact("LOLO") as PadScopeFact] }),
    ["PAD_MULTI_LOT_UNSUPPORTED"],
  );
});

// ── Multi-lot : le mode global n'est jamais prêté à un lot ───────────────────

function lotFact(value: unknown, key = TERMINAL_OPERATION_MODE_FACT_KEY) {
  return { key, value };
}

Deno.test("TERMINAL/multi-lot: un lot sans mode déclaré bloque, même si le global existe", () => {
  // mergeFactsForLot ferait descendre le mode global; le garde ne lit QUE le lot.
  assertEquals(
    resolveTerminalBlockersForLot({
      lotExtractedFacts: [lotFact("MARITIME", "routing.transport_mode")],
      effectiveServiceKeys: scopeOf("DAP_PROJECT_IMPORT"),
    }),
    [TERMINAL_OPERATION_MODE_REQUIRED],
  );
  assertEquals(
    resolveTerminalBlockersForLot({
      lotExtractedFacts: [],
      effectiveServiceKeys: scopeOf("DAP_PROJECT_IMPORT"),
    }),
    [TERMINAL_OPERATION_MODE_REQUIRED],
  );
});

Deno.test("TERMINAL/multi-lot: mêmes codes qu'en mono-lot", () => {
  const effectiveServiceKeys = scopeOf("DAP_PROJECT_IMPORT");
  assertEquals(
    resolveTerminalBlockersForLot({ lotExtractedFacts: [lotFact("LOLO")], effectiveServiceKeys }),
    [],
  );
  assertEquals(
    resolveTerminalBlockersForLot({ lotExtractedFacts: [lotFact("roro")], effectiveServiceKeys }),
    [DAKAR_TERMINAL_RATE_REQUIRED],
  );
  assertEquals(
    resolveTerminalBlockersForLot({ lotExtractedFacts: [lotFact(" ConRo ")], effectiveServiceKeys }),
    [DAKAR_TERMINAL_RATE_REQUIRED],
  );
  assertEquals(
    resolveTerminalBlockersForLot({ lotExtractedFacts: [lotFact("RO-RO")], effectiveServiceKeys }),
    [TERMINAL_OPERATION_MODE_REQUIRED],
  );
});

Deno.test("TERMINAL/multi-lot: dossier mixte — chaque lot est jugé sur son propre mode", () => {
  const containerScope = scopeOf("DAP_PROJECT_IMPORT");
  const lots = [
    { label: "conteneurs LoLo", facts: [lotFact("LOLO")], expected: [] },
    { label: "roulant", facts: [lotFact("RORO")], expected: [DAKAR_TERMINAL_RATE_REQUIRED] },
    { label: "non déclaré", facts: [], expected: [TERMINAL_OPERATION_MODE_REQUIRED] },
  ];
  for (const lot of lots) {
    assertEquals(
      resolveTerminalBlockersForLot({ lotExtractedFacts: lot.facts, effectiveServiceKeys: containerScope }),
      lot.expected,
      lot.label,
    );
  }
});

Deno.test("TERMINAL/multi-lot: une valeur non textuelle déclarée par le lot reste invalide", () => {
  const effectiveServiceKeys = scopeOf("DAP_PROJECT_IMPORT");
  for (const raw of [1, true, null, undefined, { mode: "LOLO" }, ["LOLO"]]) {
    assertEquals(
      resolveTerminalBlockersForLot({ lotExtractedFacts: [lotFact(raw)], effectiveServiceKeys }),
      [TERMINAL_OPERATION_MODE_REQUIRED],
      JSON.stringify(raw) ?? "undefined",
    );
  }
});

Deno.test("TERMINAL/multi-lot: un lot hors périmètre DTHC n'est jamais bloqué", () => {
  for (const pkg of NON_DTHC_PACKAGES) {
    assertEquals(
      resolveTerminalBlockersForLot({ lotExtractedFacts: [], effectiveServiceKeys: scopeOf(pkg) }),
      [],
      pkg,
    );
  }
});

Deno.test("TERMINAL/multi-lot: entrées nullish sûres", () => {
  assertEquals(
    resolveTerminalBlockersForLot({
      lotExtractedFacts: null as unknown as Array<{ key?: string; value?: unknown }>,
      effectiveServiceKeys: scopeOf("AIR_IMPORT_DAP"),
    }),
    [],
  );
  assertEquals(
    resolveTerminalBlockersForLot({
      lotExtractedFacts: null as unknown as Array<{ key?: string; value?: unknown }>,
      effectiveServiceKeys: scopeOf("DAP_PROJECT_IMPORT"),
    }),
    [TERMINAL_OPERATION_MODE_REQUIRED],
  );
});

Deno.test("TERMINAL/multi-lot: pur — répétable et non mutant", () => {
  const lotExtractedFacts = [lotFact("RORO")];
  const effectiveServiceKeys = scopeOf("DAP_PROJECT_IMPORT");
  const factsBefore = JSON.stringify(lotExtractedFacts);
  const keysBefore = [...effectiveServiceKeys];
  const params = { lotExtractedFacts, effectiveServiceKeys };

  const first = resolveTerminalBlockersForLot(params);
  assertEquals(first, resolveTerminalBlockersForLot(params));
  first.push("MUTATED");
  assertEquals(resolveTerminalBlockersForLot(params), [DAKAR_TERMINAL_RATE_REQUIRED]);

  assertEquals(JSON.stringify(lotExtractedFacts), factsBefore, "faits de lot mutés");
  assertEquals(effectiveServiceKeys, keysBefore, "périmètre muté");
});
