import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { 
  Mail, Plus, RefreshCw, Star, Clock, Send, 
  MessageSquare, Brain, Trash2, Eye, Edit, Search, Paperclip,
  AlertTriangle, Filter, CheckSquare, RotateCcw, GitBranch, Users, Building,
  FileText, FileSpreadsheet, Image as ImageIcon, FileArchive, File
} from 'lucide-react';
import { EmailSearchImport } from '@/components/EmailSearchImport';
import { EmailAttachments } from '@/components/EmailAttachments';
import { LearnedKnowledge } from '@/components/LearnedKnowledge';
import { ResponseGuidanceDialog, type ExpertStyle } from '@/components/ResponseGuidanceDialog';
import { ThreadParticipants, ThreadParticipantsSummary, type ParticipantWithRole } from '@/components/ThreadParticipants';

interface EmailConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  is_active: boolean;
  last_sync_at: string | null;
}

interface Email {
  id: string;
  from_address: string;
  subject: string;
  body_text: string;
  sent_at: string;
  is_quotation_request: boolean;
  is_read: boolean;
  thread_id: string;
  extracted_data: any;
}

interface EmailDraft {
  id: string;
  subject: string;
  body_text: string;
  to_addresses: string[];
  status: string;
  created_at: string;
  original_email_id: string;
}

interface EmailThread {
  id: string;
  subject_normalized: string;
  first_message_at: string;
  last_message_at: string;
  participants: ParticipantWithRole[] | string[];
  client_email: string | null;
  client_company: string | null;
  our_role: 'direct_quote' | 'assist_partner' | null;
  partner_email: string | null;
  project_name: string | null;
  status: string;
  email_count: number;
  is_quotation_thread?: boolean;
}

function getInvokeErrorMessage(err: unknown): string {
  const anyErr = err as any;

  const body = anyErr?.context?.body;
  if (typeof body === 'string' && body.trim()) {
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.error === 'string' && parsed.error.trim()) return parsed.error;
    } catch {
      // ignore JSON parse errors
    }
  }

  if (typeof anyErr?.message === 'string' && anyErr.message.trim()) return anyErr.message;
  return 'Erreur de synchronisation';
}

export default function Emails() {
  const [configs, setConfigs] = useState<EmailConfig[]>([]);
  const [emails, setEmails] = useState<Email[]>([]);
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [attachmentCounts, setAttachmentCounts] = useState<Record<string, number>>({});
  const [attachmentDetails, setAttachmentDetails] = useState<Record<string, { types: string[], filenames: string[] }>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [selectedDraft, setSelectedDraft] = useState<EmailDraft | null>(null);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [showGuidanceDialog, setShowGuidanceDialog] = useState(false);
  const [guidanceEmailId, setGuidanceEmailId] = useState<string | null>(null);
  const [guidanceEmailSubject, setGuidanceEmailSubject] = useState<string>('');
  
  // Multi-selection state
  const [selectedEmailIds, setSelectedEmailIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [isReclassifying, setIsReclassifying] = useState(false);
  const [isReclassifyingThreads, setIsReclassifyingThreads] = useState(false);
  const [filter, setFilter] = useState<'all' | 'quotation' | 'other' | 'with_attachments' | 'without_attachments'>('all');
  const [threadFilter, setThreadFilter] = useState<'quotation' | 'all'>('quotation');
  
  // Search states
  const [emailSearchQuery, setEmailSearchQuery] = useState('');
  const [threadSearchQuery, setThreadSearchQuery] = useState('');
  
  const [newConfig, setNewConfig] = useState({
    name: '',
    host: '',
    port: 993,
    username: '',
    password: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('email-admin', {
        body: { action: 'get_all' }
      });

      if (error) throw error;

      if (data?.success) {
        setConfigs(data.configs || []);
        setEmails(data.emails || []);
        setDrafts(data.drafts || []);
        setThreads(data.threads || []);
        
        const counts: Record<string, number> = {};
        const details: Record<string, { types: string[], filenames: string[] }> = {};
        
        (data.attachments || []).forEach((att: any) => {
          if (att.email_id) {
            counts[att.email_id] = (counts[att.email_id] || 0) + 1;
            
            if (!details[att.email_id]) {
              details[att.email_id] = { types: [], filenames: [] };
            }
            
            // Determine file type from filename or content_type
            const filename = att.filename || '';
            const ext = filename.split('.').pop()?.toLowerCase() || '';
            let fileType = 'DOC';
            
            if (['pdf'].includes(ext)) fileType = 'PDF';
            else if (['xlsx', 'xls'].includes(ext)) fileType = 'Excel';
            else if (['docx', 'doc'].includes(ext)) fileType = 'Word';
            else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) fileType = 'Image';
            else if (['csv'].includes(ext)) fileType = 'CSV';
            else if (['txt'].includes(ext)) fileType = 'TXT';
            else if (['zip', 'rar', '7z'].includes(ext)) fileType = 'Archive';
            
            if (!details[att.email_id].types.includes(fileType)) {
              details[att.email_id].types.push(fileType);
            }
            details[att.email_id].filenames.push(filename);
          }
        });
        
        setAttachmentCounts(counts);
        setAttachmentDetails(details);
      }
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Erreur de chargement');
    }
    setLoading(false);
    setSelectedEmailIds(new Set());
  };

  const addConfig = async () => {
    if (!newConfig.name || !newConfig.host || !newConfig.username || !newConfig.password) {
      toast.error('Veuillez remplir tous les champs');
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('email-admin', {
        body: { 
          action: 'add_config',
          data: {
            name: newConfig.name,
            host: newConfig.host,
            port: newConfig.port,
            username: newConfig.username,
            password: newConfig.password
          }
        }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erreur');

      toast.success('Configuration ajoutée');
      setShowConfigDialog(false);
      setNewConfig({ name: '', host: '', port: 993, username: '', password: '' });
      loadData();
    } catch (error) {
      console.error('Error adding config:', error);
      toast.error('Erreur lors de l\'ajout');
    }
  };

  const syncEmails = async (configId: string) => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-emails', {
        body: { configId }
      });

      if (error) throw error;

      toast.success(`${data.synced} emails synchronisés`);
      if (data.message) {
        toast.info(data.message);
      }
      loadData();
    } catch (error) {
      console.error('Sync error:', error);
      toast.error(getInvokeErrorMessage(error));
    }
    setSyncing(false);
  };

  const learnFromEmail = async (emailId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('learn-from-content', {
        body: { contentType: 'email', contentId: emailId }
      });

      if (error) throw error;

      toast.success(`${data.stored} connaissances extraites`);
      loadData();
    } catch (error) {
      console.error('Learn error:', error);
      toast.error('Erreur d\'apprentissage');
    }
  };

  const generateResponse = async (emailId: string, customInstructions?: string, expertStyle: ExpertStyle = 'auto') => {
    try {
      const { data, error } = await supabase.functions.invoke('generate-response', {
        body: { emailId, customInstructions, expertStyle }
      });

      if (error) throw error;

      toast.success('Brouillon généré');
      loadData();
    } catch (error) {
      console.error('Generate error:', error);
      toast.error('Erreur de génération');
    }
  };

  const openGuidanceDialog = (emailId: string, subject: string) => {
    setGuidanceEmailId(emailId);
    setGuidanceEmailSubject(subject);
    setShowGuidanceDialog(true);
  };

  const handleGenerateWithGuidance = async (instructions: string, expertStyle: ExpertStyle) => {
    if (!guidanceEmailId) return;
    await generateResponse(guidanceEmailId, instructions || undefined, expertStyle);
    setGuidanceEmailId(null);
    setGuidanceEmailSubject('');
  };

  const deleteConfig = async (id: string) => {
    if (!confirm('Supprimer cette configuration ?')) return;
    
    try {
      const { data, error } = await supabase.functions.invoke('email-admin', {
        body: { action: 'delete_config', data: { configId: id } }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erreur');

      toast.success('Configuration supprimée');
      loadData();
    } catch (error) {
      toast.error('Erreur de suppression');
    }
  };

  const deleteEmail = async (emailId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!confirm('Supprimer cet email et toutes les données associées ?')) return;
    
    setIsDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke('email-admin', {
        body: { action: 'delete_email', data: { emailId } }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erreur');

      toast.success('Email supprimé');
      setSelectedEmail(null);
      loadData();
    } catch (error) {
      console.error('Delete error:', error);
      toast.error('Erreur de suppression');
    }
    setIsDeleting(false);
  };

  const deleteSelectedEmails = async () => {
    if (selectedEmailIds.size === 0) return;
    if (!confirm(`Supprimer ${selectedEmailIds.size} email(s) sélectionné(s) ?`)) return;
    
    setIsDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke('email-admin', {
        body: { action: 'delete_emails', data: { emailIds: Array.from(selectedEmailIds) } }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erreur');

      toast.success(`${data.deleted} email(s) supprimé(s)`);
      loadData();
    } catch (error) {
      console.error('Delete error:', error);
      toast.error('Erreur de suppression');
    }
    setIsDeleting(false);
  };

  const purgeNonQuotation = async () => {
    const nonQuotationCount = emails.filter(e => !e.is_quotation_request).length;
    if (nonQuotationCount === 0) {
      toast.info('Aucun email non-cotation à purger');
      return;
    }
    
    if (!confirm(`Supprimer ${nonQuotationCount} email(s) non-cotation (notifications, spam, etc.) ?`)) return;
    
    setIsDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke('email-admin', {
        body: { action: 'purge_non_quotation' }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erreur');

      toast.success(`${data.deleted} email(s) purgé(s)`);
      loadData();
    } catch (error) {
      console.error('Purge error:', error);
      toast.error('Erreur de purge');
    }
    setIsDeleting(false);
  };

  const reclassifyEmails = async () => {
    if (!confirm('Recalculer la classification de tous les emails ?\n\nCela mettra à jour le statut "cotation" de tous les emails en appliquant les nouveaux filtres (exclusion banques, newsletters, etc.)')) return;
    
    setIsReclassifying(true);
    try {
      const { data, error } = await supabase.functions.invoke('email-admin', {
        body: { action: 'reclassify_emails' }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erreur');

      toast.success(`${data.total} emails reclassifiés: ${data.quotations} cotations, ${data.nonQuotations} autres`);
      loadData();
    } catch (error) {
      console.error('Reclassify error:', error);
      toast.error('Erreur de reclassification');
    }
    setIsReclassifying(false);
  };

  const reclassifyThreads = async () => {
    if (!confirm('Recalculer la classification de tous les fils de discussion ?\n\nCela mettra à jour le statut "fil de cotation" de tous les fils.')) return;
    
    setIsReclassifyingThreads(true);
    try {
      const { data, error } = await supabase.functions.invoke('email-admin', {
        body: { action: 'reclassify_threads' }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erreur');

      toast.success(`${data.total} fils reclassifiés: ${data.quotationThreads} cotations, ${data.nonQuotationThreads} autres`);
      loadData();
    } catch (error) {
      console.error('Reclassify threads error:', error);
      toast.error('Erreur de reclassification des fils');
    }
    setIsReclassifyingThreads(false);
  };

  const toggleEmailSelection = (emailId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSelection = new Set(selectedEmailIds);
    if (newSelection.has(emailId)) {
      newSelection.delete(emailId);
    } else {
      newSelection.add(emailId);
    }
    setSelectedEmailIds(newSelection);
  };

  const toggleSelectAll = () => {
    if (selectedEmailIds.size === filteredEmails.length) {
      setSelectedEmailIds(new Set());
    } else {
      setSelectedEmailIds(new Set(filteredEmails.map(e => e.id)));
    }
  };

  // Filter emails with search
  const filteredEmails = emails.filter(email => {
    // Text search filter
    if (emailSearchQuery.trim()) {
      const query = emailSearchQuery.toLowerCase();
      const matchesSearch = 
        email.subject?.toLowerCase().includes(query) ||
        email.from_address?.toLowerCase().includes(query) ||
        email.body_text?.toLowerCase().includes(query);
      if (!matchesSearch) return false;
    }
    
    // Category filter
    if (filter === 'quotation') return email.is_quotation_request;
    if (filter === 'other') return !email.is_quotation_request;
    if (filter === 'with_attachments') return (attachmentCounts[email.id] || 0) > 0;
    if (filter === 'without_attachments') return (attachmentCounts[email.id] || 0) === 0;
    return true;
  });

  // Count emails with/without attachments
  const withAttachmentsCount = emails.filter(e => (attachmentCounts[e.id] || 0) > 0).length;
  const withoutAttachmentsCount = emails.filter(e => (attachmentCounts[e.id] || 0) === 0).length;

  // Filtered threads with search
  const filteredThreads = threads.filter(thread => {
    // Text search filter
    if (threadSearchQuery.trim()) {
      const query = threadSearchQuery.toLowerCase();
      const matchesSearch = 
        thread.subject_normalized?.toLowerCase().includes(query) ||
        thread.client_email?.toLowerCase().includes(query) ||
        thread.client_company?.toLowerCase().includes(query) ||
        thread.project_name?.toLowerCase().includes(query);
      if (!matchesSearch) return false;
    }
    
    // Category filter
    if (threadFilter === 'quotation') return thread.is_quotation_thread !== false;
    return true;
  });

  const quotationCount = emails.filter(e => e.is_quotation_request).length;
  const otherCount = emails.filter(e => !e.is_quotation_request).length;
  const quotationThreadCount = threads.filter(t => t.is_quotation_thread !== false).length;
  const otherThreadCount = threads.filter(t => t.is_quotation_thread === false).length;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
              <Mail className="h-8 w-8" />
              Gestion Emails
            </h1>
            <p className="text-muted-foreground mt-1">
              Synchronisez vos emails et laissez l'IA apprendre
            </p>
          </div>
          <Button onClick={() => setShowConfigDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Ajouter compte
          </Button>
        </div>

        <Tabs defaultValue="import" className="space-y-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="import">
              <Search className="h-4 w-4 mr-2" />
              Import sélectif
            </TabsTrigger>
            <TabsTrigger value="threads">
              <GitBranch className="h-4 w-4 mr-2" />
              Fils ({threadFilter === 'quotation' ? quotationThreadCount : threads.length})
            </TabsTrigger>
            <TabsTrigger value="knowledge">
              <Brain className="h-4 w-4 mr-2" />
              Connaissances
            </TabsTrigger>
            <TabsTrigger value="inbox">
              <Mail className="h-4 w-4 mr-2" />
              Emails importés ({emails.length})
            </TabsTrigger>
            <TabsTrigger value="quotations">
              <Star className="h-4 w-4 mr-2" />
              Cotations
            </TabsTrigger>
            <TabsTrigger value="drafts">
              <Edit className="h-4 w-4 mr-2" />
              Brouillons ({drafts.length})
            </TabsTrigger>
            <TabsTrigger value="configs">
              Comptes
            </TabsTrigger>
          </TabsList>

          <TabsContent value="import" className="space-y-4">
            {configs.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Mail className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Aucun compte email configuré</p>
                  <Button className="mt-4" onClick={() => setShowConfigDialog(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Ajouter un compte
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Compte actif</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {configs[0]?.username} @ {configs[0]?.host}
                    </p>
                  </CardContent>
                </Card>
                <EmailSearchImport 
                  configId={configs[0]?.id} 
                  onImportComplete={loadData}
                />
              </div>
            )}
          </TabsContent>

          {/* Threads Tab */}
          <TabsContent value="threads" className="space-y-4">
            {/* Toolbar */}
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center gap-4">
                  {/* Search */}
                  <div className="flex items-center gap-2 flex-1 max-w-md">
                    <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <Input
                      placeholder="Rechercher par sujet, client, projet..."
                      value={threadSearchQuery}
                      onChange={(e) => setThreadSearchQuery(e.target.value)}
                      className="h-9"
                    />
                    {threadSearchQuery && (
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => setThreadSearchQuery('')}
                        className="h-9 px-2"
                      >
                        ✕
                      </Button>
                    )}
                  </div>

                  {/* Filter */}
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-muted-foreground" />
                    <Select value={threadFilter} onValueChange={(v: 'quotation' | 'all') => setThreadFilter(v)}>
                      <SelectTrigger className="w-[200px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="quotation">
                          Cotations ({quotationThreadCount})
                        </SelectItem>
                        <SelectItem value="all">
                          Tous les fils ({threads.length})
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Reclassify threads */}
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={reclassifyThreads}
                    disabled={isReclassifyingThreads}
                  >
                    <RotateCcw className={`h-4 w-4 mr-2 ${isReclassifyingThreads ? 'animate-spin' : ''}`} />
                    Reclassifier fils
                  </Button>

                  {otherThreadCount > 0 && threadFilter === 'all' && (
                    <Badge variant="secondary" className="text-xs">
                      {otherThreadCount} fil(s) non-cotation
                    </Badge>
                  )}

                  {/* Search results count */}
                  {threadSearchQuery && (
                    <Badge variant="outline" className="text-xs">
                      {filteredThreads.length} résultat(s)
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            {filteredThreads.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <GitBranch className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Aucun fil de discussion détecté</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Les fils seront créés automatiquement lors de la synchronisation des emails
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {filteredThreads.map((thread) => (
                  <Card key={thread.id} className={`${thread.our_role === 'assist_partner' ? 'border-l-4 border-l-amber-500' : 'border-l-4 border-l-primary'}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            {thread.project_name && (
                              <Badge variant="secondary" className="text-xs">
                                📋 {thread.project_name}
                              </Badge>
                            )}
                            {thread.our_role === 'assist_partner' ? (
                              <Badge variant="outline" className="text-amber-600 border-amber-500">
                                <Users className="h-3 w-3 mr-1" />
                                Assister Partenaire
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-primary">
                                <Star className="h-3 w-3 mr-1" />
                                Cotation Directe
                              </Badge>
                            )}
                            <Badge variant="outline">
                              {thread.email_count} message(s)
                            </Badge>
                            {thread.is_quotation_thread === false && (
                              <Badge variant="outline" className="text-muted-foreground">
                                Non-cotation
                              </Badge>
                            )}
                          </div>
                          
                          <p className="font-semibold">{thread.subject_normalized}</p>
                          
                          <div className="mt-2">
                            <ThreadParticipantsSummary participants={thread.participants} />
                          </div>
                          
                          <div className="text-xs text-muted-foreground mt-2">
                            <Clock className="h-3 w-3 inline mr-1" />
                            {thread.first_message_at && new Date(thread.first_message_at).toLocaleDateString('fr-FR')} 
                            {' → '}
                            {thread.last_message_at && new Date(thread.last_message_at).toLocaleDateString('fr-FR')}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="knowledge">
            <LearnedKnowledge />
          </TabsContent>

          <TabsContent value="inbox" className="space-y-4">
            {/* Toolbar */}
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center gap-4">
                  {/* Search */}
                  <div className="flex items-center gap-2 flex-1 max-w-md">
                    <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <Input
                      placeholder="Rechercher par sujet, expéditeur ou contenu..."
                      value={emailSearchQuery}
                      onChange={(e) => setEmailSearchQuery(e.target.value)}
                      className="h-9"
                    />
                    {emailSearchQuery && (
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => setEmailSearchQuery('')}
                        className="h-9 px-2"
                      >
                        ✕
                      </Button>
                    )}
                  </div>

                  {/* Filter */}
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-muted-foreground" />
                    <Select value={filter} onValueChange={(v: 'all' | 'quotation' | 'other' | 'with_attachments' | 'without_attachments') => setFilter(v)}>
                      <SelectTrigger className="w-[220px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Tous ({emails.length})</SelectItem>
                        <SelectItem value="quotation">Cotations ({quotationCount})</SelectItem>
                        <SelectItem value="other">Autres ({otherCount})</SelectItem>
                        <SelectItem value="with_attachments">
                          <span className="flex items-center gap-2">
                            <Paperclip className="h-3 w-3" />
                            Avec pièces jointes ({withAttachmentsCount})
                          </span>
                        </SelectItem>
                        <SelectItem value="without_attachments">Sans pièces jointes ({withoutAttachmentsCount})</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Selection actions */}
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={toggleSelectAll}
                    >
                      <CheckSquare className="h-4 w-4 mr-1" />
                      {selectedEmailIds.size === filteredEmails.length && filteredEmails.length > 0 
                        ? 'Désélectionner' 
                        : 'Tout sélectionner'}
                    </Button>

                    {selectedEmailIds.size > 0 && (
                      <Button 
                        variant="destructive" 
                        size="sm"
                        onClick={deleteSelectedEmails}
                        disabled={isDeleting}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Supprimer ({selectedEmailIds.size})
                      </Button>
                    )}
                  </div>

                  {/* Reclassify button */}
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={reclassifyEmails}
                    disabled={isReclassifying || emails.length === 0}
                  >
                    <RotateCcw className={`h-4 w-4 mr-1 ${isReclassifying ? 'animate-spin' : ''}`} />
                    {isReclassifying ? 'Reclassification...' : 'Reclassifier'}
                  </Button>

                  {/* Purge button */}
                  {otherCount > 0 && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={purgeNonQuotation}
                      disabled={isDeleting}
                      className="text-destructive border-destructive hover:bg-destructive/10"
                    >
                      <AlertTriangle className="h-4 w-4 mr-1" />
                      Purger non-cotations ({otherCount})
                    </Button>
                  )}

                  {/* Search results count */}
                  {emailSearchQuery && (
                    <Badge variant="outline" className="text-xs">
                      {filteredEmails.length} résultat(s)
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            {filteredEmails.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Mail className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">
                    {emails.length === 0 
                      ? 'Aucun email synchronisé' 
                      : 'Aucun email avec ce filtre'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {filteredEmails.map((email) => (
                  <Card 
                    key={email.id} 
                    className={`cursor-pointer hover:bg-accent/50 transition-colors ${
                      email.is_quotation_request ? 'border-l-4 border-l-primary' : ''
                    } ${selectedEmailIds.has(email.id) ? 'ring-2 ring-primary' : ''}`}
                    onClick={() => setSelectedEmail(email)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        {/* Checkbox */}
                        <div className="pt-1" onClick={(e) => toggleEmailSelection(email.id, e)}>
                          <Checkbox 
                            checked={selectedEmailIds.has(email.id)}
                            onCheckedChange={() => {}}
                          />
                        </div>

                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{email.from_address}</span>
                            {attachmentCounts[email.id] > 0 ? (
                              <div className="flex items-center gap-1">
                                {attachmentDetails[email.id]?.types.map((type, idx) => {
                                  const getTypeIcon = () => {
                                    switch(type) {
                                      case 'PDF': return <FileText className="h-3 w-3" />;
                                      case 'Excel': case 'CSV': return <FileSpreadsheet className="h-3 w-3" />;
                                      case 'Word': return <FileText className="h-3 w-3" />;
                                      case 'Image': return <ImageIcon className="h-3 w-3" />;
                                      case 'Archive': return <FileArchive className="h-3 w-3" />;
                                      default: return <File className="h-3 w-3" />;
                                    }
                                  };
                                  const getTypeColor = () => {
                                    switch(type) {
                                      case 'PDF': return 'bg-red-500/20 text-red-600 border-red-500/30';
                                      case 'Excel': case 'CSV': return 'bg-green-500/20 text-green-600 border-green-500/30';
                                      case 'Word': return 'bg-blue-500/20 text-blue-600 border-blue-500/30';
                                      case 'Image': return 'bg-purple-500/20 text-purple-600 border-purple-500/30';
                                      case 'Archive': return 'bg-amber-500/20 text-amber-600 border-amber-500/30';
                                      default: return 'bg-gray-500/20 text-gray-600 border-gray-500/30';
                                    }
                                  };
                                  return (
                                    <Badge key={idx} className={`${getTypeColor()} text-xs px-1.5`}>
                                      {getTypeIcon()}
                                      <span className="ml-1">{type}</span>
                                    </Badge>
                                  );
                                })}
                                {attachmentCounts[email.id] > 1 && (
                                  <span className="text-xs text-muted-foreground">
                                    ({attachmentCounts[email.id]})
                                  </span>
                                )}
                              </div>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground/50 border-dashed">
                                <Mail className="h-3 w-3 mr-1" />
                                Sans pièce jointe
                              </Badge>
                            )}
                            {email.is_quotation_request && (
                              <Badge variant="secondary">
                                <Star className="h-3 w-3 mr-1" />
                                Cotation
                              </Badge>
                            )}
                            {email.extracted_data?.learned && (
                              <Badge variant="outline" className="text-green-600">
                                <Brain className="h-3 w-3 mr-1" />
                                Appris
                              </Badge>
                            )}
                          </div>
                          <p className="font-semibold mt-1">{email.subject}</p>
                          <p className="text-sm text-muted-foreground line-clamp-1 mt-1">
                            {email.body_text?.substring(0, 150)}...
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">
                            <Clock className="h-3 w-3 inline mr-1" />
                            {new Date(email.sent_at).toLocaleDateString('fr-FR')}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={(e) => deleteEmail(email.id, e)}
                            disabled={isDeleting}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="quotations" className="space-y-4">
            {emails.filter(e => e.is_quotation_request).map((email) => (
              <Card key={email.id} className="border-l-4 border-l-primary">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <span className="font-medium">{email.from_address}</span>
                      <p className="font-semibold mt-1">{email.subject}</p>
                      <p className="text-sm text-muted-foreground mt-2">
                        {email.body_text?.substring(0, 300)}...
                      </p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => openGuidanceDialog(email.id, email.subject || 'Sans objet')}
                      >
                        <MessageSquare className="h-4 w-4 mr-1" />
                        Répondre
                      </Button>
                      <Button 
                        size="sm" 
                        variant="ghost"
                        onClick={() => learnFromEmail(email.id)}
                      >
                        <Brain className="h-4 w-4 mr-1" />
                        Apprendre
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={(e) => deleteEmail(email.id, e)}
                        disabled={isDeleting}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Supprimer
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="drafts" className="space-y-4">
            {drafts.map((draft) => (
              <Card key={draft.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <Badge variant={draft.status === 'sent' ? 'default' : 'secondary'}>
                        {draft.status}
                      </Badge>
                      <p className="font-semibold mt-2">{draft.subject}</p>
                      <p className="text-sm text-muted-foreground">
                        À: {draft.to_addresses.join(', ')}
                      </p>
                      <p className="text-sm mt-2 line-clamp-3">{draft.body_text}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setSelectedDraft(draft)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      {draft.status === 'draft' && (
                        <Button size="sm">
                          <Send className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="configs" className="space-y-4">
            {configs.map((config) => (
              <Card key={config.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{config.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {config.username} @ {config.host}:{config.port}
                      </p>
                      {config.last_sync_at && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Dernière sync: {new Date(config.last_sync_at).toLocaleString('fr-FR')}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => syncEmails(config.id)}
                        disabled={syncing}
                      >
                        <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? 'animate-spin' : ''}`} />
                        Synchroniser
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => deleteConfig(config.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>

        {/* Email Detail Dialog */}
        <Dialog open={!!selectedEmail} onOpenChange={() => setSelectedEmail(null)}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            {selectedEmail && (
              <>
                <DialogHeader>
                  <DialogTitle>{selectedEmail.subject}</DialogTitle>
                  <DialogDescription>De: {selectedEmail.from_address}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span>De: <strong>{selectedEmail.from_address}</strong></span>
                    <span className="text-muted-foreground">
                      {new Date(selectedEmail.sent_at).toLocaleString('fr-FR')}
                    </span>
                  </div>
                  <div className="prose prose-sm max-w-none">
                    <pre className="whitespace-pre-wrap bg-muted p-4 rounded-lg text-sm">
                      {selectedEmail.body_text}
                    </pre>
                  </div>
                  
                  {/* Attachments */}
                  <EmailAttachments emailId={selectedEmail.id} />
                  
                  <div className="flex gap-2 flex-wrap">
                    <Button onClick={() => {
                      setSelectedEmail(null);
                      openGuidanceDialog(selectedEmail.id, selectedEmail.subject || 'Sans objet');
                    }}>
                      <MessageSquare className="h-4 w-4 mr-2" />
                      Générer réponse
                    </Button>
                    <Button variant="outline" onClick={() => learnFromEmail(selectedEmail.id)}>
                      <Brain className="h-4 w-4 mr-2" />
                      Apprendre
                    </Button>
                    <Button 
                      variant="destructive" 
                      onClick={() => deleteEmail(selectedEmail.id)}
                      disabled={isDeleting}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Supprimer
                    </Button>
                  </div>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Add Config Dialog */}
        <Dialog open={showConfigDialog} onOpenChange={setShowConfigDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ajouter un compte email</DialogTitle>
              <DialogDescription>Configurez votre compte IMAP pour synchroniser vos emails</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <Input
                placeholder="Nom (ex: Gmail Pro)"
                value={newConfig.name}
                onChange={(e) => setNewConfig({ ...newConfig, name: e.target.value })}
              />
              <Input
                placeholder="Serveur IMAP (ex: imap.gmail.com)"
                value={newConfig.host}
                onChange={(e) => setNewConfig({ ...newConfig, host: e.target.value })}
              />
              <Input
                type="number"
                placeholder="Port (993)"
                value={newConfig.port}
                onChange={(e) => setNewConfig({ ...newConfig, port: parseInt(e.target.value) })}
              />
              <Input
                placeholder="Email"
                value={newConfig.username}
                onChange={(e) => setNewConfig({ ...newConfig, username: e.target.value })}
              />
              <Input
                type="password"
                placeholder="Mot de passe / App Password"
                value={newConfig.password}
                onChange={(e) => setNewConfig({ ...newConfig, password: e.target.value })}
              />
              <Button className="w-full" onClick={addConfig}>
                Ajouter
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Draft Detail Dialog */}
        <Dialog open={!!selectedDraft} onOpenChange={() => setSelectedDraft(null)}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            {selectedDraft && (
              <>
                <DialogHeader>
                  <DialogTitle>{selectedDraft.subject}</DialogTitle>
                  <DialogDescription>Brouillon de réponse</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span>À: <strong>{selectedDraft.to_addresses.join(', ')}</strong></span>
                    <Badge variant={selectedDraft.status === 'sent' ? 'default' : 'secondary'}>
                      {selectedDraft.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Créé le: {new Date(selectedDraft.created_at).toLocaleString('fr-FR')}
                  </div>
                  <div className="prose prose-sm max-w-none">
                    <pre className="whitespace-pre-wrap bg-muted p-4 rounded-lg text-sm">
                      {selectedDraft.body_text}
                    </pre>
                  </div>
                  {selectedDraft.original_email_id && selectedDraft.status === 'draft' && (
                    <div className="flex gap-2 pt-2 border-t">
                      <Button 
                        variant="outline"
                        onClick={() => {
                          const emailId = selectedDraft.original_email_id;
                          const subject = selectedDraft.subject.replace('Re: ', '');
                          setSelectedDraft(null);
                          openGuidanceDialog(emailId, subject);
                        }}
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Régénérer avec instructions
                      </Button>
                    </div>
                  )}
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Response Guidance Dialog */}
        <ResponseGuidanceDialog
          open={showGuidanceDialog}
          onOpenChange={setShowGuidanceDialog}
          onGenerate={handleGenerateWithGuidance}
          emailSubject={guidanceEmailSubject}
          isRegenerating={!!selectedDraft}
        />
      </div>
    </div>
  );
}
