import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DesignationSuggestionBlock from '../DesignationSuggestionBlock';
import CaseDocumentsTab from '../CaseDocumentsTab';
import { ReadyActionsPanel } from '../ReadyActionsPanel';
import { clientDraftScopes, isCurrentClientDraft, type ClientDraftRequest } from '@/lib/clientDraftScope';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), from: vi.fn(), remove: vi.fn(), toast: vi.fn(), success: vi.fn(), error: vi.fn(), reads: {} as Record<string, unknown> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mocks.invoke }, from: mocks.from, storage: { from: () => ({ remove: mocks.remove }) } } }));
vi.mock('@/hooks/use-toast', () => ({ toast: mocks.toast }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error, info: vi.fn() } }));
vi.mock('@/hooks/useQualifiedScopeGate', () => ({ useQualifiedScopeGate: () => ({ hasCriticalUnconfirmed: false }) }));
vi.mock('../DocumentMetadataEditor', () => ({ default: () => null }));
vi.mock('@tanstack/react-query', async () => ({
  ...await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query'),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: mocks.reads[queryKey[0]], isLoading: false }),
}));
let client: QueryClient;
let deleteRow: ReturnType<typeof vi.fn>;
const requests: ClientDraftRequest[] = [
  { id: 'r1', gap_key: 'cargo.weight_kg', status: 'drafted', source_timeline_event_id: 'source-a', draft_subject: 'Poids', draft_body: 'Message A synthétique' },
  { id: 'r2', gap_key: 'cargo.description', status: 'drafted', source_timeline_event_id: 'source-b', draft_subject: 'Description', draft_body: 'Message B synthétique' },
];
function mount(ui: React.ReactNode) { return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.invoke.mockReset(); mocks.from.mockReset(); mocks.remove.mockReset();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  mocks.reads = {
    'designation-suggestions': [{ categoryId: 'cat', padCategory: 'T01', label: 'Marchandise test', score: 1, reason: 'test', source: 'validated_match' }],
    'pad-official-rates': { T01: { amount: 100, evidence_level: 'official' } },
    'commodity-categories-list': [],
    'case-documents': [{ id: 'doc', storage_path: 'case-test/document.pdf', file_name: 'document-test.pdf', document_type: 'BL', created_at: '2026-09-30T10:00:00Z' }],
    'case-documents-metadata': {}, 'case-email-attachments': [],
    'ready-actions-panel': { status: 'NEED_INFO', gaps: [], clientGaps: requests, requests: [], pendingFacts: 0, hasSelectedVersion: false, drafts: [], hasProposedFacts: false },
  };
  deleteRow = vi.fn().mockResolvedValue({ data: [{ id: 'doc' }], error: null });
  const builder = { eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), delete: vi.fn().mockReturnThis(), then: (resolve: (v: unknown) => unknown) => deleteRow().then(resolve) };
  mocks.from.mockReturnValue(builder);
  mocks.remove.mockResolvedValue({ error: null });
});
afterEach(() => { cleanup(); client.clear(); });

it.each([{ data: null, error: new Error('refus') }, { data: { ok: false, error: { message: 'refus' } }, error: null }])('PAD: stops after category refusal and never announces success', async result => {
  mocks.invoke.mockResolvedValue(result);
  mount(<DesignationSuggestionBlock goodsDescription="test cargo" caseDocumentId="doc" caseId="case-test" sourceReference="test" />);
  await userEvent.click(screen.getByRole('button', { name: 'Appliquer au dossier' }));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })));
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Catégorie PAD appliquée au dossier' }));
});
it.each([true, false])('PAD: reports a partial write when the rate fails, and refreshes facts (%s)', async thrown => {
  mocks.invoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
  if (thrown) mocks.invoke.mockRejectedValueOnce(new Error('network'));
  else mocks.invoke.mockResolvedValueOnce({ data: { ok: false }, error: null });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  mount(<DesignationSuggestionBlock goodsDescription="test cargo" caseDocumentId="doc" caseId="case-test" sourceReference="test" />);
  await userEvent.click(screen.getByRole('button', { name: 'Appliquer au dossier' }));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('Application partielle') })));
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['case-facts', 'case-test'] });
});
it('PAD: announces success only after both writes succeed', async () => {
  mocks.invoke.mockResolvedValue({ data: { ok: true }, error: null });
  mount(<DesignationSuggestionBlock goodsDescription="test cargo" caseDocumentId="doc" caseId="case-test" sourceReference="test" />);
  await userEvent.click(screen.getByRole('button', { name: 'Appliquer au dossier' }));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ title: 'Catégorie PAD appliquée au dossier' }));
  expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'set-case-fact', { body: { case_id: 'case-test', fact_key: 'cargo.pad_rate_fcfa_per_ton', value_number: 100 } });
});
it('document: opening and cancelling confirmation never deletes anything', async () => {
  mount(<CaseDocumentsTab caseId="case-test" />);
  await userEvent.click(screen.getByRole('button', { name: 'Supprimer document-test.pdf' }));
  expect(screen.getByRole('alertdialog')).toHaveTextContent('Les faits déjà extraits ne seront pas supprimés');
  await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));
  expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
});
it('document: a refused or absent row cannot trigger storage deletion', async () => {
  deleteRow.mockResolvedValue({ data: [], error: null });
  mount(<CaseDocumentsTab caseId="case-test" />);
  await userEvent.click(screen.getByRole('button', { name: 'Supprimer document-test.pdf' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirmer la suppression' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Suppression non confirmée');
  expect(mocks.remove).not.toHaveBeenCalled();
});
it('document: storage failure remains visible and retry does not repeat row deletion', async () => {
  mocks.remove.mockResolvedValueOnce({ error: new Error('offline') }).mockResolvedValueOnce({ error: null });
  mount(<CaseDocumentsTab caseId="case-test" />);
  await userEvent.click(screen.getByRole('button', { name: 'Supprimer document-test.pdf' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirmer la suppression' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Document retiré du dossier, mais fichier non supprimé');
  expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Document supprimé' }));
  await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));
  await userEvent.click(screen.getByRole('button', { name: 'Reprendre la suppression du fichier' }));
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer la suppression' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(deleteRow).toHaveBeenCalledTimes(1); expect(mocks.remove).toHaveBeenCalledTimes(2);
});
it('client: explicit confirmation marks only the displayed message, with a synchronous double-click guard', async () => {
  deleteRow.mockResolvedValue({ data: [requests[0]], error: null });
  let finish!: (value: unknown) => void;
  mocks.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  mount(<ReadyActionsPanel caseId="case-test" />);
  await userEvent.click(screen.getByRole('button', { name: 'Confirmer l’envoi manuel' }));
  const dialog = screen.getByRole('alertdialog');
  expect(dialog).toHaveTextContent('Message A synthétique'); expect(dialog).not.toHaveTextContent('Message B synthétique');
  expect(mocks.invoke).not.toHaveBeenCalled();
  const confirm = within(dialog).getByRole('button', { name: 'Confirmer cet envoi' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
  expect(mocks.invoke).toHaveBeenCalledWith('mark-client-gap-request-sent', { body: { case_id: 'case-test', gap_keys: ['cargo.weight_kg'] } });
  finish({ data: { ok: true, updated: 1, skipped: 0 }, error: null });
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
});
it.each([true, false])('client: changed draft or partial server response never becomes success (%s)', async changed => {
  deleteRow.mockResolvedValue({ data: [{ ...requests[0], draft_body: changed ? 'Message changé' : requests[0].draft_body }], error: null });
  mocks.invoke.mockResolvedValue({ data: { ok: true, updated: 0, skipped: 1 }, error: null });
  mount(<ReadyActionsPanel caseId="case-test" />);
  await userEvent.click(screen.getByRole('button', { name: 'Confirmer l’envoi manuel' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirmer cet envoi' }));
  await screen.findByRole('alert');
  expect(mocks.success).not.toHaveBeenCalled();
  expect(mocks.invoke).toHaveBeenCalledTimes(changed ? 0 : 1);
});
it('client: groups by source and exact text, refusing a same-key replacement or incomplete legacy draft', () => {
  const scopes = clientDraftScopes([...requests, { ...requests[0], id: 'legacy', source_timeline_event_id: null }]);
  expect(scopes).toHaveLength(2);
  expect(isCurrentClientDraft(scopes[0], [{ ...requests[0], id: 'replacement' }])).toBe(false);
  expect(isCurrentClientDraft(scopes[0], [requests[0]])).toBe(true);
});
