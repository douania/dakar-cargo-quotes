import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Puzzle,
  Package,
  MapPin,
  Clock,
  DollarSign,
  Users,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Mail,
  Paperclip,
  Sparkles,
  Target,
  MessageSquare,
  BookOpen,
  X,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { usePuzzleJob, PHASE_LABELS } from '@/hooks/usePuzzleJob';

interface PuzzlePhase {
  id: string;
  name: string;
  icon: React.ReactNode;
  status: 'pending' | 'completed' | 'partial' | 'failed';
  data?: unknown;
}

interface PuzzleState {
  thread_id: string;
  email_count: number;
  attachment_count: number;
  attachments_analyzed?: number;
  auto_analyzed?: number;
  phases_completed: string[];
  puzzle_completeness: number;
  cargo?: Record<string, unknown>;
  routing?: Record<string, unknown>;
  timing?: Record<string, unknown>;
  tariff_lines?: Array<Record<string, unknown>>;
  matching_criteria?: Record<string, unknown>;
  contacts?: Array<Record<string, unknown>>;
  negotiation?: Record<string, unknown>;
  missing_info?: string[];
}

interface Props {
  threadId?: string;
  emailId?: string;
  onPuzzleComplete?: (puzzle: PuzzleState) => void;
}

export function QuotationPuzzleView({ threadId, emailId, onPuzzleComplete }: Props) {
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set(['cargo', 'routing']));
  
  // Use the new async puzzle job hook
  const {
    job,
    isPolling,
    isStarting,
    isTicking,
    isStale,
    isComplete,
    isFailed,
    startAnalysis,
    cancelAnalysis,
    resumeStaleJob,
    phaseLabel,
    phasesRemaining,
  } = usePuzzleJob(threadId);

  // Derive puzzle state from job
  const puzzle: PuzzleState | null = job?.final_puzzle 
    ? (job.final_puzzle as unknown as PuzzleState)
    : job?.partial_results && Object.keys(job.partial_results).length > 0
      ? buildPartialPuzzle(job)
      : null;

  // Fetch existing learned knowledge for this thread
  const { data: existingKnowledge, refetch: refetchKnowledge } = useQuery({
    queryKey: ['thread-knowledge', threadId],
    queryFn: async () => {
      if (!threadId) return [];
      const { data, error } = await supabase
        .from('learned_knowledge')
        .select('id, name, category, description, created_at, is_validated')
        .eq('source_id', threadId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!threadId
  });

  // Track if onPuzzleComplete has been called to prevent infinite loops
  const hasCalledComplete = useRef(false);
  
  // Reset the flag when threadId changes
  useEffect(() => {
    hasCalledComplete.current = false;
  }, [threadId]);

  // Call onPuzzleComplete in an effect to avoid setState during render
  useEffect(() => {
    if (isComplete && onPuzzleComplete && puzzle && !hasCalledComplete.current) {
      hasCalledComplete.current = true;
      onPuzzleComplete(puzzle);
      refetchKnowledge();
    }
  }, [isComplete, puzzle, onPuzzleComplete, refetchKnowledge]);

  const handleStartAnalysis = async () => {
    await startAnalysis(emailId);
  };

  const togglePhase = (phaseId: string) => {
    setExpandedPhases(prev => {
      const next = new Set(prev);
      if (next.has(phaseId)) {
        next.delete(phaseId);
      } else {
        next.add(phaseId);
      }
      return next;
    });
  };

  const getPhaseStatus = (phaseId: string): 'pending' | 'completed' | 'partial' | 'failed' => {
    if (!puzzle) return 'pending';
    
    switch (phaseId) {
      case 'cargo':
        return puzzle.cargo ? 'completed' : 'pending';
      case 'routing':
        return puzzle.routing?.destination_city ? 'completed' : 
               puzzle.routing ? 'partial' : 'pending';
      case 'timing':
        return puzzle.timing?.loading_date ? 'completed' : 
               puzzle.timing ? 'partial' : 'pending';
      case 'quotation':
        return puzzle.tariff_lines && puzzle.tariff_lines.length > 0 ? 'completed' : 'pending';
      case 'negotiation':
        return (puzzle.negotiation as Record<string, unknown>)?.outcome ? 'completed' : 
               (puzzle.negotiation as Record<string, unknown>)?.occurred ? 'partial' : 'pending';
      case 'contacts':
        return puzzle.contacts && puzzle.contacts.length > 0 ? 'completed' : 'pending';
      default:
        return 'pending';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-600 bg-green-100';
      case 'partial': return 'text-amber-600 bg-amber-100';
      case 'failed': return 'text-red-600 bg-red-100';
      default: return 'text-muted-foreground bg-muted';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case 'partial': return <AlertCircle className="h-4 w-4 text-amber-600" />;
      case 'failed': return <AlertCircle className="h-4 w-4 text-red-600" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const phases: PuzzlePhase[] = [
    { id: 'cargo', name: 'Marchandises', icon: <Package className="h-4 w-4" />, status: getPhaseStatus('cargo'), data: puzzle?.cargo },
    { id: 'routing', name: 'Itinéraire', icon: <MapPin className="h-4 w-4" />, status: getPhaseStatus('routing'), data: puzzle?.routing },
    { id: 'timing', name: 'Délais', icon: <Clock className="h-4 w-4" />, status: getPhaseStatus('timing'), data: puzzle?.timing },
    { id: 'quotation', name: 'Cotation', icon: <DollarSign className="h-4 w-4" />, status: getPhaseStatus('quotation'), data: puzzle?.tariff_lines },
    { id: 'negotiation', name: 'Négociation', icon: <MessageSquare className="h-4 w-4" />, status: getPhaseStatus('negotiation'), data: puzzle?.negotiation },
    { id: 'contacts', name: 'Contacts', icon: <Users className="h-4 w-4" />, status: getPhaseStatus('contacts'), data: puzzle?.contacts },
  ];

  const completedCount = phases.filter(p => p.status === 'completed').length;
  const partialCount = phases.filter(p => p.status === 'partial').length;

  const isAnalyzing = isPolling || isStarting || isTicking;

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Puzzle className="h-5 w-5 text-primary" />
            Puzzle d'apprentissage
          </CardTitle>
          {!isAnalyzing && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleStartAnalysis}
              disabled={isStarting}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Analyser le fil complet
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Existing Knowledge Alert */}
        {existingKnowledge && existingKnowledge.length > 0 && (
          <Alert className="border-green-200 bg-green-50">
            <BookOpen className="h-4 w-4 text-green-600" />
            <AlertTitle className="text-green-800">
              Connaissances déjà extraites ({existingKnowledge.length})
            </AlertTitle>
            <AlertDescription className="text-green-700">
              <ul className="list-disc list-inside mt-2 space-y-1">
                {existingKnowledge.slice(0, 5).map((k) => (
                  <li key={k.id} className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {k.category}
                    </Badge>
                    <span>{k.name}</span>
                    {k.is_validated && (
                      <CheckCircle2 className="h-3 w-3 text-green-600" />
                    )}
                  </li>
                ))}
                {existingKnowledge.length > 5 && (
                  <li className="text-green-600 italic">
                    + {existingKnowledge.length - 5} autres éléments
                  </li>
                )}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* Progress indicator during analysis */}
        {isAnalyzing && job && (
          <div className="space-y-3 p-4 bg-primary/5 rounded-lg border border-primary/20">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {phaseLabel || 'Préparation...'}
              </span>
              <span className="text-sm text-muted-foreground">
                {job.progress}%
              </span>
            </div>
            
            <Progress value={job.progress} className="h-2" />
            
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {isStale ? (
                <>
                  <AlertCircle className="h-3 w-3 text-amber-500" />
                  <span>Analyse interrompue - reprise en cours...</span>
                </>
              ) : (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>
                    Phase {(job.phases_completed?.length || 0) + 1}/5
                    {job.email_count && ` • ${job.email_count} emails`}
                    {job.attachment_count && ` • ${job.attachment_count} PJ`}
                  </span>
                </>
              )}
            </div>
            
            <div className="flex gap-2">
              {isStale && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={resumeStaleJob}
                  disabled={isTicking}
                >
                  <RefreshCw className={cn("h-4 w-4 mr-2", isTicking && "animate-spin")} />
                  Reprendre
                </Button>
              )}
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={cancelAnalysis}
              >
                <X className="h-4 w-4 mr-2" />
                Annuler
              </Button>
            </div>
          </div>
        )}

        {/* Error state */}
        {isFailed && job?.error_message && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Analyse échouée</AlertTitle>
            <AlertDescription>
              {job.error_message}
              {job.error_phase && (
                <span className="block mt-1 text-xs">
                  Phase: {PHASE_LABELS[job.error_phase] || job.error_phase}
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Stats */}
        {puzzle && (
          <div className="flex flex-wrap items-center gap-4 p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{puzzle.email_count} emails</span>
            </div>
            <Separator orientation="vertical" className="h-4" />
            <div className="flex items-center gap-2">
              <Paperclip className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{puzzle.attachment_count} pièces jointes</span>
              {puzzle.attachments_analyzed !== undefined && (
                <Badge 
                  variant={puzzle.attachments_analyzed < puzzle.attachment_count ? "destructive" : "default"}
                  className="text-xs"
                >
                  {puzzle.attachments_analyzed}/{puzzle.attachment_count} analysées
                </Badge>
              )}
              {puzzle.auto_analyzed && puzzle.auto_analyzed > 0 && (
                <Badge variant="secondary" className="text-xs">
                  <Sparkles className="h-3 w-3 mr-1" />
                  +{puzzle.auto_analyzed} auto
                </Badge>
              )}
            </div>
            <Separator orientation="vertical" className="h-4" />
            <div className="flex-1 min-w-[150px]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-muted-foreground">Complétude</span>
                <span className="text-sm font-bold">{puzzle.puzzle_completeness}%</span>
              </div>
              <Progress value={puzzle.puzzle_completeness} className="h-2" />
            </div>
          </div>
        )}

        {/* Phases */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <Target className="h-4 w-4" />
            <span>{completedCount}/{phases.length} pièces complètes</span>
            {partialCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                {partialCount} partielles
              </Badge>
            )}
          </div>

          <ScrollArea className="max-h-[400px]">
            <div className="space-y-2">
              {phases.map((phase) => (
                <Collapsible
                  key={phase.id}
                  open={expandedPhases.has(phase.id)}
                  onOpenChange={() => togglePhase(phase.id)}
                >
                  <CollapsibleTrigger className="w-full">
                    <div className={cn(
                      "flex items-center justify-between p-3 rounded-lg border transition-colors",
                      "hover:bg-muted/50",
                      phase.status === 'completed' && "border-green-200 bg-green-50/50",
                      phase.status === 'partial' && "border-amber-200 bg-amber-50/50",
                    )}>
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "p-2 rounded-full",
                          getStatusColor(phase.status)
                        )}>
                          {phase.icon}
                        </div>
                        <span className="font-medium">{phase.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(phase.status)}
                        {expandedPhases.has(phase.id) ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                  </CollapsibleTrigger>

                  <CollapsibleContent className="pt-2">
                    <div className="ml-12 p-3 bg-muted/30 rounded-lg text-sm">
                      {phase.status === 'pending' && !puzzle && (
                        <p className="text-muted-foreground italic">
                          Cliquez sur "Analyser le fil complet" pour extraire ces informations
                        </p>
                      )}
                      
                      {phase.id === 'cargo' && phase.data && (
                        <div className="space-y-2">
                          <p><strong>Description:</strong> {(phase.data as Record<string, unknown>).description as string || '-'}</p>
                          <p><strong>Poids:</strong> {(phase.data as Record<string, unknown>).weight_kg ? `${(phase.data as Record<string, unknown>).weight_kg} kg` : '-'}</p>
                          <p><strong>Volume:</strong> {(phase.data as Record<string, unknown>).volume_cbm ? `${(phase.data as Record<string, unknown>).volume_cbm} CBM` : '-'}</p>
                          <p><strong>Conditionnement:</strong> {(phase.data as Record<string, unknown>).packaging as string || '-'}</p>
                          {(phase.data as Record<string, unknown>).hazardous && (
                            <Badge variant="destructive">IMO {(phase.data as Record<string, unknown>).imo_class as string}</Badge>
                          )}
                        </div>
                      )}

                      {phase.id === 'routing' && phase.data && (
                        <div className="space-y-2">
                          <p><strong>Origine:</strong> {(phase.data as Record<string, unknown>).origin_city as string}, {(phase.data as Record<string, unknown>).origin_country as string}</p>
                          <p><strong>Destination:</strong> {((phase.data as Record<string, unknown>).destination_city || (phase.data as Record<string, unknown>).destination_site) as string}, {(phase.data as Record<string, unknown>).destination_country as string}</p>
                          <p><strong>Incoterm:</strong> {(phase.data as Record<string, unknown>).incoterm_requested as string || '-'}</p>
                          {((phase.data as Record<string, unknown>).transit_ports as string[])?.length > 0 && (
                            <p><strong>Ports de transit:</strong> {((phase.data as Record<string, unknown>).transit_ports as string[]).join(', ')}</p>
                          )}
                        </div>
                      )}

                      {phase.id === 'timing' && phase.data && (
                        <div className="space-y-2">
                          <p><strong>Date de chargement:</strong> {(phase.data as Record<string, unknown>).loading_date as string || '-'}</p>
                          <p><strong>Deadline:</strong> {(phase.data as Record<string, unknown>).delivery_deadline as string || '-'}</p>
                          <Badge variant={
                            (phase.data as Record<string, unknown>).urgency === 'critical' ? 'destructive' :
                            (phase.data as Record<string, unknown>).urgency === 'urgent' ? 'secondary' : 'outline'
                          }>
                            {(phase.data as Record<string, unknown>).urgency as string || 'normal'}
                          </Badge>
                        </div>
                      )}

                      {phase.id === 'quotation' && Array.isArray(phase.data) && (
                        <div className="space-y-2">
                          <p><strong>{phase.data.length} lignes de tarif extraites</strong></p>
                          <div className="max-h-40 overflow-y-auto">
                            {phase.data.slice(0, 5).map((line: Record<string, unknown>, idx: number) => (
                              <div key={idx} className="flex justify-between py-1 border-b border-border/50">
                                <span>{line.service as string}</span>
                                <span className="font-mono">
                                  {(line.amount as number)?.toLocaleString()} {line.currency as string}
                                </span>
                              </div>
                            ))}
                            {phase.data.length > 5 && (
                              <p className="text-muted-foreground text-xs pt-1">
                                + {phase.data.length - 5} autres lignes
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {phase.id === 'negotiation' && phase.data && (
                        <div className="space-y-2">
                          <p><strong>Négociation:</strong> {(phase.data as Record<string, unknown>).occurred ? 'Oui' : 'Non'}</p>
                          {(phase.data as Record<string, unknown>).outcome && (
                            <Badge variant={
                              (phase.data as Record<string, unknown>).outcome === 'accepted' ? 'default' :
                              (phase.data as Record<string, unknown>).outcome === 'rejected' ? 'destructive' : 'secondary'
                            }>
                              {(phase.data as Record<string, unknown>).outcome === 'accepted' ? '✓ Acceptée' :
                               (phase.data as Record<string, unknown>).outcome === 'rejected' ? '✗ Refusée' : 
                               (phase.data as Record<string, unknown>).outcome as string}
                            </Badge>
                          )}
                          {(phase.data as Record<string, unknown>).accepted_amount && (
                            <p><strong>Montant final:</strong> {((phase.data as Record<string, unknown>).accepted_amount as number)?.toLocaleString()} {(phase.data as Record<string, unknown>).accepted_currency as string}</p>
                          )}
                        </div>
                      )}

                      {phase.id === 'contacts' && Array.isArray(phase.data) && (
                        <div className="space-y-2">
                          {phase.data.map((contact: Record<string, unknown>, idx: number) => (
                            <div key={idx} className="flex items-center gap-2 py-1">
                              <Badge variant="outline" className="text-xs">
                                {contact.role as string}
                              </Badge>
                              <span>{contact.name as string || contact.email as string}</span>
                              {contact.company && (
                                <span className="text-muted-foreground">({contact.company as string})</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Missing info */}
        {puzzle?.missing_info && puzzle.missing_info.length > 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Informations manquantes</AlertTitle>
            <AlertDescription>
              <ul className="list-disc list-inside mt-2">
                {puzzle.missing_info.map((info, idx) => (
                  <li key={idx}>{info}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* Duration info */}
        {isComplete && job?.duration_ms && (
          <p className="text-xs text-muted-foreground text-center">
            Analyse terminée en {Math.round(job.duration_ms / 1000)}s • {job.knowledge_stored || 0} connaissances stockées
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// Build partial puzzle state from job's partial_results
function buildPartialPuzzle(job: { 
  partial_results: Record<string, unknown>; 
  email_count?: number | null; 
  attachment_count?: number | null;
  phases_completed?: string[];
}): PuzzleState {
  const results = job.partial_results || {};
  
  const extractRequest = results.extract_request as Record<string, unknown> | undefined;
  const extractClarifications = results.extract_clarifications as Record<string, unknown> | undefined;
  const extractQuotation = results.extract_quotation as Record<string, unknown> | undefined;
  const extractNegotiation = results.extract_negotiation as Record<string, unknown> | undefined;
  const extractContacts = results.extract_contacts as Record<string, unknown> | undefined;

  let cargo = extractRequest?.cargo as Record<string, unknown> | undefined;
  let routing = extractRequest?.routing as Record<string, unknown> | undefined;
  let timing = extractRequest?.timing as Record<string, unknown> | undefined;

  // Merge clarifications
  if (extractClarifications?.puzzle_updates) {
    const updates = extractClarifications.puzzle_updates as Record<string, unknown>;
    if (updates.cargo) cargo = { ...cargo, ...(updates.cargo as Record<string, unknown>) };
    if (updates.routing) routing = { ...routing, ...(updates.routing as Record<string, unknown>) };
    if (updates.timing) timing = { ...timing, ...(updates.timing as Record<string, unknown>) };
  }

  // Calculate completeness
  let score = 0;
  if (cargo) score += 20;
  if (routing) score += 20;
  if (timing) score += 10;
  if (extractQuotation?.tariff_lines && (extractQuotation.tariff_lines as unknown[]).length > 0) score += 30;
  if (extractQuotation?.matching_criteria) score += 10;
  if (extractNegotiation?.final_outcome) score += 10;

  return {
    thread_id: '',
    email_count: job.email_count || 0,
    attachment_count: job.attachment_count || 0,
    phases_completed: job.phases_completed || [],
    puzzle_completeness: score,
    cargo,
    routing,
    timing,
    tariff_lines: (extractQuotation?.tariff_lines as Array<Record<string, unknown>>) || [],
    matching_criteria: extractQuotation?.matching_criteria as Record<string, unknown>,
    contacts: (extractContacts?.contacts as Array<Record<string, unknown>>) || [],
    negotiation: extractNegotiation ? {
      occurred: extractNegotiation.negotiation_occurred,
      outcome: extractNegotiation.final_outcome,
      accepted_amount: extractNegotiation.accepted_amount,
      patterns: extractNegotiation.negotiation_patterns,
    } : undefined,
    missing_info: (extractRequest?.missing_info as string[]) || [],
  };
}
