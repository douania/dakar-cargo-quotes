import { expect, it } from 'vitest';
import { proposeTransportGroups } from '../transportGroupProposal';

const unit = (over = {}) => ({ unit_ref: 'lot-2', unit_kind: 'CONTAINER', equipment_code: '20hq',
  quantity: 13, gross_weight_kg: 18000, weight_basis: 'per_unit', dangerous_goods: null,
  un_number: null, imo_class: null, temperature_control_required: false, destination_ref: null, ...over });
it('mixed cargo: proposes ordinary candidates, excludes declared DG; invents neither capacity nor acceptance', () => {
  const scope = { cargo_units: [unit({ unit_ref: 'lot-1', quantity: 39, gross_weight_kg: 55000,
    dangerous_goods: true, un_number: 'UN3536', imo_class: '9' }), unit(),
    unit({ unit_ref: 'lot-3', equipment_code: '40hq', quantity: 3, gross_weight_kg: 45000, weight_basis: 'total' })] };
  const before = JSON.stringify(scope);
  const result = proposeTransportGroups(scope);
  expect(result.groups.map(g => [g.unit_ref, g.weight_per_container_kg])).toEqual([['lot-2', 18000], ['lot-3', 15000]]);
  expect(result.excluded).toHaveLength(1);
  expect(result.groups.every(g => g.max_payload_kg === null && !g.ordinary_transport && !g.unknown_danger_base_only)).toBe(true);
  expect(JSON.stringify(scope)).toBe(before);
});
it('rejects ambiguous weights, special equipment, reefer, UN contradiction and split destinations', () => {
  for (const over of [{ gross_weight_kg: null }, { weight_basis: 'unknown' }, { quantity: 0 },
    { equipment_code: '20fl' }, { temperature_control_required: true }, { un_number: 'UN3536', dangerous_goods: false },
    { destination_ref: 'elsewhere' }]) expect(proposeTransportGroups({ cargo_units: [unit(over)] }).groups).toEqual([]);
});
