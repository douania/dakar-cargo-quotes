import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SodatraFeesEditor } from './SodatraFeesEditor';
import { QuotationCostBreakdown } from './QuotationCostBreakdown';
import type { SodatraFeeSuggestion } from '@/hooks/useSodatraFees';

afterEach(cleanup);
const suggestion = (factor?: number): SodatraFeeSuggestion => ({
  fees: [{ key: 'fixture-fee', label: 'Honoraires synthétiques', suggested_amount: 120,
    min_amount: 0, max_amount: 500, unit: 'dossier', formula: 'Fixture', is_editable: true, factors_applied: ['Fixture'] }],
  total_suggested: 120, complexity_factor: factor, complexity_reasons: [], transport_mode: 'maritime', can_calculate_commission: false,
});
describe('facteur de zone des honoraires', () => {
  it('conserve le facteur legacy connu sans modifier le montant confirmé', () => {
    const onConfirm = vi.fn(); const value = suggestion(1.3); const before = JSON.stringify(value);
    render(<SodatraFeesEditor suggestion={value} onFeesConfirmed={onConfirm} />);
    expect(screen.getByText('×1.30 complexité')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /confirmer/i }));
    expect(onConfirm).toHaveBeenCalledWith([{ key: 'fixture-fee', amount: 120 }]);
    expect(JSON.stringify(value)).toBe(before);
  });
  for (const factor of [undefined, NaN, Infinity, 0, -1]) it(`présente le facteur indéterminé ${factor} sans crash ni 1.0`, () => {
    render(<SodatraFeesEditor suggestion={suggestion(factor)} onFeesConfirmed={vi.fn()} />);
    expect(screen.getByText('Facteur de zone à confirmer')).toBeInTheDocument();
    expect(screen.queryByText(/×1\.00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/×NaN|×Infinity/)).not.toBeInTheDocument();
  });
  it('affiche aussi la réserve dans le mode compact', () => {
    render(<SodatraFeesEditor suggestion={suggestion()} onFeesConfirmed={vi.fn()} isCompact />);
    expect(screen.getByText('Facteur de zone à confirmer')).toBeInTheDocument();
  });
  it('le récapitulatif replié expose la réserve et préserve ses totaux', () => {
    render(<QuotationCostBreakdown costStructure={{ bloc_operationnel: { total: 500, items: [] },
      bloc_honoraires: { total: 120, items: [] }, bloc_debours: { total: 0, items: [] } }}
      sodatraFees={suggestion()} totalDap={620} totalDdp={620} offerType="indicative_dap" />);
    fireEvent.click(screen.getByRole('button', { name: /BLOC 2/ }));
    expect(screen.getByText('Facteur de zone à confirmer')).toBeInTheDocument();
    expect(screen.getAllByText(/620/).length).toBeGreaterThan(0);
  });
  it('une sortie historique sans suggestion garde son rendu et son facteur enregistré', () => {
    render(<QuotationCostBreakdown costStructure={{ bloc_operationnel: { total: 500, items: [] },
      bloc_honoraires: { total: 120, items: [], complexity_factor: 1.3 }, bloc_debours: { total: 0, items: [] } }}
      totalDap={620} totalDdp={620} offerType="indicative_dap" />);
    expect(screen.queryByText('Facteur de zone à confirmer')).not.toBeInTheDocument();
    expect(screen.getByText('×1.30')).toBeInTheDocument();
  });
  for (const isCompact of [false, true]) it(`une suggestion inconnue ne reprend pas un ancien facteur, compact=${isCompact}`, () => {
    render(<QuotationCostBreakdown costStructure={{ bloc_operationnel: { total: 500, items: [] },
      bloc_honoraires: { total: 120, items: [], complexity_factor: 1.3 }, bloc_debours: { total: 0, items: [] } }}
      sodatraFees={suggestion()} totalDap={620} totalDdp={620} offerType="indicative_dap" isCompact={isCompact} />);
    expect(screen.getAllByText('Facteur de zone à confirmer').length).toBeGreaterThan(0);
    expect(screen.queryByText(/×1\.30/)).not.toBeInTheDocument();
  });
});
