import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, differenceInDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  Truck, 
  Plus, 
  Pencil, 
  Trash2, 
  AlertTriangle, 
  CheckCircle2,
  Upload,
  Download,
  Search,
  Filter,
  Calendar,
  MapPin,
  Package,
} from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface TransportRate {
  id: string;
  origin: string;
  destination: string;
  container_type: string;
  cargo_category: string | null;
  rate_amount: number;
  rate_currency: string;
  provider: string | null;
  rate_includes: string[] | null;
  notes: string | null;
  source_document: string | null;
  validity_start: string | null;
  validity_end: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
}

interface RateFormData {
  origin: string;
  destination: string;
  container_type: string;
  cargo_category: string;
  rate_amount: number;
  rate_currency: string;
  provider: string;
  notes: string;
  validity_end: string;
}

export default function TransportRates() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDestination, setFilterDestination] = useState<string>('all');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRate, setEditingRate] = useState<TransportRate | null>(null);
  const [formData, setFormData] = useState<RateFormData>({
    origin: 'Dakar',
    destination: '',
    container_type: '20DV',
    cargo_category: '',
    rate_amount: 0,
    rate_currency: 'XOF',
    provider: '',
    notes: '',
    validity_end: '',
  });

  // Fetch transport rates
  const { data: rates = [], isLoading } = useQuery({
    queryKey: ['transport-rates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('local_transport_rates')
        .select('*')
        .order('destination', { ascending: true })
        .order('container_type', { ascending: true });
      
      if (error) throw error;
      return data as TransportRate[];
    },
  });

  // Add/Update mutation
  const saveMutation = useMutation({
    mutationFn: async (data: RateFormData & { id?: string }) => {
      const payload = {
        origin: data.origin,
        destination: data.destination,
        container_type: data.container_type,
        cargo_category: data.cargo_category || null,
        rate_amount: data.rate_amount,
        rate_currency: data.rate_currency,
        provider: data.provider || null,
        notes: data.notes || null,
        validity_end: data.validity_end || null,
        updated_at: new Date().toISOString(),
      };

      if (data.id) {
        const { error } = await supabase
          .from('local_transport_rates')
          .update(payload)
          .eq('id', data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('local_transport_rates')
          .insert({ ...payload, is_active: true });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transport-rates'] });
      toast.success(editingRate ? 'Tarif mis à jour' : 'Tarif ajouté');
      handleCloseDialog();
    },
    onError: (error) => {
      toast.error(`Erreur: ${error.message}`);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('local_transport_rates')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transport-rates'] });
      toast.success('Tarif supprimé');
    },
    onError: (error) => {
      toast.error(`Erreur: ${error.message}`);
    },
  });

  const handleOpenDialog = (rate?: TransportRate) => {
    if (rate) {
      setEditingRate(rate);
      setFormData({
        origin: rate.origin,
        destination: rate.destination,
        container_type: rate.container_type,
        cargo_category: rate.cargo_category || '',
        rate_amount: rate.rate_amount,
        rate_currency: rate.rate_currency || 'XOF',
        provider: rate.provider || '',
        notes: rate.notes || '',
        validity_end: rate.validity_end || '',
      });
    } else {
      setEditingRate(null);
      setFormData({
        origin: 'Dakar',
        destination: '',
        container_type: '20DV',
        cargo_category: '',
        rate_amount: 0,
        rate_currency: 'XOF',
        provider: '',
        notes: '',
        validity_end: '',
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingRate(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({
      ...formData,
      id: editingRate?.id,
    });
  };

  const handleDelete = (id: string) => {
    if (confirm('Êtes-vous sûr de vouloir supprimer ce tarif ?')) {
      deleteMutation.mutate(id);
    }
  };

  // Get rate freshness status
  const getRateFreshness = (rate: TransportRate) => {
    const updatedAt = rate.updated_at || rate.created_at;
    const daysSinceUpdate = differenceInDays(new Date(), new Date(updatedAt));
    
    if (rate.validity_end && new Date(rate.validity_end) < new Date()) {
      return { status: 'expired', label: 'Expiré', color: 'bg-red-100 text-red-800' };
    }
    if (daysSinceUpdate > 180) {
      return { status: 'old', label: '> 6 mois', color: 'bg-amber-100 text-amber-800' };
    }
    if (daysSinceUpdate > 90) {
      return { status: 'aging', label: '> 3 mois', color: 'bg-yellow-100 text-yellow-800' };
    }
    return { status: 'fresh', label: 'À jour', color: 'bg-green-100 text-green-800' };
  };

  // Filter rates
  const filteredRates = rates.filter(rate => {
    const matchesSearch = 
      rate.destination.toLowerCase().includes(searchTerm.toLowerCase()) ||
      rate.origin.toLowerCase().includes(searchTerm.toLowerCase()) ||
      rate.container_type.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesDestination = filterDestination === 'all' || 
      rate.destination.toLowerCase().includes(filterDestination.toLowerCase());
    
    return matchesSearch && matchesDestination;
  });

  // Get unique destinations for filter
  const destinations = [...new Set(rates.map(r => r.destination))].sort();

  // Stats
  const stats = {
    total: rates.length,
    expired: rates.filter(r => getRateFreshness(r).status === 'expired').length,
    old: rates.filter(r => getRateFreshness(r).status === 'old').length,
    fresh: rates.filter(r => getRateFreshness(r).status === 'fresh').length,
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('fr-FR').format(amount) + ' ' + currency;
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Truck className="h-6 w-6" />
              Tarifs Transport
            </h1>
            <p className="text-muted-foreground">
              Gestion des tarifs de transport routier
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2">
              <Upload className="h-4 w-4" />
              Importer Excel
            </Button>
            <Button variant="outline" className="gap-2">
              <Download className="h-4 w-4" />
              Exporter
            </Button>
            <Button onClick={() => handleOpenDialog()} className="gap-2">
              <Plus className="h-4 w-4" />
              Nouveau Tarif
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total tarifs</p>
                  <p className="text-2xl font-bold">{stats.total}</p>
                </div>
                <Package className="h-8 w-8 text-muted-foreground/50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">À jour</p>
                  <p className="text-2xl font-bold text-green-600">{stats.fresh}</p>
                </div>
                <CheckCircle2 className="h-8 w-8 text-green-500/50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">&gt; 6 mois</p>
                  <p className="text-2xl font-bold text-amber-600">{stats.old}</p>
                </div>
                <AlertTriangle className="h-8 w-8 text-amber-500/50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Expirés</p>
                  <p className="text-2xl font-bold text-red-600">{stats.expired}</p>
                </div>
                <AlertTriangle className="h-8 w-8 text-red-500/50" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex gap-4 items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filterDestination} onValueChange={setFilterDestination}>
            <SelectTrigger className="w-48">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Destination" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes destinations</SelectItem>
              <SelectItem value="mali">Mali</SelectItem>
              <SelectItem value="burkina">Burkina Faso</SelectItem>
              <SelectItem value="dakar">Dakar</SelectItem>
              {destinations.map(dest => (
                <SelectItem key={dest} value={dest.toLowerCase()}>{dest}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Rates Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Corridor</TableHead>
                  <TableHead>Conteneur</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead className="text-right">Tarif</TableHead>
                  <TableHead>Prestataire</TableHead>
                  <TableHead>Fraîcheur</TableHead>
                  <TableHead>Mis à jour</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      Chargement...
                    </TableCell>
                  </TableRow>
                ) : filteredRates.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      Aucun tarif trouvé
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRates.map((rate) => {
                    const freshness = getRateFreshness(rate);
                    return (
                      <TableRow key={rate.id}>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-muted-foreground" />
                            <span className="font-medium">{rate.origin}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="font-medium">{rate.destination}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{rate.container_type}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {rate.cargo_category || '-'}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {formatCurrency(rate.rate_amount, rate.rate_currency || 'XOF')}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {rate.provider || '-'}
                        </TableCell>
                        <TableCell>
                          <Badge className={freshness.color}>
                            {freshness.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {rate.updated_at 
                            ? format(new Date(rate.updated_at), 'dd/MM/yyyy', { locale: fr })
                            : format(new Date(rate.created_at), 'dd/MM/yyyy', { locale: fr })
                          }
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleOpenDialog(rate)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(rate.id)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
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

        {/* Add/Edit Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {editingRate ? 'Modifier le tarif' : 'Nouveau tarif transport'}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Origine</Label>
                  <Input
                    value={formData.origin}
                    onChange={(e) => setFormData({ ...formData, origin: e.target.value })}
                    placeholder="Dakar"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Destination *</Label>
                  <Input
                    value={formData.destination}
                    onChange={(e) => setFormData({ ...formData, destination: e.target.value })}
                    placeholder="Bamako, Mali"
                    required
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Type conteneur</Label>
                  <Select
                    value={formData.container_type}
                    onValueChange={(v) => setFormData({ ...formData, container_type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="20DV">20' DRY</SelectItem>
                      <SelectItem value="40DV">40' DRY</SelectItem>
                      <SelectItem value="40HC">40' HC</SelectItem>
                      <SelectItem value="20RF">20' REEFER</SelectItem>
                      <SelectItem value="40RF">40' REEFER</SelectItem>
                      <SelectItem value="FLATBED">Plateau</SelectItem>
                      <SelectItem value="LOWBED">Lowbed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Catégorie cargo</Label>
                  <Input
                    value={formData.cargo_category}
                    onChange={(e) => setFormData({ ...formData, cargo_category: e.target.value })}
                    placeholder="Standard, OOG..."
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Montant *</Label>
                  <Input
                    type="number"
                    value={formData.rate_amount}
                    onChange={(e) => setFormData({ ...formData, rate_amount: Number(e.target.value) })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Devise</Label>
                  <Select
                    value={formData.rate_currency}
                    onValueChange={(v) => setFormData({ ...formData, rate_currency: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="XOF">FCFA</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>Prestataire</Label>
                <Input
                  value={formData.provider}
                  onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
                  placeholder="Nom du transporteur"
                />
              </div>
              
              <div className="space-y-2">
                <Label>Date de validité (fin)</Label>
                <Input
                  type="date"
                  value={formData.validity_end}
                  onChange={(e) => setFormData({ ...formData, validity_end: e.target.value })}
                />
              </div>
              
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Conditions, inclusions..."
                  rows={2}
                />
              </div>
              
              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleCloseDialog}>
                  Annuler
                </Button>
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? 'Enregistrement...' : editingRate ? 'Mettre à jour' : 'Ajouter'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
