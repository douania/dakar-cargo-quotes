import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { 
  AlertTriangle, 
  TrendingUp, 
  FileText, 
  Newspaper, 
  RefreshCw, 
  Eye,
  CheckCircle,
  Clock,
  ExternalLink,
  Brain,
  User,
  Radar
} from 'lucide-react';

interface MarketIntelligence {
  id: string;
  source: string;
  category: string;
  title: string;
  summary: string;
  content: string;
  url: string;
  impact_level: string;
  is_processed: boolean;
  detected_at: string;
}

interface ExpertProfile {
  id: string;
  name: string;
  email: string;
  expertise: string[];
  communication_style: any;
  response_patterns: any;
  quotation_templates: any;
  learned_from_count: number;
  last_learned_at: string;
  is_primary: boolean;
}

interface SurveillanceSource {
  id: string;
  name: string;
  url: string;
  category: string;
  last_scraped_at: string;
  is_active: boolean;
}

const categoryIcons: Record<string, any> = {
  regulation: FileText,
  tariff: TrendingUp,
  market_change: AlertTriangle,
  news: Newspaper,
};

const impactColors: Record<string, string> = {
  low: 'bg-gray-500',
  medium: 'bg-yellow-500',
  high: 'bg-orange-500',
  critical: 'bg-red-500',
};

export default function MarketIntelligence() {
  const [intelligence, setIntelligence] = useState<MarketIntelligence[]>([]);
  const [experts, setExperts] = useState<ExpertProfile[]>([]);
  const [sources, setSources] = useState<SurveillanceSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [surveillanceRunning, setSurveillanceRunning] = useState(false);
  const [learningRunning, setLearningRunning] = useState(false);
  const [selectedIntel, setSelectedIntel] = useState<MarketIntelligence | null>(null);
  const [selectedExpert, setSelectedExpert] = useState<ExpertProfile | null>(null);
  const [stats, setStats] = useState({ total: 0, unprocessed: 0, critical: 0, high: 0 });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Load all data via secure edge function
      const [intelRes, expertsRes, sourcesRes] = await Promise.all([
        supabase.functions.invoke('data-admin', { body: { action: 'get_market_intelligence' } }),
        supabase.functions.invoke('data-admin', { body: { action: 'get_expert_profiles' } }),
        supabase.functions.invoke('data-admin', { body: { action: 'get_surveillance_sources' } })
      ]);

      if (intelRes.data?.success) {
        const intelData = intelRes.data.intelligence || [];
        setIntelligence(intelData);
        setStats({
          total: intelData.length,
          unprocessed: intelData.filter((i: MarketIntelligence) => !i.is_processed).length,
          critical: intelData.filter((i: MarketIntelligence) => i.impact_level === 'critical').length,
          high: intelData.filter((i: MarketIntelligence) => i.impact_level === 'high').length,
        });
      }

      if (expertsRes.data?.success) {
        setExperts(expertsRes.data.experts || []);
      }

      if (sourcesRes.data?.success) {
        setSources(sourcesRes.data.sources || []);
      }

    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const runSurveillance = async () => {
    setSurveillanceRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('market-surveillance', {
        body: {}
      });

      if (error) throw error;

      if (data?.success) {
        toast.success(`Veille terminée: ${data.new_detections} nouvelles alertes`);
        loadData();
      } else {
        toast.error(data?.error || 'Erreur de surveillance');
      }
    } catch (error: any) {
      console.error('Surveillance error:', error);
      toast.error(error.message || 'Erreur de surveillance');
    } finally {
      setSurveillanceRunning(false);
    }
  };

  const learnFromExpert = async (expertEmail: string) => {
    setLearningRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('learn-from-expert', {
        body: { expertEmail, forceRelearn: false }
      });

      if (error) throw error;

      if (data?.success) {
        toast.success(`Apprentissage terminé: ${data.stored} connaissances extraites de ${data.emails_analyzed} emails`);
        loadData();
      } else {
        toast.error(data?.error || 'Erreur d\'apprentissage');
      }
    } catch (error: any) {
      console.error('Learning error:', error);
      toast.error(error.message || 'Erreur d\'apprentissage');
    } finally {
      setLearningRunning(false);
    }
  };

  const markAsProcessed = async (id: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('data-admin', {
        body: { action: 'mark_intel_processed', data: { id } }
      });
      
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erreur');
      
      toast.success('Marqué comme traité');
      loadData();
    } catch (error) {
      toast.error('Erreur de mise à jour');
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Intelligence Marché & Apprentissage</h1>
          <p className="text-muted-foreground">
            Veille automatique et apprentissage des experts
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={loadData} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Actualiser
          </Button>
          <Button onClick={runSurveillance} disabled={surveillanceRunning}>
            <Radar className="h-4 w-4 mr-2" />
            {surveillanceRunning ? 'Veille en cours...' : 'Lancer la veille'}
          </Button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Alertes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Non traitées
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{stats.unprocessed}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Critiques
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.critical}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Haute priorité
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{stats.high}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="intelligence" className="space-y-4">
        <TabsList>
          <TabsTrigger value="intelligence">
            <Radar className="h-4 w-4 mr-2" />
            Alertes Marché
          </TabsTrigger>
          <TabsTrigger value="experts">
            <User className="h-4 w-4 mr-2" />
            Profils Experts
          </TabsTrigger>
          <TabsTrigger value="sources">
            <ExternalLink className="h-4 w-4 mr-2" />
            Sources de Veille
          </TabsTrigger>
        </TabsList>

        <TabsContent value="intelligence">
          <Card>
            <CardHeader>
              <CardTitle>Alertes récentes</CardTitle>
              <CardDescription>
                Changements détectés sur le marché, réglementations et tarifs
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <div className="space-y-3">
                  {intelligence.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      Aucune alerte détectée. Lancez la veille pour scanner les sources.
                    </p>
                  ) : (
                    intelligence.map(intel => {
                      const IconComponent = categoryIcons[intel.category] || AlertTriangle;
                      return (
                        <Card 
                          key={intel.id} 
                          className={`cursor-pointer hover:bg-accent/50 transition-colors ${
                            intel.is_processed ? 'opacity-60' : ''
                          }`}
                          onClick={() => setSelectedIntel(intel)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between">
                              <div className="flex items-start gap-3">
                                <div className={`p-2 rounded-full ${impactColors[intel.impact_level]} text-white`}>
                                  <IconComponent className="h-4 w-4" />
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <h4 className="font-medium">{intel.title}</h4>
                                    <Badge variant="outline" className="text-xs">
                                      {intel.source}
                                    </Badge>
                                    {intel.is_processed && (
                                      <CheckCircle className="h-4 w-4 text-green-500" />
                                    )}
                                  </div>
                                  <p className="text-sm text-muted-foreground line-clamp-2">
                                    {intel.summary}
                                  </p>
                                  <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                                    <Clock className="h-3 w-3" />
                                    {formatDate(intel.detected_at)}
                                  </div>
                                </div>
                              </div>
                              <Badge className={impactColors[intel.impact_level]}>
                                {intel.impact_level}
                              </Badge>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="experts">
          <Card>
            <CardHeader>
              <CardTitle>Profils d'Experts</CardTitle>
              <CardDescription>
                Experts dont l'IA apprend les méthodes et le style
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {experts.map(expert => (
                  <Card key={expert.id} className={expert.is_primary ? 'border-primary' : ''}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                            <User className="h-6 w-6 text-primary" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-semibold">{expert.name}</h4>
                              {expert.is_primary && (
                                <Badge variant="default">Principal</Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">{expert.email}</p>
                            <div className="flex gap-1 mt-1">
                              {expert.expertise?.map(exp => (
                                <Badge key={exp} variant="outline" className="text-xs">
                                  {exp}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-muted-foreground">
                            {expert.learned_from_count || 0} emails analysés
                          </p>
                          {expert.last_learned_at && (
                            <p className="text-xs text-muted-foreground">
                              Dernier: {formatDate(expert.last_learned_at)}
                            </p>
                          )}
                          <div className="flex gap-2 mt-2">
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => setSelectedExpert(expert)}
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              Voir
                            </Button>
                            <Button 
                              size="sm"
                              onClick={() => learnFromExpert(expert.email)}
                              disabled={learningRunning}
                            >
                              <Brain className="h-4 w-4 mr-1" />
                              {learningRunning ? 'Apprentissage...' : 'Apprendre'}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sources">
          <Card>
            <CardHeader>
              <CardTitle>Sources de Veille</CardTitle>
              <CardDescription>
                Sites web surveillés pour détecter les changements
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sources.map(source => (
                  <Card key={source.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium">{source.name}</h4>
                          <a 
                            href={source.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-sm text-primary hover:underline flex items-center gap-1"
                          >
                            {source.url}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                          <Badge variant="outline" className="mt-2">
                            {source.category}
                          </Badge>
                        </div>
                        <div className="text-right text-sm text-muted-foreground">
                          {source.last_scraped_at ? (
                            <p>Dernier scan: {formatDate(source.last_scraped_at)}</p>
                          ) : (
                            <p>Jamais scanné</p>
                          )}
                          <Badge variant={source.is_active ? 'default' : 'secondary'} className="mt-1">
                            {source.is_active ? 'Actif' : 'Inactif'}
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Intelligence Detail Dialog */}
      <Dialog open={!!selectedIntel} onOpenChange={() => setSelectedIntel(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Badge className={impactColors[selectedIntel?.impact_level || 'medium']}>
                {selectedIntel?.impact_level}
              </Badge>
              {selectedIntel?.title}
            </DialogTitle>
            <DialogDescription>
              Source: {selectedIntel?.source} • {selectedIntel && formatDate(selectedIntel.detected_at)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <h4 className="font-medium mb-2">Résumé</h4>
              <p className="text-muted-foreground">{selectedIntel?.summary}</p>
            </div>
            {selectedIntel?.content && (
              <div>
                <h4 className="font-medium mb-2">Action recommandée</h4>
                <p className="text-muted-foreground">{selectedIntel.content}</p>
              </div>
            )}
            {selectedIntel?.url && (
              <a 
                href={selectedIntel.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline flex items-center gap-1"
              >
                Voir la source <ExternalLink className="h-4 w-4" />
              </a>
            )}
            <div className="flex gap-2 pt-4">
              {!selectedIntel?.is_processed && (
                <Button onClick={() => selectedIntel && markAsProcessed(selectedIntel.id)}>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Marquer comme traité
                </Button>
              )}
              <Button variant="outline" onClick={() => setSelectedIntel(null)}>
                Fermer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Expert Detail Dialog */}
      <Dialog open={!!selectedExpert} onOpenChange={() => setSelectedExpert(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedExpert?.name}</DialogTitle>
            <DialogDescription>{selectedExpert?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {selectedExpert?.communication_style && (
              <div>
                <h4 className="font-medium mb-2">Style de communication</h4>
                <pre className="bg-muted p-3 rounded-lg text-xs overflow-auto">
                  {JSON.stringify(selectedExpert.communication_style, null, 2)}
                </pre>
              </div>
            )}
            {selectedExpert?.quotation_templates && (
              <div>
                <h4 className="font-medium mb-2">Templates de cotation</h4>
                <pre className="bg-muted p-3 rounded-lg text-xs overflow-auto">
                  {JSON.stringify(selectedExpert.quotation_templates, null, 2)}
                </pre>
              </div>
            )}
            {selectedExpert?.response_patterns && (
              <div>
                <h4 className="font-medium mb-2">Patterns de réponse</h4>
                <pre className="bg-muted p-3 rounded-lg text-xs overflow-auto">
                  {JSON.stringify(selectedExpert.response_patterns, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
