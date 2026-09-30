import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExternalRequestsPanel } from '../ExternalRequestsPanel';

const m = vi.hoisted(() => ({ status: 'draft', prepare: vi.fn(), confirm: vi.fn() }));
vi.mock('@/hooks/useExternalRequests', () => ({ useExternalRequests: () => ({
  requests: [{ id: 'partner-request', partner_name: 'Partenaire test', partner_email: 'partner@example.test', purpose: 'general', status: m.status, email_sent_at: null, created_at: '2026-09-30T10:00:00Z' }],
  responses: [], facts: [], isLoading: false, createRequest: {}, triggerAnalysis: {}, rejectFact: {}, closeRequest: {},
}) }));
vi.mock('@/hooks/useExternalRequestFlow', () => ({ useExternalRequestFlow: () => ({ sendRequest: { mutateAsync: m.prepare }, confirmSent: { mutateAsync: m.confirm }, validateFactAndRerun: {}, isConfirming: false }) }));
vi.mock('@/hooks/usePartnerSuggestions', () => ({ usePartnerSuggestions: () => ({ pendingSuggestions: [], scanSuggestions: {}, confirmSuggestion: {}, rejectSuggestion: {}, getPendingForRequest: () => [], getSuggestionsForRequest: () => [] }) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined }) }));
vi.mock('../PartnerSuggestionPanel', () => ({ PartnerSuggestionPanel: () => null }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('../PartnerScopeCard', () => ({ PartnerScopeCard: () => null }));
beforeEach(() => { m.status = 'draft'; m.prepare.mockReset(); m.confirm.mockReset(); });
afterEach(cleanup);

it('prepares a partner message without claiming delivery', async () => {
  render(<ExternalRequestsPanel caseId="case-test" />);
  await userEvent.click(screen.getByText('Partenaire test'));
  await userEvent.click(screen.getByRole('button', { name: 'Préparer le message' }));
  expect(m.prepare).toHaveBeenCalledWith('partner-request');
  expect(m.confirm).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Envoyer' })).not.toBeInTheDocument();
});
it('prepared status is not sent; confirmation is explicit, scoped and double-click protected', async () => {
  m.status = 'sent';
  let finish!: () => void;
  m.confirm.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<ExternalRequestsPanel caseId="case-test" />);
  expect(screen.getByText('Message préparé — envoi à confirmer')).toBeVisible();
  await userEvent.click(screen.getByText('Partenaire test'));
  await userEvent.click(screen.getByRole('button', { name: 'Confirmer l’envoi manuel' }));
  expect(screen.getByRole('alertdialog')).toHaveTextContent('partner@example.test');
  expect(m.confirm).not.toHaveBeenCalled();
  const confirm = screen.getByRole('button', { name: 'Confirmer cet envoi' });
  fireEvent.click(confirm); fireEvent.click(confirm);
  expect(m.confirm).toHaveBeenCalledTimes(1);
  expect(m.confirm).toHaveBeenCalledWith('partner-request');
  finish();
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
});
