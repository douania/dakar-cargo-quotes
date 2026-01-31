import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  Search, FileText, ArrowRight, Package, Calendar, DollarSign, 
  Building, MapPin, Copy, Filter, ChevronLeft, ChevronRight
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

interface TariffLine {
  service: string;
  description?: string;
  amount: number;
  currency: string;
  unit?: string;
}

interface QuotationRecord {
  id: string;
  route_origin: string | null;
  route_port: string;
  route_destination: string;
  cargo_type: string;
  container_types: string[] | null;
  client_name: string | null;
  client_company: string | null;
  partner_company: string | null;
  project_name: string | null;
  incoterm: string | null;
  tariff_lines: TariffLine[];
  total_amount: number | null;
  total_currency: string | null;
  margin_percent: number | null;
  created_at: string;
  // Phase 5D
  version?: number;
  status?: string;
  parent_quotation_id?: string;
  root_quotation_id?: string;
}

// Phase 5D: Status helpers
function getStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'draft': return 'Brouillon';
    case 'sent': return 'Envoyé';
    case 'accepted': return 'Accepté';
    case 'rejected': return 'Refusé';
    case 'expired': return 'Expiré';
    default: return 'Inconnu';
  }
}

function getStatusVariant(status: string | null | undefined): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'sent': return 'default';
    case 'accepted': return 'default';
    case 'rejected': return 'destructive';
    case 'draft': return 'outline';
    default: return 'secondary';
  }
}

const PAGE_SIZE = 20;

export default function QuotationHistory() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [cargoFilter, setCargoFilter] = useState<string>('all');
  const [periodFilter, setPeriodFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedQuotation, setSelectedQuotation] = useState<QuotationRecord | null>(null);
  const [page, setPage] = useState(0);

  const { data: quotations = [], isLoading } = useQuery({
    queryKey: ['quotation-history-full'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quotation_history')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return (data || []).map(item => ({
        ...item,
        tariff_lines: (item.tariff_lines as any) || [],
      })) as QuotationRecord[];
    },
  });

  // Get unique cargo types for filter
  const cargoTypes = useMemo(() => 
    [...new Set(quotations.map(q => q.cargo_type))].sort(),
    [quotations]
  );

  // Filter quotations
  const filteredQuotations = useMemo(() => {
    let result = quotations;

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(q => 
        q.route_destination.toLowerCase().includes(query) ||
        q.client_company?.toLowerCase().includes(query) ||
        q.project_name?.toLowerCase().includes(query) ||
        q.partner_company?.toLowerCase().includes(query) ||
        q.route_origin?.toLowerCase().includes(query)
      );
    }

    // Cargo type filter
    if (cargoFilter !== 'all') {
      result = result.filter(q => q.cargo_type === cargoFilter);
    }

    // Period filter
    if (periodFilter !== 'all') {
      const now = new Date();
      const cutoff = new Date();
      switch (periodFilter) {
        case '1m': cutoff.setMonth(now.getMonth() - 1); break;
        case '3m': cutoff.setMonth(now.getMonth() - 3); break;
        case '6m': cutoff.setMonth(now.getMonth() - 6); break;
        case '1y': cutoff.setFullYear(now.getFullYear() - 1); break;
      }
      result = result.filter(q => new Date(q.created_at) >= cutoff);
    }

    // Status filter (Phase 5D)
    if (statusFilter !== 'all') {
      result = result.filter(q => q.status === statusFilter);
    }

    return result;
  }, [quotations, searchQuery, cargoFilter, periodFilter, statusFilter]);

  // Pagination
  const totalPages = Math.ceil(filteredQuotations.length / PAGE_SIZE);
  const paginatedQuotations = filteredQuotations.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const formatAmount = (amount: number | null, currency: string | null) => {
    if (!amount) return '-';
    return new Intl.NumberFormat('fr-FR').format(amount) + ' ' + (currency || 'FCFA');
  };

  const handleUseAsBase = (quotation: QuotationRecord) => {
    // Store quotation data in sessionStorage for QuotationSheet to use
    sessionStorage.setItem('quotation-template', JSON.stringify({
      route_destination: quotation.route_destination,
      cargo_type: quotation.cargo_type,
      container_types: quotation.container_types,
      incoterm: quotation.incoterm,
      tariff_lines: quotation.tariff_lines,
    }));
    toast.success('Modèle chargé');
    navigate('/quotation/new');
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileText className="h-6 w-6 text-primary" />
              Historique des Cotations
            </h1>
            <p className="text-muted-foreground">
              {filteredQuotations.length} cotation{filteredQuotations.length > 1 ? 's' : ''} trouvée{filteredQuotations.length > 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4">
              <div className="flex-1 min-w-[250px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Rechercher par destination, client, projet..."
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
                    className="pl-10"
                  />
                </div>
              </div>
              
              <Select value={cargoFilter} onValueChange={(v) => { setCargoFilter(v); setPage(0); }}>
                <SelectTrigger className="w-[180px]">
                  <Package className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Type cargo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les types</SelectItem>
                  {cargoTypes.map(type => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={periodFilter} onValueChange={(v) => { setPeriodFilter(v); setPage(0); }}>
                <SelectTrigger className="w-[150px]">
                  <Calendar className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Période" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toute période</SelectItem>
                  <SelectItem value="1m">1 mois</SelectItem>
                  <SelectItem value="3m">3 mois</SelectItem>
                  <SelectItem value="6m">6 mois</SelectItem>
                  <SelectItem value="1y">1 an</SelectItem>
                </SelectContent>
              </Select>

              {/* Phase 5D: Status filter */}
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
                <SelectTrigger className="w-[150px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Statut" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous statuts</SelectItem>
                  <SelectItem value="draft">Brouillons</SelectItem>
                  <SelectItem value="sent">Envoyés</SelectItem>
                  <SelectItem value="accepted">Acceptés</SelectItem>
                  <SelectItem value="rejected">Refusés</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Quotations List */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Chargement...</div>
            ) : paginatedQuotations.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                Aucune cotation trouvée
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Route</TableHead>
                      <TableHead>Client / Partenaire</TableHead>
                      <TableHead>Cargo</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead className="text-right">Montant</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedQuotations.map((q) => (
                      <TableRow 
                        key={q.id}
                        className="cursor-pointer hover:bg-accent/50"
                        onClick={() => setSelectedQuotation(q)}
                      >
                        <TableCell className="whitespace-nowrap">
                          {format(new Date(q.created_at), 'dd MMM yyyy', { locale: fr })}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground">{q.route_origin || 'Origin'}</span>
                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            <span className="font-medium">{q.route_destination}</span>
                          </div>
                          {q.incoterm && (
                            <Badge variant="outline" className="text-xs mt-1">
                              {q.incoterm}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            {q.client_company && (
                              <span className="flex items-center gap-1 text-sm">
                                <Building className="h-3 w-3" />
                                {q.client_company}
                              </span>
                            )}
                            {q.partner_company && (
                              <span className="text-xs text-muted-foreground">
                                via {q.partner_company}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge variant="secondary">{q.cargo_type}</Badge>
                            {q.container_types && q.container_types.length > 0 && (
                              <span className="text-xs text-muted-foreground">
                                {q.container_types.join(', ')}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        {/* Phase 5D: Status column */}
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Badge variant={getStatusVariant(q.status)}>
                              {getStatusLabel(q.status)}
                            </Badge>
                            {(q.version ?? 1) > 1 && (
                              <span className="text-xs text-muted-foreground">v{q.version}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatAmount(q.total_amount, q.total_currency)}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUseAsBase(q);
                            }}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between p-4 border-t">
                    <span className="text-sm text-muted-foreground">
                      Page {page + 1} sur {totalPages}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={page === 0}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={page >= totalPages - 1}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Detail Dialog */}
        <Dialog open={!!selectedQuotation} onOpenChange={() => setSelectedQuotation(null)}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            {selectedQuotation && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-primary" />
                    {selectedQuotation.route_origin || 'Origin'} → {selectedQuotation.route_destination}
                  </DialogTitle>
                </DialogHeader>

                <div className="space-y-6">
                  {/* Meta info */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <span className="text-xs text-muted-foreground">Date</span>
                      <p className="font-medium">
                        {format(new Date(selectedQuotation.created_at), 'dd MMM yyyy', { locale: fr })}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Cargo</span>
                      <p className="font-medium">{selectedQuotation.cargo_type}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Incoterm</span>
                      <p className="font-medium">{selectedQuotation.incoterm || '-'}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Conteneurs</span>
                      <p className="font-medium">
                        {selectedQuotation.container_types?.join(', ') || '-'}
                      </p>
                    </div>
                  </div>

                  {/* Client/Partner */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-xs text-muted-foreground">Client</span>
                      <p className="font-medium">{selectedQuotation.client_company || '-'}</p>
                      {selectedQuotation.client_name && (
                        <p className="text-sm text-muted-foreground">{selectedQuotation.client_name}</p>
                      )}
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Partenaire</span>
                      <p className="font-medium">{selectedQuotation.partner_company || '-'}</p>
                    </div>
                  </div>

                  {/* Tariff lines */}
                  {selectedQuotation.tariff_lines.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium mb-2">Lignes tarifaires</h4>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Service</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right">Montant</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedQuotation.tariff_lines.map((line, i) => (
                            <TableRow key={i}>
                              <TableCell className="font-medium">{line.service}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {line.description || '-'}
                              </TableCell>
                              <TableCell className="text-right">
                                {formatAmount(line.amount, line.currency)}
                                {line.unit && <span className="text-xs text-muted-foreground ml-1">/{line.unit}</span>}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {/* Total */}
                  <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                    <span className="font-medium">Total</span>
                    <span className="text-xl font-bold">
                      {formatAmount(selectedQuotation.total_amount, selectedQuotation.total_currency)}
                    </span>
                  </div>

                  {/* Action */}
                  <div className="flex justify-end">
                    <Button onClick={() => handleUseAsBase(selectedQuotation)}>
                      <Copy className="h-4 w-4 mr-2" />
                      Utiliser comme modèle
                    </Button>
                  </div>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
