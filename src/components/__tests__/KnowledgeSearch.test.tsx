import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { KnowledgeSearch } from '../KnowledgeSearch';

// Alerte Lovable 6 (GO CTO 2026-09-28): the selected e-mail is opened, a cleared search keeps no
// old e-mail result, and a search response that arrives after the query changed is ignored.
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));

beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;
  Element.prototype.scrollIntoView ??= () => {};
});

const EMAIL_A = { id: '11111111-1111-4111-8111-111111111111', subject: 'Cotation Shanghai', from_address: 'a@example.test', received_at: null, is_quotation_request: true };
const EMAIL_B = { id: '22222222-2222-4222-8222-222222222222', subject: 'Cotation Ningbo', from_address: 'b@example.test', received_at: null, is_quotation_request: false };

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function renderSearch() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <KnowledgeSearch />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  );
}

async function typeQuery(value: string) {
  fireEvent.change(screen.getByPlaceholderText('Rechercher contacts, tarifs, emails...'), { target: { value } });
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
}

describe('KnowledgeSearch — e-mail results', () => {
  afterEach(() => { cleanup(); invoke.mockReset(); vi.useRealTimers(); });

  it('opens the reader of the e-mail actually selected, by its id', async () => {
    vi.useFakeTimers();
    invoke.mockResolvedValue({ data: { results: [], emails: [EMAIL_A, EMAIL_B] }, error: null });
    renderSearch();
    fireEvent.click(screen.getByRole('button', { name: /Rechercher/ }));
    await typeQuery('cotation');
    fireEvent.click(screen.getByText('Cotation Ningbo'));
    expect(screen.getByTestId('where').textContent).toBe(`/admin/emails?email=${EMAIL_B.id}`);
  });

  it('drops every e-mail result when the search is cleared', async () => {
    vi.useFakeTimers();
    invoke.mockResolvedValue({ data: { results: [], emails: [EMAIL_A] }, error: null });
    renderSearch();
    fireEvent.click(screen.getByRole('button', { name: /Rechercher/ }));
    await typeQuery('cotation');
    expect(screen.getByText('Cotation Shanghai')).toBeTruthy();
    await typeQuery('');
    expect(screen.queryByText('Cotation Shanghai')).toBeNull();
    expect(screen.getByText('Tapez au moins 2 caractères pour rechercher')).toBeTruthy();
  });

  it('ignores a response that arrives after the query changed', async () => {
    vi.useFakeTimers();
    let resolveFirst!: (v: unknown) => void;
    invoke
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce({ data: { results: [], emails: [EMAIL_B] }, error: null });
    renderSearch();
    fireEvent.click(screen.getByRole('button', { name: /Rechercher/ }));
    await typeQuery('shanghai');
    await typeQuery('ningbo');
    await act(async () => { resolveFirst({ data: { results: [], emails: [EMAIL_A] }, error: null }); });
    expect(screen.getByText('Cotation Ningbo')).toBeTruthy();
    expect(screen.queryByText('Cotation Shanghai')).toBeNull();
  });
});
