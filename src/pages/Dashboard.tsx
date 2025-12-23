import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  Mail, 
  RefreshCw, 
  Plus,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  TrendingUp,
  Filter
} from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import { QuotationRequestCard } from '@/components/QuotationRequestCard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface QuotationRequest {
  id: string;
  subject: string;
  from_address: string;
  received_at: string;
  body_text: string;
  extracted_data: any;
  thread_id?: string;
  attachmentCount?: number;
}

interface Stats {
  pending: number;
  processed: number;
  drafts: number;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<QuotationRequest[]>([]);
  const [stats, setStats] = useState<Stats>({ pending: 0, processed: 0, drafts: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sortBy, setSortBy] = useState<'date' | 'completeness'>('date');

  const fetchData = async () => {
    try {
      // Fetch quotation requests (emails marked as quotation that haven't been processed)
      const { data: emails, error: emailsError } = await supabase
        .from('emails')
        .select('id, subject, from_address, received_at, body_text, extracted_data, thread_id')
        .eq('is_quotation_request', true)
        .order('received_at', { ascending: false })
        .limit(50);

      if (emailsError) throw emailsError;

      // Get attachment counts
      const { data: attachments } = await supabase
        .from('email_attachments')
        .select('email_id');

      const attachmentCounts: Record<string, number> = {};
      attachments?.forEach(att => {
        if (att.email_id) {
          attachmentCounts[att.email_id] = (attachmentCounts[att.email_id] || 0) + 1;
        }
      });

      // Get draft count for processed emails
      const { data: drafts } = await supabase
        .from('email_drafts')
        .select('original_email_id')
        .not('original_email_id', 'is', null);

      const processedEmailIds = new Set(drafts?.map(d => d.original_email_id) || []);

      // Enrich emails with attachment count and filter out processed ones
      const pendingRequests = (emails || [])
        .filter(email => !processedEmailIds.has(email.id))
        .map(email => ({
          ...email,
          attachmentCount: attachmentCounts[email.id] || 0,
        }));

      setRequests(pendingRequests);

      // Calculate stats
      const { count: quotationCount } = await supabase
        .from('emails')
        .select('id', { count: 'exact' })
        .eq('is_quotation_request', true);

      const { count: draftCount } = await supabase
        .from('email_drafts')
        .select('id', { count: 'exact' })
        .eq('status', 'draft');

      setStats({
        pending: pendingRequests.length,
        processed: processedEmailIds.size,
        drafts: draftCount || 0,
      });
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Erreur de chargement des données');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchData();
  };

  const handleProcess = (emailId: string) => {
    // Navigate to the quotation sheet with the email context
    navigate(`/quotation/${emailId}`);
  };

  const handleNewQuotation = () => {
    navigate('/quotation/new');
  };

  // Sort requests
  const sortedRequests = [...requests].sort((a, b) => {
    if (sortBy === 'date') {
      return new Date(b.received_at).getTime() - new Date(a.received_at).getTime();
    }
    // Sort by completeness (more complete first)
    const getCompleteness = (r: QuotationRequest) => {
      const data = r.extracted_data || {};
      const fields = ['cargo', 'origin', 'incoterm'];
      return fields.filter(f => data[f]).length;
    };
    return getCompleteness(b) - getCompleteness(a);
  });

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gradient-gold">Demandes à traiter</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {stats.pending} demande{stats.pending > 1 ? 's' : ''} de cotation en attente
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              Actualiser
            </Button>
            <Button size="sm" onClick={handleNewQuotation}>
              <Plus className="h-4 w-4 mr-2" />
              Nouvelle cotation
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card className="border-border/50 bg-gradient-card">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">En attente</p>
                  <p className="text-2xl font-bold text-amber-500">{stats.pending}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-amber-500/10">
                  <Clock className="h-5 w-5 text-amber-500" />
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="border-border/50 bg-gradient-card">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Traitées</p>
                  <p className="text-2xl font-bold text-green-500">{stats.processed}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-green-500/10">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="border-border/50 bg-gradient-card">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Brouillons</p>
                  <p className="text-2xl font-bold text-ocean">{stats.drafts}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-ocean/10">
                  <FileText className="h-5 w-5 text-ocean" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filter & Sort */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Demandes de cotation
          </h2>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as 'date' | 'completeness')}>
            <SelectTrigger className="w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Trier par" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">Date de réception</SelectItem>
              <SelectItem value="completeness">Complétude</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Requests List */}
        {sortedRequests.length === 0 ? (
          <Card className="border-border/50 bg-gradient-card">
            <CardContent className="py-12">
              <div className="text-center">
                <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-4" />
                <h3 className="text-lg font-medium mb-2">Tout est à jour !</h3>
                <p className="text-muted-foreground mb-4">
                  Aucune demande de cotation en attente de traitement.
                </p>
                <Button onClick={handleNewQuotation}>
                  <Plus className="h-4 w-4 mr-2" />
                  Créer une cotation manuelle
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {sortedRequests.map((request) => (
              <QuotationRequestCard
                key={request.id}
                request={request}
                onProcess={handleProcess}
              />
            ))}
          </div>
        )}
      </div>
    </MainLayout>
  );
}