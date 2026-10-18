import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Mail, 
  RefreshCw, 
  Plus,
  Loader2,
  CheckCircle2,
  Clock,
  FileText,
  Filter,
  WifiOff,
  Search
} from 'lucide-react';
import { withTimeout } from '@/lib/fetchWithRetry';
import { uniqueRows } from '@/lib/email/readPages';
import { readActiveCases, readSentEmailIds, readRequestPage, readRequestAttachmentCounts, readCaseClientNames, pendingRequests } from '@/lib/email/requestListReads';
import { MainLayout } from '@/components/layout/MainLayout';
import { QuotationThreadCard } from '@/components/QuotationThreadCard';
import type { ThreadGroup, MergedExtractedData } from '@/components/QuotationThreadCard';
import { groupEmailsByThread, type RawEmail } from '@/lib/email/threadGroups';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { CaseCard } from '@/components/dashboard/CaseCard';
import type { QuoteCaseData } from '@/hooks/useQuoteCaseData';

interface Stats {
  pending: number;
  processed: number;
  drafts: number;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<RawEmail[]>([]);
  const [attachmentCounts, setAttachmentCounts] = useState<Record<string, number>>({});
  const [stats, setStats] = useState<Stats>({ pending: 0, processed: 0, drafts: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'date' | 'completeness'>('date');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RawEmail[] | null>(null);
  const [searchAttCounts, setSearchAttCounts] = useState<Record<string, number>>({});
  const [isSearching, setIsSearching] = useState(false);
  const [activeCases, setActiveCases] = useState<QuoteCaseData[]>([]);
  const [clientNames, setClientNames] = useState<Record<string, string>>({});

  const fetchGeneration = useRef(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loadedCount, setLoadedCount] = useState(0);
  const [emailTotal, setEmailTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [caseLimit, setCaseLimit] = useState(50);
  const [searchOffset, setSearchOffset] = useState(0);
  const [searchNextOffset, setSearchNextOffset] = useState<number | null>(null);
  const [searchLoaded, setSearchLoaded] = useState(0);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchRetry, setSearchRetry] = useState(0);
  const [composing, setComposing] = useState(false);

  const fetchData = async (append = false) => {
    const generation = ++fetchGeneration.current;
    setFetchError(null);
    if (append) setLoadingMore(true);
    try {
      const offset = append ? nextOffset : 0;
      if (offset === null) return;
      const [page, cases, sentIds, draftResult] = await Promise.all([
        readRequestPage(offset), readActiveCases(), readSentEmailIds(),
        withTimeout(supabase.from('email_drafts').select('id', { count: 'exact', head: true }).eq('status', 'draft')),
      ]);
      if (draftResult.error || draftResult.count === null) throw new Error('Lecture des brouillons impossible');
      const [counts, names] = await Promise.all([
        readRequestAttachmentCounts(page.rows.map(email => email.id)), readCaseClientNames(cases.map(item => item.id)),
      ]);
      if (generation !== fetchGeneration.current) return;
      const currentCases = cases as QuoteCaseData[];
      // Re-filter acquired rows too: a case may have been created since the previous page.
      setRequests(previous => pendingRequests(uniqueRows(append ? [...previous, ...page.rows] : page.rows), cases, sentIds));
      setActiveCases(currentCases); setClientNames(names);
      setAttachmentCounts(previous => append ? { ...previous, ...counts } : counts);
      setNextOffset(page.nextOffset); setLoadedCount(offset + page.rows.length); setEmailTotal(page.total);
      setStats(previous => ({ ...previous, processed: sentIds.size, drafts: draftResult.count! }));
    } catch {
      if (generation === fetchGeneration.current) setFetchError('Erreur de chargement des données ; la lecture reste incomplète');
    } finally {
      if (generation === fetchGeneration.current) { setIsLoading(false); setIsRefreshing(false); setLoadingMore(false); }
    }
  };

  const initialLoad = useRef(fetchData);
  const cancelLoad = useCallback(() => { fetchGeneration.current++; }, []);
  useEffect(() => { void initialLoad.current(); return cancelLoad; }, [cancelLoad]);

  // Cleanup invalidates in-flight requests as well as the debounce timer.
  useEffect(() => {
    let canceled = false;
    if (!searchQuery.trim() || composing) {
      setSearchResults(null); setSearchError(null); setIsSearching(false); setSearchNextOffset(null);
      return;
    }
    setIsSearching(true); setSearchError(null);
    if (searchOffset === 0) { setSearchResults([]); setSearchAttCounts({}); setSearchLoaded(0); setSearchTotal(0); setSearchNextOffset(null); }
    const timer = setTimeout(async () => {
      try {
        const [page, cases, sent] = await Promise.all([readRequestPage(searchOffset, searchQuery), readActiveCases(), readSentEmailIds()]);
        const counts = await readRequestAttachmentCounts(page.rows.map(email => email.id));
        if (canceled) return;
        setSearchResults(previous => pendingRequests(uniqueRows(searchOffset ? [...(previous || []), ...page.rows] : page.rows), cases, sent));
        setSearchAttCounts(previous => searchOffset ? { ...previous, ...counts } : counts);
        setSearchNextOffset(page.nextOffset); setSearchLoaded(searchOffset + page.rows.length); setSearchTotal(page.total);
      } catch {
        if (!canceled) setSearchError('Recherche incomplète : la lecture a échoué. Réessayez.');
      } finally { if (!canceled) setIsSearching(false); }
    }, 400);
    return () => { canceled = true; clearTimeout(timer); };
  }, [searchQuery, searchOffset, searchRetry, composing]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchData();
    if (searchQuery.trim()) { setSearchOffset(0); setSearchRetry(value => value + 1); }
  };

  const [isProcessing, setIsProcessing] = useState(false);

  const handleProcess = useCallback(async (emailId: string, threadRef: string | null) => {
    if (isProcessing) return;

    // M6.1: No fallback to legacy — require threadRef
    if (!threadRef) {
      const { toast } = await import('sonner');
      toast.error('Impossible d\'ouvrir ce fil — aucune référence thread disponible. Veuillez réessayer.');
      return;
    }

    setIsProcessing(true);
    try {
      // 1. ensure-quote-case (idempotent)
      const { data: caseData, error: caseError } = await supabase.functions.invoke('ensure-quote-case', {
        body: { thread_id: threadRef },
      });

      if (caseError || !caseData?.case_id) {
        console.error('[C3] ensure-quote-case failed:', caseError || caseData);
        const { toast } = await import('sonner');
        toast.error('Impossible de créer le dossier. Veuillez réessayer ou actualiser la page.');
        return;
      }

      const caseId = caseData.case_id;

      // 2. Guard: only build puzzle if no facts exist yet
      const { count: factsCount } = await supabase
        .from('quote_facts')
        .select('id', { count: 'exact', head: true })
        .eq('case_id', caseId)
        .eq('is_current', true);

      if (factsCount === 0) {
        try {
          const { error: puzzleError } = await supabase.functions.invoke('build-case-puzzle', {
            body: { case_id: caseId },
          });
          if (puzzleError) {
            console.warn('[C3] build-case-puzzle returned error (non-blocking):', puzzleError);
            const { toast } = await import('sonner');
            toast.warning('Analyse du dossier partielle — vous pouvez continuer');
          }
        } catch (puzzleErr) {
          console.warn('[C3] build-case-puzzle failed (non-blocking):', puzzleErr);
          const { toast } = await import('sonner');
          toast.warning('Analyse du dossier partielle — vous pouvez continuer');
        }
      }

      // 3. Navigate to case view
      navigate(`/case/${caseId}`);
    } catch (err) {
      console.error('[C3] handleProcess error:', err);
      const { toast } = await import('sonner');
      toast.error('Erreur inattendue. Veuillez réessayer ou actualiser la page.');
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, navigate]);

  const handleNewQuotation = () => {
    navigate('/intake');
  };

  // Group emails into thread groups
  const isSearch = !!searchQuery.trim();
  const displayEmails = isSearch ? (searchResults || []) : requests;
  const currentAttCounts = isSearch ? searchAttCounts : attachmentCounts;
  const threadGroups = groupEmailsByThread(displayEmails, currentAttCounts);
  // A2: mark search results so badge shows "visibles"
  if (isSearch) {
    threadGroups.forEach(tg => { tg.isSearchResult = true; });
  }

  const sortedThreadGroups = [...threadGroups].sort((a, b) => {
    if (sortBy === 'date') {
      return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
    }
    const getCompleteness = (t: ThreadGroup) => {
      const fields: (keyof MergedExtractedData)[] = ['cargo', 'origin', 'incoterm'];
      return fields.filter(f => t.mergedExtractedData[f]).length;
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
          <Card role="alert" className="border-destructive/50 bg-destructive/5 mb-6">
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gradient-gold">Demandes à traiter</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {groupEmailsByThread(requests, attachmentCounts).length} dossier(s) chargé(s) en attente
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
                  <p className="text-2xl font-bold text-amber-500">{groupEmailsByThread(requests, attachmentCounts).length}</p>
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
        {(() => {
          // Filtre anti-orphelins : masquer les dossiers sans client, sans progression, et sans thread
          const displayCases = activeCases.filter(c =>
            clientNames[c.id] ||
            (c.puzzle_completeness ?? 0) > 0 ||
            c.request_type
          );
          return displayCases.length > 0 ? (
            <div className="mb-6">
              <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
                <FileText className="h-5 w-5 text-primary" />
                Dossiers en cours
              </h2>
              <div className="space-y-2">
                {displayCases.slice(0, caseLimit).map((c) => (
                  <CaseCard key={c.id} caseData={c} clientName={clientNames[c.id]} />
                ))}
              </div>
              {displayCases.length > caseLimit && <Button variant="outline" className="mt-3" onClick={() => setCaseLimit(value => value + 50)}>Afficher les dossiers suivants</Button>}
            </div>
          ) : null;
        })()}

        {/* Filter & Sort */}
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Demandes de cotation
          </h2>
          <div className="flex items-center gap-2 flex-wrap max-w-full">
            <div className="relative w-full sm:w-[250px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              {isSearching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
              <Input
                placeholder="Rechercher par nom, sujet, contenu..."
                value={searchQuery}
                aria-label="Rechercher les demandes"
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={() => setComposing(false)}
                onChange={e => { setSearchQuery(e.target.value); setSearchOffset(0); setSearchResults(null); setSearchError(null); }}
                className="w-full pl-8"
              />
            </div>
            {searchQuery && <Button variant="ghost" size="sm" onClick={() => { setSearchQuery(''); setSearchOffset(0); setSearchResults(null); }}>Effacer</Button>}
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as 'date' | 'completeness')}>
              <SelectTrigger aria-label="Trier les demandes" className="w-[180px]">
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

        <p className="text-sm text-muted-foreground mb-3" role="status">
          {isSearch ? (isSearching ? 'Recherche en cours…' : searchLoaded + ' courriel(s) vérifié(s) sur ' + searchTotal)
            : loadedCount + ' courriel(s) chargé(s) sur ' + emailTotal}
          {(isSearch ? searchNextOffset !== null : nextOffset !== null) && ' · liste partielle'}
        </p>
        {searchError && <div role="alert" className="mb-3 text-destructive"><p>{searchError}</p><Button variant="outline" onClick={() => setSearchRetry(value => value + 1)} disabled={isSearching}>Réessayer la recherche</Button></div>}
        {/* Thread Groups List */}
        {sortedThreadGroups.length === 0 ? (
          <Card className="border-border/50 bg-gradient-card">
            <CardContent className="py-12">
              <div className="text-center">
                <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-4" />
                <h3 className="text-lg font-medium mb-2">{isSearch ? (isSearching ? 'Recherche en cours…' : searchError ? 'Recherche indisponible' : 'Aucun résultat chargé') : fetchError ? 'Lecture incomplète' : nextOffset !== null ? 'Aucune demande dans cette page' : 'Aucune demande en attente'}</h3>
                <p className="text-muted-foreground mb-4">
                  {isSearch ? 'Modifiez la recherche ou chargez la suite disponible.' : 'Les courriels déjà couverts par un dossier actif sont écartés.'}
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
            {sortedThreadGroups.map((tg) => (
              <QuotationThreadCard
                key={tg.groupKey}
                thread={tg}
                onProcess={handleProcess}
              />
            ))}
          </div>
        )}
        {(isSearch ? searchNextOffset !== null && !searchError : nextOffset !== null) && <Button variant="outline" className="mt-4" disabled={isSearching || loadingMore || isRefreshing}
          onClick={() => isSearch ? setSearchOffset(searchNextOffset!) : void fetchData(true)}>
          {isSearching || loadingMore ? 'Chargement…' : 'Charger les demandes suivantes'}
        </Button>}
      </div>
    </MainLayout>
  );
}
