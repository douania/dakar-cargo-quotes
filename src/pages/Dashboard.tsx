import { useState, useEffect, useCallback } from 'react';
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
import { MainLayout } from '@/components/layout/MainLayout';
import { QuotationThreadCard } from '@/components/QuotationThreadCard';
import type { ThreadGroup, MergedExtractedData } from '@/components/QuotationThreadCard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { CaseCard } from '@/components/dashboard/CaseCard';
import type { QuoteCaseData } from '@/hooks/useQuoteCaseData';

interface RawEmail {
  id: string;
  subject: string;
  from_address: string;
  received_at: string;
  sent_at?: string | null;
  created_at?: string | null;
  extracted_data: any;
  thread_id?: string;
  thread_ref?: string | null;
  body_text?: string | null;
  attachmentCount?: number;
}

// ── Whitelist merge of extracted_data (A3: field-by-field, no generic spread) ──
const MERGE_FIELDS: (keyof MergedExtractedData)[] = [
  'client', 'company', 'cargo', 'origin', 'destination',
  'incoterm', 'container_type', 'weight', 'urgency',
];

function mergeExtractedData(emails: RawEmail[]): MergedExtractedData {
  const result: MergedExtractedData = {};
  // oldest-first so latest non-empty wins
  const sorted = [...emails].sort(
    (a, b) => new Date(emailEventAt(a)).getTime() - new Date(emailEventAt(b)).getTime()
  );
  for (const email of sorted) {
    const ed = email.extracted_data;
    if (!ed || typeof ed !== 'object') continue;
    for (const key of MERGE_FIELDS) {
      const val = ed[key];
      if (typeof val === 'string' && val.trim()) {
        result[key] = val.trim();
      } else if (typeof val === 'number' && Number.isFinite(val)) {
        result[key] = String(val);
      }
    }
  }
  return result;
}

// A4: normalised event date
function emailEventAt(e: RawEmail): string {
  return e.received_at || e.sent_at || e.created_at || new Date(0).toISOString();
}

// ── Group emails by thread (2-pass: canonical key resolves mixed thread_ref/thread_id) ──
function groupEmailsByThread(
  emails: RawEmail[],
  attachmentCounts: Record<string, number>,
): ThreadGroup[] {
  // Pass 1: build canonical key per thread_id
  // If any email in a thread_id group has thread_ref, all emails with that thread_id use it
  const canonicalByThreadId = new Map<string, string>();
  for (const email of emails) {
    if (email.thread_id) {
      const existing = canonicalByThreadId.get(email.thread_id);
      // thread_ref wins over thread_id as canonical key
      if (email.thread_ref) {
        canonicalByThreadId.set(email.thread_id, email.thread_ref);
      } else if (!existing) {
        canonicalByThreadId.set(email.thread_id, email.thread_id);
      }
    }
  }

  // Pass 2: group using canonical key
  const groups = new Map<string, RawEmail[]>();
  for (const email of emails) {
    const key = email.thread_id
      ? (canonicalByThreadId.get(email.thread_id) || email.thread_id)
      : (email.thread_ref || email.id);
    const arr = groups.get(key) || [];
    arr.push(email);
    groups.set(key, arr);
  }

  const result: ThreadGroup[] = [];
  for (const [groupKey, msgs] of groups) {
    // sort by event date ascending
    msgs.sort((a, b) => new Date(emailEventAt(a)).getTime() - new Date(emailEventAt(b)).getTime());
    const root = msgs[0];
    const latest = msgs[msgs.length - 1];
    const totalAtt = msgs.reduce((sum, m) => sum + (attachmentCounts[m.id] || 0), 0);

    result.push({
      groupKey,
      rootEmailId: root.id,
      latestEmailId: latest.id,
      threadRef: root.thread_ref || null,
      threadId: root.thread_id || null,
      subject: root.subject || latest.subject || 'Sans sujet',
      from_address: root.from_address,
      lastActivityAt: emailEventAt(latest),
      rootReceivedAt: emailEventAt(root),
      messageCount: msgs.length,
      attachmentCount: totalAtt,
      mergedExtractedData: mergeExtractedData(msgs),
      latestBodyText: latest.body_text || null,
    });
  }
  return result;
}

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

  const fetchData = async () => {
    setFetchError(null);
    try {
      // Fetch quotation requests and active cases in parallel
      const [emailsResult, casesResult] = await Promise.all([
        withTimeout(
          supabase
            .from('emails')
            .select('id, subject, from_address, received_at, sent_at, created_at, extracted_data, thread_id, thread_ref, body_text')
            .eq('is_quotation_request', true)
            .order('received_at', { ascending: false })
            .limit(100)
        ),
        withTimeout(
          supabase
            .from('quote_cases')
            .select('id, thread_id, status, request_type, priority, puzzle_completeness, created_at, updated_at')
            .not('status', 'in', '(SENT,ARCHIVED)')
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

      // C2.1-C: build Set of thread_ids covered by active cases
      const activeCaseThreadIds = new Set<string>(
        typedCases.map(c => c.thread_id).filter((tid): tid is string => !!tid)
      );

      // Filter pending: exclude sent + exclude threads already covered by a case
      const isPendingEmail = (email: RawEmail) =>
        !sentEmailIds.has(email.id)
        && !(email.thread_ref && activeCaseThreadIds.has(email.thread_ref))
        && !(email.thread_id && activeCaseThreadIds.has(email.thread_id));

      const pendingRequests = (emails || []).filter(isPendingEmail) as RawEmail[];

      setRequests(pendingRequests);
      setAttachmentCounts(attachmentCounts);

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

      // Stats use thread count, not email count
      const threadCount = groupEmailsByThread(pendingRequests, attachmentCounts).length;
      setStats({
        pending: threadCount,
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
            .select('id, subject, from_address, received_at, sent_at, created_at, extracted_data, thread_id, thread_ref, body_text')
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

        // C2.1-C: also exclude threads covered by active cases (reuse activeCases state)
        const searchActiveCaseThreadIds = new Set<string>(
          activeCases.map(c => c.thread_id).filter((tid): tid is string => !!tid)
        );

        setSearchResults(
          (data || []).filter(e => {
            if (sentIds.has(e.id)) return false;
            if (e.thread_ref && searchActiveCaseThreadIds.has(e.thread_ref)) return false;
            if (e.thread_id && searchActiveCaseThreadIds.has(e.thread_id)) return false;
            return true;
          }) as RawEmail[]
        );
        setSearchAttCounts(attCounts);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery, activeCases]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchData();
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
      toast.error('Erreur inattendue — ouverture en mode classique');
      navigate(`/quotation/${emailId}`);
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, navigate]);

  const handleNewQuotation = () => {
    navigate('/quotation/new');
  };

  // Group emails into thread groups
  const isSearch = searchResults !== null;
  const displayEmails = isSearch ? searchResults : requests;
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
              {stats.pending} dossier{stats.pending > 1 ? 's' : ''} de cotation en attente
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
                {displayCases.map((c) => (
                  <CaseCard key={c.id} caseData={c} clientName={clientNames[c.id]} />
                ))}
              </div>
            </div>
          ) : null;
        })()}

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

        {/* Thread Groups List */}
        {sortedThreadGroups.length === 0 ? (
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
            {sortedThreadGroups.map((tg) => (
              <QuotationThreadCard
                key={tg.groupKey}
                thread={tg}
                onProcess={handleProcess}
              />
            ))}
          </div>
        )}
      </div>
    </MainLayout>
  );
}