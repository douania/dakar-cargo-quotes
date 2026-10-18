import { act, fireEvent, render, renderHook, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreadConversationView } from '@/components/ThreadConversationView';
import { getSenderType, isSodatraEmail, useThreadEmails } from '@/hooks/useThreadEmails';
import type { ThreadEmail } from '@/hooks/useThreadEmails';

const fixture = vi.hoisted(() => ({
  read: vi.fn(), calls: [] as Array<{ table: string; id: string; start: number; end: number; ids: string[] }>,
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (table: string) => {
  let id = '', start = 0, end = 0, ids: string[] = [];
  const result = () => { const call = { table, id, start, end, ids }; fixture.calls.push(call); return fixture.read(call); };
  const query = { select: () => query, eq: (_key: string, value: string) => { id = value; return query; },
    in: (_key: string, value: string[]) => { ids = value; return query; }, order: () => query,
    range: (a: number, b: number) => { start = a; end = b; return result(); }, single: result,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  }; return query;
} } }));

afterEach(() => { cleanup(); fixture.calls = []; fixture.read.mockReset(); });
function wrapper(client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })) {
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const email = (i: number, thread = 'a'): ThreadEmail => ({ id: `${thread}-${String(i).padStart(4, '0')}`,
  subject: `Message ${thread} ${i}`, from_address: 'buyer@client.invalid', to_addresses: ['ops@sodatra.sn'],
  cc_addresses: [], body_text: `Contenu ${thread} ${i}`, sent_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), is_quotation_request: false });
function serve(count = 51, attachmentCount = 0) {
  fixture.read.mockImplementation(({ table, id, start, end, ids }) => {
    if (table === 'email_threads') return { data: { id, subject_normalized: `Dossier ${id}`,
      client_email: 'buyer@client.invalid', partner_email: null }, error: null };
    if (table === 'emails') return { data: Array.from({ length: count }, (_, i) => email(count - i, id)).slice(start, end + 1), error: null, count };
    return { data: Array.from({ length: attachmentCount }, () => ({ email_id: ids[0] })).slice(start, end + 1), error: null, count: attachmentCount };
  });
}

describe('provenance des badges expéditeur', () => {
  it('requires exact internal domains and exact known external addresses', () => {
    expect(isSodatraEmail(' Ops@SODATRA.SN ')).toBe(true);
    expect(isSodatraEmail('ops@sodatra.sn.attacker.invalid')).toBe(false);
    expect(isSodatraEmail('ops@other-sodatra.sn')).toBe(false);
    expect(getSenderType(' BUYER@CLIENT.INVALID ', 'buyer@client.invalid', null)).toBe('client');
    expect(getSenderType('buyer.attacker@other.invalid', 'buyer@client.invalid', null)).toBe('unknown');
    expect(getSenderType('other@client.invalid', 'buyer@client.invalid', null)).toBe('unknown');
    expect(getSenderType('ops@partner.invalid', null, 'ops@partner.invalid')).toBe('partner');
  });
});

describe('lecture du fil sous RLS existante', () => {
  it('loads recent history in bounded pages and exposes every older message', async () => {
    serve(105);
    const { result } = renderHook(() => useThreadEmails('a'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0].emails).toHaveLength(50);
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => { await result.current.fetchNextPage(); });
    await waitFor(() => expect(result.current.data?.pages.flatMap(page => page.emails)).toHaveLength(100));
    await act(async () => { await result.current.fetchNextPage(); });
    await waitFor(() => expect(result.current.data?.pages.flatMap(page => page.emails)).toHaveLength(105));
    expect(result.current.hasNextPage).toBe(false);
    expect(fixture.calls.filter(c => c.table === 'emails').map(c => [c.id, c.start, c.end])).toEqual([
      ['a', 0, 49], ['a', 50, 99], ['a', 100, 149],
    ]);
  });

  it('counts all 1001 attachments and scopes each read to this page of email IDs', async () => {
    serve(1, 1001);
    const { result } = renderHook(() => useThreadEmails('a'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0].emails[0].attachmentCount).toBe(1001);
    expect(fixture.calls.filter(c => c.table === 'email_attachments').map(c => [c.start, c.end, c.ids])).toEqual([
      [0, 499, ['a-0001']], [500, 999, ['a-0001']], [1000, 1499, ['a-0001']],
    ]);
  });

  it('continues when a server cap returns fewer rows than requested instead of claiming complete history', async () => {
    serve(11); const original = fixture.read.getMockImplementation()!;
    fixture.read.mockImplementation(call => {
      const response = original(call);
      return call.table === 'emails' ? { ...response, data: response.data.slice(0, 4) } : response;
    });
    const { result } = renderHook(() => useThreadEmails('a'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    expect(result.current.data?.pages[0].nextOffset).toBe(4);
    for (const length of [8, 11]) {
      await act(async () => { await result.current.fetchNextPage(); });
      expect(result.current.error).toBeNull();
      await waitFor(() => expect(result.current.data?.pages.flatMap(page => page.emails)).toHaveLength(length));
    }
    expect(result.current.hasNextPage).toBe(false);
    expect(fixture.calls.filter(c => c.table === 'emails').map(c => c.start)).toEqual([0, 4, 8]);
  });

  it('does not issue an attachment query for an empty thread', async () => {
    serve(0);
    const { result } = renderHook(() => useThreadEmails('a'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0].emails).toEqual([]);
    expect(fixture.calls.some(c => c.table === 'email_attachments')).toBe(false);
  });

  it('shows an error and retry when refetch fails after a previously empty thread', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    serve(0);
    render(<ThreadConversationView threadId="a" />, { wrapper: wrapper(client) });
    expect(await screen.findByText('Aucun message dans ce fil')).toBeVisible();
    fixture.read.mockResolvedValue({ data: null, error: { message: 'fixture refused' } });
    await act(async () => { await client.invalidateQueries({ queryKey: ['thread-emails', 'a'] }); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger');
    expect(screen.queryByText('Aucun message dans ce fil')).not.toBeInTheDocument();
    serve(1);
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Contenu a 1')).toBeVisible();
  });

  it.each(['emails', 'email_attachments', 'email_threads'])('never changes a %s failure into a zero count or an empty thread', async (table) => {
    serve(1); const original = fixture.read.getMockImplementation()!;
    fixture.read.mockImplementation(call => call.table === table ? { data: null, error: { message: 'fixture refused' } } : original(call));
    render(<ThreadConversationView threadId="a" />, { wrapper: wrapper() });
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger');
    expect(screen.queryByText('Aucun message dans ce fil')).not.toBeInTheDocument();
    serve(1);
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Contenu a 1')).toBeVisible();
  });

  it('keeps acquired history on an older-page failure and retries that page', async () => {
    serve(51); const original = fixture.read.getMockImplementation()!;
    let refused = true;
    fixture.read.mockImplementation(call => call.table === 'emails' && call.start === 50 && refused
      ? { data: null, error: { message: 'fixture refused' } } : original(call));
    render(<ThreadConversationView threadId="a" />, { wrapper: wrapper() });
    expect(await screen.findByText('Contenu a 51')).toBeVisible();
    expect(screen.queryByText('0', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText(/historique partiel/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Charger les messages plus anciens' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Historique incomplet');
    expect(screen.getByText('Contenu a 51')).toBeVisible();
    refused = false;
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Contenu a 1')).toBeVisible();
    expect(screen.getAllByText(/^Contenu a /).map(node => node.textContent)).toEqual(
      Array.from({ length: 51 }, (_, i) => `Contenu a ${i + 1}`),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Charger les messages plus anciens' })).not.toBeInTheDocument();
  });

  it('does not display a late response from a different selected thread', async () => {
    serve(1); const original = fixture.read.getMockImplementation()!;
    let release: (value: unknown) => void = () => {};
    fixture.read.mockImplementation(call => call.table === 'emails' && call.id === 'a'
      ? new Promise(resolve => { release = resolve; }) : original(call));
    const { rerender } = render(<ThreadConversationView threadId="a" />, { wrapper: wrapper() });
    await waitFor(() => expect(fixture.calls.some(c => c.table === 'emails' && c.id === 'a')).toBe(true));
    rerender(<ThreadConversationView threadId="b" />);
    expect(await screen.findByText('Contenu b 1')).toBeVisible();
    await act(async () => release({ data: [email(1, 'a')], error: null, count: 1 }));
    expect(screen.queryByText('Contenu a 1')).not.toBeInTheDocument();
    expect(screen.getByText('Contenu b 1')).toBeVisible();
  });
});
