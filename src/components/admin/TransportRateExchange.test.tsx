import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransportRateExchange } from './TransportRateExchange';
import type { TransportRateRow } from '@/lib/transportRateWorkbook';

const mocks = vi.hoisted(() => ({ read: vi.fn(), insert: vi.fn(), parse: vi.fn(), export: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => ({ select: () => ({ in: mocks.read }), insert: mocks.insert }) } }));
vi.mock('@/lib/transportRateWorkbook', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/transportRateWorkbook')>(), parseTransportWorkbook: mocks.parse, exportTransportWorkbook: mocks.export }));
const row: TransportRateRow = {
  id: '22222222-2222-4222-8222-222222222222', origin: 'ORIGINE_TEST', destination: 'DESTINATION_TEST',
  container_type: '20DV', rate_amount: 123, rate_currency: 'XOF', source_document: 'SOURCE_SYNTHETIQUE',
  is_active: false, evidence_level: 'to_confirm', cargo_category: null, client_code: null, notes: null,
  provider: null, source_attachment_id: null, rate_includes: null, validity_start: null, validity_end: null, created_at: null, updated_at: null,
};
function setup(ready = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><TransportRateExchange rates={[row]} allRates={[]} ready={ready} /></QueryClientProvider>);
}
async function upload() {
  await userEvent.click(screen.getByRole('button', { name: 'Importer Excel' }));
  const file = new File(['synthetic'], 'fixture.xlsx');
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(0) });
  fireEvent.change(screen.getByLabelText('Fichier Excel (.xlsx)'), { target: { files: [file] } });
  await screen.findByText(/fixture.xlsx :/);
}
describe('actions Importer/Exporter Transport (API mockée)', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.parse.mockResolvedValue({ rows: [row], errors: [], unchanged: 0 });
    mocks.read.mockResolvedValue({ data: [], error: null }); mocks.insert.mockResolvedValue({ error: null });
    mocks.export.mockResolvedValue(new Uint8Array([1]));
  });
  afterEach(() => { vi.restoreAllMocks(); });
  it('présente les données puis exige la confirmation avant un INSERT unique et sa relecture', async () => {
    mocks.read.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValue({ data: [row], error: null });
    setup(); await upload();
    expect(screen.getByRole('region', { name: /Aperçu/ })).toHaveTextContent('SOURCE_SYNTHETIQUE');
    const save = screen.getByRole('button', { name: 'Créer 1 tarif(s) inactif(s)' });
    expect(save).toBeDisabled(); expect(mocks.insert).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.dblClick(save);
    await screen.findByText('1 tarif(s) enregistré(s) et relu(s).');
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.insert.mock.calls[0][0][0]).toMatchObject({ is_active: false, evidence_level: 'to_confirm', source_document: 'SOURCE_SYNTHETIQUE' });
  });
  it('bloque tout le fichier si une ligne est invalide et permet de le remplacer sans écrire', async () => {
    mocks.parse.mockResolvedValue({ rows: [row], errors: ['Ligne 3 : montant invalide.'], unchanged: 0 });
    setup(); await upload();
    expect(screen.getByText('Ligne 3 : montant invalide.')).toBeVisible();
    expect(screen.getByRole('button', { name: /Créer 1/ })).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled(); expect(mocks.insert).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('garde une issue UNKNOWN et ne propose qu’une relecture sans nouvel INSERT', async () => {
    mocks.insert.mockRejectedValue(new TypeError('synthetic lost response'));
    setup(); await upload(); await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: /Créer 1/ }));
    await screen.findByText(/Enregistrement non confirmé/);
    expect(screen.queryByRole('button', { name: /Créer 1/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Vérifier l’enregistrement' }));
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(3));
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });
  it('raccorde Exporter aux lignes chargées et déclenche un téléchargement XLSX', async () => {
    const create = vi.fn().mockReturnValue('blob:synthetic');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    setup(); await userEvent.click(screen.getByRole('button', { name: /Exporter/ }));
    await screen.findByText(/1 ligne\(s\) chargée\(s\)/);
    expect(mocks.export).toHaveBeenCalledWith([row]); expect(create).toHaveBeenCalled(); expect(click).toHaveBeenCalledOnce();
  });
  it('désactive les actions si le chargement des tarifs est indisponible', () => {
    setup(false);
    expect(screen.getByRole('button', { name: 'Importer Excel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Exporter/ })).toBeDisabled();
  });
  it('ferme par Échap et restitue le focus au bouton Importer', async () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'Importer Excel' });
    await userEvent.click(trigger); await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
