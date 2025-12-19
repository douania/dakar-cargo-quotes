import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Ship, FileText, AlertCircle, Filter } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

interface PortTariff {
  id: string;
  provider: string;
  category: string;
  operation_type: string;
  classification: string;
  cargo_type: string | null;
  amount: number;
  unit: string;
  surcharge_percent: number;
  surcharge_conditions: string | null;
  source_document: string | null;
  effective_date: string;
  expiry_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

type TariffFormData = Omit<PortTariff, 'id' | 'created_at' | 'updated_at'>;

const PROVIDERS = ['DP_WORLD', 'PAD', 'SODATRA', 'AIBD'];
const CATEGORIES = ['THC', 'MAGASINAGE', 'RELEVAGE', 'MANUTENTION', 'HONORAIRES', 'FRET'];
const OPERATIONS = ['EXPORT', 'IMPORT', 'TRANSIT'];
const CARGO_TYPES = ['CONTENEUR_20', 'CONTENEUR_40', 'CONTENEUR_FRIGO', 'CONTENEUR_VIDE', 'CONTENEUR_OOG', 'BREAKBULK', 'RORO', 'VEHICULE'];

export default function PortTariffsAdmin() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTariff, setEditingTariff] = useState<PortTariff | null>(null);
  const [filterProvider, setFilterProvider] = useState<string>('all');
  const [filterOperation, setFilterOperation] = useState<string>('all');

  const [formData, setFormData] = useState<TariffFormData>({
    provider: 'DP_WORLD',
    category: 'THC',
    operation_type: 'IMPORT',
    classification: '',
    cargo_type: 'CONTENEUR_20',
    amount: 0,
    unit: 'EVP',
    surcharge_percent: 0,
    surcharge_conditions: '',
    source_document: '',
    effective_date: new Date().toISOString().split('T')[0],
    expiry_date: null,
    is_active: true,
  });

  const { data: tariffs, isLoading } = useQuery({
    queryKey: ['port-tariffs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('port_tariffs')
        .select('*')
        .order('provider')
        .order('operation_type')
        .order('classification');
      
      if (error) throw error;
      return data as PortTariff[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: TariffFormData) => {
      const { error } = await supabase.from('port_tariffs').insert(data);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['port-tariffs'] });
      toast.success('Tarif créé avec succès');
      setIsDialogOpen(false);
      resetForm();
    },
    onError: (error) => {
      toast.error('Erreur lors de la création: ' + error.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<TariffFormData> }) => {
      const { error } = await supabase.from('port_tariffs').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['port-tariffs'] });
      toast.success('Tarif mis à jour');
      setIsDialogOpen(false);
      setEditingTariff(null);
      resetForm();
    },
    onError: (error) => {
      toast.error('Erreur: ' + error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('port_tariffs').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['port-tariffs'] });
      toast.success('Tarif supprimé');
    },
    onError: (error) => {
      toast.error('Erreur: ' + error.message);
    },
  });

  const resetForm = () => {
    setFormData({
      provider: 'DP_WORLD',
      category: 'THC',
      operation_type: 'IMPORT',
      classification: '',
      cargo_type: 'CONTENEUR_20',
      amount: 0,
      unit: 'EVP',
      surcharge_percent: 0,
      surcharge_conditions: '',
      source_document: '',
      effective_date: new Date().toISOString().split('T')[0],
      expiry_date: null,
      is_active: true,
    });
  };

  const handleEdit = (tariff: PortTariff) => {
    setEditingTariff(tariff);
    setFormData({
      provider: tariff.provider,
      category: tariff.category,
      operation_type: tariff.operation_type,
      classification: tariff.classification,
      cargo_type: tariff.cargo_type,
      amount: tariff.amount,
      unit: tariff.unit,
      surcharge_percent: tariff.surcharge_percent,
      surcharge_conditions: tariff.surcharge_conditions,
      source_document: tariff.source_document,
      effective_date: tariff.effective_date,
      expiry_date: tariff.expiry_date,
      is_active: tariff.is_active,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingTariff) {
      updateMutation.mutate({ id: editingTariff.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const filteredTariffs = tariffs?.filter((t) => {
    if (filterProvider !== 'all' && t.provider !== filterProvider) return false;
    if (filterOperation !== 'all' && t.operation_type !== filterOperation) return false;
    return true;
  });

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('fr-FR').format(amount) + ' FCFA';
  };

  const getProviderColor = (provider: string) => {
    switch (provider) {
      case 'DP_WORLD': return 'bg-blue-500';
      case 'PAD': return 'bg-green-500';
      case 'SODATRA': return 'bg-purple-500';
      default: return 'bg-gray-500';
    }
  };

  const getOperationColor = (op: string) => {
    switch (op) {
      case 'EXPORT': return 'bg-orange-500';
      case 'IMPORT': return 'bg-emerald-500';
      case 'TRANSIT': return 'bg-cyan-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Ship className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Tarifs Portuaires Officiels</h1>
              <p className="text-muted-foreground">
                THC, magasinage, manutention - Sources officielles
              </p>
            </div>
          </div>

          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) {
              setEditingTariff(null);
              resetForm();
            }
          }}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Nouveau tarif
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingTariff ? 'Modifier le tarif' : 'Ajouter un tarif'}
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Fournisseur</Label>
                    <Select value={formData.provider} onValueChange={(v) => setFormData({ ...formData, provider: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PROVIDERS.map((p) => (
                          <SelectItem key={p} value={p}>{p.replace('_', ' ')}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Catégorie</Label>
                    <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Type d'opération</Label>
                    <Select value={formData.operation_type} onValueChange={(v) => setFormData({ ...formData, operation_type: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OPERATIONS.map((o) => (
                          <SelectItem key={o} value={o}>{o}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Type de cargo</Label>
                    <Select value={formData.cargo_type || ''} onValueChange={(v) => setFormData({ ...formData, cargo_type: v || null })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Sélectionner..." />
                      </SelectTrigger>
                      <SelectContent>
                        {CARGO_TYPES.map((c) => (
                          <SelectItem key={c} value={c}>{c.replace(/_/g, ' ')}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label>Classification / Description</Label>
                  <Input
                    value={formData.classification}
                    onChange={(e) => setFormData({ ...formData, classification: e.target.value })}
                    placeholder="Ex: Standard, Coton Mali, Reefer..."
                    required
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label>Montant (FCFA)</Label>
                    <Input
                      type="number"
                      value={formData.amount}
                      onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                      required
                    />
                  </div>
                  <div>
                    <Label>Unité</Label>
                    <Input
                      value={formData.unit}
                      onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                      placeholder="EVP, TONNE, JOUR..."
                    />
                  </div>
                  <div>
                    <Label>Surcharge (%)</Label>
                    <Input
                      type="number"
                      value={formData.surcharge_percent}
                      onChange={(e) => setFormData({ ...formData, surcharge_percent: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                </div>

                <div>
                  <Label>Conditions de surcharge</Label>
                  <Input
                    value={formData.surcharge_conditions || ''}
                    onChange={(e) => setFormData({ ...formData, surcharge_conditions: e.target.value })}
                    placeholder="Ex: Produits dangereux, Hors gabarit..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Document source</Label>
                    <Input
                      value={formData.source_document || ''}
                      onChange={(e) => setFormData({ ...formData, source_document: e.target.value })}
                      placeholder="Ex: DPW_TARIFS_2025.pdf"
                    />
                  </div>
                  <div>
                    <Label>Date d'entrée en vigueur</Label>
                    <Input
                      type="date"
                      value={formData.effective_date}
                      onChange={(e) => setFormData({ ...formData, effective_date: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_active"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="rounded"
                  />
                  <Label htmlFor="is_active">Tarif actif</Label>
                </div>

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Annuler
                  </Button>
                  <Button type="submit">
                    {editingTariff ? 'Mettre à jour' : 'Créer'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Filters */}
        <div className="flex gap-4 mb-6">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={filterProvider} onValueChange={setFilterProvider}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Fournisseur" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous fournisseurs</SelectItem>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p} value={p}>{p.replace('_', ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Select value={filterOperation} onValueChange={setFilterOperation}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Opération" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes</SelectItem>
              {OPERATIONS.map((o) => (
                <SelectItem key={o} value={o}>{o}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-card rounded-lg p-4 border">
            <p className="text-sm text-muted-foreground">Total tarifs</p>
            <p className="text-2xl font-bold">{tariffs?.length || 0}</p>
          </div>
          <div className="bg-card rounded-lg p-4 border">
            <p className="text-sm text-muted-foreground">DP World</p>
            <p className="text-2xl font-bold text-blue-500">
              {tariffs?.filter(t => t.provider === 'DP_WORLD').length || 0}
            </p>
          </div>
          <div className="bg-card rounded-lg p-4 border">
            <p className="text-sm text-muted-foreground">PAD</p>
            <p className="text-2xl font-bold text-green-500">
              {tariffs?.filter(t => t.provider === 'PAD').length || 0}
            </p>
          </div>
          <div className="bg-card rounded-lg p-4 border">
            <p className="text-sm text-muted-foreground">SODATRA</p>
            <p className="text-2xl font-bold text-purple-500">
              {tariffs?.filter(t => t.provider === 'SODATRA').length || 0}
            </p>
          </div>
        </div>

        {/* Table */}
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fournisseur</TableHead>
                <TableHead>Opération</TableHead>
                <TableHead>Classification</TableHead>
                <TableHead>Cargo</TableHead>
                <TableHead className="text-right">Montant</TableHead>
                <TableHead>Surcharge</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Validité</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    Chargement...
                  </TableCell>
                </TableRow>
              ) : filteredTariffs?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    Aucun tarif trouvé
                  </TableCell>
                </TableRow>
              ) : (
                filteredTariffs?.map((tariff) => (
                  <TableRow key={tariff.id} className={!tariff.is_active ? 'opacity-50' : ''}>
                    <TableCell>
                      <Badge className={getProviderColor(tariff.provider)}>
                        {tariff.provider.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`${getOperationColor(tariff.operation_type)} text-white`}>
                        {tariff.operation_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {tariff.classification}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {tariff.cargo_type?.replace(/_/g, ' ') || '-'}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {formatAmount(tariff.amount)}
                    </TableCell>
                    <TableCell>
                      {tariff.surcharge_percent > 0 && (
                        <span className="text-orange-500 text-sm">
                          +{tariff.surcharge_percent}%
                          {tariff.surcharge_conditions && (
                            <span className="block text-xs text-muted-foreground">
                              {tariff.surcharge_conditions}
                            </span>
                          )}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {tariff.source_document && (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <FileText className="h-3 w-3" />
                          {tariff.source_document}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {format(new Date(tariff.effective_date), 'dd/MM/yyyy', { locale: fr })}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleEdit(tariff)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => {
                            if (confirm('Supprimer ce tarif ?')) {
                              deleteMutation.mutate(tariff.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Info box */}
        <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5" />
            <div>
              <p className="font-medium text-amber-800 dark:text-amber-200">
                Tarifs officiels uniquement
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                Ces tarifs sont utilisés par l'IA pour générer des cotations exactes. 
                Assurez-vous de mettre à jour les montants lorsque les arrêtés ministériels changent.
                Le document source de référence actuel est : <strong>DPW_TARIFS_2025_0001.pdf</strong>
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}