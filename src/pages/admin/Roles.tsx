import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert, Plus, Trash2, Copy } from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

// ── H2-d3 : gestion des rôles applicatifs depuis l'écran ────────────────
// app_roles (PAD-C2, étendu H2-a/H2-a2). Écriture réservée au rôle
// role_admin (RLS) ; un utilisateur sans ce rôle ne voit que ses propres
// lignes (policy app_roles_select_own, cumulée à app_roles_select_role_admin).
// Pas de résolution email → UUID ici : aucune fonction Edge n'expose l'API
// admin Auth (auth.admin.listUsers) dans ce lot — hors périmètre du GO H2-d,
// et une telle fonction toucherait la surface Auth. L'attribution se fait par
// identifiant utilisateur (UUID), que chacun peut copier depuis cette page
// pour son propre compte, ou obtenir par un autre canal pour un tiers.

const ROLE_OPTIONS = [
  { value: 'tariff_admin', label: 'tariff_admin — honoraires (lignes, règles, clients)' },
  { value: 'role_admin', label: 'role_admin — gestion des rôles' },
  { value: 'pad_admin', label: 'pad_admin — PAD-C2' },
  { value: 'pad_supervisor', label: 'pad_supervisor — PAD-C2' },
];

const ROLE_LABELS: Record<string, string> = {
  tariff_admin: 'tariff_admin',
  role_admin: 'role_admin',
  pad_admin: 'pad_admin',
  pad_supervisor: 'pad_supervisor',
};

interface AppRoleRow {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
}

export default function Roles() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newUserId, setNewUserId] = useState('');
  const [newRole, setNewRole] = useState('tariff_admin');

  const { data: currentUserId } = useQuery({
    queryKey: ['current-user-id'],
    queryFn: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      return data.user?.id ?? null;
    },
  });

  const { data: isRoleAdmin = false } = useQuery({
    queryKey: ['has-role-admin-role'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('has_role_admin_role');
      if (error) throw error;
      return !!data;
    },
  });

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['app-roles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_roles')
        .select('id, user_id, role, created_at')
        .order('role')
        .order('created_at');
      if (error) throw error;
      return data as AppRoleRow[];
    },
  });

  const addMutation = useMutation({
    mutationFn: async ({ user_id, role }: { user_id: string; role: string }) => {
      const { error } = await supabase.from('app_roles').insert({ user_id, role });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['app-roles'] });
      toast.success('Rôle attribué');
      setDialogOpen(false);
      setNewUserId('');
      setNewRole('tariff_admin');
    },
    onError: (e) => toast.error(`Erreur : ${e.message}`),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('app_roles').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['app-roles'] });
      toast.success('Rôle retiré');
    },
    onError: (e) => toast.error(`Erreur : ${e.message}`),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(newUserId.trim())) {
      toast.error("L'identifiant utilisateur doit être un UUID valide (ex: fcd6d183-5572-4982-9fd4-3ba3ea5ac33e).");
      return;
    }
    addMutation.mutate({ user_id: newUserId.trim(), role: newRole });
  };

  const copyOwnId = async () => {
    if (!currentUserId) return;
    try {
      await navigator.clipboard.writeText(currentUserId);
      toast.success('Identifiant copié');
    } catch {
      toast.info(currentUserId);
    }
  };

  return (
    <MainLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ShieldCheck className="h-6 w-6" /> Rôles applicatifs
            </h1>
            <p className="text-sm text-muted-foreground">
              tariff_admin (honoraires), role_admin (gestion des rôles), pad_admin / pad_supervisor (PAD-C2).
            </p>
          </div>
          {!isRoleAdmin && (
            <Badge variant="outline" className="gap-1 text-amber-700 border-amber-300 dark:text-amber-400">
              <ShieldAlert className="h-3.5 w-3.5" /> Lecture limitée à vos propres rôles (role_admin requis)
            </Badge>
          )}
        </div>

        <Card>
          <CardContent className="pt-6">
            <p className="text-sm">
              Votre identifiant utilisateur :{' '}
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{currentUserId || '…'}</code>
            </p>
            {currentUserId && (
              <Button variant="ghost" size="sm" className="mt-1" onClick={copyOwnId}>
                <Copy className="h-3.5 w-3.5 mr-1" /> Copier
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Attributions</CardTitle>
              <CardDescription>
                Le dernier role_admin ne peut pas être retiré (garde-fou anti-verrouillage, H2-a2).
              </CardDescription>
            </div>
            <Button size="sm" disabled={!isRoleAdmin} onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Attribuer un rôle
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Utilisateur</TableHead>
                    <TableHead>Rôle</TableHead>
                    <TableHead>Depuis</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roles.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">
                        {r.user_id}
                        {r.user_id === currentUserId && <Badge variant="outline" className="ml-2">Vous</Badge>}
                      </TableCell>
                      <TableCell><Badge>{ROLE_LABELS[r.role] || r.role}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString('fr-FR')}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost" size="icon" disabled={!isRoleAdmin}
                          onClick={() => { if (confirm(`Retirer le rôle ${r.role} à cet utilisateur ?`)) removeMutation.mutate(r.id); }}
                          title="Retirer ce rôle"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {roles.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Aucun rôle visible.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Attribuer un rôle</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label>Identifiant utilisateur (UUID) *</Label>
                <Input value={newUserId} onChange={(e) => setNewUserId(e.target.value)} placeholder="fcd6d183-5572-4982-9fd4-3ba3ea5ac33e" />
              </div>
              <div className="space-y-2">
                <Label>Rôle *</Label>
                <Select value={newRole} onValueChange={setNewRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
                <Button type="submit" disabled={addMutation.isPending}>Attribuer</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
