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
  User,
  Package,
  MapPin,
  FileText,
  DollarSign,
  Ship,
  Loader2,
  Mail,
  Paperclip,
  History,
  Plus,
  Trash2,
  Building2,
  Users,
  Anchor,
  Truck,
  Container,
  Boxes
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

interface CargoLine {
  id: string;
  description: string;
  origin: string;
  cargo_type: 'container' | 'breakbulk';
  container_type?: string;
  container_count?: number;
  coc_soc?: 'COC' | 'SOC';
  weight_kg?: number;
  volume_cbm?: number;
  dimensions?: string;
  pieces?: number;
}

interface ServiceLine {
  id: string;
  service: string;
  description: string;
  unit: string;
  quantity: number;
  rate?: number;
  currency: string;
}

interface ProjectContext {
  requesting_party: string;
  requesting_company: string;
  end_client?: string;
  end_client_company?: string;
  our_role: 'direct' | 'partner_support';
  partner_email?: string;
  partner_company?: string;
  project_name?: string;
  project_location?: string;
}

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
  to_addresses?: string[];
  cc_addresses?: string[];
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
  type: 'warning' | 'info' | 'error' | 'success';
  message: string;
  field?: string;
}

const containerTypes = [
  { value: '20DV', label: "20' Dry" },
  { value: '40DV', label: "40' Dry" },
  { value: '40HC', label: "40' HC" },
  { value: '40HC-OT', label: "40' HC Open Top" },
  { value: '40FR', label: "40' Flat Rack" },
  { value: '20RF', label: "20' Reefer" },
  { value: '40RF', label: "40' Reefer" },
];

const incoterms = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];

const serviceTemplates = [
  { service: 'DTHC', description: 'Destination Terminal Handling', unit: 'EVP' },
  { service: 'ON_CARRIAGE', description: 'Transport vers site', unit: 'voyage' },
  { service: 'EMPTY_RETURN', description: 'Retour conteneur vide', unit: 'EVP' },
  { service: 'DISCHARGE', description: 'Déchargement navire (breakbulk)', unit: 'tonne' },
  { service: 'PORT_CHARGES', description: 'Frais de port Dakar', unit: 'tonne' },
  { service: 'TRUCKING', description: 'Transport routier vers site', unit: 'voyage' },
  { service: 'CUSTOMS', description: 'Dédouanement', unit: 'déclaration' },
];

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
  
  // Project context
  const [projectContext, setProjectContext] = useState<ProjectContext>({
    requesting_party: '',
    requesting_company: '',
    our_role: 'direct',
  });

  // Cargo lines (multiple items)
  const [cargoLines, setCargoLines] = useState<CargoLine[]>([]);
  
  // Service lines for quotation
  const [serviceLines, setServiceLines] = useState<ServiceLine[]>([]);

  // General quotation info
  const [destination, setDestination] = useState('Dakar');
  const [finalDestination, setFinalDestination] = useState('');
  const [incoterm, setIncoterm] = useState('DAP');
  const [specialRequirements, setSpecialRequirements] = useState('');

  useEffect(() => {
    if (!isNewQuotation && emailId) {
      fetchEmailData();
    }
  }, [emailId]);

  const fetchEmailData = async () => {
    try {
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
        to_addresses: emailData.to_addresses,
        cc_addresses: emailData.cc_addresses,
        body_text: emailData.body_text,
        received_at: emailData.received_at || emailData.created_at || '',
        extracted_data: extractedData,
      };
      setEmail(emailForState);

      // Analyze email to determine project context
      analyzeEmailContext(emailForState);

      // Pre-fill form with extracted data
      if (extractedData && typeof extractedData === 'object') {
        if (extractedData.destination) setDestination(extractedData.destination);
        if (extractedData.incoterm) setIncoterm(extractedData.incoterm);
        if (extractedData.special_requirements) setSpecialRequirements(extractedData.special_requirements);
        
        // Create initial cargo line if data exists
        if (extractedData.cargo || extractedData.container_type) {
          setCargoLines([{
            id: crypto.randomUUID(),
            description: extractedData.cargo || '',
            origin: extractedData.origin || '',
            cargo_type: 'container',
            container_type: extractedData.container_type || '40HC',
            container_count: parseInt(extractedData.container_count || '1'),
            coc_soc: 'COC',
            weight_kg: extractedData.weight ? parseFloat(extractedData.weight) : undefined,
            volume_cbm: extractedData.volume ? parseFloat(extractedData.volume) : undefined,
          }]);
        }
      }

      // Fetch attachments
      const { data: attachmentData } = await supabase
        .from('email_attachments')
        .select('id, filename, content_type')
        .eq('email_id', emailId);
      
      setAttachments(attachmentData || []);

      // Generate alerts
      generateAlerts(extractedData || {}, emailForState);
      
      // Fetch suggestions
      await fetchSuggestions(emailForState);
    } catch (error) {
      console.error('Error fetching email:', error);
      toast.error('Erreur de chargement de l\'email');
    } finally {
      setIsLoading(false);
    }
  };

  const analyzeEmailContext = (emailData: Email) => {
    const fromEmail = emailData.from_address.toLowerCase();
    const toAddresses = emailData.to_addresses?.map(e => e.toLowerCase()) || [];
    const ccAddresses = emailData.cc_addresses?.map(e => e.toLowerCase()) || [];
    const allAddresses = [...toAddresses, ...ccAddresses];
    
    // Check if SODATRA is in TO or CC
    const sodatraInLoop = allAddresses.some(e => 
      e.includes('sodatra') || e.includes('@sodatra.sn')
    );
    
    // Check if 2HL is in TO
    const twoHLInTo = toAddresses.some(e => 
      e.includes('2hl') || e.includes('2hlgroup')
    );
    
    // Check if request is FROM 2HL (partner forwarding)
    const fromTwoHL = fromEmail.includes('2hl') || fromEmail.includes('2hlgroup');
    
    // Determine our role and the actors
    let context: ProjectContext = {
      requesting_party: '',
      requesting_company: '',
      our_role: 'direct',
    };

    // Extract sender name from email address
    const senderName = fromEmail.split('@')[0]
      .replace(/[._-]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
    
    const senderDomain = fromEmail.split('@')[1]?.split('.')[0]?.toUpperCase() || '';

    if (fromTwoHL) {
      // 2HL is forwarding a request - we support 2HL
      context = {
        requesting_party: senderName,
        requesting_company: '2HL Group',
        our_role: 'partner_support',
        partner_email: fromEmail,
        partner_company: '2HL Group',
        end_client: 'À identifier dans l\'email',
      };
      
      setAlerts(prev => [...prev, {
        type: 'info',
        message: '2HL nous a mis en copie - Nous assistons 2HL pour cette cotation',
      }]);
    } else if (twoHLInTo && !sodatraInLoop) {
      // Request sent TO 2HL, SODATRA not originally in loop
      context = {
        requesting_party: senderName,
        requesting_company: senderDomain,
        our_role: 'partner_support',
        partner_company: '2HL Group',
        end_client: senderName,
        end_client_company: senderDomain,
      };
      
      setAlerts(prev => [...prev, {
        type: 'info',
        message: `Demande client de ${senderDomain} à 2HL - Nous préparons les éléments pour 2HL`,
      }]);
    } else {
      // Direct request to SODATRA
      context = {
        requesting_party: senderName,
        requesting_company: senderDomain,
        our_role: 'direct',
      };
    }

    // Try to extract project name from subject
    if (emailData.subject) {
      context.project_name = emailData.subject
        .replace(/^(RE:|FW:|TR:)\s*/gi, '')
        .replace(/^(demande|offre|cotation|devis)[\s:]+/gi, '')
        .substring(0, 100);
    }

    setProjectContext(context);
  };

  const generateAlerts = (data: ExtractedData, emailData?: Email) => {
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
    
    // Check for project cargo indicators
    const bodyLower = emailData?.body_text?.toLowerCase() || '';
    if (bodyLower.includes('breakbulk') || bodyLower.includes('break bulk')) {
      newAlerts.push({ type: 'info', message: 'Cargo conventionnel (breakbulk) détecté' });
    }
    if (bodyLower.includes('project') || bodyLower.includes('projet')) {
      newAlerts.push({ type: 'info', message: 'Projet cargo détecté - Cotation complexe probable' });
    }
    if (bodyLower.includes('soc') || bodyLower.includes('shipper owned')) {
      newAlerts.push({ type: 'info', message: 'Conteneurs SOC mentionnés' });
    }
    if (bodyLower.includes('coc') || bodyLower.includes('carrier owned')) {
      newAlerts.push({ type: 'info', message: 'Conteneurs COC mentionnés' });
    }
    if (bodyLower.includes('flat rack') || bodyLower.includes('40fr')) {
      newAlerts.push({ type: 'info', message: 'Flat Rack détecté - Vérifier disponibilité' });
    }
    if (bodyLower.includes('saint louis') || bodyLower.includes('saint-louis')) {
      newAlerts.push({ type: 'info', message: 'Destination Saint-Louis - Prévoir on-carriage' });
    }
    
    setAlerts(newAlerts);
  };

  const fetchSuggestions = async (emailData: Email) => {
    try {
      const { data: knowledge } = await supabase
        .from('learned_knowledge')
        .select('*')
        .eq('category', 'template')
        .eq('is_validated', true)
        .limit(5);

      const newSuggestions: Suggestion[] = [];
      
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

  const addCargoLine = (type: 'container' | 'breakbulk') => {
    const newLine: CargoLine = {
      id: crypto.randomUUID(),
      description: '',
      origin: '',
      cargo_type: type,
      container_type: type === 'container' ? '40HC' : undefined,
      container_count: type === 'container' ? 1 : undefined,
      coc_soc: 'COC',
    };
    setCargoLines([...cargoLines, newLine]);
  };

  const updateCargoLine = (id: string, updates: Partial<CargoLine>) => {
    setCargoLines(cargoLines.map(line => 
      line.id === id ? { ...line, ...updates } : line
    ));
  };

  const removeCargoLine = (id: string) => {
    setCargoLines(cargoLines.filter(line => line.id !== id));
  };

  const addServiceLine = (template?: typeof serviceTemplates[0]) => {
    const newLine: ServiceLine = {
      id: crypto.randomUUID(),
      service: template?.service || '',
      description: template?.description || '',
      unit: template?.unit || 'forfait',
      quantity: 1,
      currency: 'FCFA',
    };
    setServiceLines([...serviceLines, newLine]);
  };

  const updateServiceLine = (id: string, updates: Partial<ServiceLine>) => {
    setServiceLines(serviceLines.map(line => 
      line.id === id ? { ...line, ...updates } : line
    ));
  };

  const removeServiceLine = (id: string) => {
    setServiceLines(serviceLines.filter(line => line.id !== id));
  };

  const handleGenerateResponse = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-response', {
        body: { 
          emailId: isNewQuotation ? null : emailId,
          quotationData: {
            projectContext,
            cargoLines,
            serviceLines,
            destination,
            finalDestination,
            incoterm,
            specialRequirements,
          },
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
          {/* Left Column: Main Form */}
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
                        {alert.type === 'success' && <CheckCircle className="h-3 w-3 text-green-500" />}
                        <span className="text-muted-foreground">{alert.message}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Project Context */}
            <Card className="border-ocean/30 bg-ocean/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-ocean" />
                  Contexte du projet
                </CardTitle>
                <CardDescription>
                  {projectContext.our_role === 'partner_support' 
                    ? "Nous assistons notre partenaire pour cette cotation"
                    : "Cotation directe client"
                  }
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Demandeur</Label>
                    <Input
                      value={projectContext.requesting_party}
                      onChange={(e) => setProjectContext({...projectContext, requesting_party: e.target.value})}
                      placeholder="Nom du contact"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Société</Label>
                    <Input
                      value={projectContext.requesting_company}
                      onChange={(e) => setProjectContext({...projectContext, requesting_company: e.target.value})}
                      placeholder="Entreprise"
                    />
                  </div>
                </div>
                
                {projectContext.our_role === 'partner_support' && (
                  <div className="p-3 rounded-lg bg-ocean/10 border border-ocean/20">
                    <div className="flex items-center gap-2 mb-2">
                      <Building2 className="h-4 w-4 text-ocean" />
                      <span className="text-sm font-medium">Partenaire: {projectContext.partner_company}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Nous préparons les éléments de cotation pour {projectContext.partner_company}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Nom du projet</Label>
                    <Input
                      value={projectContext.project_name || ''}
                      onChange={(e) => setProjectContext({...projectContext, project_name: e.target.value})}
                      placeholder="Ex: Youth Olympic Games 2026"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Lieu du projet</Label>
                    <Input
                      value={projectContext.project_location || ''}
                      onChange={(e) => setProjectContext({...projectContext, project_location: e.target.value})}
                      placeholder="Ex: Saint-Louis"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Cargo Lines */}
            <Card className="border-border/50 bg-gradient-card">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Package className="h-4 w-4 text-primary" />
                    Marchandises ({cargoLines.length})
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => addCargoLine('container')}>
                      <Container className="h-4 w-4 mr-1" />
                      Conteneur
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => addCargoLine('breakbulk')}>
                      <Boxes className="h-4 w-4 mr-1" />
                      Breakbulk
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {cargoLines.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Ajoutez des lignes de marchandise</p>
                  </div>
                ) : (
                  cargoLines.map((line, index) => (
                    <div key={line.id} className="p-4 rounded-lg border bg-muted/30 space-y-3">
                      <div className="flex items-center justify-between">
                        <Badge variant={line.cargo_type === 'container' ? 'default' : 'secondary'}>
                          {line.cargo_type === 'container' ? (
                            <><Container className="h-3 w-3 mr-1" /> Conteneur</>
                          ) : (
                            <><Boxes className="h-3 w-3 mr-1" /> Breakbulk</>
                          )}
                        </Badge>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          onClick={() => removeCargoLine(line.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs">Description</Label>
                          <Input
                            value={line.description}
                            onChange={(e) => updateCargoLine(line.id, { description: e.target.value })}
                            placeholder="Description marchandise"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Origine</Label>
                          <Input
                            value={line.origin}
                            onChange={(e) => updateCargoLine(line.id, { origin: e.target.value })}
                            placeholder="Pays/Port"
                          />
                        </div>
                      </div>

                      {line.cargo_type === 'container' ? (
                        <div className="grid grid-cols-4 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Type</Label>
                            <Select 
                              value={line.container_type || '40HC'} 
                              onValueChange={(v) => updateCargoLine(line.id, { container_type: v })}
                            >
                              <SelectTrigger className="h-9">
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
                          <div className="space-y-1">
                            <Label className="text-xs">Nombre</Label>
                            <Input
                              type="number"
                              min="1"
                              value={line.container_count || 1}
                              onChange={(e) => updateCargoLine(line.id, { container_count: parseInt(e.target.value) })}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">COC/SOC</Label>
                            <Select 
                              value={line.coc_soc || 'COC'} 
                              onValueChange={(v) => updateCargoLine(line.id, { coc_soc: v as 'COC' | 'SOC' })}
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="COC">COC (Armateur)</SelectItem>
                                <SelectItem value="SOC">SOC (Chargeur)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Poids (kg)</Label>
                            <Input
                              type="number"
                              value={line.weight_kg || ''}
                              onChange={(e) => updateCargoLine(line.id, { weight_kg: parseFloat(e.target.value) })}
                              placeholder="18000"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-4 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Poids (kg)</Label>
                            <Input
                              type="number"
                              value={line.weight_kg || ''}
                              onChange={(e) => updateCargoLine(line.id, { weight_kg: parseFloat(e.target.value) })}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Volume (m³)</Label>
                            <Input
                              type="number"
                              value={line.volume_cbm || ''}
                              onChange={(e) => updateCargoLine(line.id, { volume_cbm: parseFloat(e.target.value) })}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Dimensions</Label>
                            <Input
                              value={line.dimensions || ''}
                              onChange={(e) => updateCargoLine(line.id, { dimensions: e.target.value })}
                              placeholder="L x l x H"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Pièces</Label>
                            <Input
                              type="number"
                              value={line.pieces || ''}
                              onChange={(e) => updateCargoLine(line.id, { pieces: parseInt(e.target.value) })}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Route & Incoterm */}
            <Card className="border-border/50 bg-gradient-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Ship className="h-4 w-4 text-primary" />
                  Itinéraire & Conditions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Port de destination</Label>
                    <Input
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                      placeholder="Dakar"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Destination finale (si on-carriage)</Label>
                    <Input
                      value={finalDestination}
                      onChange={(e) => setFinalDestination(e.target.value)}
                      placeholder="Ex: Saint-Louis"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Incoterm demandé</Label>
                  <div className="flex flex-wrap gap-2">
                    {incoterms.map((inc) => (
                      <Badge
                        key={inc}
                        variant={incoterm === inc ? 'default' : 'outline'}
                        className={cn(
                          'cursor-pointer transition-colors',
                          incoterm === inc 
                            ? 'bg-primary text-primary-foreground' 
                            : 'hover:bg-primary/10'
                        )}
                        onClick={() => setIncoterm(inc)}
                      >
                        {inc}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Exigences particulières</Label>
                  <Textarea
                    value={specialRequirements}
                    onChange={(e) => setSpecialRequirements(e.target.value)}
                    placeholder="Déchargement sur site non inclus, conteneurs SOC à retourner vides..."
                    rows={2}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Services to Quote */}
            <Card className="border-border/50 bg-gradient-card">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-primary" />
                    Services à coter ({serviceLines.length})
                  </CardTitle>
                  <Select onValueChange={(v) => {
                    const template = serviceTemplates.find(t => t.service === v);
                    if (template) addServiceLine(template);
                  }}>
                    <SelectTrigger className="w-[200px] h-8">
                      <Plus className="h-4 w-4 mr-1" />
                      <span className="text-sm">Ajouter service</span>
                    </SelectTrigger>
                    <SelectContent>
                      {serviceTemplates.map((t) => (
                        <SelectItem key={t.service} value={t.service}>
                          {t.description}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {serviceLines.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <DollarSign className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Ajoutez les services demandés</p>
                    <div className="flex flex-wrap justify-center gap-2 mt-3">
                      {serviceTemplates.slice(0, 4).map((t) => (
                        <Badge 
                          key={t.service} 
                          variant="outline" 
                          className="cursor-pointer hover:bg-primary/10"
                          onClick={() => addServiceLine(t)}
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          {t.description}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : (
                  serviceLines.map((line) => (
                    <div key={line.id} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                      <div className="flex-1">
                        <Input
                          value={line.description}
                          onChange={(e) => updateServiceLine(line.id, { description: e.target.value })}
                          className="font-medium"
                        />
                      </div>
                      <div className="w-20">
                        <Input
                          type="number"
                          value={line.quantity}
                          onChange={(e) => updateServiceLine(line.id, { quantity: parseInt(e.target.value) })}
                          className="text-center"
                        />
                      </div>
                      <div className="w-24">
                        <Input
                          value={line.unit}
                          onChange={(e) => updateServiceLine(line.id, { unit: e.target.value })}
                          placeholder="unité"
                        />
                      </div>
                      <div className="w-28">
                        <Input
                          type="number"
                          value={line.rate || ''}
                          onChange={(e) => updateServiceLine(line.id, { rate: parseFloat(e.target.value) })}
                          placeholder="Tarif"
                        />
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => removeServiceLine(line.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Generated Response */}
            {generatedResponse && (
              <Card className="border-primary/30 bg-primary/5">
                <CardHeader>
                  <CardTitle className="text-base flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-primary" />
                      Réponse générée
                    </span>
                    <Button variant="outline" size="sm" onClick={handleCopyResponse}>
                      <Copy className="h-4 w-4 mr-2" />
                      Copier
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={generatedResponse}
                    onChange={(e) => setGeneratedResponse(e.target.value)}
                    rows={12}
                    className="font-mono text-sm"
                  />
                </CardContent>
              </Card>
            )}
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
                    <p className="text-xs text-muted-foreground">À</p>
                    <p className="text-sm truncate">{email.to_addresses?.join(', ') || '-'}</p>
                  </div>
                  {email.cc_addresses && email.cc_addresses.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground">Cc</p>
                      <p className="text-sm truncate">{email.cc_addresses.join(', ')}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">Date</p>
                    <p className="text-sm">{formatDate(email.received_at)}</p>
                  </div>
                  {attachments.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Pièces jointes ({attachments.length})</p>
                      <div className="flex flex-wrap gap-1">
                        {attachments.map(att => (
                          <Badge key={att.id} variant="outline" className="text-xs">
                            <Paperclip className="h-3 w-3 mr-1" />
                            {att.filename.length > 20 ? att.filename.substring(0, 20) + '...' : att.filename}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  <Separator />
                  <ScrollArea className="h-[250px]">
                    <p className="text-xs whitespace-pre-wrap text-muted-foreground">
                      {email.body_text?.substring(0, 2000) || 'Aucun contenu texte'}
                      {email.body_text && email.body_text.length > 2000 && '...'}
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
                  <Truck className="h-4 w-4 mr-2" />
                  Tarifs transport routier
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
