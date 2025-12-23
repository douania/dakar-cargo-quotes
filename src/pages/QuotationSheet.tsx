import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  ArrowLeft, 
  AlertTriangle, 
  CheckCircle, 
  HelpCircle,
  Lightbulb,
  Copy,
  Send,
  Edit3,
  User,
  Package,
  MapPin,
  FileText,
  Clock,
  DollarSign,
  Ship,
  Loader2,
  RefreshCw,
  Mail,
  Paperclip,
  History
} from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ExtractedData {
  client?: string;
  company?: string;
  cargo?: string;
  origin?: string;
  destination?: string;
  incoterm?: string;
  container_type?: string;
  container_count?: string;
  weight?: string;
  volume?: string;
  urgency?: string;
  hs_code?: string;
  special_requirements?: string;
}

interface Email {
  id: string;
  subject: string | null;
  from_address: string;
  body_text: string | null;
  received_at: string;
  extracted_data: ExtractedData | null;
}

interface Suggestion {
  field: string;
  value: string;
  source: string;
  confidence: number;
}

interface Alert {
  type: 'warning' | 'info' | 'error';
  message: string;
  field?: string;
}

const containerTypes = [
  { value: '20DV', label: "20' Dry" },
  { value: '40DV', label: "40' Dry" },
  { value: '40HC', label: "40' HC" },
  { value: '20RF', label: "20' Reefer" },
  { value: '40RF', label: "40' Reefer" },
];

const incoterms = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];

export default function QuotationSheet() {
  const { emailId } = useParams<{ emailId: string }>();
  const navigate = useNavigate();
  const isNewQuotation = emailId === 'new';
  
  const [isLoading, setIsLoading] = useState(!isNewQuotation);
  const [isGenerating, setIsGenerating] = useState(false);
  const [email, setEmail] = useState<Email | null>(null);
  const [attachments, setAttachments] = useState<Array<{ id: string; filename: string; content_type: string }>>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [generatedResponse, setGeneratedResponse] = useState('');
  
  // Form data
  const [formData, setFormData] = useState<ExtractedData>({
    client: '',
    company: '',
    cargo: '',
    origin: '',
    destination: 'Dakar',
    incoterm: 'CIF',
    container_type: '40HC',
    container_count: '1',
    weight: '',
    volume: '',
    hs_code: '',
    special_requirements: '',
  });

  useEffect(() => {
    if (!isNewQuotation && emailId) {
      fetchEmailData();
    }
  }, [emailId]);

  const fetchEmailData = async () => {
    try {
      // Fetch email
      const { data: emailData, error: emailError } = await supabase
        .from('emails')
        .select('*')
        .eq('id', emailId)
        .single();

      if (emailError) throw emailError;
      
      const extractedData = emailData.extracted_data as ExtractedData | null;
      const emailForState: Email = {
        id: emailData.id,
        subject: emailData.subject,
        from_address: emailData.from_address,
        body_text: emailData.body_text,
        received_at: emailData.received_at || emailData.created_at || '',
        extracted_data: extractedData,
      };
      setEmail(emailForState);

      // Pre-fill form with extracted data
      if (extractedData && typeof extractedData === 'object') {
        setFormData(prev => ({
          ...prev,
          ...extractedData,
        }));
      }

      // Extract from_address for client field if not set
      if (!extractedData?.client && emailData.from_address) {
        const clientName = emailData.from_address.split('@')[0]
          .replace(/[._-]/g, ' ')
          .replace(/\b\w/g, l => l.toUpperCase());
        setFormData(prev => ({
          ...prev,
          client: prev.client || clientName,
        }));
      }

      // Fetch attachments
      const { data: attachmentData } = await supabase
        .from('email_attachments')
        .select('id, filename, content_type')
        .eq('email_id', emailId);
      
      setAttachments(attachmentData || []);

      // Generate alerts based on extracted data
      generateAlerts(extractedData || {});
      
      // Fetch similar quotations for suggestions
      await fetchSuggestions(emailForState);
    } catch (error) {
      console.error('Error fetching email:', error);
      toast.error('Erreur de chargement de l\'email');
    } finally {
      setIsLoading(false);
    }
  };

  const generateAlerts = (data: ExtractedData) => {
    const newAlerts: Alert[] = [];
    
    if (!data.incoterm) {
      newAlerts.push({ type: 'warning', message: 'Incoterm non spécifié', field: 'incoterm' });
    }
    if (!data.cargo) {
      newAlerts.push({ type: 'warning', message: 'Description marchandise manquante', field: 'cargo' });
    }
    if (!data.origin) {
      newAlerts.push({ type: 'warning', message: 'Origine non identifiée', field: 'origin' });
    }
    if (!data.hs_code) {
      newAlerts.push({ type: 'info', message: 'Code SH à rechercher pour calcul des droits' });
    }
    
    setAlerts(newAlerts);
  };

  const fetchSuggestions = async (emailData: Email) => {
    try {
      // Search for similar past quotations in learned_knowledge
      const { data: knowledge } = await supabase
        .from('learned_knowledge')
        .select('*')
        .eq('category', 'template')
        .eq('is_validated', true)
        .limit(5);

      const newSuggestions: Suggestion[] = [];
      
      // Add template suggestions
      knowledge?.forEach(k => {
        if (k.data && typeof k.data === 'object') {
          newSuggestions.push({
            field: 'template',
            value: k.name,
            source: `Utilisé ${k.usage_count || 0} fois`,
            confidence: 0.8,
          });
        }
      });

      // Fetch tariff suggestions based on container type
      const { data: tariffs } = await supabase
        .from('port_tariffs')
        .select('*')
        .eq('provider', 'DPW')
        .eq('is_active', true)
        .limit(5);

      tariffs?.forEach(t => {
        newSuggestions.push({
          field: 'tariff',
          value: `${t.operation_type}: ${t.amount} ${t.unit || 'FCFA'}`,
          source: 'Tarif DPW 2025',
          confidence: 1.0,
        });
      });

      setSuggestions(newSuggestions);
    } catch (error) {
      console.error('Error fetching suggestions:', error);
    }
  };

  const updateField = (field: keyof ExtractedData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear related alert
    setAlerts(prev => prev.filter(a => a.field !== field));
  };

  const handleGenerateResponse = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-response', {
        body: { 
          emailId: isNewQuotation ? null : emailId,
          quotationData: formData,
        }
      });

      if (error) throw error;

      setGeneratedResponse(data.response || data.draft?.body_text || '');
      toast.success('Réponse générée');
    } catch (error) {
      console.error('Error generating response:', error);
      toast.error('Erreur de génération');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyResponse = () => {
    navigator.clipboard.writeText(generatedResponse);
    toast.success('Réponse copiée');
  };

  const formatDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), "dd MMM yyyy 'à' HH:mm", { locale: fr });
    } catch {
      return '-';
    }
  };

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
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold">
              {isNewQuotation ? 'Nouvelle cotation' : 'Fiche de cotation'}
            </h1>
            {email && (
              <p className="text-sm text-muted-foreground truncate">
                {email.subject}
              </p>
            )}
          </div>
          <Button 
            onClick={handleGenerateResponse}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Générer la réponse
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Alerts */}
            {alerts.length > 0 && (
              <Card className="border-amber-500/30 bg-amber-500/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2 text-amber-500">
                    <AlertTriangle className="h-4 w-4" />
                    Points d'attention
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1">
                    {alerts.map((alert, i) => (
                      <li key={i} className="text-sm flex items-center gap-2">
                        {alert.type === 'warning' && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                        {alert.type === 'info' && <HelpCircle className="h-3 w-3 text-ocean" />}
                        {alert.type === 'error' && <AlertTriangle className="h-3 w-3 text-red-500" />}
                        <span className="text-muted-foreground">{alert.message}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Form Sections */}
            <Tabs defaultValue="info" className="w-full">
              <TabsList className="grid grid-cols-3 mb-4">
                <TabsTrigger value="info">
                  <User className="h-4 w-4 mr-2" />
                  Client & Cargo
                </TabsTrigger>
                <TabsTrigger value="route">
                  <Ship className="h-4 w-4 mr-2" />
                  Itinéraire
                </TabsTrigger>
                <TabsTrigger value="response">
                  <FileText className="h-4 w-4 mr-2" />
                  Réponse
                </TabsTrigger>
              </TabsList>

              <TabsContent value="info">
                <Card className="border-border/50 bg-gradient-card">
                  <CardContent className="pt-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Client</Label>
                        <Input
                          value={formData.client || ''}
                          onChange={(e) => updateField('client', e.target.value)}
                          placeholder="Nom du contact"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Société</Label>
                        <Input
                          value={formData.company || ''}
                          onChange={(e) => updateField('company', e.target.value)}
                          placeholder="Nom de l'entreprise"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className={cn(!formData.cargo && 'text-amber-500')}>
                        Description marchandise {!formData.cargo && '*'}
                      </Label>
                      <Textarea
                        value={formData.cargo || ''}
                        onChange={(e) => updateField('cargo', e.target.value)}
                        placeholder="Décrivez la marchandise..."
                        rows={3}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Code SH</Label>
                        <Input
                          value={formData.hs_code || ''}
                          onChange={(e) => updateField('hs_code', e.target.value)}
                          placeholder="Ex: 8429.51.00"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Poids (kg)</Label>
                        <Input
                          type="number"
                          value={formData.weight || ''}
                          onChange={(e) => updateField('weight', e.target.value)}
                          placeholder="18000"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Volume (CBM)</Label>
                        <Input
                          type="number"
                          value={formData.volume || ''}
                          onChange={(e) => updateField('volume', e.target.value)}
                          placeholder="55"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Type conteneur</Label>
                        <Select 
                          value={formData.container_type || '40HC'} 
                          onValueChange={(v) => updateField('container_type', v)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {containerTypes.map((type) => (
                              <SelectItem key={type.value} value={type.value}>
                                {type.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Nombre</Label>
                        <Input
                          type="number"
                          min="1"
                          value={formData.container_count || '1'}
                          onChange={(e) => updateField('container_count', e.target.value)}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="route">
                <Card className="border-border/50 bg-gradient-card">
                  <CardContent className="pt-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className={cn(!formData.origin && 'text-amber-500')}>
                          Origine {!formData.origin && '*'}
                        </Label>
                        <Input
                          value={formData.origin || ''}
                          onChange={(e) => updateField('origin', e.target.value)}
                          placeholder="Ex: Shanghai, Rotterdam..."
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Destination</Label>
                        <Input
                          value={formData.destination || 'Dakar'}
                          onChange={(e) => updateField('destination', e.target.value)}
                          placeholder="Dakar"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className={cn(!formData.incoterm && 'text-amber-500')}>
                        Incoterm {!formData.incoterm && '*'}
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {incoterms.map((inc) => (
                          <Badge
                            key={inc}
                            variant={formData.incoterm === inc ? 'default' : 'outline'}
                            className={cn(
                              'cursor-pointer transition-colors',
                              formData.incoterm === inc 
                                ? 'bg-primary text-primary-foreground' 
                                : 'hover:bg-primary/10'
                            )}
                            onClick={() => updateField('incoterm', inc)}
                          >
                            {inc}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Exigences particulières</Label>
                      <Textarea
                        value={formData.special_requirements || ''}
                        onChange={(e) => updateField('special_requirements', e.target.value)}
                        placeholder="Marchandise fragile, température contrôlée, urgent..."
                        rows={2}
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="response">
                <Card className="border-border/50 bg-gradient-card">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-primary" />
                        Réponse générée
                      </span>
                      {generatedResponse && (
                        <Button variant="outline" size="sm" onClick={handleCopyResponse}>
                          <Copy className="h-4 w-4 mr-2" />
                          Copier
                        </Button>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {generatedResponse ? (
                      <Textarea
                        value={generatedResponse}
                        onChange={(e) => setGeneratedResponse(e.target.value)}
                        rows={15}
                        className="font-mono text-sm"
                      />
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>Cliquez sur "Générer la réponse" pour créer le brouillon</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Right Column: Context */}
          <div className="space-y-6">
            {/* Original Email */}
            {email && (
              <Card className="border-border/50 bg-gradient-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Mail className="h-4 w-4 text-ocean" />
                    Email original
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground">De</p>
                    <p className="text-sm font-medium truncate">{email.from_address}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Date</p>
                    <p className="text-sm">{formatDate(email.received_at)}</p>
                  </div>
                  {attachments.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Pièces jointes</p>
                      <div className="flex flex-wrap gap-1">
                        {attachments.map(att => (
                          <Badge key={att.id} variant="outline" className="text-xs">
                            <Paperclip className="h-3 w-3 mr-1" />
                            {att.filename.substring(0, 20)}...
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  <Separator />
                  <ScrollArea className="h-[200px]">
                    <p className="text-xs whitespace-pre-wrap text-muted-foreground">
                      {email.body_text?.substring(0, 1000) || 'Aucun contenu texte'}
                      {email.body_text && email.body_text.length > 1000 && '...'}
                    </p>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {/* Suggestions */}
            {suggestions.length > 0 && (
              <Card className="border-border/50 bg-gradient-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Lightbulb className="h-4 w-4 text-amber-500" />
                    Suggestions IA
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {suggestions.slice(0, 5).map((sug, i) => (
                      <div 
                        key={i} 
                        className="p-2 rounded-lg bg-muted/30 text-sm cursor-pointer hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{sug.value}</span>
                          <Badge variant="outline" className="text-xs">
                            {Math.round(sug.confidence * 100)}%
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{sug.source}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Quick Actions */}
            <Card className="border-border/50 bg-gradient-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Actions rapides</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button variant="outline" className="w-full justify-start" size="sm">
                  <DollarSign className="h-4 w-4 mr-2" />
                  Calculer droits de douane
                </Button>
                <Button variant="outline" className="w-full justify-start" size="sm">
                  <Package className="h-4 w-4 mr-2" />
                  Rechercher code SH
                </Button>
                <Button variant="outline" className="w-full justify-start" size="sm">
                  <History className="h-4 w-4 mr-2" />
                  Voir cotations similaires
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}