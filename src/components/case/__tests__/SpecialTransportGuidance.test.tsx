import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SpecialTransportGuidance } from '../SpecialTransportGuidance';

afterEach(cleanup);
const unit = (weight: number, basis = 'per_unit', quantity = 39) => ({ unit_ref: 'heavy', unit_kind: 'CONTAINER',
  quantity, gross_weight_kg: weight, weight_basis: basis, dangerous_goods: true, un_number: 'UN3536' });
const scope = (units: unknown[]) => ({ transport_mode: 'MARITIME', movement_direction: 'IMPORT', cargo_units: units });

describe('heavy transport operator guidance', () => {
  it('explains heavy DG cargo without changing the scope or requiring a specific truck', () => {
    const snapshot = scope([unit(55000), { ...unit(18000), unit_ref: 'ordinary' }]);
    const before = JSON.stringify(snapshot);
    render(<SpecialTransportGuidance snapshot={snapshot} />);
    expect(screen.getByRole('region', { name: 'Orientation transport des lots lourds' })).toBeVisible();
    expect(screen.getByText(/poids déclaré par unité dépasse 51 tonnes/)).toBeVisible();
    expect(screen.getByText(/UN3536/)).toBeVisible();
    expect(screen.queryByText(/ordinary/)).toBeNull();
    expect(screen.getByText(/configuration tracteur\/remorque/)).toBeInTheDocument();
    expect(JSON.stringify(snapshot)).toBe(before);
  });
  it.each([[55000, 'total', 39], [55000, 'unknown', 1], [18000, 'per_unit', 1], [Infinity, 'per_unit', 1], [55000, 'per_unit', 0]])(
    'does not treat group totals, unknown weights or invalid data as individual heavy units (%s %s %s)', (weight, basis, qty) => {
      const { container } = render(<SpecialTransportGuidance snapshot={scope([unit(weight, basis, qty)])} />);
      expect(container).toBeEmptyDOMElement();
    });
  it('distinguishes internal threshold from the regulatory reference and refreshes after revision', () => {
    const { rerender } = render(<SpecialTransportGuidance snapshot={scope([unit(18001)])} />);
    expect(screen.getByText(/Ce seuil n’est pas une limite légale/)).toBeVisible();
    expect(screen.queryByText(/poids déclaré par unité dépasse/)).toBeNull();
    rerender(<SpecialTransportGuidance snapshot={scope([unit(55000, 'total', 1)])} />);
    expect(screen.getByText(/poids déclaré par unité dépasse/)).toBeVisible();
    rerender(<SpecialTransportGuidance snapshot={scope([unit(15000)])} />);
    expect(screen.queryByRole('region')).toBeNull();
  });
  it('does not show this import guidance on an unrelated scope', () => {
    const { container } = render(<SpecialTransportGuidance snapshot={{ ...scope([unit(55000)]), movement_direction: 'EXPORT' }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
