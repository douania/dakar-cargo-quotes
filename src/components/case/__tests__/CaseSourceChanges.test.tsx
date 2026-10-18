import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CaseSourceChangesNotice } from '../CaseSourceChangesNotice';
import { QuotationVersionCard } from '@/components/puzzle/QuotationVersionCard';
import { readCaseSourceChanges } from '@/lib/caseSourceChanges';

vi.mock('@/integrations/supabase/client', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return { supabase: createClient('http://fixture.invalid', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, init) },
  }) };
});

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let requests: URL[];
let denied: string | undefined;
let missingCount: string | undefined;
let cap: number;
const originalFetch = globalThis.fetch;
const before = '2026-10-18T10:00:00Z', after = '2026-10-18T12:00:00Z';

beforeEach(() => {
  requests = []; denied = undefined; missingCount = undefined; cap = 2;
  tables = {
    quote_cases: [{ id: 'case-a', thread_id: 'root-a' }, { id: 'case-b', thread_id: 'root-b' }],
    pricing_runs: [{ id: 'run-a', case_id: 'case-a', created_at: before }],
    emails: [
      { id: 'original', thread_ref: 'root-a', subject: 'Cotation', created_at: '2026-10-17T10:00:00Z' },
      { id: 'correction', thread_ref: 'root-a', subject: 'Correction : 200 kg, 20 colis, Bamako, DAP', created_at: after, sent_at: '2026-10-01T10:00:00Z' },
      { id: 'other', thread_ref: 'root-b', subject: 'Cotation', created_at: after },
    ],
    case_documents: [], email_attachments: [], quotation_versions: [],
  };
  globalThis.fetch = vi.fn(async (input, init) => {
    expect(init?.method ?? 'GET').toBe('GET');
    const url = new URL(String(input)); expect(url.hostname).toBe('fixture.invalid'); requests.push(url);
    const table = url.pathname.split('/').pop()!;
    if (table === denied) return new Response(JSON.stringify({ message: 'Fixture read denied' }), { status: 403 });
    let rows = [...(tables[table] ?? [])];
    for (const [key, filter] of url.searchParams) {
      if (filter.startsWith('eq.')) rows = rows.filter(row => String(row[key]) === filter.slice(3));
      if (filter.startsWith('in.(')) rows = rows.filter(row => filter.slice(4, -1).split(',').includes(String(row[key])));
    }
    for (const order of (url.searchParams.get('order') ?? '').split(',').reverse()) {
      const [key, direction] = order.split('.'); rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (direction === 'desc' ? -1 : 1));
    }
    const total = rows.length, start = Number(url.searchParams.get('offset') ?? 0);
    rows = rows.slice(start, start + Math.min(cap, Number(url.searchParams.get('limit') ?? cap)));
    const single = new Headers(init?.headers).get('Accept')?.includes('vnd.pgrst.object');
    return new Response(JSON.stringify(single ? rows[0] : rows), { headers: {
      'Content-Type': 'application/json', ...(table === missingCount ? {} : { 'Content-Range': `${start}-${start + rows.length - 1}/${total}` }),
    } });
  });
});
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });
function mount(props: { caseId: string; runId?: string | null; overview?: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const result = render(<QueryClientProvider client={client}><CaseSourceChangesNotice {...props} /></QueryClientProvider>);
  return { client, ...result };
}

it('rattache la correction par racine, utilise son enregistrement malgré une Date ancienne et ne mute rien', async () => {
  const { sources } = await readCaseSourceChanges('case-a');
  expect(sources.map(row => row.id)).toEqual(['correction', 'original']);
  expect(requests.find(url => url.pathname.endsWith('/emails'))?.searchParams.get('thread_ref')).toBe('eq.root-a');
  mount({ caseId: 'case-a', runId: 'run-a' });
  expect(await screen.findByText('Nouvelles sources à examiner')).toBeInTheDocument();
  expect(screen.getByText(/Correction : 200 kg/)).toBeInTheDocument();
  expect(screen.getByText(/1 source\(s\) enregistrée/)).toBeInTheDocument();
});
it('conserve deux PJ homonymes distinctes et le document tardif avec un plafond serveur réduit', async () => {
  tables.email_attachments = [1, 2, 3].map(n => ({ id: `a${n}`, email_id: 'original', filename: 'INV.pdf', created_at: after }));
  tables.case_documents = [{ id: 'late', case_id: 'case-a', file_name: 'PL.pdf', created_at: after }];
  mount({ caseId: 'case-a', runId: 'run-a' });
  expect(await screen.findByText(/5 source\(s\) enregistrée/)).toBeInTheDocument();
  expect(screen.getAllByText(/Pièce jointe : INV.pdf/)).toHaveLength(3);
  expect(requests.some(url => url.pathname.endsWith('/email_attachments') && url.searchParams.get('offset') === '2')).toBe(true);
});
it('compare chaque version à son calcul, même si sa création est postérieure à la correction', async () => {
  tables.quotation_versions = [{ id: 'v1', case_id: 'case-a', version_number: 1, status: 'approved', is_selected: true,
    pricing_run_id: 'run-a', created_at: '2026-10-18T13:00:00Z', snapshot: { totals: { total_ht: 1000 }, lines: [] } }];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><QuotationVersionCard caseId="case-a" /></QueryClientProvider>);
  expect(await screen.findByText('Nouvelles sources à examiner')).toBeInTheDocument();
  expect(screen.getByText(/calcul de cette version/)).toBeInTheDocument();
  expect(screen.getByText('Sélectionnée')).toBeInTheDocument();
});
it('ne déduit jamais une couverture valide de sources anciennes, citations ou adoption historique', async () => {
  tables.emails = [tables.emails[0]];
  mount({ caseId: 'case-a', runId: 'run-a' });
  expect(await screen.findByText('Couverture des sources à vérifier')).toBeInTheDocument();
  expect(screen.getByText(/prise en compte n'est pas démontrée/)).toBeInTheDocument();
  expect(screen.getByText(/rattachements historiques/)).toBeInTheDocument();
});
it.each([null, 'missing'])('signale une référence de calcul absente (%s), sans prendre la date de version', async runId => {
  mount({ caseId: 'case-a', runId });
  expect(await screen.findByText(/comparaison impossible/)).toBeInTheDocument();
  expect(screen.queryByText('Nouvelles sources à examiner')).not.toBeInTheDocument();
});
it('signale une date inconnue et ne la convertit pas en source couverte', async () => {
  tables.emails[0].created_at = null;
  mount({ caseId: 'case-a', runId: 'run-a' });
  expect(await screen.findByText(/1 source\(s\) sans date exploitable/)).toBeInTheDocument();
});
it('rend le refus de lecture visible après un résultat en cache et permet la reprise', async () => {
  const view = mount({ caseId: 'case-a', runId: 'run-a' });
  await screen.findByText('Nouvelles sources à examiner'); denied = 'email_attachments';
  fireEvent.click(screen.getByText('Actualiser les sources'));
  expect(await screen.findByText(/Vérification des nouvelles sources indisponible/)).toBeInTheDocument();
  expect(screen.queryByText('Nouvelles sources à examiner')).not.toBeInTheDocument();
  denied = undefined; fireEvent.click(screen.getByText('Réessayer les sources'));
  await screen.findByText('Nouvelles sources à examiner');
  expect(view.client.getQueryCache().getAll()).toHaveLength(1);
});
it('refuse une étendue inconnue et ne transforme pas une réponse tronquée en zéro', async () => {
  missingCount = 'emails'; mount({ caseId: 'case-a', overview: true });
  expect(await screen.findByText(/Vérification des nouvelles sources indisponible/)).toBeInTheDocument();
});
it('isole les dossiers et actualise les nouvelles pièces sans toucher aux décisions', async () => {
  const view = mount({ caseId: 'case-a', runId: 'run-a' });
  await screen.findByText('Nouvelles sources à examiner');
  tables.email_attachments.push({ id: 'late', email_id: 'original', filename: 'TARDIF.pdf', created_at: after });
  fireEvent.click(screen.getByText('Actualiser les sources'));
  await screen.findByText(/TARDIF.pdf/);
  view.rerender(<QueryClientProvider client={view.client}><CaseSourceChangesNotice caseId="case-b" overview /></QueryClientProvider>);
  await waitFor(() => expect(screen.queryByText(/TARDIF.pdf/)).not.toBeInTheDocument());
  expect(await screen.findByText(/comparaison impossible/)).toBeInTheDocument();
});
