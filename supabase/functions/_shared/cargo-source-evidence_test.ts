import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { declaredWeightKg, dimensionGroupsDisagree, documentCargoEvidence, documentDimensionSources, emailCargoEvidence, sourceConfidence } from './cargo-source-evidence.ts';

Deno.test('source evidence: explicit units normalize while unknown and per-carton weights stay unknown', () => {
  for (const [raw, expected] of [['190 KGS',190], ['190 KG',190], ['1.5 tonnes',1500], ['1,5 t',1500], ['1 200 kg',1200]]) assertEquals(declaredWeightKg(raw), expected);
  assertEquals(declaredWeightKg(190), null);
  assertEquals(declaredWeightKg(190, true), 190);
  assertEquals(declaredWeightKg('190 lb'), null);
  assertEquals(declaredWeightKg('190'), null);
  assertEquals(emailCargoEvidence('Gross WT 30 KGS per carton').weightKg, null);
  assertEquals(emailCargoEvidence('55 t/unit').weightKg, null);
  assertEquals(emailCargoEvidence('Gross WT 190 KGS').weightKg, 190);
});

Deno.test('source evidence: subgroup counts cannot become a shipment total', () => {
  const text = '48 x 36 x 29 cm - 25 cartons\n44 x 27 x 24 cm - 05 cartons';
  assertEquals(emailCargoEvidence(text).pieces, null);
  assertEquals(emailCargoEvidence(`30 cartons\n${text}`).pieces, 30);
  assertEquals(emailCargoEvidence(`${text}\nTotal 30 cartons`).pieces, 30);
  assertEquals(emailCargoEvidence('12 crates').pieces, 12);
});

Deno.test('source evidence: physically equal dimensions do not create a unit-only conflict', () => {
  const cm = { count: 30, length: 48, width: 36, height: 29, unit: 'cm' };
  assertEquals(dimensionGroupsDisagree([[cm], [{ ...cm, length: .48, width: .36, height: .29, unit: 'm' }]]), false);
  assertEquals(dimensionGroupsDisagree([[cm], [{ ...cm, count: 28 }]]), true);
  assertEquals(dimensionGroupsDisagree([[cm], [{ ...cm, count: null }]]), false);
});

Deno.test('source evidence: composite sub-documents remain separate and never double a carton total', () => {
  const line_items = [{ no_of_cartons: 28, dimension_cm_carton: '48x36x29' }, { no_of_cartons: 2, dimension_cm_carton: '44x27x24' }];
  const sources = documentDimensionSources({ confidence: .9, documents: [{ doc_type: 'packing_list', extracted_info: { line_items } }, { doc_type: 'commercial_invoice', extracted_info: { line_items } }] });
  assertEquals(sources.length, 2);
  assertEquals(sources.map(s => s.groups.reduce((n,g) => n + (g.count ?? 0),0)), [30,30]);
  assertEquals(dimensionGroupsDisagree(sources.map(s => s.groups)), false);
});

Deno.test('source evidence: money components, HS8 and confidence are declared without inferred customs value', () => {
  const evidence = documentCargoEvidence({ confidence: .9, extracted_info: { payment_terms: 'FOC', total_amount: 101.96, total_currency: '€', hs_code: '3004.9099' }, tariff_lines: [
    { service: 'FOB VALUE', amount: 89.72, currency: 'EUR' }, { service: 'FREIGHT', amount: 10.2, currency: 'EUR' }, { service: 'INSURANCE', amount: 2.04, currency: 'EUR' }] });
  assertEquals(evidence.nonCommercial, true);
  assertEquals(evidence.money.map(m => [m.kind,m.amount,m.currency]), [['FOB',89.72,'EUR'],['freight',10.2,'EUR'],['insurance',2.04,'EUR'],['total',101.96,'EUR']]);
  assertEquals(evidence.hsDeclared, '3004.9099');
  assertEquals(sourceConfidence({ confidence: .9 }, { confidence: .6 }), .6);
  assertEquals(sourceConfidence({ confidence: 'high' }), null);
  assertEquals(sourceConfidence({ confidence: 1.1 }), null);
});
