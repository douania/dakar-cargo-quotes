import { useState, forwardRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Search, Mail, Users, Calendar, Loader2, BookOpen, FileText, FileSpreadsheet, Sparkles, Paperclip, Zap, Info } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { processQuotationRequest, type QuotationProcessResult, type ImportSearchIdentity } from '@/services/emailService';
import { QuotationProcessor } from '@/components/QuotationProcessor';

interface AttachmentPreview {
  filename: string;
  contentType: string;
  size: number;
}

interface EmailThread {
  threadKey?: string;
  subject: string;
  normalizedSubject: string;
  messageCount: number;
  participants: string[];
  dateRange: { first: string; last: string };
  attachments?: AttachmentPreview[];
  messages: Array<{
    uid: number;
    seq: number;
    subject: string;
    from: string;
    to: string[];
    date: string;
    messageId: string;
  }>;
}

// Helper: get the unique key for a thread (threadKey preferred, fallback normalizedSubject)
function getThreadSelectionKey(thread: EmailThread): string {
  return thread.threadKey || thread.normalizedSubject;
}

interface Props {
  configId: string;
  onImportComplete: () => void;
}

interface SearchCoverage {
  exhaustive?: boolean;
  totalFoundIsLowerBound?: boolean;
  recentWindowSize?: number;
  normalCandidatesTruncated?: boolean;
  qCandidatesTruncated?: boolean;
  recentCandidatesTruncated?: boolean;
  resultsTruncated?: boolean;
}

export const EmailSearchImport = forwardRef<HTMLDivElement, Props>(({ configId, onImportComplete }, ref) => {
  const navigate = useNavigate();
  const [searchType, setSearchType] = useState<'subject' | 'from' | 'text'>('subject');
  const [query, setQuery] = useState('');
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [selectedThreads, setSelectedThreads] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [totalFound, setTotalFound] = useState(0);
  const [searchIdentity, setSearchIdentity] = useState<ImportSearchIdentity | null>(null);
  const [searchNotice, setSearchNotice] = useState<{
    partial: boolean; coverage: SearchCoverage | null; limit: number; reconstructionTruncated: boolean;
  } | null>(null);
  const [reconstructThread, setReconstructThread] = useState(true); // Enable by default
  
  // Quotation processing state
  const [processingQuotation, setProcessingQuotation] = useState(false);
  const [quotationResult, setQuotationResult] = useState<QuotationProcessResult | null>(null);
  const [showQuotationModal, setShowQuotationModal] = useState(false);
  
  // Auto-analyze option
  const [autoAnalyze, setAutoAnalyze] = useState(false);
  const [analyzingAfterImport, setAnalyzingAfterImport] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) {
      toast.error('Veuillez entrer un terme de recherche');
      return;
    }

    setSearching(true);
    setThreads([]);
    setSelectedThreads(new Set());
    setTotalFound(0);
    setSearchNotice(null);
    setSearchIdentity(null);

    try {
      const { data, error } = await supabase.functions.invoke('search-emails', {
        body: { 
          configId, 
          searchType, 
          query: query.trim(), 
          limit: 200,
          reconstructThread 
        }
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      setThreads(data.threads || []);
      if (Number.isSafeInteger(data.uidValidity) && data.uidValidity > 0 && data.mailbox && data.accountKey) {
        setSearchIdentity({ configId, mailbox: data.mailbox, uidValidity: data.uidValidity,
          accountKey: data.accountKey, messages: (data.threads || []).flatMap((thread: EmailThread) =>
            thread.messages.map(({ uid, messageId }) => ({ uid, messageId }))),
        });
      }
      setTotalFound(data.totalFound || 0);
      const coverage: SearchCoverage | null = data.searchCoverage ?? null;
      const reconstructionTruncated = data.reconstructionTruncated === true;
      const partial = (searchType === 'subject' && coverage?.exhaustive !== true) ||
        !!(coverage?.resultsTruncated || coverage?.normalCandidatesTruncated ||
          coverage?.qCandidatesTruncated || coverage?.recentCandidatesTruncated) ||
        reconstructionTruncated || data.totalFound > data.selectedCount;
      setSearchNotice({
        partial, coverage, reconstructionTruncated,
        limit: Number.isSafeInteger(data.limitApplied) && data.limitApplied > 0 ? data.limitApplied : 200,
      });
      
      if (data.threads?.length === 0) {
        toast.info(partial
          ? 'Aucun résultat dans le périmètre vérifié. La recherche reste partielle.'
          : 'Aucun email trouvé pour cette recherche');
      } else {
        const reconstructInfo = reconstructThread ? ' (reconstruction thread activée)' : '';
        toast.success(`${data.threads.length} conversation(s) trouvée(s)${partial ? ' — résultats partiels' : ''}${reconstructInfo}`);
      }
    } catch (error) {
      console.error('Search error:', error);
      toast.error(error instanceof Error ? error.message : 'Erreur de recherche');
    }

    setSearching(false);
  };

  const toggleThread = (thread: EmailThread) => {
    const key = getThreadSelectionKey(thread);
    const newSelected = new Set(selectedThreads);
    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.add(key);
    }
    setSelectedThreads(newSelected);
  };

  const handleImport = async () => {
    if (selectedThreads.size === 0) {
      toast.error('Sélectionnez au moins une conversation');
      return;
    }
    if (!searchIdentity || searchIdentity.configId !== configId) {
      toast.error('Relancez la recherche pour vérifier la boîte et les messages avant import.');
      return;
    }

    setImporting(true);

    try {
      let totalImported = 0;
      let totalExisting = 0;
      let totalAttachments = 0;
      let lastAnalysis: any = null;
      const allImportedEmails: any[] = [];

      // P0-D: Iterate per selected thread to send the correct threadKey
      for (const thread of threads) {
        if (!selectedThreads.has(getThreadSelectionKey(thread))) continue;

        const currentThreadKey = thread.threadKey;
        let remainingUids = thread.messages.map(m => m.uid);
        let batchNum = 0;

        // Process this thread's UIDs in batches (backend may return remainingUids)
        while (remainingUids.length > 0) {
          batchNum++;
          toast.info(`Import en cours... (lot ${batchNum}, ${remainingUids.length} email(s) restant(s))`);

          const { data, error } = await supabase.functions.invoke('import-thread', {
            body: { 
              configId, 
              uids: remainingUids,
              learningCase: 'quotation',
              threadKey: currentThreadKey,
              searchIdentity,
            }
          });

          if (error) throw error;
          if (data.error) throw new Error(data.error);

          totalImported += data.imported || 0;
          totalExisting += data.alreadyExisted || 0;
          totalAttachments += data.attachmentsProcessed || 0;
          if (data.analysis) lastAnalysis = data.analysis;
          if (data.emails) allImportedEmails.push(...data.emails);

          remainingUids = data.remainingUids || [];
          if (!data.hasMore) break;
        }
      }

      // Build informative message
      let message = '';
      if (totalImported > 0) {
        message = `${totalImported} nouvel email(s) importé(s)`;
      }
      if (totalExisting > 0) {
        message += message ? ' + ' : '';
        message += `${totalExisting} email(s) déjà présent(s)`;
      }
      if (totalAttachments > 0) {
        message += `. ${totalAttachments} pièce(s) jointe(s) traitée(s)`;
      }
      if (lastAnalysis) {
        message += `. Analyse IA: ${lastAnalysis.knowledgeStored} connaissance(s) extraite(s)`;
        if (lastAnalysis.attachmentsAnalyzed > 0) {
          message += ` (incl. ${lastAnalysis.attachmentsAnalyzed} document(s))`;
        }
        if (lastAnalysis.quotationDetected) {
          message += ` - Cotation détectée${lastAnalysis.quotationAmount ? `: ${lastAnalysis.quotationAmount}` : ''}`;
        }
      }
      
      toast.success(message || 'Import terminé');
      
      // P1-3: Targeted auto-analysis — only analyze attachments from imported emails
      if (autoAnalyze && totalAttachments > 0) {
        setAnalyzingAfterImport(true);
        toast.info('Lancement de l\'analyse des pièces jointes...');
        
        try {
          // Collect email IDs from all imported emails across batches
          const importedEmailIds = allImportedEmails
            .filter((e: any) => e?.id && e.alreadyExists !== true)
            .map((e: any) => e.id);

          if (importedEmailIds.length > 0) {
            // Fetch unanalyzed attachments for these specific emails
            const { data: pendingAttachments } = await supabase
              .from('email_attachments')
              .select('id')
              .in('email_id', importedEmailIds)
              .eq('is_analyzed', false)
              .not('storage_path', 'is', null);

            if (pendingAttachments && pendingAttachments.length > 0) {
              let analyzed = 0;
              for (const att of pendingAttachments) {
                const { error: attError } = await supabase.functions.invoke('analyze-attachments', {
                  body: { attachmentId: att.id, background: false }
                });
                if (!attError) analyzed++;
              }
              toast.success(`${analyzed} pièce(s) jointe(s) analysée(s)`);
            } else {
              toast.info('Aucune pièce jointe à analyser');
            }
          }
        } catch (error) {
          console.error('Auto-analyze error:', error);
          toast.warning('L\'analyse automatique a échoué, vous pouvez relancer depuis l\'onglet Fils');
        }
        setAnalyzingAfterImport(false);
      }
      
      // Clear selection and refresh
      setSelectedThreads(new Set());
      onImportComplete();
    } catch (error) {
      console.error('Import error:', error);
      toast.error(error instanceof Error ? error.message : "Erreur d'import");
    }

    setImporting(false);
  };

  const handleProcessQuotation = async () => {
    if (selectedThreads.size === 0) {
      toast.error('Sélectionnez une conversation');
      return;
    }

    // Get UIDs from the first selected thread
    const selectedThread = threads.find(t => selectedThreads.has(getThreadSelectionKey(t)));
    if (!selectedThread) return;

    const uids = selectedThread.messages.map(m => m.uid);
    const threadKey = selectedThread.threadKey;
    if (!searchIdentity || searchIdentity.configId !== configId) {
      toast.error('Relancez la recherche pour vérifier la boîte et les messages avant import.');
      return;
    }
    
    setProcessingQuotation(true);
    setQuotationResult(null);

    try {
      toast.info('Import du fil en cours...');
      const result = await processQuotationRequest(configId, uids, threadKey, searchIdentity);
      
      // C1 Convergence: if caseId is returned, navigate to case view
      if (result.caseId) {
        if (result.warning) {
          toast.warning(result.warning);
        }
        toast.success(`Dossier ${result.caseId.slice(0, 8)}… créé`);
        setSelectedThreads(new Set());
        onImportComplete();
        // Navigate to case view
        navigate(`/case/${result.caseId}`);
      } else {
        // Legacy fallback: open modal
        setQuotationResult(result);
        setShowQuotationModal(true);
        toast.success('Cotation générée avec succès (chemin legacy)');
      }
    } catch (error) {
      console.error('Quotation processing error:', error);
      toast.error(error instanceof Error ? error.message : 'Erreur lors du traitement');
      setShowQuotationModal(false);
    }

    setProcessingQuotation(false);
  };

  const handleQuotationComplete = () => {
    setSelectedThreads(new Set());
    onImportComplete();
  };

  const formatDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), 'dd MMM yyyy HH:mm', { locale: fr });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-4" ref={ref}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Search className="h-5 w-5" />
            Rechercher des échanges à importer
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Select value={searchType} onValueChange={(v: 'subject' | 'from' | 'text') => setSearchType(v)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="subject">Par sujet</SelectItem>
                <SelectItem value="from">Par expéditeur</SelectItem>
                <SelectItem value="text">Dans le contenu</SelectItem>
              </SelectContent>
            </Select>
            
            <Input
              placeholder={
                searchType === 'subject' ? "Ex: DAP SAINT LOUIS" :
                searchType === 'from' ? "Ex: client@example.com" :
                "Ex: cotation maritime"
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="flex-1"
            />
            
            <Button onClick={handleSearch} disabled={searching}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              <span className="ml-2 hidden sm:inline">Rechercher</span>
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <Checkbox 
                id="reconstructThread"
                checked={reconstructThread}
                onCheckedChange={(checked) => setReconstructThread(checked === true)}
              />
              <label 
                htmlFor="reconstructThread" 
                className="text-sm text-muted-foreground cursor-pointer"
              >
                Reconstruire le thread complet
              </label>
            </div>
            
            <div className="flex items-center gap-2">
              <Switch
                id="autoAnalyze"
                checked={autoAnalyze}
                onCheckedChange={setAutoAnalyze}
              />
              <Label 
                htmlFor="autoAnalyze" 
                className="text-sm text-muted-foreground cursor-pointer flex items-center gap-1"
              >
                <Zap className="h-3 w-3 text-amber-500" />
                Analyser automatiquement les PJ après import
              </Label>
            </div>
          </div>

          {searchNotice?.partial && (
            <Alert aria-live="polite">
              <Info className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>Recherche partielle</AlertTitle>
              <AlertDescription className="space-y-1">
                <p>{threads.length === 0
                  ? "Aucun résultat dans le périmètre vérifié. Cela ne permet pas de conclure à l’absence d’une demande."
                  : "Des messages peuvent manquer dans ces résultats ; la recherche n’est pas exhaustive."}</p>
                <p>Affichage limité à {searchNotice.limit} e-mails.
                  {Number.isSafeInteger(searchNotice.coverage?.recentWindowSize) && (
                    <> Vérification complémentaire des sujets : fenêtre de {searchNotice.coverage?.recentWindowSize} e-mails récents.</>
                  )}
                </p>
                {(searchNotice.coverage?.normalCandidatesTruncated || searchNotice.coverage?.qCandidatesTruncated ||
                  searchNotice.coverage?.recentCandidatesTruncated) && <p>Certains candidats n’ont pas été vérifiés.</p>}
                {searchNotice.reconstructionTruncated && <p>Certains échanges liés n’ont pas pu être inclus dans la limite.</p>}
              </AlertDescription>
            </Alert>
          )}

          {totalFound > 0 && (
            <p className="text-sm text-muted-foreground">
              {searchNotice?.coverage?.totalFoundIsLowerBound ? 'Au moins ' : ''}{totalFound} email(s) trouvé(s), groupés en {threads.length} conversation(s)
            </p>
          )}
        </CardContent>
      </Card>

      {threads.length > 0 && (
        <>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <p className="text-sm font-medium">
              {selectedThreads.size} conversation(s) sélectionnée(s)
            </p>
            <div className="flex gap-2 flex-wrap">
              <Button 
                variant="outline"
                onClick={handleImport} 
                disabled={importing || processingQuotation || analyzingAfterImport || selectedThreads.size === 0}
                className="gap-2"
              >
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : analyzingAfterImport ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analyse PJ...
                  </>
                ) : (
                  <BookOpen className="h-4 w-4" />
                )}
                {!importing && !analyzingAfterImport && 'Importer pour apprentissage'}
                {importing && 'Import...'}
              </Button>
              <Button 
                onClick={handleProcessQuotation} 
                disabled={importing || processingQuotation || selectedThreads.size === 0}
                className="gap-2"
              >
                {processingQuotation ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Traiter cette cotation
              </Button>
            </div>
          </div>

          <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
            {threads.map((thread) => {
              const selKey = getThreadSelectionKey(thread);
              return (
              <Card 
                key={selKey}
                className={`cursor-pointer transition-colors ${
                  selectedThreads.has(selKey) 
                    ? 'ring-2 ring-primary bg-primary/5' 
                    : 'hover:bg-muted/50'
                }`}
                onClick={() => toggleThread(thread)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Checkbox 
                      checked={selectedThreads.has(selKey)}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate">{thread.subject}</span>
                        <Badge variant="secondary" className="shrink-0">
                          {thread.messageCount} msg
                        </Badge>
                      </div>
                      
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {thread.participants.slice(0, 3).join(', ')}
                          {thread.participants.length > 3 && ` +${thread.participants.length - 3}`}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(thread.dateRange.first)} → {formatDate(thread.dateRange.last)}
                        </span>
                        
                        {/* Attachment badges */}
                        {thread.attachments && thread.attachments.length > 0 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="flex items-center gap-1 cursor-help">
                                <Paperclip className="h-3 w-3" />
                                {thread.attachments.some(a => 
                                  a.contentType.includes('pdf') || a.filename.toLowerCase().endsWith('.pdf')
                                ) && (
                                  <Badge variant="outline" className="text-red-600 border-red-200 text-xs py-0 px-1">
                                    <FileText className="h-3 w-3 mr-0.5" />
                                    PDF
                                  </Badge>
                                )}
                                {thread.attachments.some(a => 
                                  a.contentType.includes('excel') || 
                                  a.contentType.includes('spreadsheet') ||
                                  a.filename.toLowerCase().endsWith('.xlsx') ||
                                  a.filename.toLowerCase().endsWith('.xls')
                                ) && (
                                  <Badge variant="outline" className="text-green-600 border-green-200 text-xs py-0 px-1">
                                    <FileSpreadsheet className="h-3 w-3 mr-0.5" />
                                    Excel
                                  </Badge>
                                )}
                                {thread.attachments.some(a => 
                                  a.contentType.includes('word') || 
                                  a.contentType.includes('document') ||
                                  a.filename.toLowerCase().endsWith('.docx') ||
                                  a.filename.toLowerCase().endsWith('.doc')
                                ) && (
                                  <Badge variant="outline" className="text-blue-600 border-blue-200 text-xs py-0 px-1">
                                    <FileText className="h-3 w-3 mr-0.5" />
                                    Word
                                  </Badge>
                                )}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-xs">
                              <p className="font-medium mb-1">Pièces jointes :</p>
                              <ul className="text-xs space-y-0.5">
                                {thread.attachments.slice(0, 5).map((a, i) => (
                                  <li key={i} className="truncate">{a.filename}</li>
                                ))}
                                {thread.attachments.length > 5 && (
                                  <li className="text-muted-foreground">+{thread.attachments.length - 5} autres...</li>
                                )}
                              </ul>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              );
            })}
          </div>
        </>
      )}

      <QuotationProcessor
        open={showQuotationModal}
        onOpenChange={setShowQuotationModal}
        result={quotationResult}
        isLoading={processingQuotation}
        onComplete={handleQuotationComplete}
      />
    </div>
  );
});

EmailSearchImport.displayName = 'EmailSearchImport';
