import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateDraftPdf } from "./index.ts";
import { clientQuoteSnapshot, historicalSnapshot } from "../_tests/client-quote-fixture.ts";

/** Texts drawn by pdf-lib (BT … <hex> Tj … ET), in drawing order. */
async function pdfTexts(bytes: Uint8Array): Promise<string[]> {
  const raw = new TextDecoder("latin1").decode(bytes);
  const out: string[] = [];
  for (const m of raw.matchAll(/\/Length (\d+)[^>]*>>\s*stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    let content: string;
    try {
      content = new TextDecoder("latin1").decode(await new Response(
        new Blob([bytes.slice(start, start + Number(m[1]))]).stream().pipeThrough(new DecompressionStream("deflate")),
      ).arrayBuffer());
    } catch { continue; }
    for (const tj of content.matchAll(/<([0-9A-Fa-f]*)> Tj/g)) out.push(tj[1].replace(/../g, h => String.fromCharCode(parseInt(h, 16))));
  }
  return out;
}

Deno.test("client PDF: price table kept with statuses, then bases, particular and general conditions", async () => {
  const before = JSON.stringify(clientQuoteSnapshot);
  const texts = await pdfTexts(await generateDraftPdf(clientQuoteSnapshot, "SYNTHETIC"));
  assertEquals(JSON.stringify(clientQuoteSnapshot), before, "snapshot untouched");
  // Wrapped PDF lines are joined so a sentence can be checked whole.
  const all = texts.map(t => t.trim()).join(" ");
  const order = ["PRESTATIONS", "BASES DE COTATION", "CONDITIONS PARTICULIERES", "CONDITIONS GENERALES", "*** DRAFT - DOCUMENT DE TRAVAIL ***"]
    .map(h => texts.indexOf(h));
  assert(order.every(i => i >= 0), order.join(","));
  assertEquals([...order].sort((a, b) => a - b), order, "sections in the expected order");
  // Amounts and totals unchanged.
  for (const amount of ["9 067 500", "8 251 386", "20 759 310", "48 024 930"]) assert(all.includes(amount), amount);
  // Statuses: estimated, to confirm, franchise, SOC, client charge — a zero always explains itself.
  assert(texts.includes("Estime sous hypothese, compris dans le total, non ferme"));
  assert(texts.filter(t => t === "À confirmer").length >= 3);
  assert(texts.includes("0 (franchise)") && texts.includes("Compris sous franchise de 10 jours, au-dela facture"));
  assert(texts.includes("Sans objet : conteneurs SOC, pas de restitution a l'armateur"));
  assert(texts.includes("À la charge du client, non facture par SODATRA"));
  // Bases and conditions are short and client-readable.
  assert(all.includes("- Lot 1 : 39 × 20HQ, SOC, 55 000 kg par conteneur, dangereux (UN3536, classe 9)"), all);
  assert(all.includes("Droits et taxes et calcul CAF non compris : perimetre DAP."));
  assert(all.includes("faisabilite, vehicule et eventuelles autorisations a verifier aupres du transporteur"));
  assert(all.includes("TVA SODATRA SUR HONORAIRES: 99"), "total reconciles with the table");
  assertFalse(all.includes("non citees"), "no blanket exclusion");
  // No technical codes, URLs or the former long blocks.
  for (const banned of ["SCENARIO_", "OPEN_POINT", "TO_CONFIRM", "http", "commodity_classification", "BASES RETENUES", "Texte technique long", "per_unit"]) {
    assertFalse(all.includes(banned), banned);
  }
});

Deno.test("multi-lot PDF after JSON storage: statuses, franchise and stay exclusions still printed", async () => {
  const lines = clientQuoteSnapshot.lines;
  const stored = JSON.parse(JSON.stringify({
    ...clientQuoteSnapshot, lines: [], is_multi_lot: true,
    lots: [
      { lot_index: 1, label: "Lot A", lines: lines.slice(0, 7), totals: { ht: 22986458, currency: "XOF" } },
      { lot_index: 2, label: "Lot B", lines: lines.slice(7), totals: { ht: 24939472, currency: "XOF" } },
    ],
  }));
  const texts = await pdfTexts(await generateDraftPdf(stored, "SYNTHETIC"));
  const all = texts.map(t => t.trim()).join(" ");
  assert(texts.includes("Estime sous hypothese, compris dans le total, non ferme"), "estimated status kept in lots");
  assert(texts.includes("Compris sous franchise de 10 jours, au-dela facture"), "franchise kept in lots");
  assert(all.includes("franchise 10 jours ; au-dela : jours 11 a 25 : 394 FCFA/tonne/jour"));
  assert(all.includes("detention apres sortie et TVA fournisseur eventuelle exclus"));
  assert(all.includes("TVA fournisseur incluse"));
  assertFalse(all.includes("Choisir et relier"));
});

Deno.test("historical PDF: no invented status or exclusion, recorded reservation kept", async () => {
  const texts = await pdfTexts(await generateDraftPdf(historicalSnapshot, "SYNTHETIC"));
  const all = texts.join("\n");
  assert(all.includes("Reserve historique conservee telle qu'enregistree."), all);
  assert(all.includes("Poids enregistre : 10 (unite non precisee)"));
  assertFalse(all.includes("Estime"));
  assertFalse(all.includes("Droits et taxes"));
  assert(all.includes("200 000"));
});

Deno.test("client PDF: a long line description is wrapped in its column (3 lines at most), not cut at 25 characters", async () => {
  const long = "Transport 20hq → Ndioum, Podor, Saint-Louis, Sénégal — estimation kilométrique (lot-2)";
  const veryLong = `${long} ${"avec une précision opérateur très longue ".repeat(6)}ZZFINZZ`;
  const lines = clientQuoteSnapshot.lines.map((l: Record<string, unknown>, i: number) =>
    i === 0 ? { ...l, description: long } : i === 1 ? { ...l, description: veryLong } : l);
  const texts = (await pdfTexts(await generateDraftPdf({ ...clientQuoteSnapshot, lines }, "SYNTHETIC"))).map(t => t.trim());
  const all = texts.join(" ");
  assert(all.includes("estimation kilometrique (lot 2)"), "the end of the description is printed, with the client lot label");
  assertFalse(all.includes("ZZFINZZ"), "beyond three lines the description is shortened");
  assert(texts.some(t => t.endsWith(" ...")), "a shortened description says so");
});

Deno.test("client PDF, older multi-lot read back from JSON: empty return stated as client charge, bases per lot", async () => {
  const empty = { label: "Retour conteneur vide", category: "EMPTY_RETURN", amount: 0, quantity: 1, source: { type: "business_rule", reference: "P5" } };
  const lot = (index: number, type: string) => ({
    display: [
      { description: `Transport ${type}`, category: "Transport", amount: 82600, quantity: 1, unit_price: 82600, source: { type: "OFFICIAL", reference: "TARIFS" } },
      { ...empty, description: "Retour conteneur vide" },
    ],
    raw: [
      { description: `Transport ${type}`, category: "Transport", containerType: type, amount: 82600, lot_index: index, source: { type: "OFFICIAL", reference: "TARIFS" } },
      { ...empty, lot_index: index, explanation: "EMPTY_RETURN: Obligation contractuelle client, non facturé en import SN" },
    ],
  });
  const one = lot(1, "40HC"), two = lot(2, "20DV");
  const snapshot = JSON.parse(JSON.stringify({
    is_multi_lot: true, lines: [...one.display, ...two.display], raw_lines: [...one.raw, ...two.raw],
    lots: [{ lot_index: 1, label: "Lot 1 - Synthetic A", lines: one.display, totals: {} }, { lot_index: 2, label: "Lot 2 - Synthetic B", lines: two.display, totals: {} }],
    inputs: { origin: "Ningbo", destination: "Dakar", incoterm: "DAP", cargo_weight: 18, containers: [{ quantity: 1, type: "20DV" }] },
    meta: {}, totals: { total_payable: 165200, currency: "XOF" }, client: {},
  }));
  const all = (await pdfTexts(await generateDraftPdf(snapshot, "SYNTHETIC"))).map(t => t.trim()).join(" ");
  assertEquals(all.split("À la charge du client, non facture par SODATRA").length - 1, 2, "client obligation stated on each lot line");
  assertFalse(all.includes("signification a verifier"));
  assertFalse(/\bP5\b/.test(all), "no bare rule reference");
  assert(all.includes("Lot 1 - Synthetic A : conteneur 40HC") && all.includes("Lot 2 - Synthetic B : conteneur 20DV"));
  assertFalse(all.includes("Conteneurs : 1"), "the single container of the inputs is not presented as the dossier");
});
