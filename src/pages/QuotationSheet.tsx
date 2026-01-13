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

interface ThreadEmail {
  id: string;
  subject: string | null;
  from_address: string;
  to_addresses?: string[];
  cc_addresses?: string[];
  body_text: string | null;
  received_at: string;
  sent_at: string | null;
  extracted_data: ExtractedData | null;
  thread_ref?: string | null;
}

interface ConsolidatedData {
  incoterm?: string;
  destination?: string;
  finalDestination?: string;
  cargoTypes: string[];
  containerTypes: string[];
  // NEW: Multi-container support with quantities
  containers: Array<{
    type: string;
    quantity: number;
    coc_soc?: 'COC' | 'SOC' | 'unknown';
    notes?: string;
  }>;
  origins: string[];
  specialRequirements: string[];
  projectName?: string;
  projectLocation?: string;
  originalRequestor?: { email: string; name: string; company: string };
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

// Interface for detected quotation offers
interface QuotationOffer {
  type: 'container' | 'breakbulk' | 'combined';
  email: ThreadEmail;
  sentAt: string;
  senderName: string;
  senderEmail: string;
  attachments: Array<{ id: string; filename: string; content_type: string }>;
  detectedContent: string[];
}

// Interface for extracted regulatory info
interface RegulatoryInfo {
  projectTaxation?: { sea?: string; air?: string };
  dpiRequired?: boolean;
  dpiThreshold?: string;
  dpiDeadline?: string;
  apeAvailable?: boolean;
  customsNotes: string[];
  otherNotes: string[];
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

// Our internal domains
const INTERNAL_DOMAINS = ['sodatra.sn', '2hlgroup.com', '2hl.sn'];

// Keywords that indicate a quotation offer
const OFFER_KEYWORDS = [
  'please find our rates',
  'please find attached our rates',
  'attached our rates',
  'voici notre offre',
  'ci-joint notre cotation',
  'veuillez trouver notre offre',
  'please find attached our offer',
  'please find our offer',
  'attached our offer',
  'please find the rates',
  'please find rates',
  'attached our quotation',
  'please find our quotation',
  'please see attached',
  'kindly find attached',
  'please find enclosed',
];

// Helper function to decode base64 content
const decodeBase64Content = (content: string | null): string => {
  if (!content) return '';
  
  // Check if content looks like base64
  const base64Pattern = /^[A-Za-z0-9+/=]+$/;
  const cleanContent = content.replace(/\s/g, '');
  
  if (base64Pattern.test(cleanContent) && cleanContent.length > 100) {
    try {
      return atob(cleanContent);
    } catch {
      return content;
    }
  }
  return content;
};

// Check if email is from internal domain
const isInternalEmail = (email: string): boolean => {
  const emailLower = email.toLowerCase();
  return INTERNAL_DOMAINS.some(domain => emailLower.includes(`@${domain}`));
};

// Check if email body contains offer keywords
const containsOfferKeywords = (body: string): boolean => {
  const bodyLower = body.toLowerCase();
  return OFFER_KEYWORDS.some(keyword => bodyLower.includes(keyword));
};

// Detect offer type from email content
const detectOfferType = (email: ThreadEmail): 'container' | 'breakbulk' | 'combined' | null => {
  const bodyLower = decodeBase64Content(email.body_text).toLowerCase();
  const subjectLower = (email.subject || '').toLowerCase();
  const combinedText = bodyLower + ' ' + subjectLower;
  
  const hasContainer = combinedText.includes('container') || 
                       combinedText.includes('conteneur') ||
                       combinedText.includes('40hc') ||
                       combinedText.includes('40fr') ||
                       combinedText.includes('20dv') ||
                       combinedText.includes('dthc') ||
                       combinedText.includes('soc') ||
                       combinedText.includes('coc');
  
  const hasBreakbulk = combinedText.includes('breakbulk') ||
                       combinedText.includes('break bulk') ||
                       combinedText.includes('conventionnel') ||
                       combinedText.includes('ex-hook') ||
                       combinedText.includes('fot') ||
                       combinedText.includes('stevedoring');
  
  if (hasContainer && hasBreakbulk) return 'combined';
  if (hasContainer) return 'container';
  if (hasBreakbulk) return 'breakbulk';
  return null;
};

// Extract regulatory information from email body
const extractRegulatoryInfo = (body: string): RegulatoryInfo => {
  const info: RegulatoryInfo = {
    customsNotes: [],
    otherNotes: [],
  };
  
  const bodyLower = body.toLowerCase();
  
  // Extract project taxation rates
  const seaTaxMatch = body.match(/(\d+(?:\.\d+)?)\s*%?\s*(?:of\s+)?CIF\s*(?:value)?\s*\(?(?:sea|maritime|mer)\)?/i);
  const airTaxMatch = body.match(/(\d+(?:\.\d+)?)\s*%?\s*(?:of\s+)?CIF\s*(?:value)?\s*\(?(?:air|avion)\)?/i);
  const generalCifMatch = body.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of\s+)?CIF/i);
  
  if (seaTaxMatch || airTaxMatch || generalCifMatch) {
    info.projectTaxation = {};
    if (seaTaxMatch) info.projectTaxation.sea = seaTaxMatch[1] + '%';
    if (airTaxMatch) info.projectTaxation.air = airTaxMatch[1] + '%';
    if (!seaTaxMatch && !airTaxMatch && generalCifMatch) {
      info.projectTaxation.sea = generalCifMatch[1] + '%';
    }
  }
  
  // DPI detection
  if (bodyLower.includes('dpi')) {
    info.dpiRequired = true;
    
    // Extract threshold
    const thresholdMatch = body.match(/(?:cif|value)\s*(?:>|above|supérieur|greater)\s*(?:€|eur|euro)?\s*(\d+(?:[\s,]\d+)*)/i);
    if (thresholdMatch) {
      info.dpiThreshold = '€' + thresholdMatch[1].replace(/\s/g, '');
    }
    
    // Extract deadline
    const deadlineMatch = body.match(/(\d+)\s*(?:hours?|heures?|h)\s*(?:per|par|for|pour)/i);
    if (deadlineMatch) {
      info.dpiDeadline = deadlineMatch[1] + 'h par facture';
    }
    
    // Check for 15 days before departure
    if (bodyLower.includes('15') && (bodyLower.includes('day') || bodyLower.includes('jour'))) {
      info.customsNotes.push('Deadline DPI: 15 jours avant départ');
    }
  }
  
  // APE detection
  if (bodyLower.includes('ape') || bodyLower.includes('autorisation préalable')) {
    info.apeAvailable = true;
    info.customsNotes.push('APE possible si exemption manquante');
  }
  
  // NINEA detection
  if (bodyLower.includes('ninea')) {
    info.customsNotes.push('NINEA requis');
  }
  
  // PPM detection
  if (bodyLower.includes('ppm')) {
    info.customsNotes.push('Code PPM requis');
  }
  
  // Check for exemption mentions
  if (bodyLower.includes('exempt') || bodyLower.includes('exonér')) {
    info.otherNotes.push('Régime exonéré mentionné');
  }
  
  // Check for project cargo
  if (bodyLower.includes('project') && bodyLower.includes('cargo')) {
    info.otherNotes.push('Projet cargo identifié');
  }
  
  return info;
};

// Parse email subject to extract incoterm, destination, cargo type
const parseSubject = (subject: string | null): Partial<ConsolidatedData> => {
  if (!subject) return {};
  
  const result: Partial<ConsolidatedData> = {
    cargoTypes: [],
    containerTypes: [],
    origins: [],
  };
  
  const subjectUpper = subject.toUpperCase();
  const subjectLower = subject.toLowerCase();
  
  // Extract incoterm
  for (const inc of incoterms) {
    if (subjectUpper.includes(inc)) {
      result.incoterm = inc;
      break;
    }
  }
  
  // Extract destination from subject
  const destinationPatterns = [
    /(?:DAP|DDP|CIF|CFR|FOB|FCA)\s+([A-Z][A-Z\s-]+)/i,
    /(?:to|vers|pour)\s+([A-Z][A-Z\s-]+)/i,
    /(?:destination|dest[.:]?)\s*([A-Z][A-Z\s-]+)/i,
  ];
  
  for (const pattern of destinationPatterns) {
    const match = subject.match(pattern);
    if (match) {
      const dest = match[1].trim().replace(/\s+/g, ' ');
      if (dest.length > 2 && dest.length < 50) {
        result.finalDestination = dest;
        break;
      }
    }
  }
  
  // Extract cargo types from subject
  if (subjectLower.includes('breakbulk') || subjectLower.includes('break bulk')) {
    result.cargoTypes?.push('breakbulk');
  }
  if (subjectLower.includes('container') || subjectLower.includes('conteneur')) {
    result.cargoTypes?.push('container');
  }
  if (subjectLower.includes('project') || subjectLower.includes('projet')) {
    result.cargoTypes?.push('project');
  }
  
  // Extract container types mentioned
  const containerPatterns = ['40FR', '40HC', '40DV', '20DV', '20HC', '40OT', '40HC OT', 'FLAT RACK', 'OPEN TOP'];
  for (const ct of containerPatterns) {
    if (subjectUpper.includes(ct)) {
      result.containerTypes?.push(ct.replace(' ', '-'));
    }
  }
  
  return result;
};

// Parse email body for additional data including multi-container extraction
const parseEmailBody = (body: string | null): Partial<ConsolidatedData> => {
  if (!body) return {};
  
  const result: Partial<ConsolidatedData> = {
    cargoTypes: [],
    specialRequirements: [],
    origins: [],
    containers: [],
  };
  
  const bodyLower = body.toLowerCase();
  
  // === NEW: Multi-container extraction with quantities ===
  // Pattern: "09 X 40' HC", "2 x 20DV", "1 X 40' open top", etc.
  const containerPatterns = [
    // "09 X 40' HC" or "9 x 40HC"
    /(\d+)\s*[xX×]\s*(\d{2})'?\s*(HC|DV|OT|FR|RF|GP|DC)/gi,
    // "09 X 40' HC + 1 X 40' open top"
    /(\d+)\s*[xX×]\s*(\d{2})['']?\s*(open\s*top|flat\s*rack|high\s*cube|reefer|dry)/gi,
    // "2 x 20' containers"
    /(\d+)\s*[xX×]\s*(\d{2})['']?\s*(?:containers?|conteneurs?)/gi,
  ];
  
  const containerTypeMap: Record<string, string> = {
    'hc': '40HC',
    'high cube': '40HC',
    'dv': '20DV',
    'gp': '20DV',
    'dc': '20DV',
    'dry': '20DV',
    'ot': '40OT',
    'open top': '40OT',
    'fr': '40FR',
    'flat rack': '40FR',
    'rf': '40RF',
    'reefer': '40RF',
  };
  
  for (const pattern of containerPatterns) {
    let match;
    while ((match = pattern.exec(body)) !== null) {
      const quantity = parseInt(match[1], 10);
      const size = match[2]; // 20 or 40
      const typeRaw = match[3].toLowerCase().replace(/\s+/g, ' ').trim();
      
      // Normalize container type
      let containerType = containerTypeMap[typeRaw] || `${size}${typeRaw.toUpperCase().substring(0, 2)}`;
      
      // Check for OOG notes
      const hasOog = bodyLower.includes('oog') || bodyLower.includes('out of gauge') || 
                     bodyLower.includes('hors gabarit') || bodyLower.includes('oversized');
      
      if (quantity > 0 && !isNaN(quantity)) {
        result.containers?.push({
          type: containerType,
          quantity,
          notes: hasOog ? 'OOG' : undefined
        });
      }
    }
  }
  
  // Check for SOC/COC mentions and apply to containers
  const isSoc = bodyLower.includes('soc') || bodyLower.includes('shipper owned');
  const isCoc = bodyLower.includes('coc') || bodyLower.includes('carrier owned');
  
  if (isSoc) {
    result.specialRequirements?.push('SOC (Shipper Owned Containers)');
    result.containers?.forEach(c => c.coc_soc = 'SOC');
  }
  if (isCoc) {
    result.specialRequirements?.push('COC (Carrier Owned Containers)');
    result.containers?.forEach(c => c.coc_soc = 'COC');
  }
  
  // Check for specific services mentioned
  if (bodyLower.includes('dthc')) {
    result.specialRequirements?.push('DTHC demandé');
  }
  if (bodyLower.includes('on carriage') || bodyLower.includes('on-carriage')) {
    result.specialRequirements?.push('On-carriage demandé');
  }
  if (bodyLower.includes('empty return') || bodyLower.includes('retour vide')) {
    result.specialRequirements?.push('Retour conteneur vide');
  }
  
  // Check for location patterns for project site
  const locationPatterns = [
    /project\s+location\s*[:=]?\s*(https?:\/\/[^\s]+)/i,
    /site\s*[:=]?\s*(https?:\/\/maps[^\s]+)/i,
  ];
  
  for (const pattern of locationPatterns) {
    const match = body.match(pattern);
    if (match) {
      result.projectLocation = match[1];
      break;
    }
  }
  
  // Check for specific destinations
  const destPatterns = [
    /(?:POD|port of destination)\s*[:=]?\s*([A-Za-z\s-]+)/i,
    /(?:destination finale|final destination)\s*[:=]?\s*([A-Za-z\s-]+)/i,
  ];
  
  for (const pattern of destPatterns) {
    const match = body.match(pattern);
    if (match) {
      const dest = match[1].trim();
      if (dest.length > 2 && dest.length < 50) {
        if (!result.destination) result.destination = dest;
      }
    }
  }
  
  return result;
};

// Consolidate data from all thread emails
const consolidateThreadData = (emails: ThreadEmail[]): ConsolidatedData => {
  const consolidated: ConsolidatedData = {
    cargoTypes: [],
    containerTypes: [],
    containers: [],
    origins: [],
    specialRequirements: [],
  };
  
  // Sort by date (oldest first) to process chronologically
  const sortedEmails = [...emails].sort((a, b) => {
    const dateA = new Date(a.sent_at || a.received_at);
    const dateB = new Date(b.sent_at || b.received_at);
    return dateA.getTime() - dateB.getTime();
  });
  
  // First email is the original request
  const firstEmail = sortedEmails[0];
  if (firstEmail) {
    const senderEmail = firstEmail.from_address.toLowerCase();
    const senderDomain = senderEmail.split('@')[1]?.split('.')[0]?.toUpperCase() || '';
    const senderName = senderEmail.split('@')[0]
      .replace(/[._-]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
    
    consolidated.originalRequestor = {
      email: firstEmail.from_address,
      name: senderName,
      company: senderDomain,
    };
  }
  
  // Process each email
  for (const email of sortedEmails) {
    // Parse subject
    const subjectData = parseSubject(email.subject);
    
    // Override with latest incoterm found
    if (subjectData.incoterm) {
      consolidated.incoterm = subjectData.incoterm;
    }
    if (subjectData.finalDestination && !consolidated.finalDestination) {
      consolidated.finalDestination = subjectData.finalDestination;
    }
    if (subjectData.cargoTypes) {
      consolidated.cargoTypes = [...new Set([...consolidated.cargoTypes, ...subjectData.cargoTypes])];
    }
    if (subjectData.containerTypes) {
      consolidated.containerTypes = [...new Set([...consolidated.containerTypes, ...subjectData.containerTypes])];
    }
    
    // Parse body
    const decodedBody = decodeBase64Content(email.body_text);
    const bodyData = parseEmailBody(decodedBody);
    
    if (bodyData.destination && !consolidated.destination) {
      consolidated.destination = bodyData.destination;
    }
    if (bodyData.projectLocation) {
      consolidated.projectLocation = bodyData.projectLocation;
    }
    if (bodyData.specialRequirements) {
      consolidated.specialRequirements = [...new Set([...consolidated.specialRequirements, ...bodyData.specialRequirements])];
    }
    
    // Aggregate containers with quantities from body parsing
    if (bodyData.containers && bodyData.containers.length > 0) {
      for (const container of bodyData.containers) {
        // Check if we already have this container type
        const existing = consolidated.containers.find(c => c.type === container.type);
        if (existing) {
          // Keep the higher quantity (don't add, as it might be duplicated)
          existing.quantity = Math.max(existing.quantity, container.quantity);
          if (container.notes) existing.notes = container.notes;
          if (container.coc_soc) existing.coc_soc = container.coc_soc;
        } else {
          consolidated.containers.push({ ...container });
        }
      }
    }
    
    // Also check extracted_data if available
    if (email.extracted_data) {
      const ed = email.extracted_data;
      if (ed.incoterm && !consolidated.incoterm) {
        consolidated.incoterm = ed.incoterm;
      }
      if (ed.destination && !consolidated.destination) {
        consolidated.destination = ed.destination;
      }
      if (ed.origin && !consolidated.origins.includes(ed.origin)) {
        consolidated.origins.push(ed.origin);
      }
    }
    
    // Extract project name from first subject
    if (!consolidated.projectName && email.subject) {
      consolidated.projectName = email.subject
        .replace(/^(RE:|FW:|TR:)\s*/gi, '')
        .replace(/^(demande|offre|cotation|devis)[\s:]+/gi, '')
        .substring(0, 100);
    }
  }
  
  return consolidated;
};

// Normalize subject for matching (remove Re:, Fwd:, etc.)
const normalizeSubject = (subject: string | null): string => {
  if (!subject) return '';
  return subject
    .replace(/^(RE:|FW:|TR:|AW:|SV:|VS:)\s*/gi, '')
    .replace(/^(RE:|FW:|TR:|AW:|SV:|VS:)\s*/gi, '') // Do twice for "RE: FW:" patterns
    .trim()
    .toLowerCase();
};

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
  const [offersExpanded, setOffersExpanded] = useState(true);
  
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
      // First, get the selected email
      const { data: emailData, error: emailError } = await supabase
        .from('emails')
        .select('*')
        .eq('id', emailId)
        .single();

      if (emailError) throw emailError;
      
      let threadEmailsList: ThreadEmail[] = [];
      
      // Try to get all emails from the thread
      if (emailData.thread_ref) {
        // Get all emails with same thread_ref
        const { data: threadData } = await supabase
          .from('emails')
          .select('*')
          .eq('thread_ref', emailData.thread_ref)
          .order('sent_at', { ascending: true });
        
        if (threadData && threadData.length > 0) {
          threadEmailsList = threadData.map(e => ({
            id: e.id,
            subject: e.subject,
            from_address: e.from_address,
            to_addresses: e.to_addresses,
            cc_addresses: e.cc_addresses,
            body_text: e.body_text,
            received_at: e.received_at || e.created_at || '',
            sent_at: e.sent_at,
            extracted_data: e.extracted_data as ExtractedData | null,
            thread_ref: e.thread_ref,
          }));
        }
      }
      
      // If no thread_ref or no results, try matching by normalized subject
      if (threadEmailsList.length <= 1 && emailData.subject) {
        const normalizedSubject = normalizeSubject(emailData.subject);
        
        // Search for emails with similar subject
        const { data: similarEmails } = await supabase
          .from('emails')
          .select('*')
          .order('sent_at', { ascending: true });
        
        if (similarEmails) {
          threadEmailsList = similarEmails
            .filter(e => {
              const eNormalized = normalizeSubject(e.subject);
              return eNormalized.includes(normalizedSubject) || normalizedSubject.includes(eNormalized);
            })
            .map(e => ({
              id: e.id,
              subject: e.subject,
              from_address: e.from_address,
              to_addresses: e.to_addresses,
              cc_addresses: e.cc_addresses,
              body_text: e.body_text,
              received_at: e.received_at || e.created_at || '',
              sent_at: e.sent_at,
              extracted_data: e.extracted_data as ExtractedData | null,
              thread_ref: e.thread_ref,
            }));
        }
      }
      
      // If still nothing, just use the single email
      if (threadEmailsList.length === 0) {
        threadEmailsList = [{
          id: emailData.id,
          subject: emailData.subject,
          from_address: emailData.from_address,
          to_addresses: emailData.to_addresses,
          cc_addresses: emailData.cc_addresses,
          body_text: emailData.body_text,
          received_at: emailData.received_at || emailData.created_at || '',
          sent_at: emailData.sent_at,
          extracted_data: emailData.extracted_data as ExtractedData | null,
          thread_ref: emailData.thread_ref,
        }];
      }
      
      setThreadEmails(threadEmailsList);
      
      // Set selected email to the one in the URL
      const currentEmail = threadEmailsList.find(e => e.id === emailId) || threadEmailsList[threadEmailsList.length - 1];
      setSelectedEmail(currentEmail);
      
      // Fetch attachments for all thread emails
      const emailIds = threadEmailsList.map(e => e.id);
      const { data: attachmentData } = await supabase
        .from('email_attachments')
        .select('id, filename, content_type, email_id')
        .in('email_id', emailIds);
      
      setAttachments(attachmentData || []);
      
      // Detect completed quotation offers
      const offers = detectQuotationOffers(threadEmailsList, attachmentData || []);
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

  const detectQuotationOffers = (
    emails: ThreadEmail[], 
    allAttachments: Array<{ id: string; filename: string; content_type: string; email_id?: string }>
  ): QuotationOffer[] => {
    const offers: QuotationOffer[] = [];
    
    for (const email of emails) {
      // Check if from internal domain
      if (!isInternalEmail(email.from_address)) continue;
      
      const body = decodeBase64Content(email.body_text);
      
      // Check for offer keywords
      if (!containsOfferKeywords(body)) continue;
      
      // Determine offer type
      const offerType = detectOfferType(email);
      if (!offerType) continue;
      
      // Get attachments for this email
      const emailAttachments = allAttachments.filter(a => a.email_id === email.id);
      
      // Detect content from body
      const detectedContent: string[] = [];
      const bodyLower = body.toLowerCase();
      
      if (bodyLower.includes('dry container') || bodyLower.includes('dry')) {
        detectedContent.push('Dry containers');
      }
      if (bodyLower.includes('dg container') || bodyLower.includes('dangerous')) {
        detectedContent.push('DG containers');
      }
      if (bodyLower.includes('special ig') || bodyLower.includes('in-gauge')) {
        detectedContent.push('Special IG');
      }
      if (bodyLower.includes('special oog') || bodyLower.includes('out-of-gauge')) {
        detectedContent.push('Special OOG');
      }
      if (bodyLower.includes('flat rack') || bodyLower.includes('40fr')) {
        detectedContent.push('Flat Rack');
      }
      if (bodyLower.includes('open top') || bodyLower.includes('ot')) {
        detectedContent.push('Open Top');
      }
      if (bodyLower.includes('ex-hook') || bodyLower.includes('fot')) {
        detectedContent.push('Ex-hook / FOT');
      }
      if (bodyLower.includes('dap') && bodyLower.includes('site')) {
        detectedContent.push('DAP to site');
      }
      
      offers.push({
        type: offerType,
        email,
        sentAt: email.sent_at || email.received_at,
        senderName: getEmailSenderName(email.from_address),
        senderEmail: email.from_address,
        attachments: emailAttachments,
        detectedContent,
      });
    }
    
    return offers;
  };

  const extractAllRegulatoryInfo = (emails: ThreadEmail[]): RegulatoryInfo => {
    const combined: RegulatoryInfo = {
      customsNotes: [],
      otherNotes: [],
    };
    
    for (const email of emails) {
      const body = decodeBase64Content(email.body_text);
      const info = extractRegulatoryInfo(body);
      
      if (info.projectTaxation) {
        combined.projectTaxation = {
          ...combined.projectTaxation,
          ...info.projectTaxation,
        };
      }
      if (info.dpiRequired) combined.dpiRequired = true;
      if (info.dpiThreshold) combined.dpiThreshold = info.dpiThreshold;
      if (info.dpiDeadline) combined.dpiDeadline = info.dpiDeadline;
      if (info.apeAvailable) combined.apeAvailable = true;
      
      combined.customsNotes = [...new Set([...combined.customsNotes, ...info.customsNotes])];
      combined.otherNotes = [...new Set([...combined.otherNotes, ...info.otherNotes])];
    }
    
    return combined;
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

  const getEmailSenderName = (email: string): string => {
    return email.split('@')[0]
      .replace(/[._-]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
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
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">
                {isNewQuotation ? 'Nouvelle cotation' : 'Fiche de cotation'}
              </h1>
              {quotationCompleted && (
                <Badge className="bg-green-500/20 text-green-600 border-green-500/30">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Cotation réalisée
                </Badge>
              )}
            </div>
            {selectedEmail && (
              <p className="text-sm text-muted-foreground truncate">
                {selectedEmail.subject}
              </p>
            )}
            {threadEmails.length > 1 && (
              <Badge variant="outline" className="mt-1">
                <MessageSquare className="h-3 w-3 mr-1" />
                {threadEmails.length} emails dans le fil
              </Badge>
            )}
          </div>
          {!quotationCompleted && (
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
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Main Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Quotation Completed Banner */}
            {quotationCompleted && quotationOffers.length > 0 && (
              <Card className="border-green-500/30 bg-green-500/5">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2 text-green-600">
                      <CheckCircle className="h-5 w-5" />
                      COTATION RÉALISÉE
                    </CardTitle>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleLearnFromQuotation}
                      disabled={isLearning}
                      className="border-green-500/30 text-green-600 hover:bg-green-500/10"
                    >
                      {isLearning ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <GraduationCap className="h-4 w-4 mr-2" />
                      )}
                      Apprendre de cette cotation
                    </Button>
                  </div>
                  <CardDescription>
                    {quotationOffers.length} offre(s) envoyée(s) dans ce fil de discussion
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {quotationOffers.map((offer, index) => (
                    <div 
                      key={offer.email.id}
                      className="p-4 rounded-lg border border-green-500/20 bg-background"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="gap-1">
                            {getOfferTypeIcon(offer.type)}
                            {getOfferTypeLabel(offer.type)}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            Email {index + 1}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(offer.sentAt)}
                        </span>
                      </div>
                      
                      <div className="mb-3">
                        <p className="text-sm">
                          <span className="text-muted-foreground">Par: </span>
                          <span className="font-medium">{offer.senderName}</span>
                          <span className="text-muted-foreground"> ({offer.senderEmail})</span>
                        </p>
                      </div>
                      
                      {offer.detectedContent.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs text-muted-foreground mb-1">Contenu détecté:</p>
                          <div className="flex flex-wrap gap-1">
                            {offer.detectedContent.map((content, i) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {content}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {offer.attachments.length > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Pièces jointes:</p>
                          <div className="flex flex-wrap gap-2">
                            {offer.attachments.map(att => (
                              <Badge 
                                key={att.id} 
                                variant="outline" 
                                className={cn(
                                  "text-xs gap-1",
                                  att.filename.endsWith('.xlsx') || att.filename.endsWith('.xls') 
                                    ? "border-green-500/30 text-green-600"
                                    : att.filename.endsWith('.pdf')
                                    ? "border-red-500/30 text-red-600"
                                    : ""
                                )}
                              >
                                {att.filename.endsWith('.xlsx') || att.filename.endsWith('.xls') ? (
                                  <FileSpreadsheet className="h-3 w-3" />
                                ) : (
                                  <Paperclip className="h-3 w-3" />
                                )}
                                {att.filename.length > 30 ? att.filename.substring(0, 30) + '...' : att.filename}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
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
            {regulatoryInfo && (regulatoryInfo.projectTaxation || regulatoryInfo.dpiRequired || regulatoryInfo.customsNotes.length > 0) && (
              <Card className="border-blue-500/30 bg-blue-500/5">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2 text-blue-600">
                    <ShieldCheck className="h-4 w-4" />
                    Informations réglementaires extraites
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {regulatoryInfo.projectTaxation && (
                    <div className="p-3 rounded-lg bg-background border">
                      <p className="text-sm font-medium mb-1">Taxation projet exempté:</p>
                      <div className="flex gap-4 text-sm">
                        {regulatoryInfo.projectTaxation.sea && (
                          <span>
                            <Ship className="h-3 w-3 inline mr-1" />
                            Maritime: <strong>{regulatoryInfo.projectTaxation.sea}</strong> CIF
                          </span>
                        )}
                        {regulatoryInfo.projectTaxation.air && (
                          <span>
                            ✈️ Aérien: <strong>{regulatoryInfo.projectTaxation.air}</strong> CIF
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {regulatoryInfo.dpiRequired && (
                    <div className="p-3 rounded-lg bg-background border">
                      <div className="flex items-center gap-2 mb-1">
                        <Info className="h-4 w-4 text-amber-500" />
                        <p className="text-sm font-medium">DPI Obligatoire</p>
                      </div>
                      <div className="text-sm text-muted-foreground space-y-1">
                        {regulatoryInfo.dpiThreshold && (
                          <p>Seuil: CIF &gt; {regulatoryInfo.dpiThreshold}</p>
                        )}
                        {regulatoryInfo.dpiDeadline && (
                          <p>Délai: {regulatoryInfo.dpiDeadline}</p>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {regulatoryInfo.apeAvailable && (
                    <div className="p-3 rounded-lg bg-background border">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        <p className="text-sm">APE possible si exemption manquante (renouv. 10j)</p>
                      </div>
                    </div>
                  )}
                  
                  {regulatoryInfo.customsNotes.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {regulatoryInfo.customsNotes.map((note, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {note}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Alerts */}
            {alerts.length > 0 && (
              <Card className="border-amber-500/30 bg-amber-500/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2 text-amber-500">
                    <AlertTriangle className="h-4 w-4" />
                    Points d'attention ({alerts.length})
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

            {/* Thread Timeline */}
            {threadEmails.length > 1 && (
              <Collapsible open={timelineExpanded} onOpenChange={setTimelineExpanded}>
                <Card className="border-ocean/30 bg-ocean/5">
                  <CardHeader className="pb-2">
                    <CollapsibleTrigger asChild>
                      <div className="flex items-center justify-between cursor-pointer">
                        <CardTitle className="text-base flex items-center gap-2">
                          <History className="h-4 w-4 text-ocean" />
                          Historique du fil ({threadEmails.length} échanges)
                        </CardTitle>
                        {timelineExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </CollapsibleTrigger>
                  </CardHeader>
                  <CollapsibleContent>
                    <CardContent className="pt-0">
                      <div className="relative">
                        {/* Timeline line */}
                        <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />
                        
                        <div className="space-y-2">
                          {threadEmails.map((email, index) => {
                            const isInternal = isInternalEmail(email.from_address);
                            const isOffer = quotationOffers.some(o => o.email.id === email.id);
                            
                            return (
                              <div 
                                key={email.id} 
                                className={cn(
                                  "relative pl-8 py-2 rounded-lg transition-colors cursor-pointer",
                                  email.id === selectedEmail?.id 
                                    ? "bg-ocean/10 border border-ocean/30" 
                                    : "hover:bg-muted/50",
                                  isOffer && "border-l-2 border-l-green-500"
                                )}
                                onClick={() => setSelectedEmail(email)}
                              >
                                {/* Timeline dot */}
                                <div className={cn(
                                  "absolute left-1.5 top-4 w-3 h-3 rounded-full border-2",
                                  index === 0 
                                    ? "bg-primary border-primary"
                                    : isOffer
                                    ? "bg-green-500 border-green-500"
                                    : isInternal
                                    ? "bg-ocean border-ocean"
                                    : email.id === selectedEmail?.id
                                    ? "bg-ocean border-ocean"
                                    : "bg-muted border-muted-foreground/30"
                                )} />
                                
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-sm truncate">
                                        {getEmailSenderName(email.from_address)}
                                      </span>
                                      {index === 0 && (
                                        <Badge variant="outline" className="text-xs">
                                          Original
                                        </Badge>
                                      )}
                                      {isOffer && (
                                        <Badge className="text-xs bg-green-500/20 text-green-600 border-green-500/30">
                                          Offre
                                        </Badge>
                                      )}
                                      {isInternal && !isOffer && (
                                        <Badge variant="outline" className="text-xs text-ocean">
                                          Interne
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                                      {email.subject}
                                    </p>
                                  </div>
                                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                                    {formatDate(email.sent_at || email.received_at)}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            )}

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
