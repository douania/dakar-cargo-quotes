import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const invoke = vi.hoisted(() => vi.fn());
const success = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));
vi.mock('sonner', () => ({ toast: { success } }));
import { MailboxPasswordDialog } from '../MailboxPasswordDialog';
const config = { id: '11111111-1111-4111-8111-111111111111', name: 'Boîte fictive', username: 'operator@example.invalid' };
const password = ' synthetic "password\\ ';
function setup() {
  const onClose = vi.fn(), onSuccess = vi.fn();
  render(<MailboxPasswordDialog config={config} onClose={onClose} onSuccess={onSuccess} />);
  const first = screen.getByLabelText('Mot de passe / App Password') as HTMLInputElement;
  const second = screen.getByLabelText('Confirmer le mot de passe') as HTMLInputElement;
  return { onClose, onSuccess, first, second, submit: screen.getByRole('button', { name: 'Remplacer le mot de passe' }) };
}
function fill(first: HTMLInputElement, second: HTMLInputElement, confirmation = password) {
  fireEvent.change(first, { target: { value: password } });
  fireEvent.change(second, { target: { value: confirmation } });
}
describe('existing mailbox credential recovery', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });
  it('starts empty and masked, confirms the literal credential, sends only existing UUID and clears after success', async () => {
    invoke.mockResolvedValue({ data: { success: true }, error: null });
    const s = setup(); expect(s.first.value).toBe(''); expect(s.first.type).toBe('password'); expect(s.second.type).toBe('password');
    fill(s.first, s.second); fireEvent.click(s.submit);
    await waitFor(() => expect(s.onClose).toHaveBeenCalledOnce());
    expect(invoke).toHaveBeenCalledExactlyOnceWith('email-admin', { body: { action: 'replace_password', data: { configId: config.id, password } } });
    expect(s.onSuccess).toHaveBeenCalledOnce(); expect(s.first.value).toBe(''); expect(s.second.value).toBe('');
    expect(success).toHaveBeenCalledWith('Mot de passe remplacé');
    expect(document.body.textContent).not.toContain(password);
  });
  it('blocks empty/mismatched fields before any request and focuses the error', () => {
    const s = setup(); fireEvent.click(s.submit); expect(invoke).not.toHaveBeenCalled(); expect(document.activeElement).toBe(s.first);
    fill(s.first, s.second, 'different-fake'); fireEvent.click(s.submit); expect(invoke).not.toHaveBeenCalled();
    expect(s.first.getAttribute('aria-invalid')).toBe('true'); expect(screen.getByRole('alert')).toBeTruthy();
  });
  it('prevents double submit and closing while pending, then keeps masked input with a scrubbed retryable error', async () => {
    let resolve!: (value: unknown) => void;
    invoke.mockImplementation(() => new Promise(r => { resolve = r; }));
    const s = setup(); fill(s.first, s.second); fireEvent.click(s.submit); fireEvent.submit(s.submit.closest('form')!);
    expect(invoke).toHaveBeenCalledOnce(); expect(s.submit.hasAttribute('disabled')).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' }); expect(s.onClose).not.toHaveBeenCalled();
    await act(async () => { resolve({ data: null, error: { message: password, context: { private: 'fake-secret' } } }); });
    expect(screen.getByRole('alert').textContent).toContain('Vérifiez vos droits administrateur');
    expect(document.body.textContent).not.toContain(password); expect(document.body.textContent).not.toContain('fake-secret');
    expect(s.first.value).toBe(password); expect(s.first.type).toBe('password'); expect(s.onSuccess).not.toHaveBeenCalled();
    invoke.mockResolvedValue({ data: { success: true }, error: null }); fireEvent.click(s.submit);
    await waitFor(() => expect(s.onSuccess).toHaveBeenCalledOnce());
  });
  it('ignores a late result after unmount and cancels without saving', async () => {
    const s = setup(); fireEvent.click(screen.getByRole('button', { name: 'Annuler' })); expect(s.onClose).toHaveBeenCalledOnce(); expect(invoke).not.toHaveBeenCalled();
    let resolve!: (value: unknown) => void; invoke.mockImplementation(() => new Promise(r => { resolve = r; }));
    fill(s.first, s.second); fireEvent.click(s.submit); cleanup();
    await act(async () => { resolve({ data: { success: true }, error: null }); });
    expect(s.onSuccess).not.toHaveBeenCalled(); expect(success).not.toHaveBeenCalled();
  });
});
