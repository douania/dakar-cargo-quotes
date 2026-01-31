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
  Boxes,
  Clock,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  GraduationCap,
  FileSpreadsheet,
  BookOpen,
  Info,
  ExternalLink,
  ShieldCheck
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { SimilarQuotationsPanel } from '@/components/SimilarQuotationsPanel';
import { LearnFromEmailPanel } from '@/components/LearnFromEmailPanel';
import { HistoricalRateReminders } from '@/components/HistoricalRateReminders';
import { QuotationExcelExport } from '@/components/QuotationExcelExport';

// Composants UI P0 extraits (Phase 3A)
import { RegulatoryInfoCard } from '@/features/quotation/components/RegulatoryInfoCard';
import { AlertsPanel } from '@/features/quotation/components/AlertsPanel';
import { SuggestionsCard } from '@/features/quotation/components/SuggestionsCard';
import { QuickActionsCard } from '@/features/quotation/components/QuickActionsCard';
// Composants UI P1 extraits (Phase 3B)
import { QuotationHeader } from '@/features/quotation/components/QuotationHeader';
import { ThreadTimelineCard } from '@/features/quotation/components/ThreadTimelineCard';
// Composants UI P2 extraits (Phase 4B)
import { QuotationCompletedBanner } from '@/features/quotation/components/QuotationCompletedBanner';
// Composants UI P3 extraits (Phase 4D)
import { CargoLinesForm } from '@/features/quotation/components/CargoLinesForm';
import { ServiceLinesForm } from '@/features/quotation/components/ServiceLinesForm';
// Constantes depuis le fichier centralisé
import { containerTypes, incoterms, serviceTemplates } from '@/features/quotation/constants';

// Types depuis le fichier centralisé
import type { 
  CargoLine, 
  ServiceLine, 
  ProjectContext, 
  ExtractedData, 
  ThreadEmail, 
  ConsolidatedData, 
  Suggestion, 
  Alert, 
  QuotationOffer, 
  RegulatoryInfo 
} from '@/features/quotation/types';

// Utilitaires de parsing
import { 
  decodeBase64Content,
  isInternalEmail,
  containsOfferKeywords,
  detectOfferType,
  parseSubject,
  parseEmailBody,
  getEmailSenderName
} from '@/features/quotation/utils/parsing';

// Utilitaires de consolidation
import { 
  extractRegulatoryInfo,
  normalizeSubject,
  consolidateThreadData 
} from '@/features/quotation/utils/consolidation';

// Utilitaires de détection
import { 
  detectQuotationOffers,
  extractAllRegulatoryInfo 
} from '@/features/quotation/utils/detection';

// Service de chargement des threads (Phase 4B.3)
import {
  mapRawEmailToThreadEmail,
  loadThreadEmailsByRef,
  loadThreadEmailsBySubject,
  loadThreadAttachments,
  buildCurrentEmail
} from '@/features/quotation/services/threadLoader';

// Hooks formulaire (Phase 4C)
import { useCargoLines } from '@/features/quotation/hooks/useCargoLines';
import { useServiceLines } from '@/features/quotation/hooks/useServiceLines';

// Domain layer (Phase 4F)
import { runQuotationEngine } from '@/features/quotation/domain/engine';
import type { QuotationInput } from '@/features/quotation/domain/types';

export default function QuotationSheet() {
  const { emailId } = useParams<{ emailId: string }>();
  const navigate = useNavigate();
  const isNewQuotation = emailId === 'new';
  
  const [isLoading, setIsLoading] = useState(!isNewQuotation);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLearning, setIsLearning] = useState(false);
  const [threadEmails, setThreadEmails] = useState<ThreadEmail[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<ThreadEmail | null>(null);
  const [attachments, setAttachments] = useState<Array<{ id: string; filename: string; content_type: string; email_id?: string }>>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [generatedResponse, setGeneratedResponse] = useState('');
  const [timelineExpanded, setTimelineExpanded] = useState(true);
  
  // Quotation status
  const [quotationCompleted, setQuotationCompleted] = useState(false);
  const [quotationOffers, setQuotationOffers] = useState<QuotationOffer[]>([]);
  const [regulatoryInfo, setRegulatoryInfo] = useState<RegulatoryInfo | null>(null);
  
  // Project context
  const [projectContext, setProjectContext] = useState<ProjectContext>({
    requesting_party: '',
    requesting_company: '',
    our_role: 'direct',
  });

  // Cargo lines (Phase 4C - hook extraction)
  const {
    cargoLines,
    setCargoLines,
    addCargoLine,
    updateCargoLine,
    removeCargoLine,
  } = useCargoLines();

  // Service lines (Phase 4C - hook extraction)
  const {
    serviceLines,
    setServiceLines,
    addServiceLine,
    updateServiceLine,
    removeServiceLine,
  } = useServiceLines();

  // General quotation info
  const [destination, setDestination] = useState('Dakar');
  const [finalDestination, setFinalDestination] = useState('');
  const [incoterm, setIncoterm] = useState('DAP');
  const [specialRequirements, setSpecialRequirements] = useState('');

  // ═══════════════════════════════════════════════════════════════════
  // Quotation Engine — Phase 4F.5
  // Mapping UI → Domain puis calcul des totaux
  // ═══════════════════════════════════════════════════════════════════
  const quotationInput: QuotationInput = {
    cargoLines: cargoLines.map((c) => ({
      id: c.id,
      quantity: c.container_count ?? c.pieces ?? 1,
      weight_kg: c.weight_kg ?? null,
      volume_m3: c.volume_cbm ?? null,
      description: c.description || null,
    })),
    serviceLines: serviceLines.map((s) => ({
      id: s.id,
      quantity: s.quantity ?? 1,
      unit_price: s.rate ?? null,
      description: s.description || null,
      service_code: s.service || null,
    })),
    context: { rounding: 'none' },
  };

  const engineResult = runQuotationEngine(quotationInput);
  const quotationTotals = engineResult.snapshot.totals;
  useEffect(() => {
    // Validate emailId is a valid UUID before fetching
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!isNewQuotation && emailId && uuidRegex.test(emailId)) {
      fetchThreadData();
    } else if (!isNewQuotation && emailId && !uuidRegex.test(emailId)) {
      // Invalid emailId - redirect to dashboard
      toast.error('ID email invalide');
      navigate('/');
    }
  }, [emailId]);

  const fetchThreadData = async () => {
    try {
      // First, get the selected email (reste inline - besoin de emailId du scope)
      const { data: emailData, error: emailError } = await supabase
        .from('emails')
        .select('*')
        .eq('id', emailId)
        .single();

      if (emailError) throw emailError;
      
      // Load thread emails using extracted service functions
      let threadEmailsList: ThreadEmail[] = [];
      
      if (emailData.thread_ref) {
        threadEmailsList = await loadThreadEmailsByRef(emailData.thread_ref);
      }
      
      // Fallback: try matching by normalized subject
      if (threadEmailsList.length <= 1 && emailData.subject) {
        threadEmailsList = await loadThreadEmailsBySubject(emailData.subject);
      }
      
      // Last fallback: use single email
      if (threadEmailsList.length === 0) {
        threadEmailsList = [mapRawEmailToThreadEmail(emailData)];
      }
      
      setThreadEmails(threadEmailsList);
      
      // Set selected email using extracted function
      const currentEmail = buildCurrentEmail(threadEmailsList, emailId!);
      setSelectedEmail(currentEmail);
      
      // Fetch attachments using extracted function
      const attachmentData = await loadThreadAttachments(threadEmailsList.map(e => e.id));
      setAttachments(attachmentData);
      
      // Detect completed quotation offers
      const offers = detectQuotationOffers(threadEmailsList, attachmentData);
      setQuotationOffers(offers);
      setQuotationCompleted(offers.length > 0);
      
      // Extract regulatory information from all emails
      const allRegulatoryInfo = extractAllRegulatoryInfo(threadEmailsList);
      setRegulatoryInfo(allRegulatoryInfo);
      
      // Consolidate data from all thread emails
      const consolidated = consolidateThreadData(threadEmailsList);
      
      // Apply consolidated data to form
      applyConsolidatedData(consolidated, threadEmailsList);
      
      // Analyze context and generate alerts
      analyzeEmailContext(threadEmailsList, consolidated);
      generateAlertsFromConsolidated(consolidated, threadEmailsList, offers);
      
      // Fetch suggestions
      await fetchSuggestions(currentEmail);
    } catch (error) {
      console.error('Error fetching thread:', error);
      toast.error('Erreur de chargement du fil de discussion');
    } finally {
      setIsLoading(false);
    }
  };


  const applyConsolidatedData = (consolidated: ConsolidatedData, emails: ThreadEmail[]) => {
    // Apply incoterm
    if (consolidated.incoterm) {
      setIncoterm(consolidated.incoterm);
    }
    
    // Apply destination
    if (consolidated.destination) {
      setDestination(consolidated.destination);
    }
    
    // Apply final destination (from subject parsing like "DAP SAINT LOUIS")
    if (consolidated.finalDestination) {
      setFinalDestination(consolidated.finalDestination);
    }
    
    // Apply special requirements
    if (consolidated.specialRequirements.length > 0) {
      setSpecialRequirements(consolidated.specialRequirements.join('\n'));
    }
    
    // Create cargo lines from detected containers WITH QUANTITIES
    const newCargoLines: CargoLine[] = [];
    
    // NEW: Use containers array with quantities if available
    if (consolidated.containers && consolidated.containers.length > 0) {
      for (const container of consolidated.containers) {
        newCargoLines.push({
          id: crypto.randomUUID(),
          description: container.notes || '',
          origin: consolidated.origins[0] || '',
          cargo_type: 'container',
          container_type: container.type,
          container_count: container.quantity,
          coc_soc: container.coc_soc === 'SOC' ? 'SOC' : container.coc_soc === 'COC' ? 'COC' : 
                   consolidated.specialRequirements.some(r => r.includes('SOC')) ? 'SOC' : 'COC',
        });
      }
    } else if (consolidated.cargoTypes.includes('container') || consolidated.containerTypes.length > 0) {
      // Fallback to old logic
      for (const ct of consolidated.containerTypes.length > 0 ? consolidated.containerTypes : ['40HC']) {
        newCargoLines.push({
          id: crypto.randomUUID(),
          description: '',
          origin: consolidated.origins[0] || '',
          cargo_type: 'container',
          container_type: ct.replace('-', '').substring(0, 4),
          container_count: 1,
          coc_soc: consolidated.specialRequirements.some(r => r.includes('SOC')) ? 'SOC' : 'COC',
        });
      }
    }
    
    if (consolidated.cargoTypes.includes('breakbulk')) {
      newCargoLines.push({
        id: crypto.randomUUID(),
        description: 'Cargo conventionnel',
        origin: consolidated.origins[0] || '',
        cargo_type: 'breakbulk',
      });
    }
    
    if (newCargoLines.length > 0) {
      setCargoLines(newCargoLines);
    }
  };

  // Helper function to calculate email age category
  const getEmailAgeCategory = (date: string): 'active' | 'recent_archive' | 'historical' => {
    const emailDate = new Date(date);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - emailDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 30) return 'active';
    if (diffDays < 180) return 'recent_archive';
    return 'historical';
  };

  const analyzeEmailContext = (emails: ThreadEmail[], consolidated: ConsolidatedData) => {
    // Find the first external email (original request)
    const externalEmails = emails.filter(e => {
      const from = e.from_address.toLowerCase();
      return !from.includes('sodatra') && !from.includes('@sodatra.sn');
    });
    
    const originalRequest = externalEmails[0] || emails[0];
    const fromEmail = originalRequest.from_address.toLowerCase();
    const toAddresses = originalRequest.to_addresses?.map(e => e.toLowerCase()) || [];
    const ccAddresses = originalRequest.cc_addresses?.map(e => e.toLowerCase()) || [];
    
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

    // Use consolidated original requestor if available
    if (consolidated.originalRequestor) {
      context.requesting_party = consolidated.originalRequestor.name;
      context.requesting_company = consolidated.originalRequestor.company;
    } else {
      const senderName = fromEmail.split('@')[0]
        .replace(/[._-]/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());
      const senderDomain = fromEmail.split('@')[1]?.split('.')[0]?.toUpperCase() || '';
      
      context.requesting_party = senderName;
      context.requesting_company = senderDomain;
    }

    if (fromTwoHL) {
      context.our_role = 'partner_support';
      context.partner_email = fromEmail;
      context.partner_company = '2HL Group';
      context.end_client = 'À identifier dans le fil';
    } else if (twoHLInTo) {
      context.our_role = 'partner_support';
      context.partner_company = '2HL Group';
      context.end_client = context.requesting_party;
      context.end_client_company = context.requesting_company;
    }

    // Apply project name and location from consolidated data
    if (consolidated.projectName) {
      context.project_name = consolidated.projectName;
    }
    if (consolidated.projectLocation || consolidated.finalDestination) {
      context.project_location = consolidated.projectLocation || consolidated.finalDestination;
    }

    setProjectContext(context);
  };

  const generateAlertsFromConsolidated = (
    consolidated: ConsolidatedData, 
    emails: ThreadEmail[],
    offers: QuotationOffer[]
  ) => {
    const newAlerts: Alert[] = [];
    
    // Quotation completed alert
    if (offers.length > 0) {
      newAlerts.push({ 
        type: 'success', 
        message: `Cotation réalisée - ${offers.length} offre(s) envoyée(s)` 
      });
    }
    
    // Check incoterm - use consolidated data
    if (!consolidated.incoterm) {
      newAlerts.push({ type: 'warning', message: 'Incoterm non spécifié dans le fil', field: 'incoterm' });
    } else {
      newAlerts.push({ type: 'success', message: `Incoterm détecté: ${consolidated.incoterm}`, field: 'incoterm' });
    }
    
    // Check destination
    if (consolidated.finalDestination) {
      newAlerts.push({ type: 'success', message: `Destination finale: ${consolidated.finalDestination}`, field: 'destination' });
    }
    
    // Check cargo types detected
    if (consolidated.cargoTypes.length > 0) {
      newAlerts.push({ 
        type: 'info', 
        message: `Types de cargo: ${consolidated.cargoTypes.join(', ')}` 
      });
    }
    
    // Check container types
    if (consolidated.containerTypes.length > 0) {
      newAlerts.push({ 
        type: 'info', 
        message: `Conteneurs: ${consolidated.containerTypes.join(', ')}` 
      });
    }
    
    // Check all email bodies for special indicators
    for (const email of emails) {
      const bodyLower = decodeBase64Content(email.body_text).toLowerCase();
      
      if (bodyLower.includes('flat rack') || bodyLower.includes('40fr')) {
        if (!newAlerts.some(a => a.message.includes('Flat Rack'))) {
          newAlerts.push({ type: 'info', message: 'Flat Rack détecté - Vérifier disponibilité' });
        }
      }
      if (bodyLower.includes('saint louis') || bodyLower.includes('saint-louis')) {
        if (!newAlerts.some(a => a.message.includes('Saint-Louis'))) {
          newAlerts.push({ type: 'info', message: 'Destination Saint-Louis - Prévoir on-carriage' });
        }
      }
      if (bodyLower.includes('breakbulk') || bodyLower.includes('break bulk')) {
        if (!newAlerts.some(a => a.message.includes('conventionnel'))) {
          newAlerts.push({ type: 'info', message: 'Cargo conventionnel (breakbulk) détecté' });
        }
      }
      if (bodyLower.includes('project') || bodyLower.includes('projet')) {
        if (!newAlerts.some(a => a.message.includes('Projet cargo'))) {
          newAlerts.push({ type: 'info', message: 'Projet cargo détecté - Cotation complexe probable' });
        }
      }
    }
    
    // Thread info
    if (emails.length > 1) {
      newAlerts.push({ 
        type: 'info', 
        message: `Fil de ${emails.length} emails analysé` 
      });
    }
    
    setAlerts(newAlerts);
  };

  const fetchSuggestions = async (emailData: ThreadEmail) => {
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

  const handleLearnFromQuotation = async () => {
    if (quotationOffers.length === 0) return;
    
    setIsLearning(true);
    try {
      const knowledgeEntries = quotationOffers.map(offer => ({
        name: `Cotation ${offer.type} - ${finalDestination || destination}`,
        category: 'quotation_template',
        description: `Cotation ${offer.type} pour ${projectContext.requesting_company} vers ${finalDestination || destination}`,
        data: {
          type: offer.type,
          route: {
            port: destination,
            finalDestination: finalDestination,
          },
          incoterm: incoterm,
          client: {
            name: projectContext.requesting_party,
            company: projectContext.requesting_company,
          },
          partner: projectContext.partner_company,
          projectName: projectContext.project_name,
          cargoTypes: offer.detectedContent,
          regulatoryInfo: regulatoryInfo,
          attachmentNames: offer.attachments.map(a => a.filename),
          sentAt: offer.sentAt,
          sender: offer.senderEmail,
        },
        source_type: 'email',
        source_id: offer.email.id,
        confidence: 0.9,
        is_validated: true,
      }));
      
      // Use edge function to bypass RLS
      const { data, error } = await supabase.functions.invoke('data-admin', {
        body: { action: 'create_knowledge', data: knowledgeEntries }
      });
      
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erreur inconnue');
      
      toast.success(`${data.count} connaissance(s) enregistrée(s)`);
    } catch (error) {
      console.error('Error learning from quotation:', error);
      toast.error('Erreur lors de l\'apprentissage');
    } finally {
      setIsLearning(false);
    }
  };

  const handleGenerateResponse = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-response', {
        body: { 
          emailId: isNewQuotation ? null : emailId,
          threadEmails: threadEmails.map(e => ({
            from: e.from_address,
            subject: e.subject,
            body: decodeBase64Content(e.body_text),
            date: e.sent_at || e.received_at,
          })),
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

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    try {
      return format(new Date(dateStr), "dd MMM yyyy 'à' HH:mm", { locale: fr });
    } catch {
      return '-';
    }
  };

  const getOfferTypeLabel = (type: 'container' | 'breakbulk' | 'combined'): string => {
    switch (type) {
      case 'container': return 'Conteneurs';
      case 'breakbulk': return 'Breakbulk';
      case 'combined': return 'Conteneurs & Breakbulk';
    }
  };

  const getOfferTypeIcon = (type: 'container' | 'breakbulk' | 'combined') => {
    switch (type) {
      case 'container': return <Container className="h-4 w-4" />;
      case 'breakbulk': return <Boxes className="h-4 w-4" />;
      case 'combined': return <Package className="h-4 w-4" />;
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
        <QuotationHeader
          isNewQuotation={isNewQuotation}
          quotationCompleted={quotationCompleted}
          selectedEmailSubject={selectedEmail?.subject ?? null}
          threadCount={threadEmails.length}
          isGenerating={isGenerating}
          onBack={() => navigate('/')}
          onGenerateResponse={handleGenerateResponse}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Main Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Quotation Completed Banner */}
            {quotationCompleted && quotationOffers.length > 0 && (
              <QuotationCompletedBanner
                quotationOffers={quotationOffers}
                isLearning={isLearning}
                onLearnFromQuotation={handleLearnFromQuotation}
                formatDate={formatDate}
                getOfferTypeIcon={getOfferTypeIcon}
                getOfferTypeLabel={getOfferTypeLabel}
              />
            )}

            {/* Learning Mode Panel for Historical Emails */}
            {selectedEmail && !quotationCompleted && 
             getEmailAgeCategory(selectedEmail.sent_at || selectedEmail.received_at) === 'historical' && (
              <LearnFromEmailPanel
                threadEmails={threadEmails}
                emailDate={selectedEmail.sent_at || selectedEmail.received_at}
                onLearningComplete={() => {
                  toast.success('Apprentissage terminé');
                }}
              />
            )}

            {/* Regulatory Information */}
            <RegulatoryInfoCard regulatoryInfo={regulatoryInfo} />

            {/* Alerts */}
            <AlertsPanel alerts={alerts} />

            {/* Thread Timeline */}
            <ThreadTimelineCard
              threadEmails={threadEmails}
              selectedEmailId={selectedEmail?.id ?? null}
              quotationOffers={quotationOffers}
              expanded={timelineExpanded}
              onExpandedChange={setTimelineExpanded}
              onSelectEmail={setSelectedEmail}
              formatDate={formatDate}
            />

            {/* Only show form sections if quotation is not completed */}
            {!quotationCompleted && (
              <>
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
                <CargoLinesForm
                  cargoLines={cargoLines}
                  addCargoLine={addCargoLine}
                  updateCargoLine={updateCargoLine}
                  removeCargoLine={removeCargoLine}
                />

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
                <ServiceLinesForm
                  serviceLines={serviceLines}
                  addServiceLine={addServiceLine}
                  updateServiceLine={updateServiceLine}
                  removeServiceLine={removeServiceLine}
                />
              </>
            )}

            {/* Generated Response */}
            {generatedResponse && (
              <Card className="border-primary/30 bg-primary/5">
                <CardHeader>
                  <CardTitle className="text-base flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-primary" />
                      Réponse générée
                    </span>
                    <div className="flex gap-2">
                      <QuotationExcelExport
                        client={projectContext.requesting_party || 'Client'}
                        destination={finalDestination || destination}
                        origin={cargoLines[0]?.origin}
                        incoterm={incoterm}
                        containerType={cargoLines[0]?.container_type}
                        currency="FCFA"
                        lines={serviceLines
                          .filter(line => line.rate && line.rate > 0)
                          .map(line => ({
                            category: 'SERVICES',
                            service: line.description,
                            unit: line.unit,
                            rate: line.rate || 0,
                            quantity: line.quantity,
                            amount: (line.rate || 0) * line.quantity,
                            source: 'MANUAL',
                          }))}
                        marginPercent={5}
                        validityDays={30}
                        variant="outline"
                        size="sm"
                      />
                      <Button variant="outline" size="sm" onClick={handleCopyResponse}>
                        <Copy className="h-4 w-4 mr-2" />
                        Copier
                      </Button>
                    </div>
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
            {/* Selected Email Preview */}
            {selectedEmail && (
              <Card className="border-border/50 bg-gradient-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Mail className="h-4 w-4 text-ocean" />
                    {threadEmails.length > 1 ? 'Email sélectionné' : 'Email original'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground">De</p>
                    <p className="text-sm font-medium truncate">{selectedEmail.from_address}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">À</p>
                    <p className="text-sm truncate">{selectedEmail.to_addresses?.join(', ') || '-'}</p>
                  </div>
                  {selectedEmail.cc_addresses && selectedEmail.cc_addresses.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground">Cc</p>
                      <p className="text-sm truncate">{selectedEmail.cc_addresses.join(', ')}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">Date</p>
                    <p className="text-sm">{formatDate(selectedEmail.sent_at || selectedEmail.received_at)}</p>
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
                      {(() => {
                        const decoded = decodeBase64Content(selectedEmail.body_text);
                        return decoded.substring(0, 2000) || 'Aucun contenu texte';
                      })()}
                      {selectedEmail.body_text && selectedEmail.body_text.length > 2000 && '...'}
                    </p>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {/* Historical Rate Reminders - Informative references */}
            <HistoricalRateReminders
              origin={cargoLines.length > 0 ? cargoLines[0].origin : undefined}
              destination={finalDestination || destination}
              containerTypes={cargoLines
                .filter(l => l.cargo_type === 'container' && l.container_type)
                .map(l => l.container_type!)}
              cargoType={cargoLines.length > 0 ? cargoLines[0].cargo_type : undefined}
            />

            {/* Similar Quotations Panel */}
            <SimilarQuotationsPanel
              destination={finalDestination || destination}
              cargoType={cargoLines.length > 0 ? cargoLines[0].cargo_type : undefined}
              clientCompany={projectContext.requesting_company}
              requestedServices={serviceLines.map(s => s.service).filter(Boolean)}
              onApplyTariff={(service, amount, currency) => {
                const lineToUpdate = serviceLines.find(l => l.service === service);
                if (lineToUpdate) {
                  updateServiceLine(lineToUpdate.id, { rate: amount, currency });
                  toast.success(`Tarif appliqué: ${service}`);
                }
              }}
            />

            {/* Suggestions */}
            <SuggestionsCard suggestions={suggestions} />

            {/* Quick Actions */}
            <QuickActionsCard />
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
