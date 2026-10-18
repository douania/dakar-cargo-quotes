import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreadGroup } from '@/components/QuotationThreadCard';
import Dashboard from '../Dashboard';

type Row = Record<string, unknown>;
interface Read { table: string; from: number; to: number; expression: string; ids: string[]; head: boolean; status: string }
const f = vi.hoisted(() => ({ emails: [] as Row[], cases: [] as Row[], fail: '', attachments: [] as Row[], reads: [] as Read[], deferred: new Map<string, (request: Read) => Promise<unknown>>() }));
vi.mock('@/components/layout/MainLayout', () => ({ MainLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/QuotationThreadCard', () => ({ QuotationThreadCard: ({ thread }: { thread: ThreadGroup }) => <article data-testid="request">{thread.subject} · {thread.attachmentCount}PJ</article> }));
vi.mock('@/components/dashboard/CaseCard', () => ({ CaseCard: ({ caseData }: { caseData: { id: string } }) => <article>Cas {caseData.id}</article> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (table: string) => {
  const request: Read = { table, from: 0, to: 999, expression: '', ids: [], head: false, status: '' };
  const query = { select: (_fields: string, options?: { head?: boolean }) => { request.head = !!options?.head; return query; },
    eq: (key: string, value: string) => { if (key === 'status') request.status = value; return query; }, not: () => query,
    in: (_key: string, ids: string[]) => { request.ids = ids; return query; }, order: () => query,
    range: (from: number, to: number) => { request.from = from; request.to = to; return query; }, limit: (n: number) => { request.to = n - 1; return query; },
    or: (expression: string) => { request.expression = expression; return query; },
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
      f.reads.push({ ...request });
      if (request.expression) for (const [key, response] of f.deferred) if (request.expression.includes(key)) return response(request).then(resolve, reject);
      let rows = table === 'emails' ? f.emails : table === 'quote_cases' ? f.cases : table === 'email_attachments' ? f.attachments.filter(row => request.ids.includes(String(row.email_id))) : [];
      if (request.expression) {
        const raw = request.expression.slice(request.expression.indexOf('.imatch.') + 8);
        const end = raw.indexOf(',from_address.imatch.');
        const pattern = JSON.parse(end < 0 ? raw : raw.slice(0, end));
        rows = rows.filter(row => new RegExp(pattern, 'i').test(String(row.subject)));
      }
      const count = rows.length;
      const data = request.head ? null : rows.slice(request.from, request.to + 1);
      return Promise.resolve({ data, count, error: f.fail === table ? new Error('fixture refused') : null }).then(resolve, reject);
    },
  }; return query;
} } }));

const email = (n: number, extra: Row = {}): Row => ({ id: `email-${n}`, thread_ref: `ref-${n}`, thread_id: `<${n}@fixture.invalid>`, subject: `Demande ${n}`, from_address: 'buyer@fixture.invalid', received_at: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(), extracted_data: {}, ...extra });
const fixtureCase = (n: number) => ({ id: `case-${n}`, thread_id: `ref-${n}`, status: 'FACTS_PARTIAL', request_type: 'AIR_IMPORT', updated_at: '2026-10-18T00:00:00Z' });
beforeEach(() => { f.emails = [email(1)]; f.cases = []; f.attachments = []; f.fail = ''; f.reads = []; f.deferred.clear(); });
afterEach(cleanup);
const show = () => render(<MemoryRouter><Dashboard /></MemoryRouter>);
const input = () => screen.getByRole('textbox', { name: 'Rechercher les demandes' });

describe('demandes et recherche courante', () => {
  it('excludes the 51st active case and still exposes later case cards', async () => {
    f.cases = Array.from({ length: 68 }, (_, i) => fixtureCase(i + 1)); f.emails = [email(51), email(99)];
    show();
    expect(await screen.findByText('Demande 99 · 0PJ')).toBeVisible();
    expect(screen.queryByText('Demande 51 · 0PJ')).not.toBeInTheDocument();
    expect(screen.queryByText('Cas case-68')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Afficher les dossiers suivants' }));
    expect(screen.getByText('Cas case-68')).toBeVisible();
  });
  it('loads every one of 271 messages through explicit pages and counts 1001 scoped attachments', async () => {
    f.emails = Array.from({ length: 271 }, (_, i) => email(i + 1));
    f.attachments = Array.from({ length: 1001 }, () => ({ email_id: 'email-1' }));
    show(); expect(await screen.findByText('Demande 1 · 1001PJ')).toBeVisible();
    expect(screen.getAllByTestId('request')).toHaveLength(100);
    for (const count of [200, 271]) {
      fireEvent.click(screen.getByRole('button', { name: 'Charger les demandes suivantes' }));
      await waitFor(() => expect(screen.getAllByTestId('request')).toHaveLength(count));
    }
    expect(screen.queryByRole('button', { name: 'Charger les demandes suivantes' })).not.toBeInTheDocument();
    expect(f.reads.filter(r => r.table === 'email_attachments').every(r => r.ids.length > 0 && r.ids.length <= 100)).toBe(true);
  });
  it('does not announce completion when a page contains only already-covered requests', async () => {
    f.emails = Array.from({ length: 101 }, (_, i) => email(i + 1)); f.cases = Array.from({ length: 100 }, (_, i) => fixtureCase(i + 1));
    show(); expect(await screen.findByText('Aucune demande dans cette page')).toBeVisible();
    expect(screen.queryByText('Tout est à jour !')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Charger les demandes suivantes' }));
    expect(await screen.findByText('Demande 101 · 0PJ')).toBeVisible();
  });
  it.each(['quote_cases', 'email_attachments', 'email_drafts'])('makes a %s failure visible instead of a complete empty result', async table => {
    f.fail = table; show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Erreur de chargement');
    expect(screen.getByText('Lecture incomplète')).toBeVisible();
  });
  it('ignores older responses while a newer search remains pending', async () => {
    let old: (value: unknown) => void = () => {}, fresh: (value: unknown) => void = () => {};
    f.deferred.set('old', () => new Promise(resolve => { old = resolve; }));
    f.deferred.set('fresh', () => new Promise(resolve => { fresh = resolve; }));
    show(); await screen.findByText('Demande 1 · 0PJ');
    fireEvent.change(input(), { target: { value: 'old' } });
    await waitFor(() => expect(f.reads.some(r => r.expression.includes('old'))).toBe(true));
    fireEvent.change(input(), { target: { value: 'fresh' } });
    await waitFor(() => expect(f.reads.some(r => r.expression.includes('fresh'))).toBe(true));
    await act(async () => old({ data: [email(2, { subject: 'old response' })], count: 1, error: null }));
    expect(screen.queryByText(/old response/)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Recherche en cours');
    await act(async () => fresh({ data: [email(3, { subject: 'fresh response' })], count: 1, error: null }));
    expect(await screen.findByText('fresh response · 0PJ')).toBeVisible();
  });
  it('does not restore a cleared search after the old response arrives', async () => {
    let release: (value: unknown) => void = () => {};
    f.deferred.set('old', () => new Promise(resolve => { release = resolve; }));
    show(); await screen.findByText('Demande 1 · 0PJ');
    fireEvent.change(input(), { target: { value: 'old' } });
    await waitFor(() => expect(f.reads.some(r => r.expression.includes('old'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Effacer' }));
    await act(async () => release({ data: [email(2, { subject: 'old response' })], count: 1, error: null }));
    expect(screen.getByText('Demande 1 · 0PJ')).toBeVisible(); expect(screen.queryByText(/old response/)).not.toBeInTheDocument();
  });
  it('searches literal punctuation through explicit result pages', async () => {
    f.emails = Array.from({ length: 101 }, (_, i) => email(i + 1, { subject: `Réf [FOC]*_%, ${i + 1}` }));
    show(); await screen.findByText('Réf [FOC]*_%, 1 · 0PJ');
    fireEvent.change(input(), { target: { value: '[FOC]*_%,' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Charger les demandes suivantes' }));
    expect(await screen.findByText('Réf [FOC]*_%, 101 · 0PJ')).toBeVisible();
  });
  it('waits for composition to finish before searching', async () => {
    show(); await screen.findByText('Demande 1 · 0PJ');
    fireEvent.compositionStart(input());
    fireEvent.change(input(), { target: { value: 'Demande' } });
    await new Promise(resolve => setTimeout(resolve, 450));
    expect(f.reads.some(r => r.expression)).toBe(false);
    fireEvent.compositionEnd(input());
    await waitFor(() => expect(f.reads.some(r => r.expression)).toBe(true));
  });
  it('sorts acquired groups by latest activity', async () => {
    f.emails = [email(1), email(3), email(2)];
    show(); await screen.findByText('Demande 1 · 0PJ');
    expect(screen.getAllByTestId('request').map(row => row.textContent)).toEqual([
      'Demande 3 · 0PJ', 'Demande 2 · 0PJ', 'Demande 1 · 0PJ',
    ]);
  });
  it('refreshes the current search after an active case covers its request', async () => {
    show(); await screen.findByText('Demande 1 · 0PJ');
    fireEvent.change(input(), { target: { value: 'Demande 1' } });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 courriel(s) vérifié(s)'));
    f.cases = [fixtureCase(1)];
    fireEvent.click(screen.getByRole('button', { name: 'Actualiser' }));
    await waitFor(() => expect(screen.queryByText('Demande 1 · 0PJ')).not.toBeInTheDocument());
  });
  it('re-filters acquired search pages when a later page sees a new active case', async () => {
    f.emails = Array.from({ length: 101 }, (_, i) => email(i + 1));
    show(); await screen.findByText('Demande 1 · 0PJ');
    fireEvent.change(input(), { target: { value: 'Demande' } });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('100 courriel(s) vérifié(s)'));
    f.cases = [fixtureCase(1)];
    fireEvent.click(screen.getByRole('button', { name: 'Charger les demandes suivantes' }));
    await screen.findByText('Demande 101 · 0PJ');
    expect(screen.queryByText('Demande 1 · 0PJ')).not.toBeInTheDocument();
  });
  it('shows search errors and retries without claiming there are no requests', async () => {
    show(); await screen.findByText('Demande 1 · 0PJ'); f.fail = 'emails';
    fireEvent.change(input(), { target: { value: 'Demande' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Recherche incomplète');
    expect(screen.getByText('Recherche indisponible')).toBeVisible();
    f.fail = ''; fireEvent.click(screen.getByRole('button', { name: 'Réessayer la recherche' }));
    expect(await screen.findByText('Demande 1 · 0PJ')).toBeVisible();
  });
});
