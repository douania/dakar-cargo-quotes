import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalTransportEstimateFields } from '../LocalTransportEstimateFields';
import { emptyTransportEstimateBasis } from '@/lib/scenarioAssumptions';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from } }));
vi.mock('../RoadDistanceProposal', () => ({ RoadDistanceProposal: () => null }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const scenario = { id: 's', scope_hash: 'hash', scope_snapshot: { cargo_units: [{ unit_ref: 'lot-2',
  unit_kind: 'CONTAINER', equipment_code: '20hq', quantity: 13, gross_weight_kg: 18000,
  weight_basis: 'per_unit', dangerous_goods: null, temperature_control_required: false }] } };
function query(result: unknown) {
  const q = { select: vi.fn(() => q), eq: vi.fn(() => q), is: vi.fn(() => q),
    single: vi.fn(() => Promise.resolve(result)), maybeSingle: vi.fn(() => Promise.resolve(result)) };
  return q;
}
it('reads selected scenario under user RLS, fills draft only and preserves sourced distance', async () => {
  from.mockReturnValueOnce(query({ data: { scenario_id: 's' }, error: null }))
    .mockReturnValueOnce(query({ data: scenario, error: null }));
  const onChange = vi.fn();
  render(<LocalTransportEstimateFields caseId="case" value={JSON.stringify({ ...emptyTransportEstimateBasis(),
    distance_km: 300, distance_source: 'Source test' })} onChange={onChange} />);
  fireEvent.click(screen.getByText('Proposer les lots depuis le scénario sélectionné'));
  await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
  expect(JSON.parse(onChange.mock.calls[0][0])).toMatchObject({ distance_km: 300, distance_source: 'Source test',
    scenario_source: { id: 's', scope_hash: 'hash' }, groups: [{ quantity: 13, weight_per_container_kg: 18000,
      max_payload_kg: null, ordinary_transport: false, unknown_danger_base_only: false }] });
  expect(from.mock.calls.map(c => c[0])).toEqual(['quote_scenario_selections', 'quote_scenarios']);
});
it('ignores a response after changing case or editing draft', async () => {
  let resolve!: (value: unknown) => void;
  const delayed = new Promise(r => { resolve = r; });
  from.mockReturnValueOnce(query({ data: { scenario_id: 's' }, error: null }))
    .mockReturnValueOnce(query(delayed));
  const onChange = vi.fn(); const value = JSON.stringify(emptyTransportEstimateBasis());
  const view = render(<LocalTransportEstimateFields caseId="case" value={value} onChange={onChange} />);
  fireEvent.click(screen.getByText('Proposer les lots depuis le scénario sélectionné'));
  await waitFor(() => expect(from).toHaveBeenCalledTimes(2));
  view.rerender(<LocalTransportEstimateFields caseId="other-case" value={value} onChange={onChange} />);
  resolve({ data: scenario, error: null });
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('formulaire a changé'));
  expect(onChange).not.toHaveBeenCalled();
});
