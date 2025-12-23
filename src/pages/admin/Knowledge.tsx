import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { 
  Brain, DollarSign, FileText, Users, Settings, 
  Trash2, CheckCircle, Clock, TrendingUp, Search,
  RefreshCw, Eye, MessageSquare, Handshake, GraduationCap,
  Mail, UserCheck, List, LayoutGrid, XCircle, ArrowUpDown
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
  condition: FileText,
  quotation_style: DollarSign,
  negotiation: Handshake,
  technical_expertise: GraduationCap,
  business_process: Settings,
  email_template: Mail,
  client_relations: Users,
  quotation_exchange: MessageSquare
};

const categoryLabels: Record<string, string> = {
  tarif: 'Tarifs',
  template: 'Templates',
  contact: 'Contacts',
  processus: 'Processus',
  condition: 'Conditions',
  quotation_style: 'Style de cotation',
  quotation_template: 'Template cotation',
  negotiation: 'Négociation',
  technical_expertise: 'Expertise technique',
  business_process: 'Processus métier',
  email_template: 'Templates email',
  client_relations: 'Relations clients',
  quotation_exchange: 'Échanges cotation'
};

const sourceTypeLabels: Record<string, string> = {
  expert_learning: '🧠 Apprentissage Expert',
  email_thread: '📧 Thread Email',
  email: '📧 Email',
  document: '📄 Document',
  manual: '✏️ Manuel'
};

type SortField = 'name' | 'category' | 'confidence' | 'created_at' | 'is_validated';
type SortOrder = 'asc' | 'desc';

export default function Knowledge() {
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItem, setSelectedItem] = useState<Knowledge | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [stats, setStats] = useState({ 
    total: 0, 
    validated: 0, 
    highConfidence: 0,
    expertLearning: 0 
  });

  useEffect(() => {
    loadKnowledge();
  }, []);

  const loadKnowledge = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('data-admin', {
        body: { action: 'get_all' }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erreur');

      const knowledgeData = data.knowledge || [];
      setKnowledge(knowledgeData);
      
      // Calculate stats
      const total = knowledgeData.length;
      const validated = knowledgeData.filter((k: Knowledge) => k.is_validated).length;
      const highConfidence = knowledgeData.filter((k: Knowledge) => k.confidence >= 0.8).length;
      const expertLearning = knowledgeData.filter((k: Knowledge) => k.source_type === 'expert_learning').length;
      setStats({ total, validated, highConfidence, expertLearning });
    } catch (error) {
      console.error('Error loading knowledge:', error);
      toast.error('Erreur de chargement');
    }
    setLoading(false);
  };

  const validateKnowledge = async (id: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('data-admin', {
        body: { action: 'toggle_validation', data: { id, currentState: false } }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erreur');

      toast.success('Connaissance validée');
      loadKnowledge();
    } catch (error) {
      toast.error('Erreur de validation');
    }
  };

  const deleteKnowledge = async (id: string) => {
    if (!confirm('Supprimer cette connaissance ?')) return;
    
    try {
      const { data, error } = await supabase.functions.invoke('data-admin', {
        body: { action: 'delete', data: { id } }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erreur');

      toast.success('Connaissance supprimée');
      loadKnowledge();
    } catch (error) {
      toast.error('Erreur de suppression');
    }
  };

  // Get unique categories from actual data
  const availableCategories = [...new Set(knowledge.map(k => k.category))].sort();
  
  // Get unique source types from actual data
  const availableSourceTypes = [...new Set(knowledge.map(k => k.source_type))];

  const getFilteredKnowledge = (category?: string) => {
    return knowledge.filter(k => {
      const matchesCategory = !category || k.category === category;
      const matchesSearch = searchTerm === '' || 
        k.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        k.description?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesSource = sourceFilter === 'all' || k.source_type === sourceFilter;
      return matchesCategory && matchesSearch && matchesSource;
    });
  };

  const getAllFilteredAndSorted = () => {
    const filtered = getFilteredKnowledge();
    return filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'category':
          comparison = a.category.localeCompare(b.category);
          break;
        case 'confidence':
          comparison = a.confidence - b.confidence;
          break;
        case 'is_validated':
          comparison = (a.is_validated ? 1 : 0) - (b.is_validated ? 1 : 0);
          break;
        case 'created_at':
        default:
          comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const getSourceIcon = (sourceType: string) => {
    switch (sourceType) {
      case 'expert_learning': return '🧠';
      case 'email_thread': return '📧';
      case 'email': return '📧';
      case 'document': return '📄';
      default: return '📝';
    }
  };

  const getConfidenceBadgeClass = (confidence: number) => {
    if (confidence >= 0.8) return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    if (confidence >= 0.5) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
    return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

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
          <div className="flex items-center gap-2">
            <div className="flex items-center border rounded-lg p-1">
              <Button
                variant={viewMode === 'table' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('table')}
                className="h-8 px-3"
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'cards' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('cards')}
                className="h-8 px-3"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="outline" onClick={loadKnowledge} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Actualiser
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
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
          <Card className="border-primary/50 bg-primary/5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Expert Taleb</p>
                  <p className="text-2xl font-bold text-primary">{stats.expertLearning}</p>
                </div>
                <UserCheck className="h-8 w-8 text-primary" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search and Filters */}
        <div className="flex gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher dans les connaissances..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Filtrer par source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les sources</SelectItem>
              {availableSourceTypes.map(source => (
                <SelectItem key={source} value={source}>
                  {sourceTypeLabels[source] || source}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Content */}
        {knowledge.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Brain className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                Aucune connaissance apprise
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Synchronisez des emails ou lancez un apprentissage expert pour commencer
              </p>
            </CardContent>
          </Card>
        ) : viewMode === 'table' ? (
          /* TABLE VIEW */
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead 
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => toggleSort('name')}
                    >
                      <div className="flex items-center gap-1">
                        Nom
                        <ArrowUpDown className="h-3 w-3" />
                      </div>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => toggleSort('category')}
                    >
                      <div className="flex items-center gap-1">
                        Catégorie
                        <ArrowUpDown className="h-3 w-3" />
                      </div>
                    </TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => toggleSort('confidence')}
                    >
                      <div className="flex items-center gap-1">
                        Confiance
                        <ArrowUpDown className="h-3 w-3" />
                      </div>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => toggleSort('is_validated')}
                    >
                      <div className="flex items-center gap-1">
                        Statut
                        <ArrowUpDown className="h-3 w-3" />
                      </div>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => toggleSort('created_at')}
                    >
                      <div className="flex items-center gap-1">
                        Date
                        <ArrowUpDown className="h-3 w-3" />
                      </div>
                    </TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {getAllFilteredAndSorted().map((item) => {
                    const Icon = categoryIcons[item.category] || FileText;
                    return (
                      <TableRow 
                        key={item.id} 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedItem(item)}
                      >
                        <TableCell className="font-medium max-w-[250px]">
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4 text-primary shrink-0" />
                            <span className="truncate">{item.name.replace(/_/g, ' ')}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="whitespace-nowrap">
                            {categoryLabels[item.category] || item.category}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className={`text-sm ${item.source_type === 'expert_learning' ? 'text-primary font-medium' : ''}`}>
                            {getSourceIcon(item.source_type)} {sourceTypeLabels[item.source_type]?.replace(/^[^\s]+\s/, '') || item.source_type}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge className={getConfidenceBadgeClass(item.confidence)}>
                            {Math.round(item.confidence * 100)}%
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {item.is_validated ? (
                            <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Validé
                            </Badge>
                          ) : (
                            <Badge variant="secondary">
                              <Clock className="h-3 w-3 mr-1" />
                              En attente
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatDate(item.created_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedItem(item)}
                              className="h-8 w-8 p-0"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {!item.is_validated && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => validateKnowledge(item.id)}
                                className="h-8 w-8 p-0 text-green-600 hover:text-green-700"
                              >
                                <CheckCircle className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteKnowledge(item.id)}
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {getAllFilteredAndSorted().length === 0 && (
                <div className="py-12 text-center">
                  <p className="text-muted-foreground">Aucun résultat pour ce filtre</p>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          /* CARDS VIEW */
          <Tabs defaultValue={availableCategories[0]} className="space-y-4">
            <TabsList className="flex-wrap h-auto gap-1 p-1">
              {availableCategories.map((cat) => {
                const Icon = categoryIcons[cat] || FileText;
                const count = getFilteredKnowledge(cat).length;
                return (
                  <TabsTrigger key={cat} value={cat} className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                    <Icon className="h-4 w-4" />
                    <span className="hidden sm:inline">{categoryLabels[cat] || cat}</span>
                    <Badge variant="secondary" className="ml-1">{count}</Badge>
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {availableCategories.map((category) => (
              <TabsContent key={category} value={category} className="space-y-4">
                {getFilteredKnowledge(category).length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <Brain className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-muted-foreground">
                        Aucune connaissance pour ce filtre
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {getFilteredKnowledge(category).map((item) => {
                      const Icon = categoryIcons[item.category] || FileText;
                      return (
                        <Card 
                          key={item.id}
                          className={`cursor-pointer hover:bg-accent/50 transition-colors ${
                            item.is_validated ? 'border-l-4 border-l-green-500' : ''
                          } ${item.source_type === 'expert_learning' ? 'ring-1 ring-primary/30' : ''}`}
                          onClick={() => setSelectedItem(item)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <Icon className="h-5 w-5 text-primary" />
                                  <h3 className="font-semibold line-clamp-1">{item.name.replace(/_/g, ' ')}</h3>
                                </div>
                                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                                  {item.description}
                                </p>
                                
                                <div className="flex items-center gap-2 mt-3 flex-wrap">
                                  <Badge variant={item.is_validated ? 'default' : 'secondary'}>
                                    {item.is_validated ? 'Validé' : 'Non validé'}
                                  </Badge>
                                  <Badge 
                                    variant="outline"
                                    className={item.source_type === 'expert_learning' ? 'border-primary text-primary' : ''}
                                  >
                                    {getSourceIcon(item.source_type)} {sourceTypeLabels[item.source_type] || item.source_type}
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
        )}

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
                    {selectedItem.name.replace(/_/g, ' ')}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  {selectedItem.source_type === 'expert_learning' && (
                    <div className="bg-primary/10 border border-primary/30 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-primary font-medium">
                        <UserCheck className="h-4 w-4" />
                        Appris de l'expert Taleb Hoballah
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        Cette connaissance a été extraite automatiquement de l'analyse des emails de Taleb.
                      </p>
                    </div>
                  )}

                  <div>
                    <h4 className="font-medium mb-1">Description</h4>
                    <p className="text-muted-foreground">{selectedItem.description}</p>
                  </div>
                  
                  <div>
                    <h4 className="font-medium mb-1">Données extraites</h4>
                    <pre className="bg-muted p-4 rounded-lg text-sm overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(selectedItem.data, null, 2)}
                    </pre>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Catégorie:</span>{' '}
                      <span className="font-medium">{categoryLabels[selectedItem.category] || selectedItem.category}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Source:</span>{' '}
                      <span className="font-medium">{sourceTypeLabels[selectedItem.source_type] || selectedItem.source_type}</span>
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
                        {new Date(selectedItem.created_at).toLocaleDateString('fr-FR', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
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
