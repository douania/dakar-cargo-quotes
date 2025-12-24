import { useState } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Search,
  HelpCircle,
  Lightbulb,
  Plane,
  Ship,
  Phone,
  History,
  Plus,
  Send,
  FileText,
  ChevronDown,
  ChevronUp,
  Package,
  MapPin,
  Scale,
  DollarSign,
  Calendar,
  User,
  Building,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

// Types for puzzle analysis
export interface PuzzlePiece {
  key: string;
  label: string;
  value: string | null;
  source: 'email' | 'attachment' | 'learned' | 'manual';
  confidence?: number;
}

export interface MissingInfo {
  key: string;
  label: string;
  question: string;
  priority: 'high' | 'medium' | 'low';
}

export interface ResearchItem {
  key: string;
  label: string;
  searchType: 'tariff' | 'hs_code' | 'customs_duty' | 'carrier' | 'contact' | 'historical';
  suggestedActions: string[];
  status: 'pending' | 'searching' | 'found' | 'not_found';
  result?: string;
}

export interface Suggestion {
  type: 'carrier' | 'historical_quote' | 'contact' | 'tip';
  title: string;
  items: { label: string; detail?: string; action?: string }[];
  icon?: string;
}

export interface PuzzleAnalysis {
  provided: PuzzlePiece[];
  needsFromClient: MissingInfo[];
  needsResearch: ResearchItem[];
  suggestions: Suggestion[];
  hsSuggestions?: {
    item: string;
    hs_code: string;
    description: string | null;
    dd: number;
    tva: number;
    confidence: 'high' | 'medium' | 'low';
  }[];
  workScope?: {
    starts_at: string;
    includes_freight: boolean;
    services: string[];
    notes: string[];
  };
  requiredDocuments?: string[];
  completeness: number;
  canGenerateQuote: boolean;
  transportMode: 'maritime' | 'air' | 'road' | 'multimodal' | 'unknown';
}

interface Props {
  puzzle: PuzzleAnalysis;
  originalEmail: {
    from: string;
    subject: string;
    date: string;
  };
  onAskClient: (questions: string[]) => void;
  onGenerateQuotation: () => void;
  onAddManualInfo: (key: string, value: string) => void;
  onSearchTariff: (item: ResearchItem) => void;
  isGenerating?: boolean;
}

export function QuotationPuzzle({
  puzzle,
  originalEmail,
  onAskClient,
  onGenerateQuotation,
  onAddManualInfo,
  onSearchTariff,
  isGenerating = false,
}: Props) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    provided: true,
    client: true,
    research: true,
    suggestions: true,
  });
  const [manualInputs, setManualInputs] = useState<Record<string, string>>({});

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'text-destructive border-destructive bg-destructive/10';
      case 'medium':
        return 'text-amber-600 border-amber-500 bg-amber-500/10';
      case 'low':
        return 'text-muted-foreground border-muted bg-muted/50';
      default:
        return 'text-muted-foreground';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'found':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'searching':
        return <RefreshCw className="h-4 w-4 animate-spin text-primary" />;
      case 'not_found':
        return <AlertCircle className="h-4 w-4 text-amber-500" />;
      default:
        return <Search className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getSuggestionIcon = (type: string) => {
    switch (type) {
      case 'carrier':
        return puzzle.transportMode === 'air' ? <Plane className="h-5 w-5" /> : <Ship className="h-5 w-5" />;
      case 'historical_quote':
        return <History className="h-5 w-5" />;
      case 'contact':
        return <Phone className="h-5 w-5" />;
      case 'tip':
        return <Lightbulb className="h-5 w-5" />;
      default:
        return <Lightbulb className="h-5 w-5" />;
    }
  };

  const getFieldIcon = (key: string) => {
    const iconMap: Record<string, React.ReactNode> = {
      destination: <MapPin className="h-4 w-4" />,
      origin: <MapPin className="h-4 w-4" />,
      incoterm: <Scale className="h-4 w-4" />,
      value: <DollarSign className="h-4 w-4" />,
      weight: <Package className="h-4 w-4" />,
      volume: <Package className="h-4 w-4" />,
      date: <Calendar className="h-4 w-4" />,
      client: <User className="h-4 w-4" />,
      company: <Building className="h-4 w-4" />,
    };
    return iconMap[key] || <FileText className="h-4 w-4" />;
  };

  const handleAddManualInfo = (key: string) => {
    const value = manualInputs[key];
    if (value?.trim()) {
      onAddManualInfo(key, value.trim());
      setManualInputs(prev => ({ ...prev, [key]: '' }));
    }
  };

  const collectClientQuestions = () => {
    const questions = puzzle.needsFromClient
      .filter(item => item.priority !== 'low')
      .map(item => item.question);
    onAskClient(questions);
  };

  return (
    <div className="space-y-4">
      {/* Header with completeness */}
      <Card className="border-primary/30 bg-gradient-to-br from-background to-muted/30">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Package className="h-5 w-5 text-primary" />
              Puzzle de cotation
            </CardTitle>
            <Badge variant={puzzle.canGenerateQuote ? 'default' : 'secondary'}>
              {puzzle.transportMode === 'air' ? '✈️ Fret aérien' : 
               puzzle.transportMode === 'maritime' ? '🚢 Maritime' : 
               '📦 Transport'}
            </Badge>
          </div>
          
          {/* Email summary */}
          <div className="text-sm text-muted-foreground mt-2">
            <span className="font-medium">{originalEmail.subject}</span>
            <span className="mx-2">•</span>
            <span>{originalEmail.from}</span>
          </div>
        </CardHeader>
        
        <CardContent className="pt-0">
          {/* Completeness bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Complétude du puzzle</span>
              <span className="font-medium">{puzzle.completeness}%</span>
            </div>
            <Progress 
              value={puzzle.completeness} 
              className={cn(
                "h-2",
                puzzle.completeness >= 80 ? "[&>div]:bg-green-500" :
                puzzle.completeness >= 50 ? "[&>div]:bg-amber-500" :
                "[&>div]:bg-destructive"
              )}
            />
            <p className="text-xs text-muted-foreground">
              {puzzle.provided.length} pièces fournies • 
              {puzzle.needsFromClient.length} à demander • 
              {puzzle.needsResearch.length} à rechercher
            </p>
          </div>
        </CardContent>
      </Card>

      <ScrollArea className="h-[calc(100vh-400px)] pr-2">
        <div className="space-y-4">
          {/* PROVIDED INFORMATION */}
          <Collapsible open={expandedSections.provided} onOpenChange={() => toggleSection('provided')}>
            <Card>
              <CollapsibleTrigger asChild>
                <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                      Informations fournies ({puzzle.provided.length})
                    </CardTitle>
                    {expandedSections.provided ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              
              <CollapsibleContent>
                <CardContent className="pt-0">
                  <div className="grid grid-cols-2 gap-2">
                    {puzzle.provided.map((piece) => (
                      <div
                        key={piece.key}
                        className="flex items-start gap-2 p-2 rounded-lg bg-green-500/5 border border-green-500/20"
                      >
                        {getFieldIcon(piece.key)}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-muted-foreground">{piece.label}</p>
                          <p className="text-sm font-medium truncate">{piece.value || '-'}</p>
                        </div>
                        {piece.confidence && piece.confidence < 0.8 && (
                          <Badge variant="outline" className="text-xs shrink-0">
                            ~{Math.round(piece.confidence * 100)}%
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* NEEDS FROM CLIENT */}
          {puzzle.needsFromClient.length > 0 && (
            <Collapsible open={expandedSections.client} onOpenChange={() => toggleSection('client')}>
              <Card className="border-amber-500/30">
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <HelpCircle className="h-5 w-5 text-amber-500" />
                        À demander au client ({puzzle.needsFromClient.length})
                      </CardTitle>
                      {expandedSections.client ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                
                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-2">
                    {puzzle.needsFromClient.map((item) => (
                      <div
                        key={item.key}
                        className={cn(
                          "flex items-center gap-2 p-2 rounded-lg border",
                          getPriorityColor(item.priority)
                        )}
                      >
                        <Badge variant="outline" className="shrink-0 text-xs">
                          {item.priority === 'high' ? '!' : item.priority === 'medium' ? '?' : '○'}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{item.label}</p>
                          <p className="text-xs text-muted-foreground truncate">{item.question}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Input
                            placeholder="Ajouter..."
                            value={manualInputs[item.key] || ''}
                            onChange={(e) => setManualInputs(prev => ({ ...prev, [item.key]: e.target.value }))}
                            className="h-7 w-24 text-xs"
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => handleAddManualInfo(item.key)}
                            disabled={!manualInputs[item.key]?.trim()}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-2 gap-2"
                      onClick={collectClientQuestions}
                    >
                      <Send className="h-4 w-4" />
                      Générer email de clarification
                    </Button>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}

          {/* NEEDS RESEARCH */}
          {puzzle.needsResearch.length > 0 && (
            <Collapsible open={expandedSections.research} onOpenChange={() => toggleSection('research')}>
              <Card className="border-blue-500/30">
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Search className="h-5 w-5 text-blue-500" />
                        À rechercher ({puzzle.needsResearch.length})
                      </CardTitle>
                      {expandedSections.research ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                
                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-2">
                    {puzzle.needsResearch.map((item) => (
                      <div
                        key={item.key}
                        className="flex items-center gap-2 p-2 rounded-lg border border-blue-500/20 bg-blue-500/5"
                      >
                        {getStatusIcon(item.status)}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{item.label}</p>
                          {item.result ? (
                            <p className="text-xs text-green-600">{item.result}</p>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {item.suggestedActions[0] || 'Rechercher...'}
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 shrink-0"
                          onClick={() => onSearchTariff(item)}
                          disabled={item.status === 'searching'}
                        >
                          {item.status === 'searching' ? (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                          ) : (
                            <Search className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    ))}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}

          {/* HS CODE SUGGESTIONS (Proactive AI) */}
          {puzzle.hsSuggestions && puzzle.hsSuggestions.length > 0 && (
            <Card className="border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-transparent">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Package className="h-5 w-5 text-emerald-500" />
                  Codes HS suggérés ({puzzle.hsSuggestions.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                {puzzle.hsSuggestions.map((hs, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{hs.item}</p>
                      <p className="text-xs text-muted-foreground font-mono">{hs.hs_code}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-xs">DD {hs.dd}%</Badge>
                      <Badge variant="outline" className="text-xs">TVA {hs.tva}%</Badge>
                      <Badge 
                        variant={hs.confidence === 'high' ? 'default' : 'secondary'}
                        className="text-xs"
                      >
                        {hs.confidence === 'high' ? '✓' : hs.confidence === 'medium' ? '~' : '?'}
                      </Badge>
                    </div>
                  </div>
                ))}
                {puzzle.workScope && (
                  <div className="mt-3 p-2 rounded bg-muted/50 text-xs">
                    <p className="font-medium">📍 {puzzle.workScope.starts_at}</p>
                    <p className="text-muted-foreground">
                      {puzzle.workScope.includes_freight ? 'Fret à organiser' : 'Travail commence au port'}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* SUGGESTIONS */}
          {puzzle.suggestions.length > 0 && (
            <Collapsible open={expandedSections.suggestions} onOpenChange={() => toggleSection('suggestions')}>
              <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Lightbulb className="h-5 w-5 text-primary" />
                        Suggestions proactives ({puzzle.suggestions.length})
                      </CardTitle>
                      {expandedSections.suggestions ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                
                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-3">
                    {puzzle.suggestions.map((suggestion, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg border border-primary/20 bg-background"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-primary">{getSuggestionIcon(suggestion.type)}</span>
                          <p className="font-medium text-sm">{suggestion.title}</p>
                        </div>
                        <div className="space-y-1 pl-7">
                          {suggestion.items.map((item, i) => (
                            <div key={i} className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">
                                • {item.label}
                                {item.detail && <span className="ml-1 text-xs">({item.detail})</span>}
                              </span>
                              {item.action && (
                                <Button variant="ghost" size="sm" className="h-6 text-xs">
                                  {item.action}
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}
        </div>
      </ScrollArea>

      {/* Action buttons */}
      <Separator />
      <div className="flex items-center justify-between gap-4 pt-2">
        <div className="text-sm text-muted-foreground">
          {puzzle.canGenerateQuote ? (
            <span className="flex items-center gap-1 text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              Prêt à générer
            </span>
          ) : (
            <span className="flex items-center gap-1 text-amber-600">
              <AlertCircle className="h-4 w-4" />
              Informations manquantes
            </span>
          )}
        </div>
        
        <div className="flex gap-2">
          {puzzle.needsFromClient.length > 0 && (
            <Button
              variant="outline"
              onClick={collectClientQuestions}
              className="gap-2"
            >
              <Send className="h-4 w-4" />
              Demander au client
            </Button>
          )}
          
          <Button
            onClick={onGenerateQuotation}
            disabled={isGenerating}
            className="gap-2"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Génération...
              </>
            ) : (
              <>
                <FileText className="h-4 w-4" />
                {puzzle.canGenerateQuote ? 'Générer cotation' : 'Générer (partielle)'}
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
