import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { PricingLaunchPanel } from '../PricingLaunchPanel';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: vi.fn(), functions: { invoke: vi.fn() } },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { supabase } from '@/integrations/supabase/client';

type Run = {
  id: string;
  run_number: number;
  status: string;
  error_message: string | null;
  outputs_json: { message: string } | null;
  created_at: null;
  completed_at: null;
};
const invokeMock = vi.mocked(supabase.functions.invoke);
const latest = new Map<string, Run | null>();
const queriedCases: string[] = [];
const clients: QueryClient[] = [];

function run(number: number, status: string, message: string | null = null): Run {
  return { id: `run-${number}`, run_number: number, status, error_message: message,
    outputs_json: null, created_at: null, completed_at: null };
}

function renderPanel(props: Partial<ComponentProps<typeof PricingLaunchPanel>> = {}, client?: QueryClient) {
  const queryClient = client ?? new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  if (!clients.includes(queryClient)) clients.push(queryClient);
  const onComplete = vi.fn();
  return { onComplete, client: queryClient, ...render(
    <QueryClientProvider client={queryClient}>
      <PricingLaunchPanel caseId="case-a" isRerun onComplete={onComplete} {...props} />
    </QueryClientProvider>,
  ) };
}

async function confirmPricing(user: ReturnType<typeof userEvent.setup>, container?: HTMLElement) {
  const scope = container ? within(container) : screen;
  await user.click(scope.getByRole('button', { name: 'Relancer le pricing' }));
  await user.click(await screen.findByRole('button', { name: 'Confirmer' }));
}

beforeEach(() => {
  vi.resetAllMocks();
  latest.clear();
  queriedCases.length = 0;
  const fromMock = vi.mocked(supabase.from);
  fromMock.mockImplementation(() => ({
    select: () => ({ eq: (column: string, caseId: string) => {
      expect(column).toBe('case_id');
      return { order: (column: string, options: { ascending: boolean }) => {
        expect(column).toBe('run_number');
        expect(options).toEqual({ ascending: false });
        return { limit: (count: number) => {
          expect(count).toBe(1);
          return { maybeSingle: async () => {
            queriedCases.push(caseId);
            return { data: latest.get(caseId) ?? null, error: null };
          } };
        } };
      } };
    } }),
  }) as unknown as ReturnType<typeof supabase.from>);
});

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
});

describe('versioned-case manual pricing and latest-run recovery', () => {
  it('does not run on mount or opening/cancelling the confirmation', async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(screen.getByRole('button', { name: 'Relancer le pricing' })).toBeEnabled();
    await waitFor(() => expect(queriedCases).toEqual(['case-a']));
    expect(invokeMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Relancer le pricing' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('preserves the intent guard and hides provisional pricing under that guard', async () => {
    renderPanel({ blockedByIntent: 'opportunity_check', canProvisionalDdp: true });
    expect(screen.getByRole('button', { name: 'Relancer le pricing' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Générer un devis provisoire/ })).toBeNull();
    await waitFor(() => expect(queriedCases).toEqual(['case-a']));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('preserves missing-data prechecks on rerun', async () => {
    renderPanel({ pricingPrechecks: [{ code: 'HS_CODE_REQUIRED', key: 'hs', label: 'HS manquant' }] });
    expect(screen.getByRole('button', { name: 'Relancer le pricing' })).toBeDisabled();
    expect(screen.getByText('HS manquant')).toBeInTheDocument();
    await waitFor(() => expect(queriedCases).toEqual(['case-a']));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('refreshes blocked then successful runs inside the 30-second cache window, only after confirmation', async () => {
    latest.set('case-a', run(3, 'success'));
    const user = userEvent.setup();
    const { onComplete } = renderPanel();
    await waitFor(() => expect(queriedCases).toEqual(['case-a']));
    invokeMock.mockImplementationOnce(async () => {
      latest.set('case-a', { ...run(4, 'blocked'), outputs_json: { message: 'PAD à révoquer' } });
      return { data: { pricing_blockers: ['PAD_CONFLICT'], message: 'PAD à révoquer' }, error: null };
    });
    await confirmPricing(user);
    expect(await screen.findByText('Dernier pricing bloqué')).toBeInTheDocument();
    expect(screen.getByText(/Run #4/)).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith('run-pricing', { body: { case_id: 'case-a' } });
    expect(onComplete).toHaveBeenCalledTimes(1);

    invokeMock.mockImplementationOnce(async () => {
      latest.set('case-a', run(5, 'success'));
      return { data: { lines_count: 16 }, error: null };
    });
    await confirmPricing(user);
    await waitFor(() => expect(queriedCases).toHaveLength(3));
    await waitFor(() => expect(screen.queryByText('Dernier pricing bloqué')).toBeNull());
    expect(screen.queryByText(/Run #4/)).toBeNull();
    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(invokeMock.mock.calls.every(([name]) => name === 'run-pricing')).toBe(true);
  });

  it.each(['function-error', 'rejected-promise', 'exchange-early-return'])(
    'refreshes the latest failed run on %s', async (errorPath) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      latest.set('case-a', run(3, 'success'));
      const user = userEvent.setup();
      renderPanel();
      await waitFor(() => expect(queriedCases).toEqual(['case-a']));
      invokeMock.mockImplementationOnce(async () => {
        latest.set('case-a', run(4, 'failed', 'Échec contrôlé'));
        const message = errorPath === 'exchange-early-return'
          ? 'Exchange rate for USD expired or missing' : 'Échec contrôlé';
        if (errorPath === 'rejected-promise') throw new Error(message);
        return { data: null, error: new Error(message) };
      });
      await confirmPricing(user);
      expect(await screen.findByText('Dernier pricing échoué')).toBeInTheDocument();
      expect(screen.getByText(/Run #4/)).toBeInTheDocument();
      expect(queriedCases).toHaveLength(2);
      expect(invokeMock).toHaveBeenCalledTimes(1);
    },
  );

  it('refreshes only the requested case, without leaking or invalidating another case', async () => {
    latest.set('case-a', run(4, 'blocked', 'Blocage dossier A'));
    latest.set('case-b', run(9, 'blocked', 'Blocage dossier B'));
    const user = userEvent.setup();
    const a = renderPanel();
    const b = renderPanel({ caseId: 'case-b' }, a.client);
    expect(await within(a.container).findByText('Blocage dossier A')).toBeInTheDocument();
    expect(await within(b.container).findByText('Blocage dossier B')).toBeInTheDocument();
    invokeMock.mockImplementationOnce(async () => {
      latest.set('case-a', run(5, 'success'));
      return { data: { lines_count: 16 }, error: null };
    });
    await confirmPricing(user, a.container);
    await waitFor(() => expect(within(a.container).queryByText('Dernier pricing bloqué')).toBeNull());
    expect(within(b.container).getByText('Blocage dossier B')).toBeInTheDocument();
    expect(queriedCases.filter(id => id === 'case-a')).toHaveLength(2);
    expect(queriedCases.filter(id => id === 'case-b')).toHaveLength(1);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith('run-pricing', { body: { case_id: 'case-a' } });
  });
});
