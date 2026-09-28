import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PricingResultPanel } from '../PricingResultPanel';

// MULTI-LOT-TERMINAL-1 (GO CTO 2026-09-26): a run executed successfully can still be incomplete.
// Known amount, unknown amount (TO_CONFIRM, null, reserve) and a genuine zero must stay distinct.
const pricingMock = vi.hoisted(() => ({ pricingRun: null as Record<string, unknown> | null }));

vi.mock('@/hooks/usePricingResultData', () => ({
  usePricingResultData: () => ({ pricingRun: pricingMock.pricingRun, versions: [], isLoading: false, refetchVersions: async () => {} }),
}));
vi.mock('@/integrations/supabase/client', () => {
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'update']) builder[m] = () => builder;
  builder.maybeSingle = async () => ({ data: null, error: null });
  builder.single = async () => ({ data: null, error: null });
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  return { supabase: { from: vi.fn(() => builder), rpc: vi.fn(), auth: { getUser: vi.fn() }, functions: { invoke: vi.fn() } } };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: typeof ResizeObserverStub }).ResizeObserver ?? ResizeObserverStub;

const known = { lot_index: 2, category: 'AGENCY', label: "Frais d'agence", amount: 200000, currency: 'XOF', source: { type: 'fee_rule' } };
const unknown = { lot_index: 2, category: 'SURVEY', label: 'Expertise', amount: null, currency: 'XOF',
  source: { type: 'TO_CONFIRM', reference: 'P5:TO_CONFIRM', confidence: 0, note: 'Tarif expertise à confirmer : aucun barème validé.' } };
const trueZero = { lot_index: 2, category: 'EMPTY_RETURN', label: 'Retour vide', amount: 0, currency: 'XOF', source: { type: 'business_rule' } };
const lot1 = { lot_index: 1, category: 'AGENCY', label: "Frais d'agence", amount: 200000, currency: 'XOF', source: { type: 'fee_rule' } };

function run(lot2Lines: Record<string, unknown>[]) {
  const lines = [lot1, ...lot2Lines];
  return {
    id: 'run-1', run_number: 1, created_at: '2026-09-26T12:00:00Z', completed_at: '2026-09-26T12:00:00Z',
    total_ht: 400000, total_ttc: 400000, currency: 'XOF', tariff_lines: lines, tariff_sources: [],
    outputs_json: {
      multi_lot: true, lines,
      lots: [
        { lot_index: 1, label: 'Lot A', lines: [lot1], totals: { ht: 200000, currency: 'XOF' } },
        { lot_index: 2, label: 'Lot B', lines: lot2Lines, totals: { ht: 200000, currency: 'XOF' } },
      ],
      totals: { ht: 400000, ttc: 400000, currency: 'XOF', subtotal_before_sodatra_vat: 400000, total_payable: 400000 },
    },
  };
}
const renderPanel = () => render(<QueryClientProvider client={new QueryClient()}><PricingResultPanel caseId="case-a" /></QueryClientProvider>);

describe('PricingResultPanel — incomplete multi-lot run', () => {
  afterEach(() => cleanup());

  it('keeps execution and completeness apart and never presents the total as complete', () => {
    pricingMock.pricingRun = run([known, unknown, trueZero]);
    renderPanel();
    expect(screen.getByText('Calcul exécuté')).toBeTruthy();
    expect(screen.getByText('Incomplet · 1 à confirmer')).toBeTruthy();
    expect(screen.getByText('Total à payer provisoire')).toBeTruthy();
    expect(screen.getByText('Hors 1 poste à confirmer')).toBeTruthy();
    expect(screen.getByText('Lignes chiffrées seulement, hors postes à confirmer')).toBeTruthy();
    expect(screen.getByText('Provisoire')).toBeTruthy();
    expect(screen.getByText('partiel (1 à confirmer)', { exact: false })).toBeTruthy();
    // Lot A holds no line to confirm: not marked partial.
    expect(screen.getAllByText('partiel', { exact: false })).toHaveLength(1);

    // The unknown service stays visible "À confirmer" with its reserve; the genuine zero shows 0.
    fireEvent.click(screen.getByText('Lot B'));
    const table = screen.getAllByRole('table').at(-1)!;
    const rows = within(table).getAllByRole('row');
    const surveyRow = rows.find(r => r.textContent?.includes('SURVEY'))!;
    const zeroRow = rows.find(r => r.textContent?.includes('EMPTY_RETURN'))!;
    expect(within(surveyRow).getByText('À confirmer')).toBeTruthy();
    expect(surveyRow.textContent).toContain('Tarif expertise à confirmer');
    expect(within(zeroRow).queryByText('À confirmer')).toBeNull();
    expect(zeroRow.textContent).toMatch(/0/);
  });

  it('a complete run keeps the plain labels', () => {
    pricingMock.pricingRun = run([known, trueZero]);
    renderPanel();
    expect(screen.getByText('Calcul exécuté')).toBeTruthy();
    expect(screen.queryByText(/Incomplet/)).toBeNull();
    expect(screen.getByText('Total à payer')).toBeTruthy();
    expect(screen.queryByText('Total à payer provisoire')).toBeNull();
    expect(screen.queryByText('partiel', { exact: false })).toBeNull();
  });
it("the version confirmation qualifies an incomplete total and names the lines to confirm", async () => {
    pricingMock.pricingRun = run([known, unknown, trueZero]);
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Créer la version v1/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Total à payer provisoire : 400");
    expect(dialog.textContent).toContain("(hors 1 poste à confirmer)");
    expect(dialog.textContent).not.toMatch(/• Total à payer :/);
  });

  it("the version confirmation of a complete run keeps the plain total (genuine zero is not a line to confirm)", async () => {
    pricingMock.pricingRun = run([known, trueZero]);
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Créer la version v1/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/• Total à payer : 400/);
    expect(dialog.textContent).not.toMatch(/provisoire|à confirmer/);
  });
});
