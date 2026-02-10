import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Briefcase,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Search,
  Filter,
  Power,
  PowerOff,
} from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

// ── Types ──────────────────────────────────────────────────────────

interface ClientOverride {
  id: string;
  client_code: string;
  service_code: string;
  pricing_mode: string;
  base_price: number;
  min_price: number;
  currency: string;
  mode_scope: string | null;
  valid_from: string | null;
  valid_to: string | null;
  active: boolean;
  description: string | null;
  created_at: string;
}

interface FormData {
  client_code: string;
  service_code: string;
  pricing_mode: string;
  base_price: number;
  min_price: number;
  currency: string;
  mode_scope: string;
  valid_from: string;
  valid_to: string;
  description: string;
  active: boolean;
}

const EMPTY_FORM: FormData = {
  client_code: '',
  service_code: '',
  pricing_mode: 'FIXED',
  base_price: 0,
  min_price: 0,
  currency: 'XOF',
  mode_scope: '',
  valid_from: '',
  valid_to: '',
  description: '',
  active: true,
};

const MODE_BADGES: Record<string, { label: string; className: string }> = {
  FIXED: { label: 'Fixe', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  UNIT_RATE: { label: 'Unitaire', className: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300' },
  PERCENTAGE: { label: 'Pourcentage', className: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' },
};

const SCOPE_LABELS: Record<string, string> = { SEA: 'Maritime', AIR: 'Aérien' };

// ── Helpers ────────────────────────────────────────────────────────

const fmt = (amount: number, currency: string) =>
  new Intl.NumberFormat('fr-FR').format(amount) + ' ' + currency;

const isExpired = (o: ClientOverride) =>
  !!o.valid_to && new Date(o.valid_to) < new Date();

const getValidity = (o: ClientOverride) => {
  if (!o.valid_to) return { label: 'Illimité', className: 'bg-muted text-muted-foreground' };
  if (isExpired(o)) return { label: 'Expiré', className: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' };
  return { label: 'Valide', className: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' };
};

const formatBasePrice = (mode: string, price: number, currency: string) => {
  if (mode === 'PERCENTAGE') return `${price}%`;
  if (mode === 'UNIT_RATE') return `${fmt(price, currency)} / unité`;
  return fmt(price, currency);
};

// ── Component ──────────────────────────────────────────────────────

export default function ClientOverrides() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ClientOverride | null>(null);
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);

  // ── Queries ──────────────────────────────────────────────────────

  const { data: overrides = [], isLoading } = useQuery({
    queryKey: ['client-overrides'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pricing_client_overrides')
        .select('*')
        .order('client_code')
        .order('service_code');
      if (error) throw error;
      return data as ClientOverride[];
    },
  });

  // Source canonique des services
  const { data: serviceCatalogue = [] } = useQuery({
    queryKey: ['service-catalogue-codes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pricing_service_catalogue')
        .select('service_code, service_name')
        .eq('active', true)
        .order('service_code');
      if (error) throw error;
      return data as Array<{ service_code: string; service_name: string }>;
    },
  });

  // ── Mutations ────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async (data: FormData & { id?: string }) => {
      const payload = {
        client_code: data.client_code.trim().toUpperCase(),
        service_code: data.service_code,
        pricing_mode: data.pricing_mode,
        base_price: data.base_price,
        min_price: data.min_price,
        currency: data.currency,
        mode_scope: data.mode_scope || null,
        valid_from: data.valid_from || null,
        valid_to: data.valid_to || null,
        description: data.description.trim() || null,
        active: data.active,
      };
      if (data.id) {
        const { error } = await supabase
          .from('pricing_client_overrides')
          .update(payload)
          .eq('id', data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('pricing_client_overrides')
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-overrides'] });
      toast.success(editing ? 'Contrat mis à jour' : 'Contrat créé');
      closeDialog();
    },
    onError: (e) => toast.error(`Erreur : ${e.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('pricing_client_overrides')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-overrides'] });
      toast.success('Contrat supprimé');
    },
    onError: (e) => toast.error(`Erreur : ${e.message}`),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from('pricing_client_overrides')
        .update({ active })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-overrides'] });
      toast.success('Statut mis à jour');
    },
    onError: (e) => toast.error(`Erreur : ${e.message}`),
  });

  // ── Dialog management ────────────────────────────────────────────

  const openDialog = (override?: ClientOverride) => {
    if (override) {
      setEditing(override);
      setFormData({
        client_code: override.client_code,
        service_code: override.service_code,
        pricing_mode: override.pricing_mode,
        base_price: override.base_price,
        min_price: override.min_price,
        currency: override.currency,
        mode_scope: override.mode_scope || '',
        valid_from: override.valid_from || '',
        valid_to: override.valid_to || '',
        description: override.description || '',
        active: override.active,
      });
    } else {
      setEditing(null);
      setFormData(EMPTY_FORM);
    }
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditing(null);
  };

  // ── Validation ───────────────────────────────────────────────────

  const validate = (): string | null => {
    if (!formData.client_code.trim()) return 'Le code client est requis.';
    if (!formData.service_code) return 'Le service est requis.';
    if (formData.base_price <= 0) return 'Le prix/taux doit être supérieur à 0.';
    if (formData.min_price < 0) return 'Le prix minimum ne peut pas être négatif.';
    if (formData.valid_from && formData.valid_to && formData.valid_to < formData.valid_from) {
      return 'La date de fin doit être postérieure à la date de début.';
    }
    return null;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) { toast.error(err); return; }
    saveMutation.mutate({ ...formData, id: editing?.id });
  };

  const handleDelete = (o: ClientOverride) => {
    const msg = o.active
      ? 'Ce contrat est actif. Voulez-vous vraiment le SUPPRIMER ? (Pensez à le désactiver plutôt.)'
      : 'Supprimer ce contrat ?';
    if (confirm(msg)) deleteMutation.mutate(o.id);
  };

  // ── Filters & stats ──────────────────────────────────────────────

  const filtered = useMemo(() => overrides.filter((o) => {
    if (searchTerm && !o.client_code.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !o.service_code.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (filterMode !== 'all' && o.pricing_mode !== filterMode) return false;
    if (filterStatus === 'active' && (!o.active || isExpired(o))) return false;
    if (filterStatus === 'expired' && !isExpired(o)) return false;
    if (filterStatus === 'inactive' && o.active) return false;
    return true;
  }), [overrides, searchTerm, filterMode, filterStatus]);

  const stats = useMemo(() => ({
    total: overrides.length,
    active: overrides.filter((o) => o.active && !isExpired(o)).length,
    expired: overrides.filter(isExpired).length,
    byMode: {
      FIXED: overrides.filter((o) => o.pricing_mode === 'FIXED').length,
      UNIT_RATE: overrides.filter((o) => o.pricing_mode === 'UNIT_RATE').length,
      PERCENTAGE: overrides.filter((o) => o.pricing_mode === 'PERCENTAGE').length,
    },
  }), [overrides]);

  // ── Dynamic label for base_price ─────────────────────────────────

  const basePriceLabel = (() => {
    switch (formData.pricing_mode) {
      case 'PERCENTAGE': return 'Pourcentage (%)';
      case 'UNIT_RATE': return 'Prix unitaire (XOF)';
      default: return 'Montant fixe (XOF)';
    }
  })();

  const basePriceHint = formData.pricing_mode === 'PERCENTAGE'
    ? '80 = 80% du tarif standard' : undefined;

  // ── Render ───────────────────────────────────────────────────────

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Briefcase className="h-6 w-6" />
              Contrats Clients
            </h1>
            <p className="text-muted-foreground">
              Gestion des overrides de pricing par client
            </p>
          </div>
          <Button onClick={() => openDialog()} className="gap-2">
            <Plus className="h-4 w-4" />
            Nouveau contrat
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">Total</p>
              <p className="text-2xl font-bold">{stats.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">Actifs</p>
              <p className="text-2xl font-bold text-green-600">{stats.active}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">Expirés</p>
              <p className="text-2xl font-bold text-red-600">{stats.expired}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">Par mode</p>
              <div className="flex gap-1 mt-1 flex-wrap">
                {Object.entries(stats.byMode).map(([m, c]) => (
                  <Badge key={m} className={MODE_BADGES[m]?.className}>{m}: {c}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex gap-4 items-center flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher client ou service…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filterMode} onValueChange={setFilterMode}>
            <SelectTrigger className="w-44">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les modes</SelectItem>
              <SelectItem value="FIXED">Fixe</SelectItem>
              <SelectItem value="UNIT_RATE">Unitaire</SelectItem>
              <SelectItem value="PERCENTAGE">Pourcentage</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Statut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous</SelectItem>
              <SelectItem value="active">Actifs</SelectItem>
              <SelectItem value="expired">Expirés</SelectItem>
              <SelectItem value="inactive">Inactifs</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead className="text-right">Prix / Taux</TableHead>
                  <TableHead className="text-right">Min</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Validité</TableHead>
                  <TableHead>Actif</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      Chargement…
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      Aucun contrat trouvé
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((o) => {
                    const validity = getValidity(o);
                    const modeBadge = MODE_BADGES[o.pricing_mode] ?? { label: o.pricing_mode, className: '' };
                    return (
                      <TableRow key={o.id} className={!o.active ? 'opacity-50' : ''}>
                        <TableCell className="font-medium">{o.client_code}</TableCell>
                        <TableCell className="font-mono text-xs">{o.service_code}</TableCell>
                        <TableCell>
                          <Badge className={modeBadge.className}>{modeBadge.label}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {formatBasePrice(o.pricing_mode, o.base_price, o.currency)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {o.min_price > 0 ? fmt(o.min_price, o.currency) : '-'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {o.mode_scope ? SCOPE_LABELS[o.mode_scope] ?? o.mode_scope : 'Tous'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={validity.className}>{validity.label}</Badge>
                          {o.valid_to && (
                            <span className="text-xs text-muted-foreground ml-1">
                              {format(new Date(o.valid_to), 'dd/MM/yy', { locale: fr })}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={o.active}
                            onCheckedChange={(checked) =>
                              toggleActiveMutation.mutate({ id: o.id, active: checked })
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openDialog(o)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(o)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editing ? 'Modifier le contrat' : 'Nouveau contrat client'}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Client + Service */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Code client *</Label>
                  <Input
                    value={formData.client_code}
                    onChange={(e) => setFormData({ ...formData, client_code: e.target.value })}
                    placeholder="AI0CARGO"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Service *</Label>
                  <Select
                    value={formData.service_code}
                    onValueChange={(v) => setFormData({ ...formData, service_code: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choisir un service" />
                    </SelectTrigger>
                    <SelectContent>
                      {serviceCatalogue.map((s) => (
                        <SelectItem key={s.service_code} value={s.service_code}>
                          {s.service_code} — {s.service_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Mode + Prix */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Mode de pricing *</Label>
                  <Select
                    value={formData.pricing_mode}
                    onValueChange={(v) => setFormData({ ...formData, pricing_mode: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FIXED">Fixe (montant)</SelectItem>
                      <SelectItem value="UNIT_RATE">Unitaire</SelectItem>
                      <SelectItem value="PERCENTAGE">Pourcentage (%)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{basePriceLabel} *</Label>
                  <Input
                    type="number"
                    min={0.01}
                    step="any"
                    value={formData.base_price || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, base_price: parseFloat(e.target.value) || 0 })
                    }
                    required
                  />
                  {basePriceHint && (
                    <p className="text-xs text-muted-foreground">{basePriceHint}</p>
                  )}
                </div>
              </div>

              {/* Min price + Currency */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Prix minimum</Label>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={formData.min_price || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, min_price: parseFloat(e.target.value) || 0 })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Devise</Label>
                  <Select
                    value={formData.currency}
                    onValueChange={(v) => setFormData({ ...formData, currency: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="XOF">XOF</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Scope + Active */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Scope transport</Label>
                  <Select
                    value={formData.mode_scope}
                    onValueChange={(v) =>
                      setFormData({ ...formData, mode_scope: v === 'all' ? '' : v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Tous" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous</SelectItem>
                      <SelectItem value="SEA">Maritime (SEA)</SelectItem>
                      <SelectItem value="AIR">Aérien (AIR)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end gap-2 pb-1">
                  <Switch
                    id="active-switch"
                    checked={formData.active}
                    onCheckedChange={(v) => setFormData({ ...formData, active: v })}
                  />
                  <Label htmlFor="active-switch">Actif</Label>
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Début validité</Label>
                  <Input
                    type="date"
                    value={formData.valid_from}
                    onChange={(e) => setFormData({ ...formData, valid_from: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Fin validité</Label>
                  <Input
                    type="date"
                    value={formData.valid_to}
                    onChange={(e) => setFormData({ ...formData, valid_to: e.target.value })}
                  />
                </div>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Notes sur ce contrat…"
                  rows={2}
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeDialog}>
                  Annuler
                </Button>
                <Button type="submit" disabled={saveMutation.isPending}>
                  {editing ? 'Enregistrer' : 'Créer'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
