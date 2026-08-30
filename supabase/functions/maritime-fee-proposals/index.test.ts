// Tests Deno de l'enveloppe read-only `proposal_only` (PATCH B2).
//
// Exécution (convention repo = Deno test, Vitest ne couvre pas supabase/functions/**) :
//   deno test supabase/functions/maritime-fee-proposals/index.test.ts
//
// Ces tests appellent UNIQUEMENT les fonctions pures exportées (aucun serveur,
// aucune DB, aucun réseau). Ils ne modifient aucune configuration globale.

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { buildProposalOnlyEnvelope } from "./index.ts";
import {
  mapFactsToMaritimeInput,
  resolveOperationTypeFromRequestType,
} from "../_shared/maritime-fee-proposals/fact-mapping.ts";
import type { Parametrage } from "../_shared/maritime-fee-proposals/engine.ts";
import parametrageJson from "../_shared/maritime-fee-proposals/dcq_pad_parametrage.json" with {
  type: "json",
};

const parametrage = parametrageJson as unknown as Parametrage;

// Clés strictement interdites dans la réponse (anti-comptage / anti-total ferme).
const FORBIDDEN_KEYS = [
  "lines",
  "tariff_lines",
  "total_ht",
  "total_ttc",
  "totals",
];

// 1. Direct input : import conteneur T04 + tonnage valide.
Deno.test("1 - Direct input import conteneur T04 => proposals + suggested + proposal_only", () => {
  const res = buildProposalOnlyEnvelope(
    {
      operation_type: "IMPORT",
      cargo_mode: "CONTENEUR",
      pad_category: "T04",
      tonnage: 322,
    },
    parametrage,
  );

  assertEquals(res.ok, true);
  assertEquals(res.mode, "proposal_only");
  assertEquals(res.accounting_effect, "none");
  assert(res.proposals.length > 0, "propositions attendues en IMPORT");

  const pad = res.proposals.find((p) => p.category === "taxe_de_port");
  assert(pad, "proposition taxe de port attendue");
  assertEquals(pad!.amount, null);
  assertNotEquals(pad!.suggested_amount_xof, null);
  assertEquals(pad!.suggested_amount_xof, 988218); // 3069 x 322
  assertEquals(res.input_debug.operation_type, "IMPORT");
  assertEquals(res.input_debug.has_tonnage, true);
});

// 2. Export : aucune proposition + warning.
Deno.test("2 - Export => proposals=[] + warning", () => {
  const res = buildProposalOnlyEnvelope(
    {
      operation_type: "EXPORT",
      cargo_mode: "CONTENEUR",
      pad_category: "T04",
      tonnage: 322,
    },
    parametrage,
  );
  assertEquals(res.mode, "proposal_only");
  assertEquals(res.proposals.length, 0);
  assert(res.warnings.length > 0, "un warning est attendu");
});

// 3. Transit : aucune proposition + warning.
Deno.test("3 - Transit => proposals=[] + warning", () => {
  const res = buildProposalOnlyEnvelope(
    {
      operation_type: "TRANSIT",
      cargo_mode: "CONTENEUR",
      pad_category: "T04",
      tonnage: 322,
    },
    parametrage,
  );
  assertEquals(res.proposals.length, 0);
  assert(res.warnings.length > 0, "un warning est attendu");
});

// 4. USD sans usdToXofRate : commission suggested null + missing usd_exchange_rate.
Deno.test("4 - USD sans usdToXofRate => commission suggested null + missing usd_exchange_rate", () => {
  const res = buildProposalOnlyEnvelope(
    {
      operation_type: "IMPORT",
      cargo_mode: "CONTENEUR",
      carrier: "ONE",
      pad_category: "T04",
      tonnage: 322,
      seafreight: { value: 1000, currency: "USD" },
      // pas de usdToXofRate
    },
    parametrage,
  );
  const commission = res.proposals.find((p) =>
    p.category === "commission_debours"
  );
  assert(commission, "proposition commission ONE attendue");
  assertEquals(commission!.suggested_amount_xof, null);
  assert(commission!.missing_confirmation.includes("usd_exchange_rate"));
});

// 5. Contrat anti-comptage : aucune clé interdite dans la réponse.
Deno.test("5 - Réponse ne contient AUCUNE clé interdite", () => {
  const res = buildProposalOnlyEnvelope(
    {
      operation_type: "IMPORT",
      cargo_mode: "CONTENEUR",
      carrier: "ONE",
      pad_category: "T04",
      tonnage: 322,
      seafreight: { value: 1000, currency: "EUR" },
    },
    parametrage,
  );
  // Sérialisation complète : les clés interdites ne doivent apparaître nulle part
  // au niveau racine de l'enveloppe.
  const rootKeys = Object.keys(res as unknown as Record<string, unknown>);
  for (const forbidden of FORBIDDEN_KEYS) {
    assert(
      !rootKeys.includes(forbidden),
      `clé interdite présente à la racine: ${forbidden}`,
    );
  }
});

// 6. Aucun montant ferme : toutes les propositions ont amount === null.
Deno.test("6 - Toutes les propositions ont amount === null", () => {
  const scenarios = [
    {
      operation_type: "IMPORT",
      cargo_mode: "CONTENEUR",
      carrier: "CMA CGM",
      pad_category: "T04",
      tonnage: 322,
    },
    {
      operation_type: "IMPORT",
      cargo_mode: "RORO",
      carrier: "GRIMALDI",
      pad_category: "T09",
      tonnage: 12,
    },
    {
      operation_type: "IMPORT",
      cargo_mode: "CONTENEUR",
      carrier: "Hapag-Lloyd",
      pad_category: "T12",
      tonnage: 5,
      seafreight: { value: 1000, currency: "EUR" as const },
    },
  ];
  for (const input of scenarios) {
    const res = buildProposalOnlyEnvelope(input, parametrage);
    assert(res.proposals.length > 0, "propositions attendues en IMPORT");
    for (const p of res.proposals) {
      assertEquals(p.amount, null);
      assertEquals(p.needs_human_confirmation, true);
    }
  }
});

// 7. Mapping facts -> input (read-only) : conteneur + carrier + tonnage dérivés.
Deno.test("7 - mapFactsToMaritimeInput dérive un input cohérent", () => {
  const input = mapFactsToMaritimeInput("SEA_FCL_IMPORT", [
    { fact_key: "cargo.containers", value_json: [{ type: "40HC" }] },
    { fact_key: "carrier.name", value_text: "ONE" },
    { fact_key: "cargo.pad_category", value_text: "T04" },
    { fact_key: "cargo.weight_kg", value_number: 322000 },
    { fact_key: "cargo.freight_cost", value_number: 1000 },
    { fact_key: "cargo.freight_currency", value_text: "EUR" },
  ]);

  assertEquals(input.operation_type, "IMPORT");
  assertEquals(input.cargo_mode, "CONTENEUR");
  assertEquals(input.carrier, "ONE");
  assertEquals(input.pad_category, "T04");
  assertEquals(input.tonnage, 322); // 322000 / 1000
  assertEquals(input.seafreight?.value, 1000);
  assertEquals(input.seafreight?.currency, "EUR");
  // Jamais deviné : pas de taux USD dans les faits.
  assertEquals(input.usdToXofRate, null);
});

// 8. Mapping incertain : faits absents => null (ne pas deviner).
Deno.test("8 - mapFactsToMaritimeInput ne devine pas les faits absents", () => {
  const input = mapFactsToMaritimeInput(null, []);
  assertEquals(input.operation_type, null);
  assertEquals(input.cargo_mode, null);
  assertEquals(input.carrier, null);
  assertEquals(input.pad_category, null);
  assertEquals(input.tonnage, null);
  assertEquals(input.seafreight, null);
  assertEquals(input.usdToXofRate, null);
});

// 9. resolveOperationTypeFromRequestType : mapping strict request_type -> operation_type.
Deno.test("9 - SEA_FCL_IMPORT => operation_type IMPORT", () => {
  assertEquals(resolveOperationTypeFromRequestType("SEA_FCL_IMPORT"), "IMPORT");
});

Deno.test("9b - mapping request_type strict (import/export/transit/inconnu)", () => {
  assertEquals(resolveOperationTypeFromRequestType("SEA_LCL_IMPORT"), "IMPORT");
  assertEquals(
    resolveOperationTypeFromRequestType("SEA_BREAKBULK_IMPORT"),
    "IMPORT",
  );
  assertEquals(resolveOperationTypeFromRequestType("AIR_IMPORT"), null);
  assertEquals(resolveOperationTypeFromRequestType("ROAD_IMPORT"), null);
  assertEquals(resolveOperationTypeFromRequestType("MULTIMODAL_IMPORT"), null);
  assertEquals(resolveOperationTypeFromRequestType("EXPORT_SEA_FCL"), "EXPORT");
  assertEquals(resolveOperationTypeFromRequestType("TRANSIT"), "TRANSIT");
  assertEquals(resolveOperationTypeFromRequestType("TRANSSHIPMENT"), "TRANSIT");
  assertEquals(
    resolveOperationTypeFromRequestType("TRANSBORDEMENT"),
    "TRANSIT",
  );
  // Non reconnu / vide : null (aucune devinette).
  assertEquals(resolveOperationTypeFromRequestType("import"), null);
  assertEquals(resolveOperationTypeFromRequestType("SOMETHING_ELSE"), null);
  assertEquals(resolveOperationTypeFromRequestType(null), null);
  assertEquals(resolveOperationTypeFromRequestType(""), null);
});

Deno.test("9c - SEA_BREAKBULK_IMPORT fixe seulement le mode conventionnel explicite", () => {
  const input = mapFactsToMaritimeInput("SEA_BREAKBULK_IMPORT", []);
  assertEquals(input.operation_type, "IMPORT");
  assertEquals(input.cargo_mode, "CONVENTIONNEL");
});

Deno.test("9d - AIR_IMPORT reste hors périmètre maritime même avec des conteneurs", () => {
  const input = mapFactsToMaritimeInput("AIR_IMPORT", [
    { fact_key: "cargo.containers", value_json: [{ type: "20GP" }] },
  ]);
  const res = buildProposalOnlyEnvelope(input, parametrage);
  assertEquals(input.operation_type, null);
  assertEquals(res.proposals, []);
});

// 10. Chaîne complète case-like : SEA_FCL_IMPORT -> proposals via l'enveloppe.
Deno.test("10 - SEA_FCL_IMPORT mappé produit une enveloppe proposal_only avec propositions", () => {
  const input = mapFactsToMaritimeInput("SEA_FCL_IMPORT", [
    { fact_key: "cargo.containers", value_json: [{ type: "40HC" }] },
    { fact_key: "cargo.pad_category", value_text: "T04" },
    { fact_key: "cargo.weight_kg", value_number: 322000 },
  ]);
  const res = buildProposalOnlyEnvelope(input, parametrage);
  assertEquals(res.mode, "proposal_only");
  assertEquals(res.input_debug.operation_type, "IMPORT");
  assert(res.proposals.length > 0, "propositions attendues (IMPORT résolu)");
  for (const p of res.proposals) assertEquals(p.amount, null);
});
