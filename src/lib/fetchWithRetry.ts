import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Invoke a Supabase edge function with timeout + 1 automatic retry.
 * Used across Dashboard, Emails, and other pages for resilient calls.
 */
export async function invokeWithRetry(
  fnName: string,
  body: Record<string, unknown>,
  timeoutMs = 15000
): Promise<{ data: any; error: any }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const result = await supabase.functions.invoke(fnName, {
        body,
        // @ts-ignore – AbortSignal accepted at runtime
        signal: controller.signal,
      });

      clearTimeout(timer);
      return result;
    } catch (err: any) {
      if (
        attempt === 0 &&
        (err?.name === 'AbortError' ||
          err?.message?.includes('timeout') ||
          err?.message?.includes('closed'))
      ) {
        console.warn(`[invokeWithRetry] ${fnName} attempt 1 timeout, retrying…`);
        toast.info('Serveur temporairement lent, nouvelle tentative…');
        continue;
      }
      return { data: null, error: err };
    }
  }
  return { data: null, error: new Error('Timeout persistant') };
}

/**
 * Wrap a Supabase query builder promise with a client-side timeout.
 * If the query doesn't resolve within `timeoutMs`, rejects with an error.
 */
export function withTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs = 15000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Requête expirée (timeout)')),
      timeoutMs
    );
    Promise.resolve(promise).then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}
