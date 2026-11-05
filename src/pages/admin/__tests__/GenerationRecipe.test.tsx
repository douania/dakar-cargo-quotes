import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import GenerationRecipe from '../GenerationRecipe';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const T = '11111111-1111-4111-8111-111111111111', P = '22222222-2222-4222-8222-222222222222', D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const KEY = 'dcq:recipe-attempt:no_files_v1';
type Row = Record<string, unknown>;
type Reply = { data: unknown; error: unknown; count?: number | null };
const f = vi.hoisted(() => ({ user: null as { id: string; email: string } | null, authStatus: 'authenticated', getUser: vi.fn(), rpc: vi.fn(), invoke: vi.fn(), reads: [] as { table: string; fields: string; filters: Record<string, unknown>; options: unknown }[], reply: {} as Record<string, Reply>, persisted: null as Row | null }));
vi.mock('@/features/auth', () => ({ useAuth: () => ({ user: f.user, authStatus: f.authStatus }) }));
vi.mock('@/components/layout/MainLayout', () => ({ MainLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser: (...args: unknown[]) => f.getUser(...args) }, rpc: (...args: unknown[]) => f.rpc(...args),
  functions: { invoke: (...args: unknown[]) => f.invoke(...args) },
  from: (table: string) => {
    if (!['emails', 'quote_cases', 'email_attachments', 'email_drafts'].includes(table)) throw new Error(`Unexpected table: ${table}`);
    const read = { table, fields: '', filters: {} as Record<string, unknown>, options: undefined as unknown };
    const query = {
      select: (fields: string, options?: unknown) => { read.fields = fields; read.options = options; return query; },
      eq: (key: string, value: unknown) => { read.filters[key] = value; return query; },
      limit: (n: number) => { expect(n).toBe(2); return query; },
      range: (start: number, end: number) => { expect([start, end]).toEqual([0, 999]); return query; },
      single: () => query,
      then: (resolve: (reply: Reply) => unknown, reject: (reason: unknown) => unknown) => {
        f.reads.push(read);
        const reply = table === 'email_drafts' && read.filters.id ? { data: f.persisted, error: null } : f.reply[table];
        return Promise.resolve(reply).then(resolve, reject);
      },
    };
    return query;
  },
} }));

function good() {
  const draft = { id: D, original_email_id: E, created_by: A, status: 'draft', sent_at: null, subject: '[RECETTE AUTH] Synthétique', body_text: '[RECETTE AUTH — NE PAS ENVOYER]\nContenu synthétique' };
  return { ok: true, data: {
    success: true, recipe_mode: 'no_files_v1', zone_reply_contract: 'optional_factor_v1',
    recipe_effects: { draft_persisted: true, application_ai_calls_occurred: true, usage_counters_may_change: true, attachment_analysis_performed: false, files_created: false, download_links_created: false },
    draft, attachment_needed: false, attachment_data: null, generated_attachment: null,
    can_quote_now: true, quotation_metadata: { zone_resolution: { status: 'matched', source: 'delivery_zones' } },
  } };
}
beforeEach(() => {
  f.user = { id: A, email: 'operator@example.invalid' }; f.authStatus = 'authenticated'; f.reads = [];
  f.getUser.mockReset().mockResolvedValue({ data: { user: f.user }, error: null });
  f.rpc.mockReset().mockResolvedValue({ data: true, error: null });
  f.reply = {
    emails: { data: { id: E, subject: 'Demande synthétique', thread_ref: T }, error: null },
    quote_cases: { data: [{ id: C, thread_id: T }], error: null },
    email_attachments: { data: [{ id: P, email_id: E, is_analyzed: true }], count: 1, error: null },
    email_drafts: { data: null, count: 0, error: null },
  };
  const answer = good(); f.persisted = { ...answer.data.draft };
  f.invoke.mockReset().mockResolvedValue({ data: answer, error: null });
  sessionStorage.clear(); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Connected fetch is forbidden in synthetic tests'); }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function show() { return render(<MemoryRouter><GenerationRecipe /></MemoryRouter>); }
async function fill() {
  fireEvent.change(screen.getByLabelText('Opérateur autorisé (UUID)'), { target: { value: A } });
  fireEvent.change(screen.getByLabelText('Dossier (UUID)'), { target: { value: C } });
  fireEvent.change(screen.getByLabelText('Courriel (UUID)'), { target: { value: E } });
}
const check = () => userEvent.click(screen.getByRole('button', { name: 'Vérifier en lecture seule' }));
async function ready() { await fill(); await check(); await screen.findByText('Vérification effectuée'); await userEvent.click(screen.getByRole('checkbox')); }
const generate = () => userEvent.click(screen.getByRole('button', { name: 'Exécuter la recette interne' }));

it('loads without any API call and requires three UUIDs with focusable error and preserved inputs', async () => {
  show(); expect(f.getUser).not.toHaveBeenCalled(); expect(f.reads).toHaveLength(0); expect(f.invoke).not.toHaveBeenCalled();
  await check(); expect(await screen.findByRole('alert')).toHaveTextContent('trois identifiants UUID'); expect(f.getUser).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Opérateur autorisé (UUID)')).toHaveFocus();
  await fill(); expect(screen.getByLabelText('Dossier (UUID)')).toHaveValue(C);
  expect(document.title).toBe('Recette sans fichiers | Dakar Cargo Quotes');
});
it('reads only canonical metadata with existing identity/workspace admission and no generation', async () => {
  show(); await ready(); expect(f.getUser).toHaveBeenCalledWith(); expect(f.rpc).toHaveBeenCalledWith('has_workspace_access');
  expect(f.reads.map(r => r.table)).toEqual(['emails', 'quote_cases', 'email_attachments', 'email_drafts']);
  expect(f.reads.map(r => r.fields).join()).not.toMatch(/body|storage|extracted|token/);
  expect(f.reads[3].options).toEqual({ count: 'exact', head: true }); expect(f.invoke).not.toHaveBeenCalled();
});
it('sends one safe literal request, repeats reads, validates mode/effects and re-reads the actual draft', async () => {
  show(); await ready(); await generate(); await screen.findByText('Brouillon interne confirmé');
  expect(f.invoke).toHaveBeenCalledTimes(1); const [name, options] = f.invoke.mock.calls[0];
  expect(name).toBe('generate-response'); expect(options).toEqual({ body: {
    recipe_mode: 'no_files_v1', recipe_email_id: E, zone_reply_contract: 'optional_factor_v1', customInstructions: 'Recette technique d’authentification uniquement. Brouillon interne sans envoi.', expertStyle: 'auto', reply_language_override: 'AUTO',
  } });
  expect(options.body).not.toHaveProperty('emailId'); expect(options.body).not.toHaveProperty('quotationData'); expect(options).not.toHaveProperty('headers');
  expect(f.getUser).toHaveBeenCalledTimes(2); expect(f.reads.at(-1)?.filters).toEqual({ id: D, original_email_id: E, created_by: A });
  expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual({ actorId: A, caseId: C, emailId: E, attemptedAt: expect.any(String) });
  expect(screen.getByRole('button', { name: 'Exécuter la recette interne' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: /envoyer|réessayer/i })).not.toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
});
it('requires confirmation and invalidates preflight when the target is edited', async () => {
  show(); await fill(); await check(); await screen.findByText('Vérification effectuée'); expect(screen.getByRole('button', { name: 'Exécuter la recette interne' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Courriel (UUID)'), { target: { value: P } }); expect(screen.queryByText('Vérification effectuée')).not.toBeInTheDocument(); expect(f.invoke).not.toHaveBeenCalled();
});
it.each(['unauthenticated', 'loading', 'timeout'])('cannot submit in auth state %s', async status => {
  f.authStatus = status; show(); await fill(); expect(screen.getByRole('button', { name: 'Vérifier en lecture seule' })).toBeDisabled(); expect(f.invoke).not.toHaveBeenCalled();
});
it('refuses another operator before reads and refuses expired identity at verification', async () => {
  show(); await fill(); fireEvent.change(screen.getByLabelText('Opérateur autorisé (UUID)'), { target: { value: P } }); await check(); expect(await screen.findByRole('alert')).toHaveTextContent('session'); expect(f.getUser).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Opérateur autorisé (UUID)'), { target: { value: A } }); f.getUser.mockResolvedValue({ data: { user: null }, error: new Error('expired') }); await check(); expect(await screen.findByRole('alert')).toHaveTextContent('session'); expect(f.reads).toHaveLength(0);
});
describe('fail-closed preconditions', () => {
  it.each([
    ['workspace denial', () => f.rpc.mockResolvedValue({ data: false, error: null })],
    ['workspace error', () => f.rpc.mockResolvedValue({ data: null, error: new Error('failure') })],
    ['email read failure', () => { f.reply.emails.error = new Error('failure'); }],
    ['missing thread', () => { f.reply.emails.data = { id: E, thread_ref: null }; }],
    ['wrong email', () => { f.reply.emails.data = { id: P, thread_ref: T }; }],
    ['wrong case', () => { f.reply.quote_cases.data = [{ id: P, thread_id: T }]; }],
    ['ambiguous cases', () => { f.reply.quote_cases.data = [{ id: C, thread_id: T }, { id: P, thread_id: T }]; }],
    ['case read error', () => { f.reply.quote_cases.error = new Error('failure'); }],
    ['unanalysed attachment', () => { f.reply.email_attachments.data = [{ id: P, email_id: E, is_analyzed: false }]; }],
    ['truthy analysed flag', () => { f.reply.email_attachments.data = [{ id: P, email_id: E, is_analyzed: 1 }]; }],
    ['missing attachment count', () => { f.reply.email_attachments.count = null; }],
    ['truncated attachments', () => { f.reply.email_attachments.count = 2; }],
    ['wrong attachment owner', () => { f.reply.email_attachments.data = [{ id: P, email_id: A, is_analyzed: true }]; }],
    ['duplicated attachments', () => { f.reply.email_attachments.data = [{ id: P, email_id: E, is_analyzed: true }, { id: P, email_id: E, is_analyzed: true }]; f.reply.email_attachments.count = 2; }],
    ['attachment read error', () => { f.reply.email_attachments.error = new Error('failure'); }],
    ['existing draft', () => { f.reply.email_drafts.count = 1; }],
    ['unknown draft count', () => { f.reply.email_drafts.count = null; }],
    ['draft read error', () => { f.reply.email_drafts.error = new Error('failure'); }],
  ])('blocks %s without generation or attempt marker', async (_, alter) => {
    alter(); show(); await fill(); await check(); await screen.findByRole('alert'); expect(f.invoke).not.toHaveBeenCalled(); expect(sessionStorage.getItem(KEY)).toBeNull(); expect(screen.getByLabelText('Courriel (UUID)')).toHaveValue(E);
  });
});
it('revalidates a changed attachment state before submitting and permits no generation', async () => {
  show(); await ready(); f.reply.email_attachments.count = 2; await generate(); await screen.findByRole('alert'); expect(f.invoke).not.toHaveBeenCalled(); expect(sessionStorage.getItem(KEY)).toBeNull();
});
it.each([
  ['legacy envelope', (p: ReturnType<typeof good>) => { delete (p.data as Partial<typeof p.data>).recipe_mode; }],
  ['false success', (p: ReturnType<typeof good>) => { p.data.success = false; }],
  ['wrong mode', (p: ReturnType<typeof good>) => { p.data.recipe_mode = 'other'; }],
  ['missing effects', (p: ReturnType<typeof good>) => { delete (p.data as Partial<typeof p.data>).recipe_effects; }],
  ['files flag', (p: ReturnType<typeof good>) => { p.data.recipe_effects.files_created = true; }],
  ['links flag', (p: ReturnType<typeof good>) => { p.data.recipe_effects.download_links_created = true; }],
  ['analysis flag', (p: ReturnType<typeof good>) => { p.data.recipe_effects.attachment_analysis_performed = true; }],
  ['attachment payload', (p: ReturnType<typeof good>) => { Object.assign(p.data, { attachment_data: {} }); }],
  ['generated attachment', (p: ReturnType<typeof good>) => { Object.assign(p.data, { generated_attachment: { public_url: 'https://example.invalid/no-open' } }); }],
  ['wrong email', (p: ReturnType<typeof good>) => { p.data.draft.original_email_id = P; }],
  ['wrong actor', (p: ReturnType<typeof good>) => { p.data.draft.created_by = P; }],
  ['sent draft', (p: ReturnType<typeof good>) => { p.data.draft.status = 'sent'; }],
  ['missing marker', (p: ReturnType<typeof good>) => { p.data.draft.subject = 'wrong'; }],
])('treats %s as uncertain, never retries and never renders raw content or URLs', async (_, mutate) => {
  const response = good(); mutate(response); f.invoke.mockResolvedValue({ data: response, error: null }); show(); await ready(); await generate();
  expect(await screen.findByRole('alert')).toHaveTextContent('sans confirmation complète'); expect(f.invoke).toHaveBeenCalledTimes(1); expect(screen.queryByText('Brouillon interne confirmé')).not.toBeInTheDocument(); expect(screen.queryByRole('link', { name: /example/ })).not.toBeInTheDocument(); expect(screen.getByLabelText('Dossier (UUID)')).toHaveValue(C);
});
it.each([400, 401, 403, 409, 503])('does not downgrade or retry a server %s refusal', async status => {
  f.invoke.mockResolvedValue({ data: null, error: { context: Response.json({ error: { code: 'RECIPE_DISABLED' } }, { status }) } }); show(); await ready(); await generate(); expect(await screen.findByRole('alert')).toHaveTextContent('Ne relancez pas'); expect(f.invoke).toHaveBeenCalledTimes(1); expect(sessionStorage.getItem(KEY)).not.toBeNull();
});
it('does not call the server when attempt storage cannot be written', async () => {
  show(); await ready(); vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable'); }); await generate(); await screen.findByRole('alert'); expect(f.invoke).not.toHaveBeenCalled();
});
it('explains an unavailable attempt store truthfully at mount and blocks all calls', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage unavailable'); }); show();
  expect(await screen.findByRole('alert')).toHaveTextContent('suivi de tentative'); expect(screen.queryByText(/Une tentative est déjà enregistrée/)).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Vérifier en lecture seule' })).toBeDisabled(); expect(f.invoke).not.toHaveBeenCalled();
});
it('blocks remount/reload after an attempt and retains only identifiers and time in session storage', async () => {
  const view = show(); await ready(); await generate(); await screen.findByText('Brouillon interne confirmé'); view.unmount(); show(); expect(screen.getByRole('button', { name: 'Vérifier en lecture seule' })).toBeDisabled(); expect(await screen.findByRole('status')).toHaveTextContent('déjà enregistrée'); expect(sessionStorage.getItem(KEY)).not.toMatch(/secret|token|Demande|Contenu/);
});
it('guards rapid duplicate clicks and a delayed response without a second call', async () => {
  let settle!: (value: unknown) => void; f.invoke.mockImplementation(() => new Promise(resolve => { settle = resolve; })); show(); await ready(); const button = screen.getByRole('button', { name: 'Exécuter la recette interne' });
  fireEvent.click(button); fireEvent.click(button); await waitFor(() => expect(f.invoke).toHaveBeenCalledTimes(1)); expect(button).toBeDisabled();
  await act(async () => settle({ data: good(), error: null })); await screen.findByText('Brouillon interne confirmé'); expect(f.invoke).toHaveBeenCalledTimes(1);
});
it('times out without claiming cancellation or allowing a retry', async () => {
  show(); await ready(); let settle!: (value: unknown) => void; f.invoke.mockImplementation(() => new Promise(resolve => { settle = resolve; })); vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: 'Exécuter la recette interne' })); await act(async () => { await vi.advanceTimersByTimeAsync(0); }); expect(f.invoke).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(90_001); }); expect(screen.getByRole('alert')).toHaveTextContent('Un brouillon et des frais IA peuvent exister');
  await act(async () => settle({ data: good(), error: null })); expect(screen.queryByText('Brouillon interne confirmé')).not.toBeInTheDocument(); expect(f.invoke).toHaveBeenCalledTimes(1);
});
it('does not report full engine verification for a non-quotation answer', async () => {
  const response = good(); response.data.can_quote_now = false; f.invoke.mockResolvedValue({ data: response, error: null }); show(); await ready(); await generate(); await screen.findByText('Brouillon confirmé ; contrôle moteur non concluant'); expect(f.invoke).toHaveBeenCalledTimes(1);
});
it('requires an authoritative persisted draft read, not only an HTTP acknowledgement', async () => {
  f.persisted = null; show(); await ready(); await generate(); expect(await screen.findByRole('alert')).toHaveTextContent('sans confirmation complète'); expect(screen.queryByText('Brouillon interne confirmé')).not.toBeInTheDocument();
});
it('ignores late output when the active user changes', async () => {
  let settle!: (value: unknown) => void; f.invoke.mockImplementation(() => new Promise(resolve => { settle = resolve; })); const view = show(); await ready(); await generate(); await waitFor(() => expect(f.invoke).toHaveBeenCalledTimes(1));
  f.user = { id: P, email: 'other@example.invalid' }; view.rerender(<MemoryRouter><GenerationRecipe /></MemoryRouter>); await act(async () => settle({ data: good(), error: null })); expect(screen.queryByText('Brouillon interne confirmé')).not.toBeInTheDocument(); expect(screen.queryByText(D)).not.toBeInTheDocument(); expect(f.reads.some(r => r.filters.id === D)).toBe(false);
});
it('ignores a slow preflight after unmount and never calls generation', async () => {
  let settle!: (value: unknown) => void; f.getUser.mockImplementation(() => new Promise(resolve => { settle = resolve; })); const view = show(); await fill(); await check(); view.unmount(); await act(async () => settle({ data: { user: f.user }, error: null })); expect(f.invoke).not.toHaveBeenCalled();
});
