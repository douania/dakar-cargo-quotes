import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuotationVersionCard } from '../QuotationVersionCard';
import { SendQuotationPanel } from '../SendQuotationPanel';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getUser: vi.fn() },
    functions: { invoke: vi.fn() },
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: typeof ResizeObserverStub }).ResizeObserver ?? ResizeObserverStub;

type Row = Record<string, unknown>;
type DbResult<T> = { data: T | null; error: { message: string } | null };
interface FixtureBuilder extends PromiseLike<DbResult<Row[]>> {
  select: (columns?: string) => FixtureBuilder;
  eq: (column: string, value: unknown) => FixtureBuilder;
  neq: (column: string, value: unknown) => FixtureBuilder;
  in: (column: string, values: unknown[]) => FixtureBuilder;
  order: (column: string, options: { ascending: boolean }) => FixtureBuilder;
  limit: (count: number) => FixtureBuilder;
  maybeSingle: () => Promise<DbResult<Row>>;
  single: () => Promise<DbResult<Row>>;
  update: (patch: Row) => FixtureBuilder;
}

const fromMock = vi.mocked(supabase.from);
const rpcMock = vi.mocked(supabase.rpc);
const getUserMock = vi.mocked(supabase.auth.getUser);
const invokeMock = vi.mocked(supabase.functions.invoke);
const toastError = vi.mocked(toast.error);
const toastSuccess = vi.mocked(toast.success);
const updateSpy = vi.fn();

let db: Record<string, Row[]>;
let forceRpcError: string | null = null;
let rpcGate: ReturnType<typeof createDeferred> | null = null;
let refetchGate: ReturnType<typeof createDeferred> | null = null;
let forceNextRead: string | null = null;
let forceResolvedError: { table: string; kind?: 'single' | 'list' } | null = null;
let throwAfterCommit = false;
let versionListGate: (ReturnType<typeof createDeferred> & { caseId: string }) | null = null;

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}

function snapshot(totalHt: number): Row {
  return { totals: { total_ht: totalHt, currency: 'XOF' }, lines: [{ description: 'ligne' }], raw_lines: [], meta: {} };
}

function seedTwoVersions(caseId: string) {
  db.quotation_versions.push(
    { id: caseId + '-v1', case_id: caseId, version_number: 1, status: 'approved', is_selected: true,
      snapshot: snapshot(1000000), created_at: '2026-08-01T08:00:00Z', created_by: null },
    { id: caseId + '-v2', case_id: caseId, version_number: 2, status: 'draft', is_selected: false,
      snapshot: snapshot(2000000), created_at: '2026-08-02T08:00:00Z', created_by: null },
  );
  db.quote_cases.push({ id: caseId, status: 'QUOTED_VERSIONED' });
}

function seedDraft(versionId: string, overrides: Row) {
  overrides = overrides || {};
  db.email_drafts.push(Object.assign({
    id: 'draft-' + versionId, quotation_version_id: versionId, subject: 'Devis ' + versionId,
    to_addresses: ['client@example.com'], status: 'draft', sent_at: null,
    body_text: 'Corps ' + versionId, body_html: null, ai_generated: false,
    created_at: '2026-08-01T09:00:00Z',
  }, overrides));
}

function createTableBuilder(table: string): FixtureBuilder {
  let rows: Row[] = (db[table] || []).slice();
  let limitN: number | null = null;
  let scopedCase: unknown;

  const finalize = () => (limitN != null ? rows.slice(0, limitN) : rows);

  const maybeGate = async (kind: 'single' | 'list') => {
    if (table === 'quote_cases' && refetchGate) {
      await refetchGate.promise;
    }
    if (kind === 'list' && table === 'quotation_versions' && versionListGate?.caseId === scopedCase) {
      await versionListGate.promise;
    }
    if (forceNextRead === table) {
      forceNextRead = null;
      throw new Error('Network fixture down: ' + table);
    }
    if (forceResolvedError?.table === table && (!forceResolvedError.kind || forceResolvedError.kind === kind)) {
      forceResolvedError = null;
      return { message: 'Supabase fixture read error: ' + table };
    }
    return null;
  };
  const single = async (): Promise<DbResult<Row>> => {
    const error = await maybeGate('single');
    return { data: error ? null : finalize()[0] ?? null, error };
  };
  const builder: FixtureBuilder = {
    select: () => builder,
    eq: (col, val) => { if (col === 'case_id') scopedCase = val; rows = rows.filter(r => r[col] === val); return builder; },
    neq: (col, val) => { rows = rows.filter(r => r[col] !== val); return builder; },
    in: (col, vals) => { rows = rows.filter(r => vals.includes(r[col])); return builder; },
    order: (col, opts) => {
      rows.sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (opts.ascending ? 1 : -1));
      return builder;
    },
    limit: (n) => { limitN = n; return builder; },
    maybeSingle: single,
    single,
    then: (resolve, reject) => maybeGate('list')
      .then(error => ({ data: error ? null : finalize(), error }))
      .then(resolve, reject),
    update: (patch) => { updateSpy(table, patch); return builder; },
  };
  return builder;
}

function renderPair(caseId: string, client?: QueryClient) {
  const queryClient = client || new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <div data-testid={'card-' + caseId}><QuotationVersionCard caseId={caseId} /></div>
      <div data-testid={'panel-' + caseId}><SendQuotationPanel caseId={caseId} /></div>
    </QueryClientProvider>,
  );
  return {
    ...utils,
    client: queryClient,
    card: () => within(screen.getByTestId('card-' + caseId)),
    panel: () => within(screen.getByTestId('panel-' + caseId)),
  };
}

function amountPattern(n: number) {
  return new RegExp(n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
}

beforeEach(() => {
  vi.resetAllMocks();
  db = {
    quotation_versions: [], quote_cases: [], email_drafts: [], quotation_documents: [],
    external_quote_requests: [], external_quote_response_facts: [], client_gap_requests: [],
  };
  forceRpcError = null;
  rpcGate = null;
  refetchGate = null;
  forceNextRead = null;
  forceResolvedError = null;
  throwAfterCommit = false;
  versionListGate = null;
  updateSpy.mockReset();

  fromMock.mockImplementation(createTableBuilder as unknown as typeof supabase.from);
  getUserMock.mockResolvedValue({ data: { user: { id: 'operator-1' } }, error: null } as Awaited<ReturnType<typeof supabase.auth.getUser>>);
  rpcMock.mockImplementation((async (fn: string, args: Record<string, unknown>) => {
    if (fn !== 'select_quotation_version') return { data: null, error: null };
    if (rpcGate) await rpcGate.promise;
    if (forceRpcError) {
      const message = forceRpcError;
      forceRpcError = null;
      return { data: null, error: new Error(message) };
    }
    db.quotation_versions = db.quotation_versions.map((v) => (
      v.case_id === args.p_case_id ? Object.assign({}, v, { is_selected: v.id === args.p_version_id }) : v
    ));
    if (throwAfterCommit) throw new Error('Response lost after commit');
    return { data: null, error: null };
  }) as unknown as typeof supabase.rpc);
});

afterEach(() => {
  cleanup();
});

describe('QuotationVersionCard <-> SendQuotationPanel selection sync', () => {
  it('v1 -> v2 -> v1 round trip stays aligned without a reload, preserves drafts, and triggers zero implicit actions', async () => {
    seedTwoVersions('case-a');
    seedDraft('case-a-v1', {});
    seedDraft('case-a-v2', {});
    const user = userEvent.setup();
    const pair = renderPair('case-a');
    const card = pair.card;
    const panel = pair.panel;

    expect(await panel().findByText('v1')).toBeInTheDocument();
    expect(panel().getByText(amountPattern(1000000))).toBeInTheDocument();
    expect(panel().getByDisplayValue('Corps case-a-v1')).toBeInTheDocument();

    await user.click(card().getByRole('button', { name: 'Sélectionner' }));

    await waitFor(() => expect(panel().getByText('v2')).toBeInTheDocument());
    expect(panel().getByText(amountPattern(2000000))).toBeInTheDocument();
    expect(panel().getByDisplayValue('Corps case-a-v2')).toBeInTheDocument();
    expect(card().getByRole('button', { name: 'Sélectionner' })).toBeInTheDocument();

    await user.click(card().getByRole('button', { name: 'Sélectionner' }));

    await waitFor(() => expect(panel().getByText('v1')).toBeInTheDocument());
    expect(panel().getByText(amountPattern(1000000))).toBeInTheDocument();
    expect(panel().getByDisplayValue('Corps case-a-v1')).toBeInTheDocument();

    expect(db.quotation_versions).toHaveLength(2);
    const v1row = db.quotation_versions.filter((v) => v.id === 'case-a-v1')[0];
    const v2row = db.quotation_versions.filter((v) => v.id === 'case-a-v2')[0];
    expect(v1row.snapshot).toEqual(snapshot(1000000));
    expect(v2row.snapshot).toEqual(snapshot(2000000));
    expect(db.email_drafts).toHaveLength(2);

    expect(invokeMock).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith('Version sélectionnée');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('selecting a version without a draft never leaks the previous draft text and discards an unsaved edit', async () => {
    seedTwoVersions('case-a');
    seedDraft('case-a-v1', {});
    const user = userEvent.setup();
    const pair = renderPair('case-a');
    const card = pair.card;
    const panel = pair.panel;

    await panel().findByDisplayValue('Corps case-a-v1');
    const bodyField = panel().getByPlaceholderText('Corps du message...');
    await user.clear(bodyField);
    await user.type(bodyField, 'Texte non enregistre v1');
    expect(panel().getByDisplayValue('Texte non enregistre v1')).toBeInTheDocument();

    await user.click(card().getByRole('button', { name: 'Sélectionner' }));

    await waitFor(() => expect(panel().getByText('v2')).toBeInTheDocument());
    expect(panel().queryByDisplayValue('Texte non enregistre v1')).toBeNull();
    expect(panel().queryByText('Corps case-a-v1')).toBeNull();
    expect(panel().queryByPlaceholderText('Corps du message...')).toBeNull();
    expect(panel().getByRole('button', { name: /Générer un brouillon/ })).toBeInTheDocument();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('QuotationVersionCard <-> SendQuotationPanel selection sync: concurrency and failures', () => {
  it('blocks card and panel actions for the whole selection + refetch window, then unblocks once settled', async () => {
    seedTwoVersions('case-a');
    seedDraft('case-a-v1', {});
    seedDraft('case-a-v2', {});
    const user = userEvent.setup();
    const pair = renderPair('case-a');
    const card = pair.card;
    const panel = pair.panel;

    await panel().findByDisplayValue('Corps case-a-v1');
    refetchGate = createDeferred();
    await user.click(card().getByRole('button', { name: 'Sélectionner' }));

    await waitFor(() => expect(panel().getByText(/Actualisation de la version sélectionnée en cours/i)).toBeInTheDocument());
    expect(card().getByRole('button', { name: 'Sélectionner' })).toBeDisabled();
    expect(panel().getByRole('button', { name: /Marquer comme envoyé/i })).toBeDisabled();
    expect(panel().getByRole('button', { name: /Enregistrer le brouillon/i })).toBeDisabled();
    expect(panel().getByText('v1')).toBeInTheDocument();

    refetchGate.resolve();

    await waitFor(() => expect(panel().queryByText(/Actualisation de la version sélectionnée en cours/i)).toBeNull());
    await waitFor(() => expect(panel().getByText('v2')).toBeInTheDocument());
    expect(panel().getByRole('button', { name: /Marquer comme envoyé/i })).toBeEnabled();
  });

  it('a failed RPC keeps everything on the previous version with no partial state', async () => {
    seedTwoVersions('case-a');
    seedDraft('case-a-v1', {});
    seedDraft('case-a-v2', {});
    forceRpcError = 'RPC boom';
    const user = userEvent.setup();
    const pair = renderPair('case-a');
    const card = pair.card;
    const panel = pair.panel;

    await panel().findByDisplayValue('Corps case-a-v1');
    await user.click(card().getByRole('button', { name: 'Sélectionner' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Erreur lors de la sélection', expect.objectContaining({ description: expect.stringContaining('resynchronisé') })));
    expect(panel().getByText('v1')).toBeInTheDocument();
    expect(panel().getByDisplayValue('Corps case-a-v1')).toBeInTheDocument();
    const v1row = db.quotation_versions.filter((v) => v.id === 'case-a-v1')[0];
    const v2row = db.quotation_versions.filter((v) => v.id === 'case-a-v2')[0];
    expect(v1row.is_selected).toBe(true);
    expect(v2row.is_selected).toBe(false);
    expect(card().getByRole('button', { name: 'Sélectionner' })).toBeEnabled();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('QuotationVersionCard <-> SendQuotationPanel selection sync: refresh failure and double click', () => {
  it('fails closed when the post-selection refresh fails, blocking actions until a retry succeeds', async () => {
    seedTwoVersions('case-a');
    seedDraft('case-a-v1', {});
    seedDraft('case-a-v2', {});
    const user = userEvent.setup();
    const pair = renderPair('case-a');
    const card = pair.card;
    const panel = pair.panel;

    await panel().findByDisplayValue('Corps case-a-v1');
    forceNextRead = 'quote_cases';
    await user.click(card().getByRole('button', { name: 'Sélectionner' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(
      'Erreur lors de la sélection',
      { description: 'La sélection a peut-être été enregistrée mais l\'actualisation a échoué. Réessayez.' },
    ));
    const v2row = db.quotation_versions.filter((v) => v.id === 'case-a-v2')[0];
    expect(v2row.is_selected).toBe(true);
    expect(panel().getByText('v1')).toBeInTheDocument();
    expect(panel().getByText(/Impossible d.actualiser les données du devis/i)).toBeInTheDocument();
    expect(panel().getByRole('button', { name: /Marquer comme envoyé/i })).toBeDisabled();
    expect(panel().getByRole('button', { name: /Enregistrer le brouillon/i })).toBeDisabled();

    toastError.mockClear();
    await user.click(panel().getByRole('button', { name: 'Réessayer le brouillon' }));

    await waitFor(() => expect(panel().getByText('v2')).toBeInTheDocument());
    expect(panel().queryByText(/Impossible d.actualiser les données du devis/i)).toBeNull();
    expect(panel().getByRole('button', { name: /Marquer comme envoyé/i })).toBeEnabled();
  });

  it('a double click on the same version only fires one RPC call', async () => {
    seedTwoVersions('case-a');
    seedDraft('case-a-v1', {});
    rpcGate = createDeferred();
    const user = userEvent.setup();
    const pair = renderPair('case-a');
    const card = pair.card;

    const selectButton = await card().findByRole('button', { name: 'Sélectionner' });
    await user.dblClick(selectButton);
    expect(rpcMock).toHaveBeenCalledTimes(1);

    rpcGate.resolve();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Version sélectionnée'));
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});

describe('QuotationVersionCard <-> SendQuotationPanel selection sync: case isolation', () => {
  it('keeps case isolation: a slow selection in one case never blocks or leaks into another case', async () => {
    seedTwoVersions('case-a');
    seedDraft('case-a-v1', {});
    seedDraft('case-a-v2', {});
    seedTwoVersions('case-b');
    seedDraft('case-b-v1', {});
    const user = userEvent.setup();
    const a = renderPair('case-a');
    const b = renderPair('case-b', a.client);

    await a.panel().findByDisplayValue('Corps case-a-v1');
    await b.panel().findByDisplayValue('Corps case-b-v1');
    refetchGate = createDeferred();

    await user.click(a.card().getByRole('button', { name: 'Sélectionner' }));
    await waitFor(() => expect(a.panel().getByText(/Actualisation de la version sélectionnée en cours/i)).toBeInTheDocument());

    expect(b.card().getByRole('button', { name: 'Sélectionner' })).toBeEnabled();
    expect(b.panel().queryByText(/Actualisation de la version sélectionnée en cours/i)).toBeNull();
    expect(b.panel().getByRole('button', { name: /Marquer comme envoyé/i })).toBeEnabled();
    expect(b.panel().getByText('v1')).toBeInTheDocument();

    refetchGate.resolve();
    await waitFor(() => expect(a.panel().getByText('v2')).toBeInTheDocument());
    expect(b.panel().getByText('v1')).toBeInTheDocument();
    expect(b.card().getAllByText('Sélectionnée')).toHaveLength(1);
  });
});

describe('selection synchronization review regressions', () => {
  it.each(['quotation_versions', 'quote_cases', 'email_drafts'])('fails closed on resolved Supabase error from %s', async (table) => {
    seedTwoVersions('case-a');
    seedDraft('case-a-v1', {});
    seedDraft('case-a-v2', {});
    const pair = renderPair('case-a');
    await pair.panel().findByDisplayValue('Corps case-a-v1');
    forceResolvedError = { table, kind: 'single' };
    await userEvent.click(pair.card().getByRole('button', { name: 'Sélectionner' }));
    await pair.panel().findByText(/Impossible d.actualiser les données du devis/);
    expect(pair.panel().getByRole('button', { name: /Enregistrer le brouillon/ })).toBeDisabled();
    expect(pair.panel().getByRole('button', { name: /Marquer comme envoyé/ })).toBeDisabled();
    expect(pair.panel().getByText('v1')).toBeInTheDocument();
    expect(db.quotation_versions.find(v => v.id === 'case-a-v2')?.is_selected).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('does not display a stale selected card or claim success if its own list read fails', async () => {
    seedTwoVersions('case-a');
    seedDraft('case-a-v1', {});
    const pair = renderPair('case-a');
    await pair.panel().findByDisplayValue('Corps case-a-v1');
    forceResolvedError = { table: 'quotation_versions', kind: 'list' };
    await userEvent.click(pair.card().getByRole('button', { name: 'Sélectionner' }));
    await pair.card().findByRole('alert');
    expect(pair.card().queryByText('Sélectionnée')).toBeNull();
    await pair.panel().findByText('v2');
    expect(toastSuccess).not.toHaveBeenCalled();
    await userEvent.click(pair.card().getByRole('button', { name: 'Réessayer les versions' }));
    await pair.card().findByText('Sélectionnée');
    expect(pair.panel().getByText('v2')).toBeInTheDocument();
  });

  it('resynchronizes the real selection after an RPC commits then throws a network exception', async () => {
    seedTwoVersions('case-a');
    seedDraft('case-a-v1', {});
    seedDraft('case-a-v2', {});
    const pair = renderPair('case-a');
    await pair.panel().findByDisplayValue('Corps case-a-v1');
    throwAfterCommit = true;
    await userEvent.click(pair.card().getByRole('button', { name: 'Sélectionner' }));
    await pair.panel().findByDisplayValue('Corps case-a-v2');
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Erreur lors de la sélection', expect.objectContaining({ description: expect.stringContaining('resynchronisé') })));
    expect(pair.panel().getByText('v2')).toBeInTheDocument();
    expect(pair.panel().getByRole('button', { name: /Enregistrer le brouillon/ })).toBeEnabled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('keeps actions locked if both the RPC response and the subsequent refresh fail', async () => {
    seedTwoVersions('case-a');
    seedDraft('case-a-v1', {});
    const pair = renderPair('case-a');
    await pair.panel().findByDisplayValue('Corps case-a-v1');
    throwAfterCommit = true;
    forceResolvedError = { table: 'quote_cases', kind: 'single' };
    await userEvent.click(pair.card().getByRole('button', { name: 'Sélectionner' }));
    await pair.panel().findByText(/Impossible d.actualiser les données du devis/);
    expect(pair.panel().getByRole('button', { name: /Enregistrer le brouillon/ })).toBeDisabled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('isolates a rerender to case B from a late RPC and version read for case A', async () => {
    seedTwoVersions('case-a');
    seedTwoVersions('case-b');
    seedDraft('case-a-v1', {});
    seedDraft('case-b-v1', {});
    const pair = renderPair('case-a');
    await pair.panel().findByDisplayValue('Corps case-a-v1');
    rpcGate = createDeferred();
    versionListGate = { ...createDeferred(), caseId: 'case-a' };
    await userEvent.click(pair.card().getByRole('button', { name: 'Sélectionner' }));
    pair.rerender(<QueryClientProvider client={pair.client}>
      <QuotationVersionCard caseId="case-b" />
      <SendQuotationPanel caseId="case-b" />
    </QueryClientProvider>);
    await screen.findByDisplayValue('Corps case-b-v1');
    await act(async () => { rpcGate?.resolve(); });
    await act(async () => { versionListGate?.resolve(); });
    await waitFor(() => expect(pair.client.isMutating()).toBe(0));
    expect(screen.getByDisplayValue('Corps case-b-v1')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Corps case-a-v1')).toBeNull();
    expect(db.quotation_versions.find(v => v.id === 'case-b-v1')?.is_selected).toBe(true);
    expect(db.quotation_versions.find(v => v.id === 'case-a-v2')?.is_selected).toBe(true);
    expect(screen.getAllByText('Sélectionnée')).toHaveLength(1);
  });

  it('invalidates an inactive cached panel before it mounts again', async () => {
    seedTwoVersions('case-a');
    seedDraft('case-a-v1', {});
    seedDraft('case-a-v2', {});
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
    const pair = renderPair('case-a', client);
    await pair.panel().findByDisplayValue('Corps case-a-v1');
    pair.rerender(<QueryClientProvider client={client}><QuotationVersionCard caseId="case-a" /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole('button', { name: 'Sélectionner' }));
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(client.getQueryState(['send-quotation-data', 'case-a'])?.isInvalidated).toBe(true);
    pair.rerender(<QueryClientProvider client={client}><SendQuotationPanel caseId="case-a" /></QueryClientProvider>);
    await screen.findByDisplayValue('Corps case-a-v2');
    expect(screen.getByText('v2')).toBeInTheDocument();
    client.clear();
  });

  it('blocks an already-open confirmation during selection and closes it when the version changes', async () => {
    seedTwoVersions('case-a');
    seedDraft('case-a-v1', {});
    seedDraft('case-a-v2', {});
    const pair = renderPair('case-a');
    await pair.panel().findByDisplayValue('Corps case-a-v1');
    const select = pair.card().getByRole('button', { name: 'Sélectionner' });
    await userEvent.click(pair.panel().getByRole('button', { name: /Marquer comme envoyé/ }));
    rpcGate = createDeferred();
    fireEvent.click(select);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmer le marquage' })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer le marquage' }));
    expect(invokeMock).not.toHaveBeenCalled();
    await act(async () => { rpcGate?.resolve(); });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await pair.panel().findByDisplayValue('Corps case-a-v2');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('drops unsaved v1 edits without writing them into an existing v2 draft', async () => {
    seedTwoVersions('case-a');
    seedDraft('case-a-v1', {});
    seedDraft('case-a-v2', {});
    const before = JSON.stringify(db.email_drafts);
    const pair = renderPair('case-a');
    await pair.panel().findByDisplayValue('Corps case-a-v1');
    fireEvent.change(pair.panel().getByPlaceholderText('Corps du message...'), { target: { value: 'UNSAVED V1' } });
    await userEvent.click(pair.card().getByRole('button', { name: 'Sélectionner' }));
    await pair.panel().findByDisplayValue('Corps case-a-v2');
    expect(pair.panel().queryByDisplayValue('UNSAVED V1')).toBeNull();
    expect(JSON.stringify(db.email_drafts)).toBe(before);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
