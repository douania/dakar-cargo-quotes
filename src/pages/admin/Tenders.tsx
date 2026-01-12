import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  FileText, 
  Plus, 
  ChevronRight, 
  Ship, 
  Truck, 
  Package,
  Calendar,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { TenderDetailView } from '@/components/tenders/TenderDetailView';
import { CreateTenderDialog } from '@/components/tenders/CreateTenderDialog';

interface TenderProject {
  id: string;
  reference: string;
  client: string | null;
  tender_type: string | null;
  status: string;
  origin_country: string | null;
  deadline: string | null;
  cargo_summary: {
    total_teus?: number;
    total_vehicles?: number;
    total_tonnes?: number;
    total_cbm?: number;
    contingent_count?: number;
  };
  created_at: string;
}

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  draft: { label: 'Brouillon', color: 'bg-muted text-muted-foreground', icon: Clock },
  in_progress: { label: 'En cours', color: 'bg-blue-100 text-blue-800', icon: RefreshCw },
  submitted: { label: 'Soumis', color: 'bg-amber-100 text-amber-800', icon: FileText },
  won: { label: 'Gagné', color: 'bg-green-100 text-green-800', icon: CheckCircle2 },
  lost: { label: 'Perdu', color: 'bg-red-100 text-red-800', icon: AlertTriangle },
};

export default function TendersAdmin() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(
    searchParams.get('selected')
  );
  const [activeTab, setActiveTab] = useState('all');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const queryClient = useQueryClient();

  const handleTenderCreated = (tenderId: string) => {
    handleSelectTender(tenderId);
  };

  // Handle URL parameter for selected tender
  useEffect(() => {
    const selected = searchParams.get('selected');
    if (selected && selected !== selectedTenderId) {
      setSelectedTenderId(selected);
    }
  }, [searchParams]);

  // Update URL when selection changes
  const handleSelectTender = (tenderId: string | null) => {
    setSelectedTenderId(tenderId);
    if (tenderId) {
      setSearchParams({ selected: tenderId });
    } else {
      setSearchParams({});
    }
  };

  const { data: tenders, isLoading } = useQuery({
    queryKey: ['tender-projects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tender_projects')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as TenderProject[];
    }
  });

  const filteredTenders = tenders?.filter(t => {
    if (activeTab === 'all') return true;
    return t.status === activeTab;
  });

  const getStatusBadge = (status: string) => {
    const config = statusConfig[status] || statusConfig.draft;
    const Icon = config.icon;
    return (
      <Badge className={`${config.color} gap-1`}>
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  if (selectedTenderId) {
    return (
      <MainLayout>
        <TenderDetailView 
          tenderId={selectedTenderId} 
          onBack={() => handleSelectTender(null)} 
        />
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Gestion des Tenders</h1>
            <p className="text-muted-foreground">
              Projets multi-segments avec consolidation des tarifs partenaires
            </p>
          </div>
          <Button className="gap-2" onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4" />
            Nouveau Tender
          </Button>
        </div>

        <CreateTenderDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          onTenderCreated={handleTenderCreated}
        />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="all">Tous ({tenders?.length || 0})</TabsTrigger>
            <TabsTrigger value="draft">Brouillons</TabsTrigger>
            <TabsTrigger value="in_progress">En cours</TabsTrigger>
            <TabsTrigger value="submitted">Soumis</TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-4">
            {isLoading ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map(i => (
                  <Card key={i} className="animate-pulse">
                    <CardHeader className="h-24 bg-muted/50" />
                    <CardContent className="h-32 bg-muted/30" />
                  </Card>
                ))}
              </div>
            ) : filteredTenders?.length === 0 ? (
              <Card className="p-12 text-center">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Aucun tender</h3>
                <p className="text-muted-foreground mb-4">
                  Importez un tender depuis un email ou créez-en un nouveau
                </p>
                <Button variant="outline" className="gap-2" onClick={() => setShowCreateDialog(true)}>
                  <Plus className="h-4 w-4" />
                  Créer un tender
                </Button>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredTenders?.map((tender) => (
                  <Card 
                    key={tender.id} 
                    className="cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => handleSelectTender(tender.id)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-base">{tender.reference}</CardTitle>
                          <CardDescription className="flex items-center gap-1 mt-1">
                            <MapPin className="h-3 w-3" />
                            {tender.client || 'Client non défini'}
                          </CardDescription>
                        </div>
                        {getStatusBadge(tender.status)}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {/* Cargo Summary */}
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        {tender.cargo_summary?.total_teus && (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Package className="h-3.5 w-3.5" />
                            <span>{tender.cargo_summary.total_teus} TEUs</span>
                          </div>
                        )}
                        {tender.cargo_summary?.total_vehicles && (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Truck className="h-3.5 w-3.5" />
                            <span>{tender.cargo_summary.total_vehicles} véhicules</span>
                          </div>
                        )}
                        {tender.cargo_summary?.contingent_count && (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Ship className="h-3.5 w-3.5" />
                            <span>{tender.cargo_summary.contingent_count} contingents</span>
                          </div>
                        )}
                      </div>

                      {/* Deadline */}
                      {tender.deadline && (
                        <div className="flex items-center gap-2 text-sm">
                          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-muted-foreground">
                            Échéance: {format(new Date(tender.deadline), 'dd MMM yyyy', { locale: fr })}
                          </span>
                        </div>
                      )}

                      {/* Origin */}
                      {tender.origin_country && (
                        <Badge variant="outline" className="text-xs">
                          {tender.origin_country}
                        </Badge>
                      )}

                      <div className="flex items-center justify-end pt-2">
                        <Button variant="ghost" size="sm" className="gap-1">
                          Voir détails
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
