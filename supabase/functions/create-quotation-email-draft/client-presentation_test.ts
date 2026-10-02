import { assert, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildDeterministicBody } from "./index.ts";
import { clientQuoteSnapshot, historicalSnapshot } from "../_tests/client-quote-fixture.ts";

const partial = { level: "partial" as const, reasons: [], firmTotalPolicy: "all_included" as const };

Deno.test("client e-mail: same bases and conditions as the PDF, short, without codes or URLs", () => {
  const body = buildDeterministicBody(clientQuoteSnapshot, 1, false, [], true, partial);
  for (const heading of ["Bases de cotation :", "Conditions particulières :", "Conditions générales :"]) assertStringIncludes(body, heading);
  assertStringIncludes(body, "Lot 1 : 39 × 20HQ, SOC, 55 000 kg par conteneur, dangereux (UN3536, classe 9)");
  assertStringIncludes(body, "Postes à confirmer, non compris dans le total");
  assertStringIncludes(body, "TVA SODATRA sur honoraires");
  assertFalse(body.includes("non citées"));
  assertStringIncludes(body, "Droits et taxes et calcul CAF non compris : périmètre DAP.");
  // Stay and transport conditions recorded per lot (independent of the projection itself).
  assertStringIncludes(body, "Magasinage — lot 2 — sortie supposée dans la franchise : franchise 10 jours ; au-delà : jours 11 à 25");
  assertStringIncludes(body, "Magasinage DPW, détention après sortie et TVA fournisseur éventuelle exclus.");
  assertStringIncludes(body, "montant transport TTC, TVA fournisseur incluse");
  assertStringIncludes(body, "Hypothèse : Séjour retenu — lot 1 : magasinage 15 jours, surestaries à confirmer");
  assertFalse(body.includes("Choisir et relier"));
  assertStringIncludes(body, "Les montants « Estimé » sont compris dans le total mais ne sont pas fermes.");
  // Amounts use the fr-FR narrow no-break space.
  assertStringIncludes(body.replace(/[\u202F\u00A0]/g, " "), "48 024 930");
  for (const banned of ["SCENARIO_", "OPEN_POINT", "TO_CONFIRM", "http", "commodity_classification", "Éléments sous réserve", "per_unit", "Texte technique long"]) {
    assertFalse(body.includes(banned), banned);
  }
  assert(body.split("\n").every(line => line.length < 600), "no long paragraph (former blocks reached 1 000 to 2 750 characters)");
});

Deno.test("historical e-mail keeps the recorded reservation and invents no exclusion", () => {
  const body = buildDeterministicBody(historicalSnapshot, 1, false, [], true, { level: "provisional", reasons: [], firmTotalPolicy: "all_included" });
  assertStringIncludes(body, "Réserve historique conservée telle qu’enregistrée.");
  assertStringIncludes(body, "Poids enregistré : 10 (unité non précisée)");
  assertFalse(body.includes("Droits et taxes"));
});

Deno.test("e-mail wording agrees with the qualification: « Cette offre partielle », « Ce devis provisoire »", () => {
  const snapshot = { ...clientQuoteSnapshot, inputs: { ...clientQuoteSnapshot.inputs, origin: "Dakar Port", destination: "N'Dioum", incoterm: "DAP" } };
  assertStringIncludes(buildDeterministicBody(snapshot, 1, false, [], true, partial), "Cette offre partielle concerne votre expédition");
  const provisional = buildDeterministicBody(snapshot, 1, true, ["  - Lot 1", "  - Lot 2"], true, { level: "provisional", reasons: [], firmTotalPolicy: "all_included" });
  assertStringIncludes(provisional, "Ce devis provisoire concerne votre expédition");
  assertStringIncludes(provisional, "Ce devis provisoire couvre 2 lots :");
  assertFalse(buildDeterministicBody(snapshot, 1, false, [], true, partial).includes("Ce offre"));
});
