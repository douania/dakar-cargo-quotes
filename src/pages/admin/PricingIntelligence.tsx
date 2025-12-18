import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { 
  TrendingUp, DollarSign, BarChart3, FileSpreadsheet,
  RefreshCw, Play, Eye, CheckCircle, AlertCircle,
  ArrowLeft, Percent, Calculator, FileText, Layers
} from 'lucide-react';
import { Link } from 'react-router-dom';

interface PricingPattern {
  id: string;
  name: string;
  category: string;
  description: string;
  data: any;
  confidence: number;
  is_validated: boolean;
  created_at: string;
}

interface AnalysisResult {
  success: boolean;
  patterns_found: {
    quotation_structure: boolean;
    pricing_ratios: number;
    margin_items: number;
    templates: number;
    formulas: number;
  };
  full_analysis: any;
}

export default function PricingIntelligence() {
  const queryClient = useQueryClient();
  const [selectedPattern, setSelectedPattern] = useState<PricingPattern | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

  // Fetch pricing-related knowledge
  const { data: patterns, isLoading } = useQuery({
    queryKey: ['pricing-patterns'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('data-admin', {
        body: { action: 'get_all' }
      });
      if (error) throw error;
      
      const knowledge = data?.knowledge || [];
      return knowledge.filter((k: PricingPattern) => 
        k.category === 'pricing_pattern' || 
        k.category === 'quotation_style' ||
        k.name.toLowerCase().includes('pricing') ||
        k.name.toLowerCase().includes('margin') ||
        k.name.toLowerCase().includes('quotation')
      );
    }
  });

  // Fetch unanalyzed Excel attachments
  const { data: excelAttachments } = useQuery({
    queryKey: ['excel-attachments'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('data-admin', {
        body: { action: 'get_attachments' }
      });
      if (error) throw error;
      
      const attachments = data?.attachments || [];
      return attachments.filter((a: any) => 
        a.content_type?.includes('spreadsheet') || 
        a.content_type?.includes('excel') ||
        a.filename?.endsWith('.xlsx') ||
        a.filename?.endsWith('.xls')
      );
    }
  });

  // Analyze pricing patterns mutation
  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('analyze-pricing-patterns', {
        body: { expertEmail: 'th@2hlgroup.com' }
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Analyse échouée');
      return data;
    },
    onSuccess: (data) => {
      setAnalysisResult(data);
      toast.success(`Analyse terminée: ${data.knowledge_saved} patterns sauvegardés`);
      queryClient.invalidateQueries({ queryKey: ['pricing-patterns'] });
    },
    onError: (error: any) => {
      toast.error(`Erreur: ${error.message}`);
    }
  });

  // Analyze attachments mutation
  const analyzeAttachmentsMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('analyze-attachments', {
        body: {}
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`${data.analyzed} pièces jointes analysées`);
      queryClient.invalidateQueries({ queryKey: ['excel-attachments'] });
    },
    onError: (error: any) => {
      toast.error(`Erreur: ${error.message}`);
    }
  });

  const pricingPatterns = patterns?.filter((p: PricingPattern) => p.category === 'pricing_pattern') || [];
  const quotationStyles = patterns?.filter((p: PricingPattern) => p.category === 'quotation_style') || [];
  const marginAnalysis = patterns?.filter((p: PricingPattern) => 
    p.name.toLowerCase().includes('margin') || p.category === 'business_process'
  ) || [];

  const unanalyzedCount = excelAttachments?.filter((a: any) => !a.is_analyzed).length || 0;
  const analyzedCount = excelAttachments?.filter((a: any) => a.is_analyzed).length || 0;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link to="/admin/knowledge">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
              <TrendingUp className="h-8 w-8 text-primary" />
              Pricing Intelligence
            </h1>
            <p className="text-muted-foreground mt-1">
              Analyse des patterns de prix et structures de cotation de Taleb
            </p>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Patterns de prix</p>
                  <p className="text-2xl font-bold">{pricingPatterns.length}</p>
                </div>
                <DollarSign className="h-8 w-8 text-primary" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Structures cotation</p>
                  <p className="text-2xl font-bold">{quotationStyles.length}</p>
                </div>
                <FileText className="h-8 w-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Analyses marge</p>
                  <p className="text-2xl font-bold">{marginAnalysis.length}</p>
                </div>
                <Percent className="h-8 w-8 text-green-500" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Excel à analyser</p>
                  <p className="text-2xl font-bold text-amber-500">{unanalyzedCount}</p>
                </div>
                <FileSpreadsheet className="h-8 w-8 text-amber-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Actions */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="h-5 w-5" />
              Lancer une analyse
            </CardTitle>
            <CardDescription>
              Analysez les emails et pièces jointes de Taleb pour extraire les patterns de pricing
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-4">
              <Button 
                onClick={() => analyzeMutation.mutate()}
                disabled={analyzeMutation.isPending}
                className="gap-2"
              >
                {analyzeMutation.isPending ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <BarChart3 className="h-4 w-4" />
                )}
                Analyser les patterns de prix
              </Button>
              
              {unanalyzedCount > 0 && (
                <Button 
                  variant="outline"
                  onClick={() => analyzeAttachmentsMutation.mutate()}
                  disabled={analyzeAttachmentsMutation.isPending}
                  className="gap-2"
                >
                  {analyzeAttachmentsMutation.isPending ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="h-4 w-4" />
                  )}
                  Analyser {unanalyzedCount} fichiers Excel
                </Button>
              )}
            </div>

            {analysisResult && (
              <div className="mt-4 p-4 bg-muted rounded-lg">
                <h4 className="font-medium flex items-center gap-2 mb-3">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  Résultats de l'analyse
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Structure</p>
                    <p className="font-medium">{analysisResult.patterns_found.quotation_structure ? '✓' : '✗'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Ratios prix</p>
                    <p className="font-medium">{analysisResult.patterns_found.pricing_ratios}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Items marge</p>
                    <p className="font-medium">{analysisResult.patterns_found.margin_items}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Templates</p>
                    <p className="font-medium">{analysisResult.patterns_found.templates}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Formules</p>
                    <p className="font-medium">{analysisResult.patterns_found.formulas}</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Patterns Tabs */}
        <Tabs defaultValue="pricing" className="space-y-4">
          <TabsList>
            <TabsTrigger value="pricing" className="gap-2">
              <DollarSign className="h-4 w-4" />
              Ratios de prix
            </TabsTrigger>
            <TabsTrigger value="structure" className="gap-2">
              <Layers className="h-4 w-4" />
              Structure cotation
            </TabsTrigger>
            <TabsTrigger value="margins" className="gap-2">
              <Percent className="h-4 w-4" />
              Analyse marges
            </TabsTrigger>
            <TabsTrigger value="excel" className="gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              Fichiers Excel ({excelAttachments?.length || 0})
            </TabsTrigger>
          </TabsList>

          {/* Pricing Ratios Tab */}
          <TabsContent value="pricing" className="space-y-4">
            {pricingPatterns.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <DollarSign className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Aucun ratio de prix détecté</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Lancez une analyse pour détecter les patterns
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pricingPatterns.map((pattern: PricingPattern) => (
                  <PatternCard 
                    key={pattern.id} 
                    pattern={pattern} 
                    onClick={() => setSelectedPattern(pattern)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Structure Tab */}
          <TabsContent value="structure" className="space-y-4">
            {quotationStyles.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Layers className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Aucune structure de cotation détectée</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {quotationStyles.map((pattern: PricingPattern) => (
                  <PatternCard 
                    key={pattern.id} 
                    pattern={pattern} 
                    onClick={() => setSelectedPattern(pattern)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Margins Tab */}
          <TabsContent value="margins" className="space-y-4">
            {marginAnalysis.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Percent className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Aucune analyse de marge détectée</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Les marges cachées seront identifiées après analyse
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {marginAnalysis.map((pattern: PricingPattern) => (
                  <MarginCard 
                    key={pattern.id} 
                    pattern={pattern}
                    onClick={() => setSelectedPattern(pattern)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Excel Files Tab */}
          <TabsContent value="excel" className="space-y-4">
            {!excelAttachments?.length ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Aucun fichier Excel trouvé</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Importez des threads email contenant des cotations Excel
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {excelAttachments.map((attachment: any) => (
                  <Card key={attachment.id} className={attachment.is_analyzed ? 'border-l-4 border-l-green-500' : ''}>
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <FileSpreadsheet className="h-5 w-5 text-green-600" />
                        <div>
                          <p className="font-medium">{attachment.filename}</p>
                          <p className="text-sm text-muted-foreground">
                            {attachment.size ? `${Math.round(attachment.size / 1024)} KB` : 'Taille inconnue'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {attachment.is_analyzed ? (
                          <Badge className="bg-green-100 text-green-700">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Analysé
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-600">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            Non analysé
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Detail Dialog */}
        <Dialog open={!!selectedPattern} onOpenChange={() => setSelectedPattern(null)}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            {selectedPattern && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Calculator className="h-5 w-5" />
                    {selectedPattern.name.replace(/_/g, ' ')}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-1">Description</h4>
                    <p className="text-muted-foreground">{selectedPattern.description}</p>
                  </div>

                  <div>
                    <h4 className="font-medium mb-1">Confiance</h4>
                    <div className="flex items-center gap-2">
                      <Progress value={selectedPattern.confidence * 100} className="flex-1" />
                      <span className="text-sm font-medium">{Math.round(selectedPattern.confidence * 100)}%</span>
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="font-medium mb-2">Données extraites</h4>
                    <pre className="bg-muted p-4 rounded-lg text-sm overflow-x-auto whitespace-pre-wrap max-h-96">
                      {JSON.stringify(selectedPattern.data, null, 2)}
                    </pre>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge variant={selectedPattern.is_validated ? 'default' : 'secondary'}>
                      {selectedPattern.is_validated ? 'Validé' : 'Non validé'}
                    </Badge>
                    <Badge variant="outline">{selectedPattern.category}</Badge>
                  </div>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function PatternCard({ pattern, onClick }: { pattern: PricingPattern; onClick: () => void }) {
  return (
    <Card 
      className={`cursor-pointer hover:bg-accent/50 transition-colors ${
        pattern.is_validated ? 'border-l-4 border-l-green-500' : ''
      }`}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">{pattern.name.replace(/_/g, ' ')}</h3>
            </div>
            <p className="text-sm text-muted-foreground line-clamp-2">
              {pattern.description}
            </p>
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>Confiance</span>
                <span>{Math.round(pattern.confidence * 100)}%</span>
              </div>
              <Progress value={pattern.confidence * 100} className="h-2" />
            </div>
          </div>
          <Button variant="ghost" size="icon" className="ml-2">
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MarginCard({ pattern, onClick }: { pattern: PricingPattern; onClick: () => void }) {
  const marginData = pattern.data?.margin_distribution || pattern.data;
  
  return (
    <Card 
      className="cursor-pointer hover:bg-accent/50 transition-colors border-l-4 border-l-amber-500"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Percent className="h-5 w-5 text-amber-500" />
              <h3 className="font-semibold">{pattern.name.replace(/_/g, ' ')}</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              {pattern.description}
            </p>
            
            {typeof marginData === 'object' && marginData && (
              <div className="grid grid-cols-3 gap-2 text-sm">
                {Object.entries(marginData).slice(0, 6).map(([key, value]) => (
                  <div key={key} className="bg-muted rounded p-2">
                    <p className="text-xs text-muted-foreground capitalize">{key}</p>
                    <p className="font-medium">{typeof value === 'number' ? `${value}%` : String(value)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Button variant="ghost" size="icon" className="ml-2">
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
