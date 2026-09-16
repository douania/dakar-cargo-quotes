import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RoadDistanceProposal } from '../RoadDistanceProposal';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));
afterEach(() => { cleanup(); invoke.mockReset(); });
const value = JSON.stringify({ destination: 'Test', groups: [{ ordinary_transport: false }] });
const proposed = { status: 'proposed', destination: 'Test', distance_km: 300, distance_source: 'TomTom fixture', verified_on: '2026-09-16', message: 'Indicatif' };
it('fills only draft distance, no ordinary qualification or persistence', async () => {
  invoke.mockResolvedValue({ data: proposed }); const change = vi.fn();
  render(<RoadDistanceProposal caseId="case" value={value} onChange={change} />);
  fireEvent.click(screen.getByText('Proposer la distance routière'));
  await waitFor(() => expect(change).toHaveBeenCalledOnce());
  expect(JSON.parse(change.mock.calls[0][0]).groups).toEqual([{ ordinary_transport: false }]);
  expect(invoke.mock.calls[0][1].body).toEqual({ case_id: 'case', destination: 'Test' });
});
it('ambiguous destination needs choice before filling', async () => {
  invoke.mockResolvedValueOnce({ data: { status: 'choose_destination', destination: 'Test', candidates: [{ id: 'id', label: 'Ville', precise: false }], message: 'Choisir' } }).mockResolvedValueOnce({ data: proposed });
  const change = vi.fn(); render(<RoadDistanceProposal caseId="case" value={value} onChange={change} />);
  fireEvent.click(screen.getByText('Proposer la distance routière'));
  fireEvent.click(await screen.findByText('Choisir Ville — point approximatif'));
  await waitFor(() => expect(change).toHaveBeenCalledOnce());
  expect(invoke.mock.calls[1][1].body.selected_id).toBe('id');
});
it('stale async response cannot overwrite an edited draft', async () => {
  let resolve!: (x: unknown) => void; invoke.mockReturnValue(new Promise(r => { resolve = r; })); const change = vi.fn();
  function Form() { const [v, set] = useState(value); return <><button onClick={() => set('{}')}>Edit</button><RoadDistanceProposal caseId="case" value={v} onChange={change} /></>; }
  render(<Form />); fireEvent.click(screen.getByText('Proposer la distance routière')); fireEvent.click(screen.getByText('Edit'));
  resolve({ data: proposed }); await screen.findByText('Le formulaire a changé : relancez la proposition.'); expect(change).not.toHaveBeenCalled();
});
it('failure keeps manual draft intact', async () => {
  invoke.mockRejectedValue(new Error('network')); const change = vi.fn();
  render(<RoadDistanceProposal caseId="case" value={value} onChange={change} />); fireEvent.click(screen.getByText('Proposer la distance routière'));
  await screen.findByText('Distance indisponible. La saisie manuelle reste possible.'); expect(change).not.toHaveBeenCalled();
});
it('a response from a previous case is discarded even with identical draft', async () => {
  let resolve!: (x: unknown) => void; invoke.mockReturnValue(new Promise(r => { resolve = r; })); const change = vi.fn();
  const view = render(<RoadDistanceProposal caseId="old" value={value} onChange={change} />);
  fireEvent.click(screen.getByText('Proposer la distance routière'));
  view.rerender(<RoadDistanceProposal caseId="new" value={value} onChange={change} />);
  resolve({ data: proposed }); await screen.findByText('Le formulaire a changé : relancez la proposition.'); expect(change).not.toHaveBeenCalled();
});
