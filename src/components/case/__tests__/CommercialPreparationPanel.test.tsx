import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { CommercialPreparationPanel } from '../CommercialPreparationPanel';
import { prepareCommercialQuote } from '@/lib/commercialPreparation';

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver = ResizeObserverStub;
Element.prototype.scrollIntoView = vi.fn(); Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => {}; Element.prototype.releasePointerCapture = () => {};
afterEach(cleanup);
const reason = 'Décision opérateur pour ce dossier fictif seulement';
const source = { totals: { currency: 'XOF' }, raw_lines: [
  { label: 'Handling aéroportuaire', amount: null, source: { type: 'TO_CONFIRM', air_handling: { supplier_known_ht_xof: 34420, source_reference: 'Synthetic documentary cost' } } },
  { label: 'Honoraires', amount: 200000, source: { type: 'fee_rule' } },
] };
const initial = () => prepareCommercialQuote('fictional-case', 'fictional-version', source);
async function select(label: string, option: string) {
  fireEvent.keyDown(screen.getByLabelText(label), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

describe('Commercial preparation component, no backend mutation', () => {
  it('separates source cost from customer amount and announces local/non-durable state', () => {
    render(<CommercialPreparationPanel initial={initial()} actorId="fictional-operator"/>);
    expect(screen.getByText(/Préparation locale non enregistrée/)).toBeInTheDocument();
    const line = screen.getByText('Handling aéroportuaire').closest('tr')!;
    expect(within(line).getByText(/34.*420 FCFA/)).toBeInTheDocument();
    expect(within(line).getAllByText('À confirmer').length).toBeGreaterThan(0);
    expect(screen.getByText('Montants dont la base reste à préciser')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enregistrer|Créer la version|Envoyer/ })).not.toBeInTheDocument();
  });
  it('retains a separate estimated customer amount while preserving the source', async () => {
    const changed = vi.fn(), draft = initial(); render(<CommercialPreparationPanel initial={draft} actorId="fictional-operator" onDraftChanged={changed}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Handling aéroportuaire' }));
    fireEvent.change(screen.getByLabelText(/Montant client en FCFA/), { target: { value: '40 000' } });
    await select('Base du montant client', 'Avant TVA SODATRA');
    fireEvent.change(screen.getByLabelText('Justification et source de l’estimation'), { target: { value: reason } });
    fireEvent.click(screen.getByRole('button', { name: 'Retenir dans la préparation' }));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls[0][0].lines[0]).toMatchObject({ client_amount_xof: 40000, status: 'estimated', supplier: { amount_ht_xof: 34420 } });
    expect(draft.lines[0].client_amount_xof).toBeNull(); expect(source.raw_lines[0].amount).toBeNull();
  });
  it('requires a reason, focuses the invalid field and preserves malformed input instead of converting to zero', () => {
    const changed = vi.fn(); render(<CommercialPreparationPanel initial={initial()} actorId="fictional-operator" onDraftChanged={changed}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Handling aéroportuaire' }));
    fireEvent.change(screen.getByLabelText(/Montant client en FCFA/), { target: { value: '12abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Retenir dans la préparation' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/au moins 10/);
    expect(screen.getByLabelText('Justification et source de l’estimation')).toHaveFocus();
    fireEvent.change(screen.getByLabelText('Justification et source de l’estimation'), { target: { value: reason } });
    fireEvent.click(screen.getByRole('button', { name: 'Retenir dans la préparation' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/numérique/);
    expect(screen.getByLabelText(/Montant client en FCFA/)).toHaveValue('12abc'); expect(changed).not.toHaveBeenCalled();
  });
  it('allows an explicit zero and reversibly removes a line without deleting source data', async () => {
    const changed = vi.fn(); render(<CommercialPreparationPanel initial={initial()} actorId="fictional-operator" onDraftChanged={changed}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Handling aéroportuaire' }));
    fireEvent.change(screen.getByLabelText(/Montant client en FCFA/), { target: { value: '0' } });
    await select('Base du montant client', 'Taxes comprises');
    fireEvent.change(screen.getByLabelText('Justification et source de l’estimation'), { target: { value: reason } });
    fireEvent.click(screen.getByRole('button', { name: 'Retenir dans la préparation' }));
    expect(changed.mock.calls[0][0].lines[0].client_amount_xof).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Handling aéroportuaire' }));
    fireEvent.change(screen.getByLabelText('Justification et source de l’estimation'), { target: { value: reason } });
    fireEvent.click(screen.getByRole('button', { name: 'Retirer cette ligne de la préparation' }));
    expect(changed.mock.calls[1][0].lines).toHaveLength(2); expect(changed.mock.calls[1][0].lines[0].included).toBe(false);
    expect(screen.getByText('Retirée')).toBeInTheDocument();
  });
  it('adds an explicitly estimated customs provision without presenting it as an official fiscal tariff', async () => {
    const changed = vi.fn(); render(<CommercialPreparationPanel initial={initial()} actorId="fictional-operator" onDraftChanged={changed}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une rubrique' }));
    fireEvent.change(screen.getByLabelText('Libellé de la rubrique'), { target: { value: 'Provision douane' } });
    await select('Nature', 'Provision droits et taxes');
    fireEvent.change(screen.getByLabelText(/Montant client en FCFA/), { target: { value: '150000' } });
    await select('Base du montant client', 'Taxes comprises');
    fireEvent.change(screen.getByLabelText('Justification et source de l’estimation'), { target: { value: reason } });
    fireEvent.click(screen.getByRole('button', { name: 'Retenir dans la préparation' }));
    expect(screen.getByText('Provision opérateur ; aucun taux fiscal validé.')).toBeInTheDocument();
    const lines = changed.mock.calls[0][0].lines;
    expect(lines[lines.length - 1]).toMatchObject({ client_amount_xof: 150000, kind: 'customs_estimate', status: 'estimated' });
  });
  it('locks edits and resets the whole preparation immediately when case/version changes', () => {
    const view = render(<CommercialPreparationPanel initial={initial()} actorId="fictional-operator" isLocked/>);
    expect(screen.getByRole('button', { name: 'Ajouter une rubrique' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Modifier Handling aéroportuaire' })).toBeDisabled();
    view.rerender(<CommercialPreparationPanel initial={prepareCommercialQuote('other-case', 'other-version', { raw_lines: [] })} actorId="fictional-operator"/>);
    expect(screen.queryByText('Handling aéroportuaire')).not.toBeInTheDocument();
    expect(screen.getByText(/Aucune ligne préparée/)).toBeInTheDocument();
  });
  it('retains valid state and entered fields when cumulative amounts would overflow', async () => {
    const changed = vi.fn(); render(<CommercialPreparationPanel initial={initial()} actorId="fictional-operator" onDraftChanged={changed}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Handling aéroportuaire' }));
    fireEvent.change(screen.getByLabelText(/Montant client en FCFA/), { target: { value: '999999999999' } });
    await select('Base du montant client', 'Taxes comprises');
    fireEvent.change(screen.getByLabelText('Justification et source de l’estimation'), { target: { value: reason } });
    fireEvent.click(screen.getByRole('button', { name: 'Retenir dans la préparation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une rubrique' }));
    fireEvent.change(screen.getByLabelText('Libellé de la rubrique'), { target: { value: 'Autre prestation' } });
    fireEvent.change(screen.getByLabelText(/Montant client en FCFA/), { target: { value: '1' } });
    await select('Base du montant client', 'Taxes comprises');
    fireEvent.change(screen.getByLabelText('Justification et source de l’estimation'), { target: { value: reason } });
    fireEvent.click(screen.getByRole('button', { name: 'Retenir dans la préparation' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Somme hors limites/);
    expect(screen.getByLabelText(/Montant client en FCFA/)).toHaveValue('1'); expect(changed).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('restores keyboard focus to the owning action when a controlled dialog closes', async () => {
    render(<CommercialPreparationPanel initial={initial()} actorId="fictional-operator"/>);
    const opener = screen.getByRole('button', { name: 'Modifier Handling aéroportuaire' });
    opener.focus(); fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });
});
