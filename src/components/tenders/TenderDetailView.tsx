import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ArrowLeft, 
  FileText, 
  Ship, 
  Truck, 
  Package,
  MapPin,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ExternalLink,
  Calendar
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { TenderSegmentCard } from './TenderSegmentCard';
import { TenderContingentTable } from './TenderContingentTable';

interface TenderDetailViewProps {
  tenderId: string;
  onBack: () => void;
}

interface TenderSegment {
  id: string;
  segment_order: number;
  segment_type: string;
  origin_location: string;
  destination_location: string;
  partner_company: string | null;
  rate_per_unit: number | null;
  rate_unit: string | null;
  currency: string;
  status: string;
  inclusions: string[];
  exclusions: string[];
  additional_charges: Record<string, unknown>;
  source_email_id: string | null;
  source_learned_knowledge_id: string | null;
}

interface TenderContingent {
  id: string;
  contingent_name: string;
  origin_location: string | null;
  destination_port: string | null;
  destination_site: string | null;
  cargo_teus: number;
  cargo_vehicles: number;
  cargo_tonnes: number;
  cargo_cbm: number;
  deadline_ddd: string | null;
  status: string;
  total_cost_estimate: number | null;
  selling_price: number | null;
}

export function TenderDetailView({ tenderId, onBack }: TenderDetailViewProps) {
  const { data: tender, isLoading: tenderLoading } = useQuery({
    queryKey: ['tender-project', tenderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tender_projects')
        .select('*')
        .eq('id', tenderId)
        .single();
      
      if (error) throw error;
      return data;
    }
  });

  const { data: segments } = useQuery({
    queryKey: ['tender-segments', tenderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tender_segments')
        .select('*')
        .eq('tender_id', tenderId)
        .order('segment_order');
      
      if (error) throw error;
      return data as TenderSegment[];
    }
  });

  const { data: contingents } = useQuery({
    queryKey: ['tender-contingents', tenderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tender_contingents')
        .select('*')
        .eq('tender_id', tenderId)
        .order('contingent_name');
      
      if (error) throw error;
      return data as TenderContingent[];
    }
  });

  const getSegmentStatusInfo = () => {
    if (!segments || segments.length === 0) return { confirmed: 0, pending: 0, total: 0 };
    
    const confirmed = segments.filter(s => s.status === 'confirmed' && s.rate_per_unit).length;
    const pending = segments.filter(s => s.status === 'pending' || !s.rate_per_unit).length;
    
    return { confirmed, pending, total: segments.length };
  };

  const statusInfo = getSegmentStatusInfo();

  if (tenderLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{tender?.reference}</h1>
            <p className="text-muted-foreground flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              {tender?.client || 'Client non défini'} • {tender?.origin_country}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2">
            <FileText className="h-4 w-4" />
            Générer offre
          </Button>
        </div>
      </div>

      {/* Status Overview */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{statusInfo.confirmed}</p>
                <p className="text-sm text-muted-foreground">Segments confirmés</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100">
                <HelpCircle className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{statusInfo.pending}</p>
                <p className="text-sm text-muted-foreground">À demander</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100">
                <Ship className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{contingents?.length || 0}</p>
                <p className="text-sm text-muted-foreground">Contingents</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100">
                <Calendar className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {tender?.deadline 
                    ? format(new Date(tender.deadline), 'dd/MM', { locale: fr })
                    : '-'
                  }
                </p>
                <p className="text-sm text-muted-foreground">Échéance</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="segments">
        <TabsList>
          <TabsTrigger value="segments" className="gap-2">
            <Truck className="h-4 w-4" />
            Segments ({segments?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="contingents" className="gap-2">
            <Package className="h-4 w-4" />
            Contingents ({contingents?.length || 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="segments" className="mt-4 space-y-4">
          {segments && segments.length > 0 ? (
            <div className="space-y-4">
              {/* Visual Pipeline */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Pipeline Multi-Segments</CardTitle>
                  <CardDescription>
                    Visualisation des legs du transport avec statut des tarifs
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 overflow-x-auto pb-2">
                    {segments.map((segment, idx) => (
                      <div key={segment.id} className="flex items-center">
                        <TenderSegmentCard segment={segment} compact />
                        {idx < segments.length - 1 && (
                          <div className="w-8 h-0.5 bg-muted mx-2" />
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Detailed Segment Cards */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {segments.map((segment) => (
                  <TenderSegmentCard key={segment.id} segment={segment} />
                ))}
              </div>
            </div>
          ) : (
            <Card className="p-8 text-center">
              <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">Aucun segment défini</h3>
              <p className="text-muted-foreground mb-4">
                Analysez le tender pour extraire automatiquement les segments
              </p>
              <Button variant="outline">Analyser le tender</Button>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="contingents" className="mt-4">
          {contingents && contingents.length > 0 ? (
            <TenderContingentTable contingents={contingents} />
          ) : (
            <Card className="p-8 text-center">
              <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">Aucun contingent</h3>
              <p className="text-muted-foreground">
                Importez les contingents depuis le PDF tender
              </p>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
