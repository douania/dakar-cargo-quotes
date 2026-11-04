import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import Emails from '../Emails';
type Row = Record<string, unknown>;
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const f = vi.hoisted(() => ({ generate: vi.fn(), drafts: [] as Row[], emails: [] as Row[], calls: [] as Record<string, unknown>[], success: vi.fn() }));
vi.mock('@/components/EmailSearchImport', () => ({ EmailSearchImport: () => null }));
vi.mock('@/components/LearningStats', () => ({ LearningStats: () => null }));
vi.mock('@/components/LearnedKnowledge', () => ({ LearnedKnowledge: () => null }));
vi.mock('@/components/puzzle/ThreadUsageTagWithData', () => ({ ThreadUsageTagWithData: () => null }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn(), success: f.success } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  functions: { invoke: async (name: string, options: { body: Record<string, unknown> }) => {
    if (name === 'generate-response') { f.calls.push(options.body); return await f.generate(options.body); }
    if (name === 'email-admin' && options.body.action === 'get_all') return { data: { success: true, configs: [] }, error: null };
    if (name === 'email-admin' && options.body.action === 'get_threads_paginated') return { data: { success: true, offset: 0, totalCount: 0, threads: [] }, error: null };
    throw new Error(`Unexpected connected operation ${name}`);
  } },
  from: (table: string) => {
    let start = 0, end = 999;
    const query = { select: () => query, eq: () => query, not: () => query, order: () => query, in: () => query, or: () => query,
      range: (a: number, b: number) => { start = a; end = b; return query; }, limit: (n: number) => { end = n - 1; return query; },
      then: (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) => {
        const rows = table === 'emails' ? f.emails : table === 'email_drafts' ? f.drafts : [];
        return Promise.resolve({ data: rows.slice(start, end + 1), count: rows.length, error: null }).then(resolve, reject);
      },
    }; return query;
  },
} }));
const failure = () => ({ data: null, error: { context: Response.json({ ok: false, error: { code: 'ZONE_ENGINE_CONTRACT_NOT_READY', message: 'Vérification indisponible — aucun nouveau brouillon produit' } }, { status: 503 }) } });
const confirmed = (emailId = A) => ({ data: { ok: true, data: { draft: { id: `new-${emailId}`, original_email_id: emailId, body_text: 'Synthetic confirmed reply' } } }, error: null });
beforeEach(() => {
  f.generate.mockReset(); f.calls = []; f.success.mockReset();
  f.emails = [A, B].map(id => ({ id, subject: 'Même sujet synthétique', from_address: 'buyer@example.invalid', body_text: 'Synthetic request', sent_at: '2026-11-04T12:00:00Z', is_quotation_request: true }));
  f.drafts = [{ id: 'old-A', original_email_id: A, subject: 'Ancien brouillon A', body_text: 'Texte original conservé mot pour mot', to_addresses: ['buyer@example.invalid'], created_at: '2026-11-01T12:00:00Z', status: 'draft' }];
});
afterEach(cleanup);
function show() { return render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TooltipProvider><Emails /></TooltipProvider></QueryClientProvider></MemoryRouter>); }
function tab(name: RegExp) { fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false }); }
async function open(index = 0) { tab(/^Cotations$/); await waitFor(() => expect(screen.getAllByRole('button', { name: 'Répondre' })).toHaveLength(2)); await userEvent.click(screen.getAllByRole('button', { name: 'Répondre' })[index]); return await screen.findByRole('dialog'); }
async function close() { await userEvent.click(screen.getByRole('button', { name: 'Close' })); }
const input = () => screen.getByRole('textbox');
const submit = () => userEvent.click(screen.getByRole('button', { name: 'Générer avec instructions' }));

it('real admin→service→dialog keeps guidance and the stored draft on a zone-engine refusal', async () => {
  f.generate.mockResolvedValue(failure()); const before = JSON.stringify(f.drafts);
  show(); await open(); await userEvent.type(input(), 'Conserver les consignes A'); await submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Vérification indisponible');
  expect(input()).toHaveValue('Conserver les consignes A');
  expect(f.calls).toHaveLength(1); expect(f.calls[0]).toMatchObject({ emailId: A, customInstructions: 'Conserver les consignes A', zone_reply_contract: 'optional_factor_v1' });
  expect(f.success).not.toHaveBeenCalled(); expect(JSON.stringify(f.drafts)).toBe(before);
  await close(); tab(/Brouillons/); expect(await screen.findByText('Texte original conservé mot pour mot')).toBeVisible();
});

it('same-email reopen retains failed guidance while a different email with the same subject starts clean', async () => {
  f.generate.mockResolvedValue(failure()); show(); await open(); await userEvent.type(input(), 'Consignes A seules'); await submit(); await screen.findByRole('alert');
  await close(); await open(); expect(input()).toHaveValue('Consignes A seules');
  await close(); await open(1); expect(input()).toHaveValue('');
});

it('a late success for A never clears or closes the active guidance for B', async () => {
  let settle!: (v: unknown) => void;
  f.generate.mockImplementation(() => new Promise(resolve => { settle = resolve; }));
  show(); await open(); await userEvent.type(input(), 'Consignes A'); await submit();
  await close(); await open(1); await userEvent.type(input(), 'Consignes B');
  await act(async () => settle(confirmed(A)));
  expect(input()).toHaveValue('Consignes B'); expect(screen.getByRole('dialog')).toBeVisible(); expect(f.calls).toHaveLength(1);
});

it('parent guards A pending→B→A remount against duplicate invocation and releases after settlement', async () => {
  let settle!: (v: unknown) => void;
  f.generate.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; })).mockResolvedValueOnce(confirmed(A));
  show(); await open(); await userEvent.type(input(), 'Première A'); await submit();
  await close(); await open(1); await close(); await open(); await userEvent.type(input(), 'Seconde saisie A'); await submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('déjà en cours'); expect(f.calls).toHaveLength(1);
  await act(async () => settle(failure()));
  await submit(); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(f.calls).toHaveLength(2);
});

it.each([{}, { draft: { id: 'other-email', original_email_id: B, body_text: 'Payload of another email must not be rendered' } }])('does not reset on an incomplete or wrong-email acknowledgement %j', async payload => {
  f.generate.mockResolvedValue({ data: { ok: true, data: payload }, error: null });
  show(); await open(); await userEvent.type(input(), 'Conserver A'); await submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('confirmé'); expect(input()).toHaveValue('Conserver A');
  expect(f.success).not.toHaveBeenCalled(); expect(screen.queryByText('Payload of another email must not be rendered')).not.toBeInTheDocument();
});

it('only a confirmed matching new draft closes and resets guidance; original stored draft remains', async () => {
  f.generate.mockResolvedValue(confirmed(A)); const before = JSON.stringify(f.drafts);
  show(); await open(); await userEvent.type(input(), 'Nouvelle génération A'); await submit();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(f.success).toHaveBeenCalledWith('Brouillon généré'); expect(JSON.stringify(f.drafts)).toBe(before);
  await open(); expect(input()).toHaveValue('');
});
