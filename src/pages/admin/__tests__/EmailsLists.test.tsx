import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Emails from '../Emails';

type Row = Record<string, unknown>;
interface Read { table: string; from: number; to: number; expression: string; ids: string[]; column: string }
const f = vi.hoisted(() => ({ emails: [] as Row[], threads: [] as Row[], drafts: [] as Row[], attachments: [] as Row[],
  reads: [] as Read[], offsets: [] as number[], cap: 50, failConfig: false, legacyBackend: false, failDraftAt: null as number | null, deferred: new Map<string, () => Promise<unknown>>() }));
vi.mock('@/components/EmailSearchImport', () => ({ EmailSearchImport: () => null }));
vi.mock('@/components/LearningStats', () => ({ LearningStats: () => null }));
vi.mock('@/components/LearnedKnowledge', () => ({ LearnedKnowledge: () => null }));
vi.mock('@/components/puzzle/ThreadUsageTagWithData', () => ({ ThreadUsageTagWithData: () => null }));
vi.mock('@/components/ResponseGuidanceDialog', () => ({ ResponseGuidanceDialog: () => null }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  functions: { invoke: async (_name: string, options: { body: { action: string; data?: { offset?: number; page?: number; pageSize?: number } } }) => {
    if (options.body.action === 'get_all') return { data: { success: !f.failConfig, configs: [] }, error: null };
    if (options.body.action !== 'get_threads_paginated') throw new Error('Mutation not allowed in this fixture');
    const body = options.body.data, offset = body?.offset ?? (body?.page ?? 0) * (body?.pageSize ?? 50);
    f.offsets.push(offset);
    return { data: { success: true, offset: f.legacyBackend ? undefined : offset, totalCount: f.threads.length, threads: f.threads.slice(offset, offset + f.cap) }, error: null };
  } },
  from: (table: string) => {
    const request: Read = { table, from: 0, to: 999, expression: '', ids: [], column: '' };
    const query = { select: () => query, eq: () => query, not: () => query, order: () => query,
      in: (column: string, ids: string[]) => { request.column = column; request.ids = ids; return query; },
      range: (from: number, to: number) => { request.from = from; request.to = to; return query; },
      limit: (n: number) => { request.to = n - 1; return query; }, or: (value: string) => { request.expression = value; return query; },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        f.reads.push({ ...request });
        for (const [key, response] of f.deferred) if (request.expression.includes(key)) return response().then(resolve, reject);
        let rows = table === 'emails' ? f.emails : table === 'email_drafts' ? f.drafts : table === 'email_attachments' ? f.attachments : [];
        if (request.ids.length) rows = rows.filter(row => request.ids.includes(String(row[request.column])));
        if (request.expression) {
          const raw = request.expression.slice(request.expression.indexOf('.imatch.') + 8);
          const quoted = raw.slice(0, raw.indexOf(',from_address.imatch.'));
          const pattern = new RegExp(JSON.parse(quoted), 'i'); rows = rows.filter(row => pattern.test(String(row.subject)));
        }
        return Promise.resolve({ data: rows.slice(request.from, request.to + 1), count: rows.length,
          error: table === 'email_drafts' && f.failDraftAt === request.from ? new Error('Draft read refused') : null }).then(resolve, reject);
      },
    }; return query;
  },
} }));

const message = (n: number): Row => ({ id: `email-${n}`, thread_ref: `thread-${n}`, subject: `Courriel ${n}`,
  from_address: 'buyer@fixture.invalid', to_addresses: ['ops@fixture.invalid'], body_text: `Texte fictif ${n}`,
  sent_at: '2026-10-18T00:00:00Z', received_at: '2026-10-18T00:00:00Z', is_quotation_request: true, is_processed: false });
const thread = (n: number): Row => ({ id: `thread-${n}`, subject_normalized: `Fil ${n}`, client_email: 'buyer@fixture.invalid',
  client_company: `Société ${n}`, project_name: null, participants: [], first_message_at: '2026-10-01T00:00:00Z',
  last_message_at: '2026-10-18T00:00:00Z', status: 'active', email_count: 1, is_quotation_thread: true });
beforeEach(() => { f.emails = [message(1)]; f.threads = [thread(1)]; f.drafts = []; f.attachments = [];
  f.reads = []; f.offsets = []; f.cap = 50; f.failConfig = false; f.legacyBackend = false; f.failDraftAt = null; f.deferred.clear(); });
afterEach(cleanup);
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><TooltipProvider><Emails /></TooltipProvider></QueryClientProvider></MemoryRouter>);
}
function tab(name: RegExp) { fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false }); }
const search = () => screen.getByPlaceholderText('Rechercher par sujet, expéditeur ou contenu...');

describe('listes de courriels sous lecture existante', () => {
  it('refuses an older backend DTO instead of claiming a complete thread list', async () => {
    f.legacyBackend = true; f.threads = Array.from({ length: 164 }, (_, i) => thread(i + 1));
    show(); tab(/Fils/);
    expect(await screen.findByRole('alert')).toHaveTextContent('Lecture');
    expect(f.offsets).toEqual([0]);
    expect(screen.queryByText(/recherche dans les 50 fils lus/)).not.toBeInTheDocument();
  });
  it('reads all 164 thread summaries despite a reduced server cap and searches the older metadata', async () => {
    f.threads = Array.from({ length: 164 }, (_, i) => thread(i + 1)); f.cap = 17;
    show(); tab(/Fils/);
    expect(await screen.findByText(/recherche dans les 164 fils lus/)).toBeVisible();
    expect(f.offsets).toEqual([0, 17, 34, 51, 68, 85, 102, 119, 136, 153]);
    fireEvent.change(screen.getByPlaceholderText('Rechercher par sujet, client, projet...'), { target: { value: 'Société 164' } });
    expect(await screen.findByText('Fil 164')).toBeVisible();
  });
  it('keeps the thread list bounded and offers the next summaries', async () => {
    f.threads = Array.from({ length: 68 }, (_, i) => thread(i + 1));
    show(); tab(/Fils/); await screen.findByText(/recherche dans les 68 fils lus/);
    expect(screen.queryByText('Fil 68')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Afficher les fils suivants' }));
    expect(await screen.findByText('Fil 68')).toBeVisible();
  });
  it('pages 271 stored emails and finds a matching older message through server search', async () => {
    f.emails = Array.from({ length: 271 }, (_, i) => message(271 - i));
    f.emails[270].subject = 'Cible historique hors fenêtre';
    show(); tab(/Emails importés/);
    expect(await screen.findByText('Courriel 271')).toBeVisible();
    expect(screen.queryByText('Cible historique hors fenêtre')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Charger les courriels suivants' })).toBeVisible();
    fireEvent.change(search(), { target: { value: 'Cible historique hors fenêtre' } });
    expect(await screen.findByText('Cible historique hors fenêtre')).toBeVisible();
    expect(screen.queryByText('Courriel 271')).not.toBeInTheDocument();
  });
  it('shows unthreaded emails and clears stale rows after a successful empty refresh', async () => {
    f.threads = []; f.emails = [message(1)]; f.failConfig = true;
    show(); tab(/Emails importés/); expect(await screen.findByText('Courriel 1')).toBeVisible();
    f.emails = []; f.failConfig = false;
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer les lectures' }));
    await waitFor(() => expect(screen.queryByText('Courriel 1')).not.toBeInTheDocument());
    expect(await screen.findByText('Aucun email synchronisé')).toBeVisible();
  });
  it('clears destructive selections when the search criterion changes', async () => {
    f.emails = [message(1), message(2), message(3)];
    show(); tab(/Emails importés/); await screen.findByText('Courriel 3');
    fireEvent.click(screen.getByRole('button', { name: 'Tout sélectionner' }));
    expect(screen.getByRole('button', { name: 'Supprimer (3)' })).toBeVisible();
    fireEvent.change(search(), { target: { value: 'Courriel 1' } });
    expect(screen.queryByRole('button', { name: /Supprimer \(/ })).not.toBeInTheDocument();
    expect(await screen.findByText('Courriel 1')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Tout sélectionner' }));
    expect(screen.getByRole('button', { name: 'Supprimer (1)' })).toBeVisible();
  });
  it('does not display an older response while another mail search is pending', async () => {
    let old: (value: unknown) => void = () => {}, fresh: (value: unknown) => void = () => {};
    f.deferred.set('old', () => new Promise(resolve => { old = resolve; }));
    f.deferred.set('fresh', () => new Promise(resolve => { fresh = resolve; }));
    show(); tab(/Emails importés/); await screen.findByText('Courriel 1');
    fireEvent.change(search(), { target: { value: 'old' } });
    await waitFor(() => expect(f.reads.some(r => r.expression.includes('old'))).toBe(true));
    fireEvent.change(search(), { target: { value: 'fresh' } });
    await waitFor(() => expect(f.reads.some(r => r.expression.includes('fresh'))).toBe(true));
    await act(async () => old({ data: [{ ...message(2), subject: 'Ancienne réponse' }], count: 1, error: null }));
    expect(screen.queryByText('Ancienne réponse')).not.toBeInTheDocument();
    await act(async () => fresh({ data: [{ ...message(3), subject: 'fresh recherche actuelle' }], count: 1, error: null }));
    expect(await screen.findByText('fresh recherche actuelle')).toBeVisible();
  });
  it('retries the refused draft refresh at zero rather than appending the old next page', async () => {
    f.drafts = Array.from({ length: 61 }, (_, n) => ({ id: `draft-${n}`, subject: `Brouillon ${n}`, status: 'draft',
      to_addresses: ['recipient@fixture.invalid'], body_text: 'Fictif' }));
    f.failConfig = true; show(); tab(/Brouillons/); await screen.findByText('Brouillon 0');
    f.failDraftAt = 0;
    fireEvent.click(screen.getByText('Réessayer les lectures', { selector: 'button' }));
    await screen.findByText('Réessayer les brouillons', { selector: 'button' });
    f.failDraftAt = null; const before = f.reads.length;
    fireEvent.click(screen.getByText('Réessayer les brouillons', { selector: 'button' }));
    await waitFor(() => expect(f.reads.length).toBeGreaterThan(before));
    expect(f.reads.slice(before).filter(r => r.table === 'email_drafts').map(r => r.from)).toEqual([0]);
    expect(screen.queryByText('Brouillon 60')).not.toBeInTheDocument();
  });
  it('exposes drafts beyond the first 50 without sending any email', async () => {
    f.drafts = Array.from({ length: 61 }, (_, n) => ({ id: `draft-${n}`, subject: `Brouillon ${n}`, status: 'draft',
      to_addresses: ['recipient@fixture.invalid'], body_text: 'Texte fictif' }));
    show(); tab(/Brouillons/);
    expect(await screen.findByText(/50 brouillon\(s\) chargé\(s\) sur 61/)).toBeVisible();
    expect(screen.queryByText('Brouillon 60')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Charger les brouillons suivants' }));
    expect(await screen.findByText('Brouillon 60')).toBeVisible();
  });
});
