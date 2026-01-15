import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
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
  TrendingUp,
  FileText,
  MessageSquare,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface PuzzlePhase {
  id: string;
  name: string;
  icon: React.ReactNode;
  status: 'pending' | 'completed' | 'partial' | 'failed';
  data?: any;
}

interface PuzzleState {
  thread_id: string;
  email_count: number;
  attachment_count: number;
  phases_completed: string[];
  puzzle_completeness: number;
  cargo?: any;
  routing?: any;
  timing?: any;
  tariff_lines?: any[];
  matching_criteria?: any;
  contacts?: any[];
  negotiation?: any;
  missing_info?: string[];
}

interface Props {
  threadId?: string;
  emailId?: string;
  onPuzzleComplete?: (puzzle: PuzzleState) => void;
}

export function QuotationPuzzleView({ threadId, emailId, onPuzzleComplete }: Props) {
  const [puzzle, setPuzzle] = useState<PuzzleState | null>(null);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set(['cargo', 'routing']));

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('learn-quotation-puzzle', {
        body: { threadId, emailId }
      });
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data.success && data.puzzle) {
        setPuzzle(data.puzzle);
        toast.success(`Puzzle analysé: ${data.puzzle.puzzle_completeness}% complet`);
        if (onPuzzleComplete) {
          onPuzzleComplete(data.puzzle);
        }
      }
    },
    onError: (error) => {
      toast.error('Erreur lors de l\'analyse du puzzle');
      console.error('Puzzle analysis error:', error);
    }
  });

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
        return puzzle.negotiation?.outcome ? 'completed' : 
               puzzle.negotiation?.occurred ? 'partial' : 'pending';
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

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Puzzle className="h-5 w-5 text-primary" />
            Puzzle d'apprentissage
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => analyzeMutation.mutate()}
            disabled={analyzeMutation.isPending}
          >
            {analyzeMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analyse...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Analyser le fil complet
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Stats */}
        {puzzle && (
          <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{puzzle.email_count} emails</span>
            </div>
            <Separator orientation="vertical" className="h-4" />
            <div className="flex items-center gap-2">
              <Paperclip className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{puzzle.attachment_count} pièces jointes</span>
            </div>
            <Separator orientation="vertical" className="h-4" />
            <div className="flex-1">
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
                          <p><strong>Description:</strong> {phase.data.description || '-'}</p>
                          <p><strong>Poids:</strong> {phase.data.weight_kg ? `${phase.data.weight_kg} kg` : '-'}</p>
                          <p><strong>Volume:</strong> {phase.data.volume_cbm ? `${phase.data.volume_cbm} CBM` : '-'}</p>
                          <p><strong>Conditionnement:</strong> {phase.data.packaging || '-'}</p>
                          {phase.data.hazardous && (
                            <Badge variant="destructive">IMO {phase.data.imo_class}</Badge>
                          )}
                        </div>
                      )}

                      {phase.id === 'routing' && phase.data && (
                        <div className="space-y-2">
                          <p><strong>Origine:</strong> {phase.data.origin_city}, {phase.data.origin_country}</p>
                          <p><strong>Destination:</strong> {phase.data.destination_city || phase.data.destination_site}, {phase.data.destination_country}</p>
                          <p><strong>Incoterm:</strong> {phase.data.incoterm_requested || '-'}</p>
                          {phase.data.transit_ports?.length > 0 && (
                            <p><strong>Ports de transit:</strong> {phase.data.transit_ports.join(', ')}</p>
                          )}
                        </div>
                      )}

                      {phase.id === 'timing' && phase.data && (
                        <div className="space-y-2">
                          <p><strong>Date de chargement:</strong> {phase.data.loading_date || '-'}</p>
                          <p><strong>Deadline:</strong> {phase.data.delivery_deadline || '-'}</p>
                          <Badge variant={
                            phase.data.urgency === 'critical' ? 'destructive' :
                            phase.data.urgency === 'urgent' ? 'secondary' : 'outline'
                          }>
                            {phase.data.urgency || 'normal'}
                          </Badge>
                        </div>
                      )}

                      {phase.id === 'quotation' && Array.isArray(phase.data) && (
                        <div className="space-y-2">
                          <p><strong>{phase.data.length} lignes de tarif extraites</strong></p>
                          <div className="max-h-40 overflow-y-auto">
                            {phase.data.slice(0, 5).map((line: any, idx: number) => (
                              <div key={idx} className="flex justify-between py-1 border-b border-border/50">
                                <span>{line.service}</span>
                                <span className="font-mono">
                                  {line.amount?.toLocaleString()} {line.currency}
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
                          <p><strong>Négociation:</strong> {phase.data.occurred ? 'Oui' : 'Non'}</p>
                          {phase.data.outcome && (
                            <Badge variant={
                              phase.data.outcome === 'accepted' ? 'default' :
                              phase.data.outcome === 'rejected' ? 'destructive' : 'secondary'
                            }>
                              {phase.data.outcome === 'accepted' ? '✓ Acceptée' :
                               phase.data.outcome === 'rejected' ? '✗ Refusée' : 
                               phase.data.outcome}
                            </Badge>
                          )}
                          {phase.data.accepted_amount && (
                            <p><strong>Montant final:</strong> {phase.data.accepted_amount?.toLocaleString()} {phase.data.accepted_currency}</p>
                          )}
                        </div>
                      )}

                      {phase.id === 'contacts' && Array.isArray(phase.data) && (
                        <div className="space-y-2">
                          {phase.data.map((contact: any, idx: number) => (
                            <div key={idx} className="flex items-center gap-2 py-1">
                              <Badge variant="outline" className="text-xs">
                                {contact.role}
                              </Badge>
                              <span>{contact.name || contact.email}</span>
                              <span className="text-muted-foreground text-xs">
                                {contact.company}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {phase.status === 'pending' && puzzle && (
                        <p className="text-muted-foreground italic">
                          Information non extraite ou non détectée
                        </p>
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
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <span className="font-medium text-amber-800">Informations manquantes</span>
            </div>
            <ul className="list-disc list-inside text-sm text-amber-700 space-y-1">
              {puzzle.missing_info.map((info, idx) => (
                <li key={idx}>{info}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Matching criteria */}
        {puzzle?.matching_criteria && (
          <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span className="font-medium">Critères de réutilisation</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {puzzle.matching_criteria.container_types?.map((type: string) => (
                <Badge key={type} variant="secondary">{type}</Badge>
              ))}
              {puzzle.matching_criteria.destination_port && (
                <Badge variant="outline">{puzzle.matching_criteria.destination_port}</Badge>
              )}
              {puzzle.matching_criteria.destination_city && (
                <Badge variant="outline">{puzzle.matching_criteria.destination_city}</Badge>
              )}
              {puzzle.matching_criteria.cargo_category && (
                <Badge variant="outline">{puzzle.matching_criteria.cargo_category}</Badge>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
