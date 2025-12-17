import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  Brain, CheckCircle, XCircle, Eye, Trash2, 
  Tag, DollarSign, FileText, Users, Clock, Package,
  TrendingUp, Loader2, RefreshCw
} from 'lucide-react';

interface LearnedKnowledge {
  id: string;
  name: string;
  category: string;
  description: string | null;
  data: any;
  source_type: string | null;
  confidence: number;
  is_validated: boolean;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

const categoryIcons: Record<string, React.ReactNode> = {
  tarif: <DollarSign className="h-4 w-4" />,
  template: <FileText className="h-4 w-4" />,
  contact: <Users className="h-4 w-4" />,
  negociation: <TrendingUp className="h-4 w-4" />,
  condition: <Clock className="h-4 w-4" />,
  marchandise: <Package className="h-4 w-4" />,
  quotation_exchange: <Brain className="h-4 w-4" />,
};

const categoryLabels: Record<string, string> = {
  tarif: 'Tarifs',
  template: 'Templates',
  contact: 'Contacts',
  negociation: 'Négociation',
  condition: 'Conditions',
  marchandise: 'Marchandises',
  quotation_exchange: 'Échanges',
};

export function LearnedKnowledge() {
  const [knowledge, setKnowledge] = useState<LearnedKnowledge[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<LearnedKnowledge | null>(null);
  const [filter, setFilter] = useState<string>('all');

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
    } catch (error) {
      console.error('Error loading knowledge:', error);
      toast.error('Erreur de chargement');
    }
    setLoading(false);
  };

  const toggleValidation = async (id: string, currentState: boolean) => {
    try {
      const { error } = await supabase
        .from('learned_knowledge')
        .update({ 
          is_validated: !currentState,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (error) throw error;
      
      toast.success(currentState ? 'Connaissance invalidée' : 'Connaissance validée');
      loadKnowledge();
    } catch (error) {
      console.error('Error toggling validation:', error);
      toast.error('Erreur de mise à jour');
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
      setSelectedItem(null);
      loadKnowledge();
    } catch (error) {
      console.error('Error deleting knowledge:', error);
      toast.error('Erreur de suppression');
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), 'dd MMM yyyy HH:mm', { locale: fr });
    } catch {
      return dateStr;
    }
  };

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 0.8) {
      return <Badge className="bg-green-500/20 text-green-600 border-green-500/30">Haute ({Math.round(confidence * 100)}%)</Badge>;
    } else if (confidence >= 0.5) {
      return <Badge className="bg-yellow-500/20 text-yellow-600 border-yellow-500/30">Moyenne ({Math.round(confidence * 100)}%)</Badge>;
    }
    return <Badge className="bg-red-500/20 text-red-600 border-red-500/30">Basse ({Math.round(confidence * 100)}%)</Badge>;
  };

  const categories = [...new Set(knowledge.map(k => k.category))];
  const filteredKnowledge = filter === 'all' 
    ? knowledge 
    : filter === 'validated' 
      ? knowledge.filter(k => k.is_validated)
      : filter === 'pending'
        ? knowledge.filter(k => !k.is_validated)
        : knowledge.filter(k => k.category === filter);

  const stats = {
    total: knowledge.length,
    validated: knowledge.filter(k => k.is_validated).length,
    pending: knowledge.filter(k => !k.is_validated).length,
    byCategory: categories.reduce((acc, cat) => {
      acc[cat] = knowledge.filter(k => k.category === cat).length;
      return acc;
    }, {} as Record<string, number>)
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <Brain className="h-8 w-8 text-primary/50" />
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
              <CheckCircle className="h-8 w-8 text-green-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">En attente</p>
                <p className="text-2xl font-bold text-yellow-600">{stats.pending}</p>
              </div>
              <Clock className="h-8 w-8 text-yellow-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <Button 
              variant="outline" 
              className="w-full h-full"
              onClick={loadKnowledge}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Actualiser
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Tabs value={filter} onValueChange={setFilter} className="w-full">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="all">Tout ({stats.total})</TabsTrigger>
          <TabsTrigger value="validated" className="text-green-600">
            <CheckCircle className="h-3 w-3 mr-1" />
            Validées ({stats.validated})
          </TabsTrigger>
          <TabsTrigger value="pending" className="text-yellow-600">
            <Clock className="h-3 w-3 mr-1" />
            En attente ({stats.pending})
          </TabsTrigger>
          {categories.map(cat => (
            <TabsTrigger key={cat} value={cat}>
              {categoryIcons[cat] || <Tag className="h-3 w-3 mr-1" />}
              <span className="ml-1">{categoryLabels[cat] || cat} ({stats.byCategory[cat]})</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Knowledge List */}
      {filteredKnowledge.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Brain className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Aucune connaissance trouvée</p>
            <p className="text-sm text-muted-foreground mt-2">
              Importez des échanges emails pour commencer l'apprentissage
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredKnowledge.map((item) => (
            <Card 
              key={item.id} 
              className={`cursor-pointer transition-colors hover:bg-accent/50 ${
                item.is_validated ? 'border-l-4 border-l-green-500' : ''
              }`}
              onClick={() => setSelectedItem(item)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="gap-1">
                        {categoryIcons[item.category] || <Tag className="h-3 w-3" />}
                        {categoryLabels[item.category] || item.category}
                      </Badge>
                      {getConfidenceBadge(item.confidence)}
                      {item.is_validated && (
                        <Badge className="bg-green-500/20 text-green-600 border-green-500/30">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Validée
                        </Badge>
                      )}
                    </div>
                    <h3 className="font-semibold mt-2 truncate">{item.name}</h3>
                    {item.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                        {item.description}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      Créé le {formatDate(item.created_at)}
                      {item.usage_count > 0 && ` • Utilisé ${item.usage_count} fois`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button 
                      size="sm" 
                      variant={item.is_validated ? "outline" : "default"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleValidation(item.id, item.is_validated);
                      }}
                    >
                      {item.is_validated ? (
                        <XCircle className="h-4 w-4" />
                      ) : (
                        <CheckCircle className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {selectedItem && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="gap-1">
                    {categoryIcons[selectedItem.category] || <Tag className="h-3 w-3" />}
                    {categoryLabels[selectedItem.category] || selectedItem.category}
                  </Badge>
                  {getConfidenceBadge(selectedItem.confidence)}
                </div>
                <DialogTitle className="mt-2">{selectedItem.name}</DialogTitle>
              </DialogHeader>
              
              <div className="space-y-4">
                {selectedItem.description && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">Description</h4>
                    <p>{selectedItem.description}</p>
                  </div>
                )}

                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">Données extraites</h4>
                  <pre className="bg-muted p-4 rounded-lg text-sm overflow-x-auto">
                    {JSON.stringify(selectedItem.data, null, 2)}
                  </pre>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Source:</span>
                    <span className="ml-2">{selectedItem.source_type || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Utilisations:</span>
                    <span className="ml-2">{selectedItem.usage_count}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Créé:</span>
                    <span className="ml-2">{formatDate(selectedItem.created_at)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Mis à jour:</span>
                    <span className="ml-2">{formatDate(selectedItem.updated_at)}</span>
                  </div>
                </div>

                <div className="flex justify-between pt-4 border-t">
                  <Button 
                    variant="destructive" 
                    size="sm"
                    onClick={() => deleteKnowledge(selectedItem.id)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Supprimer
                  </Button>
                  <Button 
                    variant={selectedItem.is_validated ? "outline" : "default"}
                    onClick={() => toggleValidation(selectedItem.id, selectedItem.is_validated)}
                  >
                    {selectedItem.is_validated ? (
                      <>
                        <XCircle className="h-4 w-4 mr-2" />
                        Invalider
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Valider
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
