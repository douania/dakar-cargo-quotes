import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChat } from './useChat';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession } } }));
function stream(parts: string[]) {
  return new Response(new ReadableStream({ start(controller) {
    parts.forEach(p => controller.enqueue(new TextEncoder().encode(p))); controller.close();
  } }));
}
const token = (value: string | null) => ({ data: { session: value ? { access_token: value } : null }, error: null });
describe('useChat session et streaming (sans réseau)', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); getSession.mockResolvedValue(token('session-a')); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('utilise le jeton courant à chaque envoi et restitue les fragments UTF-8/SSE', async () => {
    fetchMock.mockImplementation(() => stream([': ping\n', 'data: {"choices":[{"delta":{"content":"Bon', 'jour é"}}]}\r\n', 'data: [DONE]']));
    const { result } = renderHook(() => useChat());
    await act(async () => { await result.current.sendMessage('question synthétique'); });
    expect(result.current.messages.map(m => m.content)).toEqual(['question synthétique', 'Bonjour é']);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer session-a');
    getSession.mockResolvedValue(token('session-b'));
    await act(async () => { await result.current.sendMessage('suite'); });
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer session-b');
    expect(result.current.error).toBeNull(); expect(result.current.isLoading).toBe(false);
  });
  it('ne contacte pas le chat sans session, conserve les pièces et reprend sans dupliquer la question', async () => {
    getSession.mockResolvedValue(token(null));
    const { result } = renderHook(() => useChat());
    await act(async () => { await result.current.sendMessage('question', [{ id: 'fixture', name: 'synthétique.txt', content: 'contexte' }]); });
    expect(fetchMock).not.toHaveBeenCalled(); expect(result.current.error?.reconnect).toBe(true);
    getSession.mockResolvedValue(token('reconnected'));
    fetchMock.mockResolvedValue(stream(['data: {"choices":[{"delta":{"content":"réponse"}}]}\ndata: [DONE]\n']));
    await act(async () => { await result.current.retryMessage(); });
    expect(result.current.messages.filter(m => m.role === 'user')).toHaveLength(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content).toContain('contexte');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer reconnected');
  });
  it.each([[401, true, 'Session expirée'], [403, false, 'Accès refusé'], [429, false, 'Limite'], [402, false, 'Crédits'], [500, false, 'indisponible']])('rend une erreur explicite pour HTTP %s', async (status, reconnect, message) => {
    fetchMock.mockResolvedValue(new Response('{}', { status: Number(status) }));
    const { result } = renderHook(() => useChat());
    await act(async () => { await result.current.sendMessage('question'); });
    expect(result.current.error?.message).toContain(message); expect(result.current.error?.reconnect).toBe(reconnect);
    expect(result.current.isLoading).toBe(false);
  });
  it('conserve une réponse tronquée et ne propose pas de relance silencieuse', async () => {
    fetchMock.mockResolvedValue(stream(['data: {"choices":[{"delta":{"content":"partiel"}}]}\n']));
    const { result } = renderHook(() => useChat());
    await act(async () => { await result.current.sendMessage('question'); });
    expect(result.current.messages[1].content).toBe('partiel'); expect(result.current.error?.retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('signale les erreurs réseau et évite deux envois simultanés', async () => {
    fetchMock.mockRejectedValue(new TypeError('synthetic network failure'));
    const { result } = renderHook(() => useChat());
    await act(async () => { await Promise.all([result.current.sendMessage('question'), result.current.sendMessage('double clic')]); });
    expect(result.current.messages).toHaveLength(1); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.error?.retryable).toBe(true);
  });
  it('annule avant la fin de la lecture de session sans envoyer la requête', async () => {
    let resolve: (value: ReturnType<typeof token>) => void;
    getSession.mockImplementation(() => new Promise(r => { resolve = r; }));
    const { result } = renderHook(() => useChat());
    let pending: Promise<void>;
    act(() => { pending = result.current.sendMessage('question'); });
    act(() => { result.current.cancelRequest(); });
    await act(async () => { resolve(token('session')); await pending; });
    expect(fetchMock).not.toHaveBeenCalled(); expect(result.current.isLoading).toBe(false);
  });
  it('ne réinsère aucun fragment tardif après effacement de la conversation', async () => {
    let resolveRead: (value: ReadableStreamReadResult<Uint8Array>) => void;
    const read = vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(r => { resolveRead = r; }));
    const cancel = vi.fn().mockResolvedValue(undefined);
    fetchMock.mockResolvedValue({ ok: true, body: { getReader: () => ({ read, cancel, releaseLock: vi.fn() }) } });
    const { result } = renderHook(() => useChat());
    let pending: Promise<void>;
    await act(async () => { pending = result.current.sendMessage('question'); await Promise.resolve(); });
    act(() => { result.current.clearMessages(); });
    await act(async () => { resolveRead({ done: false, value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"tardif"}}]}\n') }); await pending; });
    expect(result.current.messages).toEqual([]); expect(result.current.error).toBeNull(); expect(cancel).toHaveBeenCalled();
  });
  it('borne une session bloquée et permet ensuite la reprise avec un jeton neuf', async () => {
    vi.useFakeTimers(); getSession.mockImplementation(() => new Promise(() => undefined));
    const { result } = renderHook(() => useChat());
    let pending: Promise<void>;
    act(() => { pending = result.current.sendMessage('question'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); await pending; });
    expect(result.current.error?.reconnect).toBe(true); expect(result.current.isLoading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('libère immédiatement une annulation même si getSession ne se termine pas', async () => {
    getSession.mockImplementation(() => new Promise(() => undefined));
    const { result } = renderHook(() => useChat());
    let pending: Promise<void>;
    act(() => { pending = result.current.sendMessage('question'); });
    await act(async () => { result.current.cancelRequest(); await pending; });
    expect(result.current.isLoading).toBe(false); expect(fetchMock).not.toHaveBeenCalled();
  });
});
