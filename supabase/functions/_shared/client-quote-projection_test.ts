import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyClientLine, projectClientQuote } from "./client-quote-projection.ts";
import { clientQuoteSnapshot, historicalSnapshot } from "../_tests/client-quote-fixture.ts";

Deno.test("line status follows the qualification recorded by the engine, never the source type alone", () => {
  const p = projectClientQuote(clientQuoteSnapshot);
  assertEquals(p.lines.map(l => l.status), [
    "firm", "estimated", "to_confirm", "estimated", "estimated", "to_confirm", "to_confirm", "franchise",
    "to_confirm", "estimated", "firm", "not_applicable", "client_charge",
  ]);
  // An OFFICIAL tariff applied under an operator assumption is not presented as firm.
  assertEquals(p.lines[9].label, "Estimé sous hypothèse, compris dans le total, non ferme");
  assertEquals(p.lines[0].label, "");
  assertEquals(p.lines[2].amountText, "À confirmer");
  assertEquals(p.lines[7].label, "Compris sous franchise de 10 jours, au-delà facturé");
  assertStringIncludes(p.lines[11].label, "pas de restitution à l’armateur");
  assertEquals(p.lines[12].label, "À la charge du client, non facturé par SODATRA");
  for (const zero of [7, 11, 12]) assert(p.lines[zero].amountText, "a zero always states its meaning");
});

Deno.test("without a recorded qualification nothing is claimed; explicit to-confirm and zero meanings stay", () => {
  const officialWithout = classifyClientLine({ description: "Supplément IMO — lot-1", amount: 450000, source: { type: "OFFICIAL" } }, {});
  assertEquals([officialWithout.status, officialWithout.label], ["unqualified", ""]);
  const calculatedWithout = classifyClientLine({ amount: 1000, source: { type: "CALCULATED" } }, {});
  assertEquals(calculatedWithout.status, "unqualified");
  const pricedImo = classifyClientLine({ description: "Supplément IMO — lot-1", amount: 450000, source: { type: "OFFICIAL" } },
    { scenario_provenance: { firm_eligible: true, assumption_dependent: false } });
  assertEquals(pricedImo.status, "firm", "an IMO surcharge already priced is never shown as 'éventuel'");
  assertEquals(classifyClientLine({ amount: null, source: { type: "TO_CONFIRM" } }, {}).status, "to_confirm");
});

Deno.test("bases: lot, equipment, ownership, weight with unit, danger, distance", () => {
  const p = projectClientQuote(clientQuoteSnapshot);
  assertEquals(p.bases.slice(0, 4), [
    "Trajet : CNSHA → SN-NDIOUM",
    "Lot 1 : 39 × 20HQ, SOC, 55 000 kg par conteneur, dangereux (UN3536, classe 9)",
    "Lot 2 : 13 × 20HQ, SOC, 18 000 kg par conteneur, statut dangereux non confirmé",
    "Lot 3 : 3 × 40HQ, COC, 15 000 kg par conteneur, statut dangereux non confirmé",
  ]);
  assertStringIncludes(p.bases.join("\n"), "Distance routière retenue : 480,9 km (lots 2, 3)");
});

Deno.test("particular conditions: named exclusions, conditional charges, no unproven authorisation, no codes", () => {
  const text = projectClientQuote(clientQuoteSnapshot).conditions.join("\n");
  assertStringIncludes(text, "Postes à confirmer, non compris dans le total (montant et applicabilité à confirmer) :");
  assertStringIncludes(text, "Supplément IMO éventuel — lot 2");
  assertStringIncludes(text, "Droits et taxes et calcul CAF non compris : périmètre DAP.");
  assertStringIncludes(text, "Lots 2, 3 : faisabilité, véhicule et éventuelles autorisations à vérifier auprès du transporteur ;");
  assertStringIncludes(text, "supplément IMO éventuel, montant et applicabilité à confirmer");
  assertStringIncludes(text, "Frais annexes de terminal : montant et applicabilité à confirmer, non compris dans le total.");
  assertStringIncludes(text, "À confirmer avant offre ferme : classification de la marchandise (lot 1), emballage (lot 2), régime douanier, lieu (origine).");
  for (const banned of ["facturés selon", "autorisation de transport exceptionnel", "SCENARIO_", "OPEN_POINT", "commodity_classification_unknown", "TO_CONFIRM", "http"]) {
    assertFalse(text.includes(banned), banned);
  }
});

Deno.test("general conditions: only those that apply, and no blanket exclusion of uncited services", () => {
  const p = projectClientQuote(clientQuoteSnapshot);
  assertEquals(p.general, [
    "Les montants « Estimé » sont compris dans le total mais ne sont pas fermes.",
    "Un poste non chiffré n’est pas gratuit.",
    "Une franchise de séjour est conditionnelle : au-delà, le séjour est facturable selon les conditions applicables.",
    "Cotation établie sur des bases opérateur explicites et révisables.",
    "Manutention des conteneurs selon le barème homologué, sans déduction liée à l’opérateur ou au mode de manutention.",
    "Bases révisables selon les documents définitifs ; toute correction donne lieu à une révision du devis.",
  ]);
  assertFalse(p.general.join("\n").includes("non citées"));
});

Deno.test("total reconciles with the table: sub-total and SODATRA VAT read from the snapshot", () => {
  assertEquals(projectClientQuote(clientQuoteSnapshot).totalNote,
    "Sous-total avant TVA SODATRA : 47 925 930 XOF ; TVA SODATRA sur honoraires : 99 000 XOF.");
  assertEquals(projectClientQuote(historicalSnapshot).totalNote, null);
});

Deno.test("historical versions: no invented status, unit, exclusion or general clause; recorded texts kept", () => {
  const legacy = projectClientQuote({
    ...historicalSnapshot,
    lines: [...historicalSnapshot.lines,
      { description: "Franchise magasinage: 7 jours (tarif: 500 FCFA/t/j après franchise)", amount: 0, category: "Magasinage", source: { type: "OFFICIAL" } },
      { description: "Remise exceptionnelle", amount: 0, source: { type: "business_rule" } }],
    raw_lines: [{}, {}, { notes: "Geste commercial enregistré." }],
  });
  assertEquals(legacy.lines.map(l => l.status), ["unqualified", "franchise", "zero_unexplained"]);
  assertEquals(legacy.lines[1].label, "Compris sous franchise de 7 jours, au-delà facturé");
  assertEquals(legacy.bases, ["Trajet : Anvers → Dakar (CIF)", "Conteneurs : 1 × 20GP SOC", "Poids enregistré : 10 (unité non précisée)"]);
  const text = legacy.conditions.join("\n");
  assertStringIncludes(text, "Réserve historique conservée telle qu’enregistrée.");
  assertStringIncludes(text, "Remise exceptionnelle : Geste commercial enregistré.");
  assertFalse(text.includes("Droits et taxes"), "DAP exclusion only when the scope says so");
  assert(legacy.hasRecordedFallback);
});

Deno.test("stay: franchise, overage tiers and recorded exclusions per lot; operator guidance stays internal", () => {
  const p = projectClientQuote(clientQuoteSnapshot);
  const text = p.conditions.join("\n");
  assertStringIncludes(text, "Magasinage — lot 2 — sortie supposée dans la franchise : franchise 10 jours ; au-delà : jours 11 à 25 : 394 FCFA/tonne/jour, dès le jour 26 : 599 FCFA/tonne/jour");
  assertStringIncludes(text, "Magasinage — lot 1 : Franchise applicable à confirmer");
  assertStringIncludes(text, "durées à renseigner");
  assertStringIncludes(text, "Surestaries armateur — lot COC lot 3 : armateur à confirmer ; barèmes de référence consultés : CMA CGM (franchise 10 jours), Hapag-Lloyd (franchise 10 jours)");
  assertStringIncludes(text, "Magasinage DPW, détention après sortie et TVA fournisseur éventuelle exclus.");
  assertStringIncludes(text, "point de départ du décompte à confirmer");
  assertStringIncludes(text, "montant transport TTC, TVA fournisseur incluse ; Retour vide, attente, manutention et prestations particulières non présumés inclus.");
  assertFalse(text.includes("Choisir et relier"), "operator instruction is not a client condition");
  assertStringIncludes(p.bases.join("\n"), "Hypothèse : Séjour retenu — lot 1 : magasinage 15 jours, surestaries à confirmer ; lot 3 : magasinage 8 jours, surestaries 20 jours");
});

Deno.test("a covered reservation is kept, cleaned and scoped, when its line is absent", () => {
  const p = projectClientQuote({
    lines: [{ description: "Frais d'agence", amount: 200000, source: { type: "fee_rule" } }], raw_lines: [{}],
    meta: { quoteQualification: { level: "provisional", reasons: [
      { code: "SCENARIO_TRANSPORT_KM_ESTIMATE", unit_ref: "lot-2", message: "Transport estimé par distance ; e-mail aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee ; véhicule à confirmer." },
      { code: "SCENARIO_CONTAINER_STAY_ESTIMATE", message: "Séjour estimé par lot : durées distinctes." },
      { code: "RATE_PENDING_CONFIRMATION", message: "Au moins un poste tarifaire est en attente de confirmation (TO_CONFIRM)." },
    ] } },
  });
  const text = p.conditions.join("\n");
  assertStringIncludes(text, "Lot 2 : Transport estimé par distance ; e-mail source ; véhicule à confirmer.");
  assertStringIncludes(text, "Séjour estimé par lot : durées distinctes.");
  assertStringIncludes(text, "Au moins un poste tarifaire est en attente de confirmation");
  assertFalse(text.includes("aaaaaaaa-bbbb"));
});

Deno.test("multi-lot: lots[].lines keep their recorded qualification after JSON storage", () => {
  const lotLines = clientQuoteSnapshot.lines;
  const multi = JSON.parse(JSON.stringify({
    ...clientQuoteSnapshot, lines: [], is_multi_lot: true,
    lots: [{ lot_index: 1, label: "Lot A", lines: lotLines.slice(0, 7) }, { lot_index: 2, label: "Lot B", lines: lotLines.slice(7) }],
  }));
  const p = projectClientQuote(multi);
  assertEquals(p.lines.map(l => l.status), projectClientQuote(clientQuoteSnapshot).lines.map(l => l.status));
  assertEquals(p.lines[7].label, "Compris sous franchise de 10 jours, au-delà facturé");
  assertEquals(p.lines[3].label, "Estimé sous hypothèse, compris dans le total, non ferme");
});

Deno.test("multi-lot: a raw line qualifies one displayed line only, never a second identical one", () => {
  const thc = { description: "THC IMPORT 20HQ", amount: 100, source: { type: "OFFICIAL", reference: "Arrêté" } };
  const stored = JSON.parse(JSON.stringify({
    lines: [], is_multi_lot: true,
    raw_lines: [{ ...thc, scenario_provenance: { firm_eligible: true, assumption_dependent: false } }],
    lots: [{ lot_index: 1, lines: [thc] }, { lot_index: 2, lines: [thc] }],
  }));
  assertEquals(projectClientQuote(stored).lines.map(l => l.status), ["firm", "unqualified"]);
});

Deno.test("a covered reservation is kept when the line is present but does not say the same thing", () => {
  const p = projectClientQuote({
    lines: [{ description: "THC IMPORT 20HQ", amount: 155000, source: { type: "CALCULATED" } }], raw_lines: [{}],
    meta: { quoteQualification: { level: "provisional", reasons: [
      { code: "SCENARIO_THC_BASE_ESTIMATE", message: "THC base estimée sous hypothèse, supplément IMO non compris." },
      { code: "SCENARIO_EMPTY_RETURN_SCOPE", unit_ref: "lot-3", message: "Retour vide lot-3 à la charge du client." },
    ] } },
  });
  assertEquals(p.lines[0].status, "unqualified");
  const text = p.conditions.join("\n");
  assertStringIncludes(text, "THC base estimée sous hypothèse, supplément IMO non compris.");
  assertStringIncludes(text, "Lot 3 : Retour vide lot 3 à la charge du client.");
});

Deno.test("projection does not mutate the saved snapshot", () => {
  const before = JSON.stringify(clientQuoteSnapshot);
  projectClientQuote(clientQuoteSnapshot);
  assertEquals(JSON.stringify(clientQuoteSnapshot), before);
});

Deno.test("cargo basis: source traceability dropped, shorthand translated, cargo description kept", () => {
  const units = clientQuoteSnapshot.operator_basis.scope.cargo_units;
  const withBasis = (scenario_basis: string) => projectClientQuote({
    ...clientQuoteSnapshot,
    operator_basis: { ...clientQuoteSnapshot.operator_basis, scope: { ...clientQuoteSnapshot.operator_basis.scope, cargo_units: [{ ...units[0], scenario_basis }] } },
  }).bases.find(b => b.startsWith("Lot 1 :")) ?? "";
  const traced = withBasis(`Hypothèses à vérifier; e-mail 0a1b2c3d-1111-4222-8333-444455556666; SHA256 ${"ab".repeat(32)}; poids haut; Qté conteneurs source.`);
  assertStringIncludes(traced, "base opérateur : poids retenu en hypothèse haute ; nombre de conteneurs selon la demande");
  for (const banned of ["e-mail", "SHA", "Hypothèses à vérifier", "référence", "ab".repeat(8)]) assertFalse(traced.includes(banned), banned);
  assertFalse(withBasis("Hypothèses à vérifier; e-mail source").includes("base opérateur"), "nothing left to say → no operator basis");
  assertStringIncludes(withBasis("Wooden storage cabinets; 1 unité/conteneur."), "base opérateur : Wooden storage cabinets ; 1 unité/conteneur");
});

Deno.test("open points: the same place recorded as origin and origine is listed once", () => {
  const snapshot = {
    ...clientQuoteSnapshot,
    operator_basis: { ...clientQuoteSnapshot.operator_basis, open_points: [{ code: "port_to_propose", key: "port_to_propose:origin", ref: "origin" }] },
  };
  const text = projectClientQuote(snapshot).conditions.join("\n");
  assertStringIncludes(text, "lieu (origine)");
  assertFalse(/\borigin\b/.test(text), "no English place reference");
});

// Older multi-lot version shape (no operator basis): single container in inputs, types on the lines.
const olderMultiLot = () => {
  const raw = (lot: number, extra: Record<string, unknown>) => ({ lot_index: lot, lot_label: `Lot ${lot} - Synthetic ${lot}`, ...extra });
  const rawLines = [
    raw(1, { category: "Terminal (DPW)", containerType: "40HC", source: { type: "TO_CONFIRM" } }),
    raw(1, { label: "Retour conteneur vide", category: "EMPTY_RETURN", amount: 0, source: { type: "business_rule", reference: "P5" },
      explanation: "EMPTY_RETURN: Obligation contractuelle client, non facturé en import SN" }),
    raw(2, { category: "Transport", containerType: "20dv", amount: 82600, source: { type: "OFFICIAL" } }),
    raw(2, { label: "Retour conteneur vide", category: "EMPTY_RETURN", amount: 0, source: { type: "business_rule", reference: "P5" } }),
  ];
  const lines = [
    { description: "THC IMPORT 40HC", category: "Terminal (DPW)", amount: null, source: { type: "TO_CONFIRM" } },
    { description: "Retour conteneur vide", category: "EMPTY_RETURN", amount: 0, source: { type: "business_rule", reference: "P5" } },
    { description: "Transport 20DV", category: "Transport", amount: 82600, source: { type: "OFFICIAL" } },
    { description: "Retour conteneur vide", category: "EMPTY_RETURN", amount: 0, source: { type: "business_rule", reference: "P5" } },
  ];
  return {
    is_multi_lot: true, lines, raw_lines: rawLines,
    lots: [{ lot_index: 1, label: "Lot 1 - Synthetic 1", lines: lines.slice(0, 2) }, { lot_index: 2, label: "Lot 2 - Synthetic 2", lines: lines.slice(2) }],
    inputs: { origin: "Ningbo", destination: "Dakar", incoterm: "DAP", cargo_weight: 18, containers: [{ quantity: 1, type: "20DV", coc_soc: null }] },
    meta: {}, totals: {},
  };
};

Deno.test("older empty return at zero: a recorded client obligation is stated, a bare rule reference never is", () => {
  const p = projectClientQuote(olderMultiLot());
  assertEquals([p.lines[1].status, p.lines[1].label, p.lines[1].amountText], ["client_charge", "À la charge du client, non facturé par SODATRA", "Non facturé"]);
  assertEquals(p.lines[3].status, "zero_unexplained", "without a recorded explanation the zero stays to verify");
  const text = p.conditions.join("\n");
  assertStringIncludes(text, "Retour conteneur vide : montant nul, signification non enregistrée");
  assertFalse(/\bP5\b/.test(text), "no bare rule reference");
  const explained = olderMultiLot();
  (explained.raw_lines[3] as Record<string, unknown>).explanation = "EMPTY_RETURN: Restitution organisée par le transporteur";
  assertStringIncludes(projectClientQuote(explained).conditions.join("\n"), "Retour conteneur vide : Restitution organisée par le transporteur");
});

Deno.test("older multi-lot bases: equipment per lot from its own lines, dossier weight not spread over lots", () => {
  const bases = projectClientQuote(olderMultiLot()).bases;
  assertEquals(bases.slice(0, 4), [
    "Trajet : Ningbo → Dakar (DAP)",
    "Lot 1 - Synthetic 1 : conteneur 40HC",
    "Lot 2 - Synthetic 2 : conteneur 20DV",
    "Poids enregistré au dossier, non réparti par lot : 18 (unité non précisée)",
  ]);
  assertFalse(bases.join("\n").includes("1 × 20DV"), "the single container of the inputs is not presented as the whole dossier");
  const untyped = olderMultiLot();
  delete (untyped.raw_lines[2] as Record<string, unknown>).containerType;
  assertStringIncludes(projectClientQuote(untyped).bases.join("\n"), "Conteneurs : 1 × 20DV", "a lot without a recorded type keeps the recorded inputs");
});
