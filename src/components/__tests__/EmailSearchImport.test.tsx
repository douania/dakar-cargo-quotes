import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EmailSearchImport } from '../EmailSearchImport';

const { invoke, info, success, error, processQuotationRequest, from, idsFilter } = vi.hoisted(() => ({
  invoke: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn(), processQuotationRequest: vi.fn(), from: vi.fn(), idsFilter: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke }, from } }));
vi.mock('sonner', () => ({ toast: { info, success, error } }));
vi.mock('@/services/emailService', () => ({ processQuotationRequest }));
vi.mock('@/components/QuotationProcessor', () => ({ QuotationProcessor: () => null }));

const thread = {
  threadKey: '<root@example.invalid>', subject: 'Cotation locale', normalizedSubject: 'cotation locale',
  messageCount: 1, participants: ['sender@example.invalid'],
  dateRange: { first: '2026-01-02T12:00:00Z', last: '2026-01-02T12:00:00Z' }, attachments: [],
  messages: [{ uid: 101, seq: 1, subject: 'Cotation locale', from: 'sender@example.invalid', to: [], date: '2026-01-02T12:00:00Z', messageId: '<root@example.invalid>' }],
};
const coverage = { exhaustive: false, totalFoundIsLowerBound: true, recentWindowSize: 200, resultsTruncated: false };

function renderSearch() {
  render(<MemoryRouter><EmailSearchImport configId="fixture-config" onImportComplete={() => {}} /></MemoryRouter>);
}
function search() {
  fireEvent.change(screen.getByPlaceholderText('Ex: DAP SAINT LOUIS'), { target: { value: 'Cotation locale' } });
  fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }));
}

describe('EmailSearchImport - couverture de recherche', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('affiche durablement résultats partiels, borne récente, plafond et total minimum', async () => {
    invoke.mockResolvedValue({ data: { threads: [thread], totalFound: 1, selectedCount: 1, limitApplied: 200, searchCoverage: { ...coverage, qCandidatesTruncated: true }, reconstructionTruncated: true }, error: null });
    renderSearch(); search();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Recherche partielle');
    expect(alert.textContent).toContain('Affichage limité à 200 e-mails');
    expect(alert.textContent).toContain('fenêtre de 200 e-mails récents');
    expect(alert.textContent).toContain('Certains candidats n’ont pas été vérifiés');
    expect(alert.textContent).toContain('Certains échanges liés');
    expect(screen.getByText(/Au moins 1 email/)).toBeTruthy();
    expect(success).toHaveBeenCalledWith(expect.stringContaining('résultats partiels'));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toBe('search-emails');
  });

  it('zéro résultat non exhaustif ne devient pas une absence définitive de demande', async () => {
    invoke.mockResolvedValue({ data: { threads: [], totalFound: 0, selectedCount: 0, limitApplied: 200, searchCoverage: coverage }, error: null });
    renderSearch(); search();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Aucun résultat dans le périmètre vérifié');
    expect(alert.textContent).toContain('ne permet pas de conclure à l’absence d’une demande');
    expect(info).toHaveBeenCalledWith('Aucun résultat dans le périmètre vérifié. La recherche reste partielle.');
    expect(info).not.toHaveBeenCalledWith('Aucun email trouvé pour cette recherche');
    expect(success).not.toHaveBeenCalled();
  });

  it('retire l’avertissement précédent au lancement puis sur échec ; aucune couverture stale', async () => {
    invoke.mockResolvedValueOnce({ data: { threads: [], totalFound: 0, searchCoverage: coverage }, error: null });
    renderSearch(); search();
    await screen.findByRole('alert');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rechercher' }).hasAttribute('disabled')).toBe(false));
    let settle!: (value: unknown) => void;
    invoke.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }));
    expect(screen.queryByRole('alert')).toBeNull();
    settle({ data: null, error: new Error('Échec local fictif') });
    await waitFor(() => expect(error).toHaveBeenCalledWith('Échec local fictif'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ne montre pas de réserve de couverture si l’API annonce un résultat complet non tronqué', async () => {
    invoke.mockResolvedValue({ data: { threads: [], totalFound: 0, selectedCount: 0, limitApplied: 200, searchCoverage: { exhaustive: true } }, error: null });
    renderSearch(); search();
    await waitFor(() => expect(info).toHaveBeenCalledWith('Aucun email trouvé pour cette recherche'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('transmet le contexte de recherche aux deux chemins import et cotation', async () => {
    const context = { configId: 'fixture-config', mailbox: 'INBOX', uidValidity: 77, accountKey: 'fixture-account',
      messages: [{ uid: 101, messageId: thread.messages[0].messageId }] };
    invoke.mockResolvedValueOnce({ data: { threads: [thread], totalFound: 1, ...context }, error: null });
    invoke.mockResolvedValueOnce({ data: { imported: 0, alreadyExisted: 1, emails: [], hasMore: false }, error: null });
    renderSearch(); search(); await screen.findByText('Cotation locale');
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Importer pour apprentissage' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke.mock.calls[1]).toEqual(['import-thread', { body: {
      configId: 'fixture-config', uids: [101], learningCase: 'quotation', threadKey: thread.threadKey, searchIdentity: context,
    } }]);
    cleanup(); vi.clearAllMocks();
    invoke.mockResolvedValueOnce({ data: { threads: [thread], totalFound: 1, ...context }, error: null });
    processQuotationRequest.mockRejectedValueOnce(new Error('Fin du banc fictif'));
    renderSearch(); search(); await screen.findByText('Cotation locale');
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Traiter cette cotation' }));
    await waitFor(() => expect(processQuotationRequest).toHaveBeenCalledWith('fixture-config', [101], thread.threadKey, context));
  });

  it('le lot mixte analyse seulement les PJ des nouveaux emails', async () => {
    invoke.mockResolvedValueOnce({ data: { threads: [thread], totalFound: 1, mailbox: 'INBOX', uidValidity: 77, accountKey: 'fixture-account' }, error: null });
    invoke.mockResolvedValueOnce({ data: { imported: 1, alreadyExisted: 1, attachmentsProcessed: 1, hasMore: false,
      emails: [{ id: 'fixture-existing', alreadyExists: true }, { id: 'fixture-new', alreadyExists: false }] }, error: null });
    from.mockReturnValue({ select: () => ({ in: idsFilter }) });
    idsFilter.mockReturnValue({ eq: () => ({ not: () => Promise.resolve({ data: [] }) }) });
    renderSearch(); search(); await screen.findByText('Cotation locale');
    fireEvent.click(screen.getAllByRole('checkbox')[1]); fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: 'Importer pour apprentissage' }));
    await waitFor(() => expect(idsFilter).toHaveBeenCalledWith('email_id', ['fixture-new']));
    expect(from).toHaveBeenCalledWith('email_attachments');
  });

  it('refuse un résultat sans namespace ou provenant d’une autre configuration avant import', async () => {
    invoke.mockResolvedValueOnce({ data: { threads: [thread], totalFound: 1 }, error: null });
    renderSearch(); search(); await screen.findByText('Cotation locale');
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Importer pour apprentissage' }));
    expect(error).toHaveBeenCalledWith('Relancez la recherche pour vérifier la boîte et les messages avant import.');
    expect(invoke).toHaveBeenCalledTimes(1);
    cleanup(); vi.clearAllMocks();
    invoke.mockResolvedValueOnce({ data: { threads: [thread], totalFound: 1, mailbox: 'INBOX', uidValidity: 77, accountKey: 'fixture-account' }, error: null });
    const view = render(<MemoryRouter><EmailSearchImport configId="fixture-config" onImportComplete={() => {}} /></MemoryRouter>);
    search(); await screen.findByText('Cotation locale');
    view.rerender(<MemoryRouter><EmailSearchImport configId="fixture-other-config" onImportComplete={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Traiter cette cotation' }));
    expect(error).toHaveBeenCalledWith('Relancez la recherche pour vérifier la boîte et les messages avant import.');
    expect(processQuotationRequest).not.toHaveBeenCalled(); expect(invoke).toHaveBeenCalledTimes(1);
  });
});
