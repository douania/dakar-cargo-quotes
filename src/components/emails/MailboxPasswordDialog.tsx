import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

interface Props {
  config: { id: string; name: string; username: string };
  onClose: () => void;
  onSuccess: () => void;
}

/** Sensitive input lives only in this mounted dialog, never in a persisted draft. */
export function MailboxPasswordDialog({ config, onClose, onSuccess }: Props) {
  const id = useId();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const passwordInput = useRef<HTMLInputElement>(null);
  const trigger = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return;
    if (!password || password.length > 1024 || password.includes('\r') || password.includes('\n')
      || password.includes(String.fromCharCode(0)) || password !== confirmation) {
      setError('Saisissez deux fois le même mot de passe, sans retour à la ligne.');
      passwordInput.current?.focus();
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError('');
    try {
      const result = await supabase.functions.invoke('email-admin', {
        body: { action: 'replace_password', data: { configId: config.id, password } },
      });
      if (!mounted.current) return;
      if (result.error || result.data?.success !== true) throw new Error();
      setPassword('');
      setConfirmation('');
      toast.success('Mot de passe remplacé');
      onSuccess();
      onClose();
    } catch {
      if (mounted.current) {
        // Raw server errors can contain sensitive details; never render or log them.
        setError('Remplacement impossible. Vérifiez vos droits administrateur et réessayez.');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !inFlight.current) onClose(); }}>
      <DialogContent className="max-h-[90dvh] w-[calc(100%_-_2rem)] overflow-y-auto [&>button]:hidden"
        onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus(); }}
        onEscapeKeyDown={(event) => { if (inFlight.current) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (inFlight.current) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Remplacer le mot de passe</DialogTitle>
          <DialogDescription>
            {config.name} · {config.username}. Les emails, pièces jointes et dossiers sont conservés.
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="space-y-4" aria-busy={pending}>
          <div className="space-y-2">
            <Label htmlFor={`${id}-password`}>Mot de passe / App Password</Label>
            <Input id={`${id}-password`} ref={passwordInput} type="password" autoComplete="new-password"
              maxLength={1024} value={password} disabled={pending}
              aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}
              onChange={(event) => setPassword(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-confirmation`}>Confirmer le mot de passe</Label>
            <Input id={`${id}-confirmation`} type="password" autoComplete="new-password"
              maxLength={1024} value={confirmation} disabled={pending}
              aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}
              onChange={(event) => setConfirmation(event.target.value)} />
          </div>
          <p id={`${id}-error`} role={error ? 'alert' : undefined} className="min-h-10 text-sm text-destructive">{error}</p>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>Annuler</Button>
            <Button type="submit" disabled={pending} className="min-w-40">
              {pending ? 'Remplacement…' : 'Remplacer le mot de passe'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
