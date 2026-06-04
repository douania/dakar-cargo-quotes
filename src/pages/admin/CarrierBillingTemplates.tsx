import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Ship, Plus, Pencil, Trash2, Search,
} from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

/* ── Real DB enum values (audited) ── */
const CALCULATION_METHODS = [
  'PER_BL', 'PER_CNT', 'PER_CONTAINER', 'PER_TEU',
  'PER_TONNE', 'PER_UNIT', 'PERCENTAGE',
] as const;

const OPERATION_TYPES = ['ALL', 'IMPORT', 'EXPORT', 'TRANSIT'] as const;
const INVOICE_TYPES = ['CONSOLIDATED', 'DOCUMENTATION', 'PORT_CHARGES', 'SERVICES'] as const;
const CURRENCIES = ['XOF', 'EUR', 'USD'] as const;

/* ── Types ── */
interface TemplateRow {
  id: string;
  carrier: string;
  charge_code: string;
  charge_name: string;
  calculation_method: string;
  default_amount: number | null;
  currency: string | null;
  operation_type: string | null;
  invoice_type: string | null;
  invoice_sequence: number | null;
  vat_rate: number | null;
  is_variable: boolean | null;
  variable_unit: string | null;
  base_reference: string | null;
  source_documents: string[] | null;
  effective_date: string | null;
  is_active: boolean | null;
  notes: string | null;
  created_at: string | null;
}

interface FormData {
  carrier: string;
  charge_code: string;
  charge_name: string;
  calculation_method: string;
  default_amount: string;
  currency: string;
  operation_type: string;
  invoice_type: string;
  invoice_sequence: string;
  vat_rate: string;
  is_variable: boolean;
  variable_unit: string;
  base_reference: string;
  source_documents: string;
  effective_date: string;
  is_active: boolean;
}

const emptyForm: FormData = {
  carrier: '', charge_code: '', charge_name: '',
  calculation_method: 'PER_BL', default_amount: '', currency: 'XOF',
  operation_type: 'IMPORT', invoice_type: 'SERVICES',
  invoice_sequence: '0', vat_rate: '0', is_variable: false,
  variable_unit: '', base_reference: '', source_documents: '',
  effective_date: '', is_active: true,
};

/** Sanitise source_documents: trim, drop blanks, avoid [""] */
function sanitiseSourceDocs(raw: string): string[] | null {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  return lines.length > 0 ? lines : null;
}

export default function CarrierBillingTemplates() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [search, setSearch] = useState('');

  /* ── Filters ── */
  const [fCarrier, setFCarrier] = useState('all');
  const [fOpType, setFOpType] = useState('all');
  const [fInvType, setFInvType] = useState('all');
  const [fActive, setFActive] = useState('all');

  /* ── Query ── */
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['carrier_billing_templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('carrier_billing_templates')
        .select('*')
        .order('carrier')
        .order('invoice_sequence', { ascending: true });
      if (error) throw error;
      return data as TemplateRow[];
    },
  });

  /* ── Distinct carriers for filter ── */
  const carriers = [...new Set(rows.map(r => r.carrier))].sort();

  /* ── Filtered rows ── */
  const filtered = rows.filter(r => {
    if (fCarrier !== 'all' && r.carrier !== fCarrier) return false;
    if (fOpType !== 'all' && r.operation_type !== fOpType) return false;
    if (fInvType !== 'all' && r.invoice_type !== fInvType) return false;
    if (fActive === 'active' && !r.is_active) return false;
    if (fActive === 'inactive' && r.is_active) return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        r.charge_code.toLowerCase().includes(s) ||
        r.charge_name.toLowerCase().includes(s) ||
        r.carrier.toLowerCase().includes(s)
      );
    }
    return true;
  });

  /* ── Mutations ── */
  const upsert = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (editing) {
        const { data, error } = await supabase.functions.invoke('carrier-billing-templates-admin', {
          body: { action: 'update', id: editing.id, data: payload },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
      } else {
        const { data, error } = await supabase.functions.invoke('carrier-billing-templates-admin', {
          body: { action: 'create', data: payload },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['carrier_billing_templates'] });
      toast.success(editing ? 'Template modifié' : 'Template créé');
      closeDialog();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke('carrier-billing-templates-admin', {
        body: { action: 'delete', id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['carrier_billing_templates'] });
      toast.success('Template supprimé');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* ── Dialog helpers ── */
  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(row: TemplateRow) {
    setEditing(row);
    setForm({
      carrier: row.carrier,
      charge_code: row.charge_code,
      charge_name: row.charge_name,
      calculation_method: row.calculation_method,
      default_amount: row.default_amount != null ? String(row.default_amount) : '',
      currency: row.currency ?? 'XOF',
      operation_type: row.operation_type ?? 'IMPORT',
      invoice_type: row.invoice_type ?? 'SERVICES',
      invoice_sequence: row.invoice_sequence != null ? String(row.invoice_sequence) : '0',
      vat_rate: row.vat_rate != null ? String(row.vat_rate) : '0',
      is_variable: !!row.is_variable,
      variable_unit: row.variable_unit ?? '',
      base_reference: row.base_reference ?? '',
      source_documents: (row.source_documents ?? []).join('\n'),
      effective_date: row.effective_date ?? '',
      is_active: row.is_active ?? true,
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditing(null);
  }

  function handleSubmit() {
    if (!form.carrier.trim() || !form.charge_code.trim() || !form.charge_name.trim()) {
      toast.error('Carrier, code et nom sont requis');
      return;
    }
    const payload: Record<string, unknown> = {
      carrier: form.carrier.trim(),
      charge_code: form.charge_code.trim(),
      charge_name: form.charge_name.trim(),
      calculation_method: form.calculation_method,
      default_amount: form.default_amount ? Number(form.default_amount) : null,
      currency: form.currency,
      operation_type: form.operation_type,
      invoice_type: form.invoice_type,
      invoice_sequence: form.invoice_sequence ? Number(form.invoice_sequence) : null,
      vat_rate: form.vat_rate ? Number(form.vat_rate) : 0,
      is_variable: form.is_variable,
      variable_unit: form.is_variable ? form.variable_unit.trim() || null : null,
      base_reference: form.base_reference.trim() || null,
      source_documents: sanitiseSourceDocs(form.source_documents),
      effective_date: form.effective_date || null,
      is_active: form.is_active,
    };
    upsert.mutate(payload);
  }

  const set = (key: keyof FormData, val: string | boolean) =>
    setForm(prev => ({ ...prev, [key]: val }));

  /* ── Render ── */
  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Ship className="h-5 w-5 text-primary" />
              Templates débours compagnies
            </h1>
            <p className="text-sm text-muted-foreground">{filtered.length} / {rows.length} templates</p>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> Nouveau
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher code, nom, carrier…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="max-w-xs"
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Select value={fCarrier} onValueChange={setFCarrier}>
                <SelectTrigger className="w-[160px]"><SelectValue placeholder="Carrier" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous carriers</SelectItem>
                  {carriers.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={fOpType} onValueChange={setFOpType}>
                <SelectTrigger className="w-[140px]"><SelectValue placeholder="Opération" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes opérations</SelectItem>
                  {OPERATION_TYPES.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={fInvType} onValueChange={setFInvType}>
                <SelectTrigger className="w-[160px]"><SelectValue placeholder="Type facture" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous types</SelectItem>
                  {INVOICE_TYPES.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={fActive} onValueChange={setFActive}>
                <SelectTrigger className="w-[120px]"><SelectValue placeholder="Statut" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  <SelectItem value="active">Actifs</SelectItem>
                  <SelectItem value="inactive">Inactifs</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Carrier</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Nom</TableHead>
                    <TableHead>Opération</TableHead>
                    <TableHead>Méthode</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                    <TableHead>Devise</TableHead>
                    <TableHead>TVA %</TableHead>
                    <TableHead>Facture</TableHead>
                    <TableHead>Seq</TableHead>
                    <TableHead>Base ref</TableHead>
                    <TableHead>Variable</TableHead>
                    <TableHead>Actif</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={14} className="text-center py-8 text-muted-foreground">Chargement…</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={14} className="text-center py-8 text-muted-foreground">Aucun template</TableCell></TableRow>
                  ) : filtered.map(row => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.carrier}</TableCell>
                      <TableCell><Badge variant="outline">{row.charge_code}</Badge></TableCell>
                      <TableCell className="max-w-[200px] truncate">{row.charge_name}</TableCell>
                      <TableCell>{row.operation_type ?? '—'}</TableCell>
                      <TableCell><Badge variant="secondary">{row.calculation_method}</Badge></TableCell>
                      <TableCell className="text-right font-mono">
                        {row.default_amount != null ? row.default_amount.toLocaleString('fr-FR') : '—'}
                      </TableCell>
                      <TableCell>{row.currency ?? '—'}</TableCell>
                      <TableCell>{row.vat_rate != null ? `${row.vat_rate}%` : '—'}</TableCell>
                      <TableCell>{row.invoice_type ?? '—'}</TableCell>
                      <TableCell className="text-center">{row.invoice_sequence ?? '—'}</TableCell>
                      <TableCell className="max-w-[120px] truncate text-muted-foreground text-xs">{row.base_reference ?? '—'}</TableCell>
                      <TableCell>{row.is_variable ? <Badge>Var</Badge> : '—'}</TableCell>
                      <TableCell>
                        <Badge variant={row.is_active ? 'default' : 'destructive'}>
                          {row.is_active ? 'Actif' : 'Inactif'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(row)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(row.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Dialog – Create / Edit */}
        <Dialog open={dialogOpen} onOpenChange={v => { if (!v) closeDialog(); }}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? 'Modifier le template' : 'Nouveau template'}</DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
              {/* carrier */}
              <div className="space-y-1">
                <Label>Carrier *</Label>
                <Input value={form.carrier} onChange={e => set('carrier', e.target.value)} />
              </div>
              {/* charge_code */}
              <div className="space-y-1">
                <Label>Code charge *</Label>
                <Input value={form.charge_code} onChange={e => set('charge_code', e.target.value)} />
              </div>
              {/* charge_name */}
              <div className="sm:col-span-2 space-y-1">
                <Label>Nom charge *</Label>
                <Input value={form.charge_name} onChange={e => set('charge_name', e.target.value)} />
              </div>
              {/* calculation_method */}
              <div className="space-y-1">
                <Label>Méthode calcul</Label>
                <Select value={form.calculation_method} onValueChange={v => set('calculation_method', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CALCULATION_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {/* default_amount */}
              <div className="space-y-1">
                <Label>Montant par défaut</Label>
                <Input type="number" value={form.default_amount} onChange={e => set('default_amount', e.target.value)} placeholder="Vide si variable" />
              </div>
              {/* currency */}
              <div className="space-y-1">
                <Label>Devise</Label>
                <Select value={form.currency} onValueChange={v => set('currency', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {/* operation_type */}
              <div className="space-y-1">
                <Label>Type opération</Label>
                <Select value={form.operation_type} onValueChange={v => set('operation_type', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OPERATION_TYPES.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {/* invoice_type */}
              <div className="space-y-1">
                <Label>Type facture</Label>
                <Select value={form.invoice_type} onValueChange={v => set('invoice_type', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INVOICE_TYPES.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {/* invoice_sequence */}
              <div className="space-y-1">
                <Label>Séquence facture</Label>
                <Input type="number" value={form.invoice_sequence} onChange={e => set('invoice_sequence', e.target.value)} />
              </div>
              {/* vat_rate */}
              <div className="space-y-1">
                <Label>Taux TVA (%)</Label>
                <Input type="number" value={form.vat_rate} onChange={e => set('vat_rate', e.target.value)} />
              </div>
              {/* base_reference */}
              <div className="sm:col-span-2 space-y-1">
                <Label>Référence de base</Label>
                <Input value={form.base_reference} onChange={e => set('base_reference', e.target.value)} placeholder="Ex: THC, BL, ISPS…" />
              </div>
              {/* is_variable */}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="is_variable"
                  checked={form.is_variable}
                  onCheckedChange={v => set('is_variable', !!v)}
                />
                <Label htmlFor="is_variable">Ligne variable</Label>
              </div>
              {/* variable_unit */}
              {form.is_variable && (
                <div className="space-y-1">
                  <Label>Unité variable</Label>
                  <Input value={form.variable_unit} onChange={e => set('variable_unit', e.target.value)} placeholder="Ex: tonne, cbm…" />
                </div>
              )}
              {/* effective_date */}
              <div className="space-y-1">
                <Label>Date d'effet</Label>
                <Input type="date" value={form.effective_date} onChange={e => set('effective_date', e.target.value)} />
              </div>
              {/* is_active */}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="is_active"
                  checked={form.is_active}
                  onCheckedChange={v => set('is_active', !!v)}
                />
                <Label htmlFor="is_active">Actif</Label>
              </div>
              {/* source_documents */}
              <div className="sm:col-span-2 space-y-1">
                <Label>Documents source (un par ligne)</Label>
                <Textarea
                  rows={3}
                  value={form.source_documents}
                  onChange={e => set('source_documents', e.target.value)}
                  placeholder="Ex: Facture CMA-CGM 2024&#10;Barème portuaire PAD"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={closeDialog}>Annuler</Button>
              <Button onClick={handleSubmit} disabled={upsert.isPending}>
                {editing ? 'Enregistrer' : 'Créer'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
