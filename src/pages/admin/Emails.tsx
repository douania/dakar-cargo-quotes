import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { 
  Mail, Plus, RefreshCw, Star, Clock, Send, 
  MessageSquare, Brain, Trash2, Eye, Edit, Search, Paperclip
} from 'lucide-react';
import { EmailSearchImport } from '@/components/EmailSearchImport';
import { EmailAttachments } from '@/components/EmailAttachments';
import { LearnedKnowledge } from '@/components/LearnedKnowledge';

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

function getInvokeErrorMessage(err: unknown): string {
  const anyErr = err as any;

  // Supabase Functions errors often carry the response body in context
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
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  
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
      const [configsRes, emailsRes, draftsRes] = await Promise.all([
        supabase.from('email_configs').select('*').order('created_at', { ascending: false }),
        supabase.from('emails').select('*').order('sent_at', { ascending: false }).limit(50),
        supabase.from('email_drafts').select('*').order('created_at', { ascending: false })
      ]);

      if (configsRes.data) setConfigs(configsRes.data);
      if (emailsRes.data) setEmails(emailsRes.data);
      if (draftsRes.data) setDrafts(draftsRes.data);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Erreur de chargement');
    }
    setLoading(false);
  };

  const addConfig = async () => {
    if (!newConfig.name || !newConfig.host || !newConfig.username || !newConfig.password) {
      toast.error('Veuillez remplir tous les champs');
      return;
    }

    try {
      const { error } = await supabase.from('email_configs').insert({
        name: newConfig.name,
        host: newConfig.host,
        port: newConfig.port,
        username: newConfig.username,
        password_encrypted: newConfig.password // In production, encrypt this
      });

      if (error) throw error;

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

  const generateResponse = async (emailId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('generate-response', {
        body: { emailId }
      });

      if (error) throw error;

      toast.success('Brouillon généré');
      loadData();
    } catch (error) {
      console.error('Generate error:', error);
      toast.error('Erreur de génération');
    }
  };

  const deleteConfig = async (id: string) => {
    if (!confirm('Supprimer cette configuration ?')) return;
    
    try {
      await supabase.from('email_configs').delete().eq('id', id);
      toast.success('Configuration supprimée');
      loadData();
    } catch (error) {
      toast.error('Erreur de suppression');
    }
  };

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


          <TabsContent value="knowledge">
            <LearnedKnowledge />
          </TabsContent>

          <TabsContent value="inbox" className="space-y-4">
            {emails.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Mail className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Aucun email synchronisé</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Ajoutez un compte email et synchronisez pour commencer
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {emails.map((email) => (
                  <Card 
                    key={email.id} 
                    className={`cursor-pointer hover:bg-accent/50 transition-colors ${
                      email.is_quotation_request ? 'border-l-4 border-l-primary' : ''
                    }`}
                    onClick={() => setSelectedEmail(email)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{email.from_address}</span>
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
                        <div className="text-right text-sm text-muted-foreground">
                          <Clock className="h-3 w-3 inline mr-1" />
                          {new Date(email.sent_at).toLocaleDateString('fr-FR')}
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
                        onClick={() => generateResponse(email.id)}
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
                      <Button size="sm" variant="outline">
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
                  
                  <div className="flex gap-2">
                    <Button onClick={() => generateResponse(selectedEmail.id)}>
                      <MessageSquare className="h-4 w-4 mr-2" />
                      Générer réponse
                    </Button>
                    <Button variant="outline" onClick={() => learnFromEmail(selectedEmail.id)}>
                      <Brain className="h-4 w-4 mr-2" />
                      Apprendre
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
      </div>
    </div>
  );
}
