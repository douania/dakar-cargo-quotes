import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  TERMINAL_OPERATION_MODE_FACT_KEY,
  type TerminalScopeFact,
} from "../_shared/terminal-operation-mode.ts";
import { SERVICE_PACKAGES, resolveEffectiveServiceKeys } from "../_shared/service-scope.ts";

/**
 * TERMINAL-GAP — build-case-puzzle doit refuser READY_TO_PRICE exactement quand
 * run-pricing refuserait de chiffrer sur TERMINAL_OPERATION_MODE_REQUIRED.
 *
 * On teste ici la résolution PURE du gap (périmètre + validité du mode), la
 * partie DB (insert/upgrade/resolve idempotents) restant hors portée hermétique.
 */

// L'Edge Function n'est importée que pour ses helpers purs.
Deno.env.set("BUILD_CASE_PUZZLE_DISABLE_SERVE", "1");
const { resolveTerminalModeGapState, TERMINAL_MODE_GAP_KEY, TERMINAL_SCOPE_FACT_KEYS } =
  await import("./index.ts") as {
    resolveTerminalModeGapState: (facts: TerminalScopeFact[]) => {
      servicePackage: string;
      effectiveServiceKeys: string[];
      gapRequired: boolean;
    };
    TERMINAL_MODE_GAP_KEY: string;
    TERMINAL_SCOPE_FACT_KEYS: string[];
  };

function facts(servicePackage: string, mode?: unknown, overrides?: unknown): TerminalScopeFact[] {
  const rows: TerminalScopeFact[] = [{ fact_key: "service.package", value_text: servicePackage }];
  if (mode !== undefined) {
    rows.push({ fact_key: TERMINAL_OPERATION_MODE_FACT_KEY, value_text: mode });
  }
  if (overrides !== undefined) {
    rows.push({ fact_key: "service.overrides", value_json: overrides });
  }
  return rows;
}

Deno.test("TERMINAL-GAP: la clé du gap est celle du fait, pour que sa saisie le referme", () => {
  assertEquals(TERMINAL_MODE_GAP_KEY, TERMINAL_OPERATION_MODE_FACT_KEY);
  assertEquals(TERMINAL_MODE_GAP_KEY, "routing.terminal_operation_mode");
});

Deno.test("TERMINAL-GAP: le SELECT de scope couvre périmètre + mode", () => {
  // Sans l'une de ces clés, l'état du gap serait calculé sur un périmètre faux.
  for (const key of ["service.package", "service.overrides", TERMINAL_OPERATION_MODE_FACT_KEY]) {
    assert(TERMINAL_SCOPE_FACT_KEYS.includes(key), `${key} manquant du SELECT`);
  }
});

Deno.test("TERMINAL-GAP: le périmètre est résolu comme dans run-pricing", () => {
  const state = resolveTerminalModeGapState(facts("DAP_PROJECT_IMPORT"));
  assertEquals(state.servicePackage, "DAP_PROJECT_IMPORT");
  assertEquals(
    state.effectiveServiceKeys,
    resolveEffectiveServiceKeys("DAP_PROJECT_IMPORT", { add: [], remove: [] }),
  );
});

Deno.test("TERMINAL-GAP: package normalisé (casse/espaces) avant résolution", () => {
  const state = resolveTerminalModeGapState(facts("  dap_project_import  "));
  assertEquals(state.servicePackage, "DAP_PROJECT_IMPORT");
  assertEquals(state.gapRequired, true);
});

Deno.test("TERMINAL-GAP: gap ouvert sur tout package DTHC sans mode", () => {
  const dthcPackages = Object.keys(SERVICE_PACKAGES).filter((pkg) =>
    resolveEffectiveServiceKeys(pkg, { add: [], remove: [] }).includes("DTHC")
  );
  assert(dthcPackages.length > 0, "au moins un package DTHC attendu");
  for (const pkg of dthcPackages) {
    assertEquals(resolveTerminalModeGapState(facts(pkg)).gapRequired, true, pkg);
  }
});

Deno.test("TERMINAL-GAP: aucun gap hors périmètre DTHC (air, export, LCL DAP)", () => {
  for (const pkg of Object.keys(SERVICE_PACKAGES)) {
    if (resolveEffectiveServiceKeys(pkg, { add: [], remove: [] }).includes("DTHC")) continue;
    assertEquals(resolveTerminalModeGapState(facts(pkg)).gapRequired, false, pkg);
  }
  assertEquals(resolveTerminalModeGapState(facts("AIR_IMPORT_DAP")).gapRequired, false);
  assertEquals(resolveTerminalModeGapState(facts("EXPORT_SENEGAL")).gapRequired, false);
});

Deno.test("TERMINAL-GAP: package absent ou inconnu → périmètre vide → aucun gap", () => {
  assertEquals(resolveTerminalModeGapState([]).gapRequired, false);
  assertEquals(resolveTerminalModeGapState(facts("")).gapRequired, false);
  assertEquals(resolveTerminalModeGapState(facts("NOT_A_PACKAGE")).gapRequired, false);
});

Deno.test("TERMINAL-GAP: un mode valide referme le gap", () => {
  for (const mode of ["LOLO", "lolo", " RoRo ", "CONRO"]) {
    assertEquals(
      resolveTerminalModeGapState(facts("DAP_PROJECT_IMPORT", mode)).gapRequired,
      false,
      `mode ${mode}`,
    );
  }
});

Deno.test("TERMINAL-GAP: un mode invalide maintient le gap ouvert", () => {
  // C'est la raison du `continue` dans le final sync 10b : la seule PRÉSENCE du
  // fait ne doit pas refermer le gap.
  for (const mode of ["RO-RO", "ROULIER", "", "   ", "DPW", 42, null, { mode: "LOLO" }]) {
    assertEquals(
      resolveTerminalModeGapState(facts("DAP_PROJECT_IMPORT", mode)).gapRequired,
      true,
      `mode ${JSON.stringify(mode)}`,
    );
  }
});

Deno.test("TERMINAL-GAP: RoRo/ConRo déclaré n'ouvre PAS de gap de mode", () => {
  // Le fait est renseigné et juste ; c'est le barème Dakar Terminal qui manque,
  // et ce blocage-là appartient à run-pricing (DAKAR_TERMINAL_RATE_REQUIRED).
  assertEquals(resolveTerminalModeGapState(facts("DAP_PROJECT_IMPORT", "RORO")).gapRequired, false);
  assertEquals(resolveTerminalModeGapState(facts("DAP_PROJECT_IMPORT", "CONRO")).gapRequired, false);
});

Deno.test("TERMINAL-GAP: service.overrides déplacent le périmètre, donc le gap", () => {
  assertEquals(
    resolveTerminalModeGapState(facts("DAP_PROJECT_IMPORT", undefined, { add: [], remove: ["DTHC"] })).gapRequired,
    false,
  );
  assertEquals(
    resolveTerminalModeGapState(facts("LCL_IMPORT_DAP", undefined, { add: ["DTHC"], remove: [] })).gapRequired,
    true,
  );
});

Deno.test("TERMINAL-GAP: DDP_PROJECT_IMPORT se comporte comme DAP_PROJECT_IMPORT", () => {
  for (const mode of [undefined, "LOLO", "RORO", "RO-RO"]) {
    assertEquals(
      resolveTerminalModeGapState(facts("DDP_PROJECT_IMPORT", mode)).gapRequired,
      resolveTerminalModeGapState(facts("DAP_PROJECT_IMPORT", mode)).gapRequired,
      `mode ${String(mode)}`,
    );
  }
});

Deno.test("TERMINAL-GAP: résolution pure — répétable et non mutante", () => {
  const rows = facts("DAP_PROJECT_IMPORT", "RO-RO");
  const before = JSON.stringify(rows);
  const first = resolveTerminalModeGapState(rows);
  const second = resolveTerminalModeGapState(rows);
  assertEquals(first, second);
  assertEquals(first.gapRequired, true);
  assertEquals(JSON.stringify(rows), before, "les faits d'entrée ont été mutés");
});
