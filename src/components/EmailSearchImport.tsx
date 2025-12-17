import { useState } from 'react';
import { Brain, CheckCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Mail, Users, Calendar, Download, Loader2, BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface EmailThread {
  subject: string;
  normalizedSubject: string;
  messageCount: number;
  participants: string[];
  dateRange: { first: string; last: string };
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

interface Props {
  configId: string;
  onImportComplete: () => void;
}

export function EmailSearchImport({ configId, onImportComplete }: Props) {
  const [searchType, setSearchType] = useState<'subject' | 'from' | 'text'>('subject');
  const [query, setQuery] = useState('');
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [selectedThreads, setSelectedThreads] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [totalFound, setTotalFound] = useState(0);

  const handleSearch = async () => {
    if (!query.trim()) {
      toast.error('Veuillez entrer un terme de recherche');
      return;
    }

    setSearching(true);
    setThreads([]);
    setSelectedThreads(new Set());

    try {
      const { data, error } = await supabase.functions.invoke('search-emails', {
        body: { configId, searchType, query: query.trim(), limit: 50 }
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      setThreads(data.threads || []);
      setTotalFound(data.totalFound || 0);
      
      if (data.threads?.length === 0) {
        toast.info('Aucun email trouvé pour cette recherche');
      } else {
        toast.success(`${data.threads.length} conversation(s) trouvée(s)`);
      }
    } catch (error) {
      console.error('Search error:', error);
      toast.error(error instanceof Error ? error.message : 'Erreur de recherche');
    }

    setSearching(false);
  };

  const toggleThread = (normalizedSubject: string) => {
    const newSelected = new Set(selectedThreads);
    if (newSelected.has(normalizedSubject)) {
      newSelected.delete(normalizedSubject);
    } else {
      newSelected.add(normalizedSubject);
    }
    setSelectedThreads(newSelected);
  };

  const handleImport = async () => {
    if (selectedThreads.size === 0) {
      toast.error('Sélectionnez au moins une conversation');
      return;
    }

    setImporting(true);

    try {
      // Collect all UIDs from selected threads
      let remainingUids: number[] = [];
      for (const thread of threads) {
        if (selectedThreads.has(thread.normalizedSubject)) {
          remainingUids.push(...thread.messages.map(m => m.uid));
        }
      }

      let totalImported = 0;
      let totalExisting = 0;
      let totalAttachments = 0;
      let lastAnalysis: any = null;
      let batchNum = 0;

      // Process in batches
      while (remainingUids.length > 0) {
        batchNum++;
        toast.info(`Import en cours... (lot ${batchNum}, ${remainingUids.length} email(s) restant(s))`);

        const { data, error } = await supabase.functions.invoke('import-thread', {
          body: { 
            configId, 
            uids: remainingUids,
            learningCase: 'quotation'
          }
        });

        if (error) throw error;
        if (data.error) throw new Error(data.error);

        totalImported += data.imported || 0;
        totalExisting += data.alreadyExisted || 0;
        totalAttachments += data.attachmentsProcessed || 0;
        if (data.analysis) lastAnalysis = data.analysis;

        // Update remaining UIDs from response
        remainingUids = data.remainingUids || [];
        
        if (!data.hasMore) break;
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
      
      // Clear selection and refresh
      setSelectedThreads(new Set());
      onImportComplete();
    } catch (error) {
      console.error('Import error:', error);
      toast.error(error instanceof Error ? error.message : "Erreur d'import");
    }

    setImporting(false);
  };

  const formatDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), 'dd MMM yyyy HH:mm', { locale: fr });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-4">
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

          {totalFound > 0 && (
            <p className="text-sm text-muted-foreground">
              {totalFound} email(s) trouvé(s), groupés en {threads.length} conversation(s)
            </p>
          )}
        </CardContent>
      </Card>

      {threads.length > 0 && (
        <>
          <div className="flex justify-between items-center">
            <p className="text-sm font-medium">
              {selectedThreads.size} conversation(s) sélectionnée(s)
            </p>
            <Button 
              onClick={handleImport} 
              disabled={importing || selectedThreads.size === 0}
              className="gap-2"
            >
              {importing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <BookOpen className="h-4 w-4" />
              )}
              Importer pour apprentissage
            </Button>
          </div>

          <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
            {threads.map((thread) => (
              <Card 
                key={thread.normalizedSubject}
                className={`cursor-pointer transition-colors ${
                  selectedThreads.has(thread.normalizedSubject) 
                    ? 'ring-2 ring-primary bg-primary/5' 
                    : 'hover:bg-muted/50'
                }`}
                onClick={() => toggleThread(thread.normalizedSubject)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Checkbox 
                      checked={selectedThreads.has(thread.normalizedSubject)}
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
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
