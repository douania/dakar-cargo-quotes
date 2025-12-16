import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { 
  Brain, DollarSign, FileText, Users, Settings, 
  Trash2, CheckCircle, Clock, TrendingUp, Search,
  RefreshCw, Eye
} from 'lucide-react';

interface Knowledge {
  id: string;
  category: string;
  name: string;
  description: string;
  data: any;
  source_type: string;
  confidence: number;
  usage_count: number;
  is_validated: boolean;
  last_used_at: string | null;
  created_at: string;
}

const categoryIcons: Record<string, any> = {
  tarif: DollarSign,
  template: FileText,
  contact: Users,
  processus: Settings,
  condition: FileText
};

const categoryLabels: Record<string, string> = {
  tarif: 'Tarifs',
  template: 'Templates',
  contact: 'Contacts',
  processus: 'Processus',
  condition: 'Conditions'
};

export default function Knowledge() {
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItem, setSelectedItem] = useState<Knowledge | null>(null);
  const [stats, setStats] = useState({ total: 0, validated: 0, highConfidence: 0 });

  useEffect(() => {
    loadKnowledge();
  }, []);

  const loadKnowledge = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('learned_knowledge')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      setKnowledge(data || []);
      
      // Calculate stats
      const total = data?.length || 0;
      const validated = data?.filter(k => k.is_validated).length || 0;
      const highConfidence = data?.filter(k => k.confidence >= 0.8).length || 0;
      setStats({ total, validated, highConfidence });
    } catch (error) {
      console.error('Error loading knowledge:', error);
      toast.error('Erreur de chargement');
    }
    setLoading(false);
  };

  const validateKnowledge = async (id: string) => {
    try {
      const { error } = await supabase
        .from('learned_knowledge')
        .update({ is_validated: true, confidence: 1.0 })
        .eq('id', id);

      if (error) throw error;

      toast.success('Connaissance validée');
      loadKnowledge();
    } catch (error) {
      toast.error('Erreur de validation');
    }
  };

  const deleteKnowledge = async (id: string) => {
    if (!confirm('Supprimer cette connaissance ?')) return;
    
    try {
      const { error } = await supabase
        .from('learned_knowledge')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('Connaissance supprimée');
      loadKnowledge();
    } catch (error) {
      toast.error('Erreur de suppression');
    }
  };

  const getKnowledgeByCategory = (category: string) => {
    return knowledge.filter(k => 
      k.category === category &&
      (searchTerm === '' || 
        k.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        k.description?.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  };

  const categories = ['tarif', 'template', 'contact', 'processus', 'condition'];

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
              <Brain className="h-8 w-8" />
              Base de Connaissances
            </h1>
            <p className="text-muted-foreground mt-1">
              Connaissances apprises automatiquement par l'IA
            </p>
          </div>
          <Button variant="outline" onClick={loadKnowledge} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Actualiser
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total</p>
                  <p className="text-2xl font-bold">{stats.total}</p>
                </div>
                <Brain className="h-8 w-8 text-primary" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Validées</p>
                  <p className="text-2xl font-bold text-green-600">{stats.validated}</p>
                </div>
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Haute confiance</p>
                  <p className="text-2xl font-bold text-blue-600">{stats.highConfidence}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher dans les connaissances..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Categories Tabs */}
        <Tabs defaultValue="tarif" className="space-y-4">
          <TabsList className="flex-wrap">
            {categories.map((cat) => {
              const Icon = categoryIcons[cat] || FileText;
              const count = getKnowledgeByCategory(cat).length;
              return (
                <TabsTrigger key={cat} value={cat} className="gap-2">
                  <Icon className="h-4 w-4" />
                  {categoryLabels[cat]} ({count})
                </TabsTrigger>
              );
            })}
          </TabsList>

          {categories.map((category) => (
            <TabsContent key={category} value={category} className="space-y-4">
              {getKnowledgeByCategory(category).length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Brain className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">
                      Aucune connaissance {categoryLabels[category].toLowerCase()} apprise
                    </p>
                    <p className="text-sm text-muted-foreground mt-2">
                      Synchronisez des emails ou uploadez des documents pour commencer l'apprentissage
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {getKnowledgeByCategory(category).map((item) => {
                    const Icon = categoryIcons[item.category] || FileText;
                    return (
                      <Card 
                        key={item.id}
                        className={`cursor-pointer hover:bg-accent/50 transition-colors ${
                          item.is_validated ? 'border-l-4 border-l-green-500' : ''
                        }`}
                        onClick={() => setSelectedItem(item)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <Icon className="h-5 w-5 text-primary" />
                                <h3 className="font-semibold">{item.name}</h3>
                              </div>
                              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                                {item.description}
                              </p>
                              
                              <div className="flex items-center gap-2 mt-3">
                                <Badge variant={item.is_validated ? 'default' : 'secondary'}>
                                  {item.is_validated ? 'Validé' : 'Non validé'}
                                </Badge>
                                <Badge variant="outline">
                                  {item.source_type === 'email' ? '📧' : '📄'} {item.source_type}
                                </Badge>
                                {item.usage_count > 0 && (
                                  <Badge variant="outline">
                                    Utilisé {item.usage_count}x
                                  </Badge>
                                )}
                              </div>
                              
                              <div className="mt-3">
                                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                                  <span>Confiance</span>
                                  <span>{Math.round(item.confidence * 100)}%</span>
                                </div>
                                <Progress value={item.confidence * 100} className="h-2" />
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>

        {/* Detail Dialog */}
        <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            {selectedItem && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    {(() => {
                      const Icon = categoryIcons[selectedItem.category] || FileText;
                      return <Icon className="h-5 w-5" />;
                    })()}
                    {selectedItem.name}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-1">Description</h4>
                    <p className="text-muted-foreground">{selectedItem.description}</p>
                  </div>
                  
                  <div>
                    <h4 className="font-medium mb-1">Données</h4>
                    <pre className="bg-muted p-4 rounded-lg text-sm overflow-x-auto">
                      {JSON.stringify(selectedItem.data, null, 2)}
                    </pre>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Source:</span>{' '}
                      <span className="font-medium">{selectedItem.source_type}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Confiance:</span>{' '}
                      <span className="font-medium">{Math.round(selectedItem.confidence * 100)}%</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Utilisations:</span>{' '}
                      <span className="font-medium">{selectedItem.usage_count}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Créé le:</span>{' '}
                      <span className="font-medium">
                        {new Date(selectedItem.created_at).toLocaleDateString('fr-FR')}
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-4">
                    {!selectedItem.is_validated && (
                      <Button onClick={() => {
                        validateKnowledge(selectedItem.id);
                        setSelectedItem(null);
                      }}>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Valider
                      </Button>
                    )}
                    <Button 
                      variant="destructive" 
                      onClick={() => {
                        deleteKnowledge(selectedItem.id);
                        setSelectedItem(null);
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Supprimer
                    </Button>
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
