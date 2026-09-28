import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';

// Alerte Lovable 6 (GO CTO 2026-09-28): /admin/emails?email=<id> opens that e-mail through a
// targeted read (authenticated client, RLS), even when it is not among the 300 listed e-mails.
const db = vi.hoisted(() => ({ maybeSingle: vi.fn(), eq: vi.fn(), from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => {
  const builder = { select: () => builder, eq: (...a: unknown[]) => { db.eq(...a); return builder; }, maybeSingle: () => db.maybeSingle() };
  return { supabase: { from: (t: string) => { db.from(t); return builder; }, functions: { invoke: vi.fn() } } };
});
const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn(), info: vi.fn() } }));

import { useEmailDeepLink } from '../Emails';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function Harness() {
  const [opened, setOpened] = useState<{ id: string } | null>(null);
  const opens = useState<string[]>([])[0];
  const { clearEmailParam } = useEmailDeepLink((e) => { if (e) opens.push(e.id); setOpened(e as { id: string } | null); });
  const loc = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <div data-testid="opened">{opened?.id ?? 'none'}</div>
      <div data-testid="opens">{opens.join(',')}</div>
      <div data-testid="search">{loc.search}</div>
      <button onClick={() => { setOpened(null); clearEmailParam(); }}>close</button>
      <button onClick={() => navigate(`/admin/emails?email=${B}`)}>goB</button>
      <button onClick={() => navigate('/admin/emails?email=not-a-uuid')}>goBad</button>
    </div>
  );
}

const renderAt = (search: string) =>
  render(<MemoryRouter initialEntries={[`/admin/emails${search}`]}><Harness /></MemoryRouter>);
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('useEmailDeepLink', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('opens the requested e-mail by a targeted read of the emails table', async () => {
    db.maybeSingle.mockResolvedValue({ data: { id: A, subject: 'Hors liste' }, error: null });
    renderAt(`?email=${A}`);
    await flush();
    expect(db.from).toHaveBeenCalledWith('emails');
    expect(db.eq).toHaveBeenCalledWith('id', A);
    expect(screen.getByTestId('opened').textContent).toBe(A);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('reports an inaccessible e-mail and drops the link', async () => {
    db.maybeSingle.mockResolvedValue({ data: null, error: null });
    renderAt(`?email=${A}`);
    await flush();
    expect(screen.getByTestId('opened').textContent).toBe('none');
    expect(toastError).toHaveBeenCalledWith('E-mail introuvable ou inaccessible avec vos droits.');
    expect(screen.getByTestId('search').textContent).toBe('');
  });

  it('rejects an invalid identifier without querying', async () => {
    renderAt('?email=not-a-uuid');
    await flush();
    expect(db.from).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Lien d'e-mail invalide.");
    expect(screen.getByTestId('search').textContent).toBe('');
  });

  it('switching to another result ignores the slower previous read', async () => {
    let resolveA!: (v: unknown) => void;
    db.maybeSingle
      .mockImplementationOnce(() => new Promise((r) => { resolveA = r; }))
      .mockResolvedValueOnce({ data: { id: B }, error: null });
    renderAt(`?email=${A}`);
    await flush();
    fireEvent.click(screen.getByText('goB'));
    await flush();
    await act(async () => { resolveA({ data: { id: A }, error: null }); });
    await flush();
    expect(screen.getByTestId('opened').textContent).toBe(B);
    expect(screen.getByTestId('opens').textContent).toBe(B);
  });

  it('an invalid identifier after an opened e-mail closes it and shows the error', async () => {
    db.maybeSingle.mockResolvedValue({ data: { id: A }, error: null });
    renderAt(`?email=${A}`);
    await flush();
    expect(screen.getByTestId('opened').textContent).toBe(A);
    fireEvent.click(screen.getByText('goBad'));
    await flush();
    expect(toastError).toHaveBeenCalledWith("Lien d'e-mail invalide.");
    expect(screen.getByTestId('opened').textContent).toBe('none');
    expect(screen.getByTestId('search').textContent).toBe('');
    expect(db.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it('closing drops the link and nothing reopens', async () => {
    db.maybeSingle.mockResolvedValue({ data: { id: A }, error: null });
    renderAt(`?email=${A}`);
    await flush();
    fireEvent.click(screen.getByText('close'));
    await flush();
    expect(screen.getByTestId('opened').textContent).toBe('none');
    expect(screen.getByTestId('search').textContent).toBe('');
    expect(db.maybeSingle).toHaveBeenCalledTimes(1);
  });
});
