import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Message, AttachedFile } from '@/types';

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
type RequestMessages = { role: Message['role']; content: string }[];
export interface ChatError { message: string; reconnect: boolean; retryable: boolean }

function currentSession(signal: AbortSignal): ReturnType<typeof supabase.auth.getSession> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, result?: Awaited<ReturnType<typeof supabase.auth.getSession>>) => {
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('SessionUnavailable')), 10_000);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    supabase.auth.getSession().then(result => finish(undefined, result), () => finish(new Error('SessionUnavailable')));
  });
}

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const retryRef = useRef<RequestMessages | null>(null);
  useEffect(() => () => { requestRef.current?.abort(); }, []);

  const runRequest = useCallback(async (history: RequestMessages, controller: AbortController) => {
    const active = () => requestRef.current === controller && !controller.signal.aborted;
    let assistantContent = '';
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    setIsLoading(true);
    setError(null);
    retryRef.current = history;
    try {
      // Read the current token for each send/retry. Server admission is unchanged.
      let sessionResult: Awaited<ReturnType<typeof supabase.auth.getSession>>;
      try { sessionResult = await currentSession(controller.signal); }
      catch {
        if (active()) setError({ message: 'Vérification de session indisponible ou trop lente. Reconnectez-vous puis réessayez ce message.', reconnect: true, retryable: true });
        return;
      }
      const { data, error: sessionError } = sessionResult;
      if (!active()) return;
      if (sessionError || !data.session?.access_token) {
        setError({ message: 'Session indisponible. Reconnectez-vous puis réessayez ce message.', reconnect: true, retryable: true });
        return;
      }
      const response = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ messages: history }), signal: controller.signal,
      });
      if (!active()) return;
      if (!response.ok) {
        const message = response.status === 401 ? 'Session expirée ou refusée. Reconnectez-vous puis réessayez ce message.'
          : response.status === 403 ? 'Accès refusé à cet espace. Faites vérifier vos droits avant de réessayer.'
          : response.status === 429 ? 'Limite de requêtes atteinte. Réessayez dans quelques instants.'
          : response.status === 402 ? 'Crédits insuffisants. Faites vérifier le compte avant de réessayer.'
          : 'Le service de conversation est indisponible. Vous pouvez réessayer ce message.';
        setError({ message, reconnect: response.status === 401, retryable: true });
        return;
      }
      if (!response.body) throw new Error('Missing stream');
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let complete = false;
      const assistantId = crypto.randomUUID();
      const consume = (raw: string) => {
        if (!active()) return;
        const line = raw.replace(/\r$/, '');
        if (!line.startsWith('data:')) return;
        const value = line.slice(5).trim();
        if (value === '[DONE]') { complete = true; return; }
        const parsed = JSON.parse(value);
        if (parsed.error) throw new Error('Stream error');
        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta !== 'string' || !delta) return;
        const first = !assistantContent;
        assistantContent += delta;
        const content = assistantContent;
        setMessages(prev => first ? [...prev, { id: assistantId, role: 'assistant', content }]
          : prev.map(m => m.id === assistantId ? { ...m, content } : m));
      };
      while (!complete && active()) {
        const { done, value } = await reader.read();
        if (!active()) return;
        buffer += decoder.decode(value, { stream: !done });
        let newline: number;
        while (!complete && (newline = buffer.indexOf('\n')) !== -1) {
          consume(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
        }
        if (done) { if (!complete && buffer.trim()) consume(buffer); break; }
      }
      if (!active()) return;
      if (!complete || !assistantContent) throw new Error('Incomplete stream');
      retryRef.current = null;
    } catch {
      if (active()) setError({
        message: assistantContent ? 'Réponse interrompue. Le texte reçu est conservé ; envoyez un nouveau message pour poursuivre.'
          : 'La réponse n’a pas pu être reçue. Votre message est conservé ; une nouvelle tentative peut relancer son traitement.',
        reconnect: false, retryable: !assistantContent,
      });
    } finally {
      if (reader) { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      if (requestRef.current === controller) { requestRef.current = null; setIsLoading(false); }
    }
  }, []);

  const sendMessage = useCallback(async (content: string, attachedFiles?: AttachedFile[]) => {
    if (requestRef.current || (!content.trim() && !attachedFiles?.length)) return;
    const controller = new AbortController(); requestRef.current = controller;
    const context = attachedFiles?.map(f => `[Document joint: ${f.name}]\n${f.content.substring(0, 2000)}${f.content.length > 2000 ? '…(tronqué)' : ''}`).join('\n\n');
    const fullContent = context ? `${content}\n\n--- Documents joints ---\n${context}` : content;
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content, attachedFiles };
    setMessages(prev => [...prev, userMessage]);
    await runRequest([...messages.map(m => ({ role: m.role, content: m.content })), { role: 'user', content: fullContent }], controller);
  }, [messages, runRequest]);
  const retryMessage = useCallback(async () => {
    if (requestRef.current || !retryRef.current) return;
    const controller = new AbortController(); requestRef.current = controller;
    await runRequest(retryRef.current, controller);
  }, [runRequest]);
  const cancelRequest = useCallback(() => { requestRef.current?.abort(); }, []);
  const clearMessages = useCallback(() => {
    requestRef.current?.abort(); requestRef.current = null; retryRef.current = null;
    setMessages([]); setError(null); setIsLoading(false);
  }, []);
  return { messages, isLoading, error, sendMessage, retryMessage, clearMessages, cancelRequest };
}
