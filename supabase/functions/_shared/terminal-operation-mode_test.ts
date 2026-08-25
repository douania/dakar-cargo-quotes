import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  DAKAR_TERMINAL_RATE_REQUIRED,
  normalizeTerminalOperationFactWrite,
  normalizeTerminalOperationMode,
  readTerminalOperationMode,
  requiresTerminalOperationModeGap,
  resolveTerminalOperationBlockers,
  scopeRequiresTerminalOperator,
  TERMINAL_OPERATION_MODE_FACT_KEY,
  TERMINAL_OPERATION_MODE_REQUIRED,
  TERMINAL_OPERATION_MODES,
  TERMINAL_OPERATOR_BY_MODE,
  terminalOperationBlockerMessage,
  type TerminalScopeFact,
} from "./terminal-operation-mode.ts";

/**
 * Doctrine terminale (2026-08-25) — la décision PURE, isolée de toute base.
 *
 * Ce que ces tests épinglent :
 *   - LoLo = DP World, RoRo/ConRo = Dakar Terminal ;
 *   - aucun montant Dakar Terminal sans barème : RoRo/ConRo bloque, point ;
 *   - le mode ne se devine pas — ni depuis un synonyme, ni depuis un transporteur.
 */

const NO_FACTS: TerminalScopeFact[] = [];
const DTHC_SCOPE = ["PORT_DAKAR_HANDLING", "DTHC", "TRUCKING", "CUSTOMS_DAKAR"];
const NON_DTHC_SCOPE = ["AIR_HANDLING", "CUSTOMS_DAKAR", "TRUCKING", "AGENCY"];

function modeFact(value: unknown, column: "value_text" | "value_json" | "value_number" = "value_text"): TerminalScopeFact {
  return { fact_key: TERMINAL_OPERATION_MODE_FACT_KEY, [column]: value } as TerminalScopeFact;
}

function blockers(facts: TerminalScopeFact[], effectiveServiceKeys = DTHC_SCOPE): string[] {
  return resolveTerminalOperationBlockers({ facts, effectiveServiceKeys });
}

// ── Normalisation ───────────────────────────────────────────────────────────

Deno.test("TERMINAL: les trois valeurs canoniques sont exactement LOLO/RORO/CONRO", () => {
  assertEquals([...TERMINAL_OPERATION_MODES], ["LOLO", "RORO", "CONRO"]);
  for (const mode of TERMINAL_OPERATION_MODES) {
    assertEquals(normalizeTerminalOperationMode(mode), mode);
  }
});

Deno.test("TERMINAL: normalisation casse + espaces", () => {
  assertEquals(normalizeTerminalOperationMode("lolo"), "LOLO");
  assertEquals(normalizeTerminalOperationMode("  RoRo  "), "RORO");
  assertEquals(normalizeTerminalOperationMode("\tConRo\n"), "CONRO");
  assertEquals(normalizeTerminalOperationMode("cOnRo"), "CONRO");
});

Deno.test("TERMINAL: aucun synonyme n'est deviné", () => {
  // Deviner reviendrait à choisir un opérateur terminal à la place de l'humain.
  for (const raw of ["RO-RO", "RO RO", "LO-LO", "LO/LO", "ROULIER", "CON-RO", "CONVENTIONNEL", "BREAKBULK", "FCL", "DPW", "DP WORLD", "DAKAR TERMINAL", "GRIMALDI"]) {
    assertEquals(normalizeTerminalOperationMode(raw), null, `${raw} ne doit pas être accepté`);
  }
});

Deno.test("TERMINAL: valeurs vides ou non textuelles → inconnu", () => {
  for (const raw of ["", "   ", null, undefined, 0, 1, true, false, {}, [], { mode: "LOLO" }, ["LOLO"]]) {
    assertEquals(normalizeTerminalOperationMode(raw), null, `${JSON.stringify(raw)} doit être inconnu`);
  }
});

Deno.test("TERMINAL: l'écriture manuelle canonicalise une valeur texte valide", () => {
  assertEquals(normalizeTerminalOperationFactWrite({ value_text: "  rOrO  " }), "RORO");
  assertEquals(normalizeTerminalOperationFactWrite({ value_text: "lolo" }), "LOLO");
  assertEquals(normalizeTerminalOperationFactWrite({ value_text: "CONRO" }), "CONRO");
});

Deno.test("TERMINAL: l'écriture manuelle refuse tout payload ambigu ou non canonisable", () => {
  assertEquals(normalizeTerminalOperationFactWrite({ value_text: "RO-RO" }), null);
  assertEquals(normalizeTerminalOperationFactWrite({ value_text: "LOLO", value_number: 1 }), null);
  assertEquals(normalizeTerminalOperationFactWrite({ value_text: "LOLO", value_json: "RORO" }), null);
  assertEquals(normalizeTerminalOperationFactWrite({ value_json: "LOLO" }), null);
  assertEquals(normalizeTerminalOperationFactWrite({}), null);
});

Deno.test("TERMINAL: la table opérateur reflète la doctrine", () => {
  assertEquals(TERMINAL_OPERATOR_BY_MODE.LOLO, "DP_WORLD");
  assertEquals(TERMINAL_OPERATOR_BY_MODE.RORO, "DAKAR_TERMINAL");
  // Un conteneur FCL transporté par un ConRo relève de Dakar Terminal, pas de DP World.
  assertEquals(TERMINAL_OPERATOR_BY_MODE.CONRO, "DAKAR_TERMINAL");
});

// ── Lecture du fait ─────────────────────────────────────────────────────────

Deno.test("TERMINAL: lecture depuis value_text, avec normalisation", () => {
  assertEquals(readTerminalOperationMode([modeFact(" roro ")]), "RORO");
});

Deno.test("TERMINAL: value_json textuel accepté, objet de métadonnées ignoré", () => {
  assertEquals(readTerminalOperationMode([modeFact("CONRO", "value_json")]), "CONRO");
  // Même doctrine que pad-scope-blocker: value_json peut porter des métadonnées
  // de propagation ; la valeur métier reste dans value_text.
  assertEquals(
    readTerminalOperationMode([
      { fact_key: TERMINAL_OPERATION_MODE_FACT_KEY, value_json: { origin: "MAP-6", mode: "LOLO" }, value_text: "RORO" },
    ]),
    "RORO",
  );
  assertEquals(
    readTerminalOperationMode([
      { fact_key: TERMINAL_OPERATION_MODE_FACT_KEY, value_json: { origin: "MAP-6", mode: "LOLO" } },
    ]),
    null,
  );
});

Deno.test("TERMINAL: value_number n'est jamais un mode", () => {
  assertEquals(readTerminalOperationMode([modeFact(1, "value_number")]), null);
});

Deno.test("TERMINAL: fait absent, autre clé, ou tableau vide → inconnu", () => {
  assertEquals(readTerminalOperationMode(NO_FACTS), null);
  assertEquals(readTerminalOperationMode([{ fact_key: "routing.transport_mode", value_text: "MARITIME" }]), null);
  assertEquals(readTerminalOperationMode(null as unknown as TerminalScopeFact[]), null);
});

// ── Périmètre ───────────────────────────────────────────────────────────────

Deno.test("TERMINAL: seul DTHC arme le garde", () => {
  assertEquals(scopeRequiresTerminalOperator(DTHC_SCOPE), true);
  assertEquals(scopeRequiresTerminalOperator([" dthc "]), true);
  assertEquals(scopeRequiresTerminalOperator(NON_DTHC_SCOPE), false);
  assertEquals(scopeRequiresTerminalOperator([]), false);
  assertEquals(scopeRequiresTerminalOperator(null as unknown as string[]), false);
});

Deno.test("TERMINAL: PORT_DAKAR_HANDLING n'arme PAS le garde terminal", () => {
  // C'est le marqueur PAD (redevance séparée, non facturable), pas de la manutention.
  assertEquals(scopeRequiresTerminalOperator(["PORT_DAKAR_HANDLING"]), false);
  assertEquals(scopeRequiresTerminalOperator(["PAD_DROIT_PASSAGE"]), false);
  assertEquals(blockers(NO_FACTS, ["PORT_DAKAR_HANDLING", "TRUCKING"]), []);
});

Deno.test("TERMINAL: THC_EXPORT n'est pas DTHC — l'export n'est pas touché", () => {
  assertEquals(scopeRequiresTerminalOperator(["PORT_CHARGES", "THC_EXPORT", "SEA_FREIGHT"]), false);
});

// ── Le garde ────────────────────────────────────────────────────────────────

Deno.test("TERMINAL: DTHC hors périmètre → aucun changement, quels que soient les faits", () => {
  for (const facts of [NO_FACTS, [modeFact("LOLO")], [modeFact("RORO")], [modeFact("n'importe quoi")]]) {
    assertEquals(blockers(facts, NON_DTHC_SCOPE), []);
    assertEquals(blockers(facts, []), []);
  }
});

Deno.test("TERMINAL: DTHC au périmètre + mode absent → TERMINAL_OPERATION_MODE_REQUIRED", () => {
  assertEquals(blockers(NO_FACTS), [TERMINAL_OPERATION_MODE_REQUIRED]);
});

Deno.test("TERMINAL: DTHC au périmètre + mode invalide → TERMINAL_OPERATION_MODE_REQUIRED", () => {
  for (const raw of ["RO-RO", "ROULIER", "", "   ", "DPW", "MARITIME"]) {
    assertEquals(blockers([modeFact(raw)]), [TERMINAL_OPERATION_MODE_REQUIRED], `valeur ${JSON.stringify(raw)}`);
  }
  assertEquals(blockers([modeFact(42, "value_number")]), [TERMINAL_OPERATION_MODE_REQUIRED]);
  assertEquals(blockers([modeFact({ mode: "LOLO" }, "value_json")]), [TERMINAL_OPERATION_MODE_REQUIRED]);
});

Deno.test("TERMINAL: LOLO autorise le chemin DTHC existant", () => {
  // Aucun blocage: run-pricing reprend son chemin DTHC, montant et source inchangés.
  assertEquals(blockers([modeFact("LOLO")]), []);
  assertEquals(blockers([modeFact("  lolo ")]), []);
});

Deno.test("TERMINAL: RORO → DAKAR_TERMINAL_RATE_REQUIRED", () => {
  assertEquals(blockers([modeFact("RORO")]), [DAKAR_TERMINAL_RATE_REQUIRED]);
});

Deno.test("TERMINAL: CONRO → DAKAR_TERMINAL_RATE_REQUIRED (conteneur FCL compris)", () => {
  assertEquals(blockers([modeFact("CONRO")]), [DAKAR_TERMINAL_RATE_REQUIRED]);
  // Un périmètre conteneur complet reste Dakar Terminal si le navire est ConRo.
  assertEquals(
    blockers([modeFact("CONRO")], ["PORT_DAKAR_HANDLING", "DTHC", "EMPTY_RETURN", "TRUCKING"]),
    [DAKAR_TERMINAL_RATE_REQUIRED],
  );
});

Deno.test("TERMINAL: un seul blocage à la fois, jamais les deux", () => {
  for (const facts of [NO_FACTS, [modeFact("LOLO")], [modeFact("RORO")], [modeFact("CONRO")], [modeFact("???")]]) {
    assert(blockers(facts).length <= 1);
  }
});

Deno.test("TERMINAL: les codes de blocage sont stables", () => {
  // Persistés dans pricing_runs.outputs_json — les renommer est un breaking change.
  assertEquals(TERMINAL_OPERATION_MODE_REQUIRED, "TERMINAL_OPERATION_MODE_REQUIRED");
  assertEquals(DAKAR_TERMINAL_RATE_REQUIRED, "DAKAR_TERMINAL_RATE_REQUIRED");
  assertEquals(TERMINAL_OPERATION_MODE_FACT_KEY, "routing.terminal_operation_mode");
});

Deno.test("TERMINAL: chaque blocage porte un message opérateur non vide et distinct", () => {
  const modeMsg = terminalOperationBlockerMessage([TERMINAL_OPERATION_MODE_REQUIRED]);
  const rateMsg = terminalOperationBlockerMessage([DAKAR_TERMINAL_RATE_REQUIRED]);
  assert(modeMsg.length > 0 && rateMsg.length > 0);
  assert(modeMsg !== rateMsg);
  assertEquals(terminalOperationBlockerMessage([]), "");
  assertEquals(terminalOperationBlockerMessage(null as unknown as string[]), "");
});

// ── Gap de clarification ────────────────────────────────────────────────────

Deno.test("TERMINAL: le gap ne s'ouvre que sur mode absent ou invalide", () => {
  const gap = (facts: TerminalScopeFact[], keys = DTHC_SCOPE) =>
    requiresTerminalOperationModeGap({ facts, effectiveServiceKeys: keys });

  assertEquals(gap(NO_FACTS), true);
  assertEquals(gap([modeFact("RO-RO")]), true);
  assertEquals(gap([modeFact("LOLO")]), false);
  // RoRo/ConRo déclaré: le fait est là et juste — c'est le barème qui manque,
  // inutile de reposer la question à l'opérateur.
  assertEquals(gap([modeFact("RORO")]), false);
  assertEquals(gap([modeFact("CONRO")]), false);
  // Hors périmètre DTHC: jamais de gap.
  assertEquals(gap(NO_FACTS, NON_DTHC_SCOPE), false);
});

// ── Pureté / idempotence ────────────────────────────────────────────────────

Deno.test("TERMINAL: le garde est pur — répétable et non mutant", () => {
  const facts = [modeFact("RORO")];
  const keys = [...DTHC_SCOPE];
  const factsBefore = JSON.stringify(facts);
  const keysBefore = [...keys];
  const params = { facts, effectiveServiceKeys: keys };

  const first = resolveTerminalOperationBlockers(params);
  const second = resolveTerminalOperationBlockers(params);
  assertEquals(first, second);
  assertEquals(first, [DAKAR_TERMINAL_RATE_REQUIRED]);

  // Le tableau retourné n'est pas un état interne partagé.
  first.push("MUTATED");
  assertEquals(resolveTerminalOperationBlockers(params), [DAKAR_TERMINAL_RATE_REQUIRED]);

  assertEquals(JSON.stringify(facts), factsBefore, "les faits d'entrée ont été mutés");
  assertEquals(keys, keysBefore, "le périmètre d'entrée a été muté");
});

Deno.test("TERMINAL: entrées nullish sûres", () => {
  assertEquals(
    resolveTerminalOperationBlockers({
      facts: null as unknown as TerminalScopeFact[],
      effectiveServiceKeys: null as unknown as string[],
    }),
    [],
  );
  assertEquals(
    resolveTerminalOperationBlockers({
      facts: null as unknown as TerminalScopeFact[],
      effectiveServiceKeys: DTHC_SCOPE,
    }),
    [TERMINAL_OPERATION_MODE_REQUIRED],
  );
});
