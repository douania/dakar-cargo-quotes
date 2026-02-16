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
  Filter,
  WifiOff,
  Search
} from 'lucide-react';
import { withTimeout } from '@/lib/fetchWithRetry';
import { MainLayout } from '@/components/layout/MainLayout';
import { QuotationRequestCard } from '@/components/QuotationRequestCard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CaseCard } from '@/components/dashboard/CaseCard';
import type { QuoteCaseData } from '@/hooks/useQuoteCaseData';

interface QuotationRequest {
  id: string;
  subject: string;
  from_address: string;
  received_at: string;
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
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'date' | 'completeness'>('date');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<QuotationRequest[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [activeCases, setActiveCases] = useState<QuoteCaseData[]>([]);
  const [clientNames, setClientNames] = useState<Record<string, string>>({});

  const fetchData = async () => {
    setFetchError(null);
    try {
      // Fetch quotation requests and active cases in parallel
      const [emailsResult, casesResult] = await Promise.all([
        withTimeout(
          supabase
            .from('emails')
            .select('id, subject, from_address, received_at, extracted_data, thread_id, body_text')
            .eq('is_quotation_request', true)
            .order('received_at', { ascending: false })
            .limit(100)
        ),
        withTimeout(
          supabase
            .from('quote_cases')
            .select('id, thread_id, status, request_type, priority, puzzle_completeness, created_at, updated_at')
            .not('status', 'in', '(SENT,ARCHIVED)')
            .is('thread_id', null)
            .order('updated_at', { ascending: false })
            .limit(50)
        ),
      ]);

      const { data: emails, error: emailsError } = emailsResult;
      if (emailsError) throw emailsError;

      const { data: cases } = casesResult;
      const typedCases = (cases as QuoteCaseData[]) || [];
      setActiveCases(typedCases);

      // Fetch client names from quote_facts
      if (typedCases.length > 0) {
        const caseIds = typedCases.map(c => c.id);
        const { data: clientFacts } = await supabase
          .from('quote_facts')
          .select('case_id, value_text')
          .in('case_id', caseIds)
          .eq('fact_key', 'contacts.client_company')
          .eq('is_current', true);
        const names: Record<string, string> = {};
        clientFacts?.forEach(f => { if (f.case_id && f.value_text) names[f.case_id] = f.value_text; });
        setClientNames(names);
      }


      // Get attachment counts
      const { data: attachments } = await withTimeout(
        supabase
          .from('email_attachments')
          .select('email_id')
      );

      const attachmentCounts: Record<string, number> = {};
      attachments?.forEach(att => {
        if (att.email_id) {
          attachmentCounts[att.email_id] = (attachmentCounts[att.email_id] || 0) + 1;
        }
      });

      // Get SENT drafts only
      const { data: sentDrafts } = await withTimeout(
        supabase
          .from('email_drafts')
          .select('original_email_id')
          .eq('status', 'sent')
          .not('original_email_id', 'is', null)
      );

      const sentEmailIds = new Set(sentDrafts?.map(d => d.original_email_id) || []);

      const pendingRequests = (emails || [])
        .filter(email => !sentEmailIds.has(email.id))
        .map(email => ({
          ...email,
          attachmentCount: attachmentCounts[email.id] || 0,
        }));

      setRequests(pendingRequests);

      // Calculate stats
      const { count: quotationCount } = await withTimeout(
        supabase
          .from('emails')
          .select('id', { count: 'exact' })
          .eq('is_quotation_request', true)
      );

      const { count: draftCount } = await withTimeout(
        supabase
          .from('email_drafts')
          .select('id', { count: 'exact' })
          .eq('status', 'draft')
      );

      setStats({
        pending: pendingRequests.length,
        processed: sentEmailIds.size,
        drafts: draftCount || 0,
      });
    } catch (error: any) {
      console.error('Error fetching data:', error);
      const msg = error?.message?.includes('timeout')
        ? 'Connexion lente — le serveur ne répond pas'
        : 'Erreur de chargement des données';
      setFetchError(msg);
      // Don't clear existing data on error
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Server-side search with debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const q = searchQuery.trim();
        const { data, error } = await withTimeout(
          supabase
            .from('emails')
            .select('id, subject, from_address, received_at, extracted_data, thread_id, body_text')
            .eq('is_quotation_request', true)
            .or(`subject.ilike.%${q}%,from_address.ilike.%${q}%,body_text.ilike.%${q}%,body_html.ilike.%${q}%`)
            .order('received_at', { ascending: false })
            .limit(50)
        );
        if (error) throw error;

        // Get attachment counts for search results
        const ids = (data || []).map(e => e.id);
        const { data: atts } = ids.length > 0
          ? await supabase.from('email_attachments').select('email_id').in('email_id', ids)
          : { data: [] };
        const attCounts: Record<string, number> = {};
        atts?.forEach(a => { if (a.email_id) attCounts[a.email_id] = (attCounts[a.email_id] || 0) + 1; });

        // Filter out already-sent
        const { data: sentDrafts } = await supabase
          .from('email_drafts')
          .select('original_email_id')
          .eq('status', 'sent')
          .not('original_email_id', 'is', null);
        const sentIds = new Set(sentDrafts?.map(d => d.original_email_id) || []);

        setSearchResults(
          (data || [])
            .filter(e => !sentIds.has(e.id))
            .map(e => ({ ...e, attachmentCount: attCounts[e.id] || 0 }))
        );
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchData();
  };

  const handleProcess = (emailId: string) => {
    navigate(`/quotation/${emailId}`);
  };

  const handleNewQuotation = () => {
    navigate('/quotation/new');
  };

  // Use search results when searching, otherwise use all requests
  const displayRequests = searchResults !== null ? searchResults : requests;

  const sortedRequests = [...displayRequests].sort((a, b) => {
    if (sortBy === 'date') {
      return new Date(b.received_at).getTime() - new Date(a.received_at).getTime();
    }
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
        {/* Error banner */}
        {fetchError && (
          <Card className="border-destructive/50 bg-destructive/5 mb-6">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <WifiOff className="h-5 w-5 text-destructive" />
                  <div>
                    <p className="font-medium text-destructive">{fetchError}</p>
                    <p className="text-sm text-muted-foreground">Les données affichées peuvent ne pas être à jour.</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                  Réessayer
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
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
                  <p className="text-sm text-muted-foreground">Dossiers actifs</p>
                  <p className="text-2xl font-bold text-primary">{activeCases.length}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-primary/10">
                  <FileText className="h-5 w-5 text-primary" />
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

        {/* Active Cases Section */}
        {activeCases.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
              <FileText className="h-5 w-5 text-primary" />
              Dossiers en cours
            </h2>
            <div className="space-y-2">
              {activeCases.map((c) => (
                <CaseCard key={c.id} caseData={c} clientName={clientNames[c.id]} />
              ))}
            </div>
          </div>
        )}

        {/* Filter & Sort */}
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Demandes de cotation
          </h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              {isSearching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
              <Input
                placeholder="Rechercher par nom, sujet, contenu..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-[250px] pl-8"
              />
            </div>
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