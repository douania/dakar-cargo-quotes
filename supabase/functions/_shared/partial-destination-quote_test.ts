import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { assertPartialServiceResponse, partialChargeableWeight, partialKgQuantity, partialDestinationDdpEligible, PARTIAL_CUSTOMS_GAP_KEYS } from './partial-destination-quote.ts';
const input = { allowProvisional: true, packageKey: 'AIR_IMPORT_DDP', requestType: 'AIR_IMPORT', lotCount: 0, serviceKeys: ['AIR_HANDLING', 'CUSTOMS_DAKAR', 'TRUCKING', 'AGENCY'], scopeEvent: { actor_type: 'system', event_data: { freight_scope: false, customs_scope: true, request_evidence: { mode: 'destination' } } } };
Deno.test('partial destination: explicit provisional mono-air-DDP and grounded destination scope only', () => {
  assertEquals(partialDestinationDdpEligible(input), true);
  for (const patch of [{ allowProvisional: false }, { packageKey: 'AIR_IMPORT_EXW' }, { requestType: 'SEA_FCL_IMPORT' }, { lotCount: 2 }, { lotCount: null }, { scopeEvent: null }, { serviceKeys: [...input.serviceKeys, 'AIR_FREIGHT'] }, { serviceKeys: ['TRUCKING'] }]) assertEquals(partialDestinationDdpEligible({ ...input, ...patch }), false);
  assertEquals(partialDestinationDdpEligible({ ...input, scopeEvent: { actor_type: 'system', event_data: { freight_scope: false } } }), false);
  assertEquals(partialDestinationDdpEligible({ ...input, scopeEvent: { actor_type: 'operator', event_data: { freight_scope: false, customs_scope: true } } }), true);
});
Deno.test('partial destination: only enumerated customs dependencies may bypass global gaps', () => {
  assertEquals([...PARTIAL_CUSTOMS_GAP_KEYS], ['cargo.hs_code', 'cargo.value', 'customs.regime_code']);
  for (const gap of ['pricing.pad_group_scope', 'routing.destination_city', 'cargo.weight_kg', 'communications.pending']) assertEquals(PARTIAL_CUSTOMS_GAP_KEYS.has(gap), false);
});
Deno.test('partial weight: gross190 does not supply taxable weight; conflict keeps unvalidated value unknown', () => {
  assertEquals(partialChargeableWeight([{ fact_key: 'cargo.weight_kg', value_number: 190 }]).kg, null);
  assertEquals(partialChargeableWeight([{ fact_key: 'cargo.chargeable_weight_kg', value_number: 200, source_type: 'deterministic_calc' }, { fact_key: 'cargo.dimensions_evidence', value_json: { conflict: true } }]).kg, null);
  for (const value of [null, 0, -1, Infinity, NaN]) assertEquals(partialChargeableWeight([{ fact_key: 'cargo.chargeable_weight_kg', value_number: value }]).kg, null);
});
Deno.test('partial weight: current positive value and protected operator choice retained without changing formula', () => {
  const fact = { fact_key: 'cargo.chargeable_weight_kg', value_number: 250, source_type: 'operator' };
  assertEquals(partialChargeableWeight([fact, { fact_key: 'cargo.dimensions_evidence', value_json: { conflict: true } }]).kg, 250);
  assertEquals(partialChargeableWeight([{ ...fact, source_type: 'attachment_extracted' }]).kg, 250);
});
Deno.test('partial service response: valid zero/reserve/skip retained; duplicates, omissions and invalid amounts refused', () => {
  const lines = [{ id: 'a', rate: 0, source: 'fee_rule' }, { id: 'b', rate: null, source: 'missing_quantity' }];
  assertPartialServiceResponse({ data: { priced_lines: lines } }, ['a', 'b']);
  assertPartialServiceResponse({ data: { priced_lines: [{ id: 'a', rate: null, source: 'fee_rule_skipped' }] } }, ['a']);
  for (const bad of [undefined, {}, { data: {} }, { data: { priced_lines: [] } },
    { data: { priced_lines: [lines[0], lines[0]] } }, { data: { priced_lines: [{ ...lines[0], rate: Infinity }, lines[1]] } }]) {
    assertThrows(() => assertPartialServiceResponse(bad, ['a', 'b']));
  }
});
Deno.test('partial KG tariff: explicit gross190/net151 independent of dimensions; chargeable and unspecified bases remain unknown', () => {
  const facts = [{ fact_key: 'cargo.weight_kg', value_number: 190 }, { fact_key: 'cargo.weight_net_kg', value_number: 151 },
    { fact_key: 'cargo.dimensions_evidence', value_json: { conflict: true } }];
  assertEquals(partialKgQuantity({ requires_fact_key: 'cargo.weight_kg' }, facts).kg, 190);
  assertEquals(partialKgQuantity({ requires_fact_key: 'cargo.weight_net_kg' }, facts).kg, 151);
  assertEquals(partialKgQuantity({ requires_fact_key: 'cargo.chargeable_weight_kg' }, facts).kg, null);
  for (const key of [null, '', 'kg', 'AIR_HANDLING', 'cargo.unsupported_weight']) {
    assertEquals(partialKgQuantity({ requires_fact_key: key }, facts), { kg: null, factKey: null, reason: 'KG_TARIFF_BASIS_UNSPECIFIED' });
  }
  assertEquals(partialKgQuantity({ requires_fact_key: 'cargo.weight_kg' }, []).kg, null);
});

for(const shipment_type of ['export','transit','unknown'])for(const actor_type of ['system','operator'])Deno.test(`partial destination: explicit ${shipment_type} scope cannot authorize import DDP (${actor_type})`,()=>{
 const event_data={...input.scopeEvent.event_data,shipment_type};const saved=JSON.stringify(event_data);
 assertEquals(partialDestinationDdpEligible({...input,scopeEvent:{actor_type,event_data}}),false);assertEquals(JSON.stringify(event_data),saved);
 assertEquals(partialDestinationDdpEligible({...input,scopeEvent:{actor_type,event_data:{scope:event_data}}}),false);
});
Deno.test('partial destination: affirmative import scope and historical untyped destination remain compatible',()=>{
 for(const shipment_type of ['import',' IMPORT '])for(const actor_type of ['system','operator']){
  assertEquals(partialDestinationDdpEligible({...input,scopeEvent:{actor_type,event_data:{...input.scopeEvent.event_data,shipment_type}}}),true);
 }
 assertEquals(partialDestinationDdpEligible(input),true);
});
Deno.test('partial destination: malformed declared direction is not an import confirmation',()=>{
 for(const shipment_type of [null,42,true,'',{},[]])assertEquals(partialDestinationDdpEligible({...input,scopeEvent:{actor_type:'operator',event_data:{...input.scopeEvent.event_data,shipment_type}}}),false);
});
