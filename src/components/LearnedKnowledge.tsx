import { useState, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  Brain, CheckCircle, XCircle, Trash2, 
  Tag, DollarSign, FileText, Users, Clock, Package,
  TrendingUp, Loader2, RefreshCw, AlertTriangle, CheckSquare
} from 'lucide-react';
import { useKnowledge, useToggleValidation, useDeleteKnowledge, useBulkValidation, useBulkDelete } from '@/hooks/useKnowledge';
import type { LearnedKnowledge as LearnedKnowledgeType } from '@/types';
import { toast } from 'sonner';

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

function formatDate(dateStr: string) {
  try {
    return format(new Date(dateStr), 'dd MMM yyyy HH:mm', { locale: fr });
  } catch {
    return dateStr;
  }
}

function getConfidenceBadge(confidence: number) {
  if (confidence >= 0.8) {
    return <Badge className="bg-green-500/20 text-green-600 border-green-500/30">Haute ({Math.round(confidence * 100)}%)</Badge>;
  } else if (confidence >= 0.5) {
    return <Badge className="bg-yellow-500/20 text-yellow-600 border-yellow-500/30">Moyenne ({Math.round(confidence * 100)}%)</Badge>;
  }
  return <Badge className="bg-red-500/20 text-red-600 border-red-500/30">Basse ({Math.round(confidence * 100)}%)</Badge>;
}

export function LearnedKnowledge() {
  const { data: knowledge = [], isLoading, refetch } = useKnowledge();
  const toggleValidation = useToggleValidation();
  const deleteKnowledgeMutation = useDeleteKnowledge();
  const bulkValidation = useBulkValidation();
  const bulkDelete = useBulkDelete();
  
  const [selectedItem, setSelectedItem] = useState<LearnedKnowledgeType | null>(null);
  const [filter, setFilter] = useState<string>('pending'); // Default to pending for validation workflow
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const categories = useMemo(() => 
    [...new Set(knowledge.map(k => k.category))],
    [knowledge]
  );

  const filteredKnowledge = useMemo(() => {
    let result = knowledge;
    if (filter === 'validated') result = knowledge.filter(k => k.is_validated);
    else if (filter === 'pending') result = knowledge.filter(k => !k.is_validated);
    else if (filter === 'low_confidence') result = knowledge.filter(k => k.confidence < 0.5);
    else if (filter !== 'all') result = knowledge.filter(k => k.category === filter);
    
    // Sort pending items by confidence (lowest first for review priority)
    if (filter === 'pending' || filter === 'low_confidence') {
      result = [...result].sort((a, b) => a.confidence - b.confidence);
    }
    return result;
  }, [knowledge, filter]);

  // Detect potential duplicates (same name or similar description)
  const duplicateCandidates = useMemo(() => {
    const duplicates = new Set<string>();
    const nameMap = new Map<string, string[]>();
    
    knowledge.forEach(k => {
      const normalizedName = k.name.toLowerCase().trim();
      if (!nameMap.has(normalizedName)) {
        nameMap.set(normalizedName, []);
      }
      nameMap.get(normalizedName)!.push(k.id);
    });
    
    nameMap.forEach((ids) => {
      if (ids.length > 1) {
        ids.forEach(id => duplicates.add(id));
      }
    });
    
    return duplicates;
  }, [knowledge]);

  const stats = useMemo(() => ({
    total: knowledge.length,
    validated: knowledge.filter(k => k.is_validated).length,
    pending: knowledge.filter(k => !k.is_validated).length,
    lowConfidence: knowledge.filter(k => k.confidence < 0.5).length,
    duplicates: duplicateCandidates.size,
    byCategory: categories.reduce((acc, cat) => {
      acc[cat] = knowledge.filter(k => k.category === cat).length;
      return acc;
    }, {} as Record<string, number>)
  }), [knowledge, categories, duplicateCandidates]);

  // Selection handlers
  const toggleSelection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (selectedIds.size === filteredKnowledge.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredKnowledge.map(k => k.id)));
    }
  }, [filteredKnowledge, selectedIds.size]);

  const handleBulkValidate = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    bulkValidation.mutate(ids, {
      onSuccess: () => {
        setSelectedIds(new Set());
        toast.success(`${ids.length} connaissance(s) validée(s)`);
      }
    });
  }, [selectedIds, bulkValidation]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Supprimer ${selectedIds.size} connaissance(s) ?`)) return;
    const ids = Array.from(selectedIds);
    bulkDelete.mutate(ids, {
      onSuccess: () => {
        setSelectedIds(new Set());
        toast.success(`${ids.length} connaissance(s) supprimée(s)`);
      }
    });
  }, [selectedIds, bulkDelete]);

  const handleToggleValidation = useCallback((id: string, currentState: boolean) => {
    toggleValidation.mutate({ id, currentState });
  }, [toggleValidation]);

  const handleDelete = useCallback((id: string) => {
    if (!confirm('Supprimer cette connaissance ?')) return;
    deleteKnowledgeMutation.mutate(id);
    setSelectedItem(null);
  }, [deleteKnowledgeMutation]);

  // Reset selection when filter changes
  const handleFilterChange = useCallback((newFilter: string) => {
    setFilter(newFilter);
    setSelectedIds(new Set());
  }, []);
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
                <p className="text-2xl font-bold text-success">{stats.validated}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-success/50" />
            </div>
          </CardContent>
        </Card>
        <Card className={stats.pending > 0 ? 'border-warning' : ''}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">À valider</p>
                <p className="text-2xl font-bold text-warning">{stats.pending}</p>
              </div>
              <Clock className="h-8 w-8 text-warning/50" />
            </div>
          </CardContent>
        </Card>
        <Card className={stats.lowConfidence > 0 ? 'border-destructive/50' : ''}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Confiance faible</p>
                <p className="text-2xl font-bold text-destructive">{stats.lowConfidence}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-destructive/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <Button 
              variant="outline" 
              className="w-full h-full"
              onClick={() => refetch()}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Actualiser
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Tabs value={filter} onValueChange={handleFilterChange} className="w-full">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="pending" className="text-warning">
            <Clock className="h-3 w-3 mr-1" />
            À valider ({stats.pending})
          </TabsTrigger>
          <TabsTrigger value="low_confidence" className="text-destructive">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Confiance faible ({stats.lowConfidence})
          </TabsTrigger>
          <TabsTrigger value="all">Tout ({stats.total})</TabsTrigger>
          <TabsTrigger value="validated" className="text-success">
            <CheckCircle className="h-3 w-3 mr-1" />
            Validées ({stats.validated})
          </TabsTrigger>
          {categories.map(cat => (
            <TabsTrigger key={cat} value={cat}>
              {categoryIcons[cat] || <Tag className="h-3 w-3 mr-1" />}
              <span className="ml-1">{categoryLabels[cat] || cat} ({stats.byCategory[cat]})</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Bulk Actions */}
      {filteredKnowledge.length > 0 && (
        <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={selectedIds.size === filteredKnowledge.length && filteredKnowledge.length > 0}
              onCheckedChange={selectAll}
            />
            <span className="text-sm text-muted-foreground">
              {selectedIds.size > 0 ? `${selectedIds.size} sélectionnée(s)` : 'Tout sélectionner'}
            </span>
          </div>
          
          {selectedIds.size > 0 && (
            <>
              <Button 
                size="sm" 
                variant="default"
                onClick={handleBulkValidate}
                disabled={bulkValidation.isPending}
              >
                <CheckCircle className="h-4 w-4 mr-1" />
                Valider ({selectedIds.size})
              </Button>
              <Button 
                size="sm" 
                variant="destructive"
                onClick={handleBulkDelete}
                disabled={bulkDelete.isPending}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Supprimer ({selectedIds.size})
              </Button>
            </>
          )}
        </div>
      )}

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
                item.is_validated ? 'border-l-4 border-l-success' : ''
              } ${
                duplicateCandidates.has(item.id) ? 'ring-1 ring-warning' : ''
              } ${
                selectedIds.has(item.id) ? 'bg-accent/30' : ''
              }`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  {/* Checkbox for selection */}
                  <Checkbox
                    checked={selectedIds.has(item.id)}
                    onCheckedChange={() => toggleSelection(item.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1"
                  />
                  
                  <div 
                    className="flex-1 min-w-0"
                    onClick={() => setSelectedItem(item)}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="gap-1">
                        {categoryIcons[item.category] || <Tag className="h-3 w-3" />}
                        {categoryLabels[item.category] || item.category}
                      </Badge>
                      {getConfidenceBadge(item.confidence)}
                      {item.is_validated && (
                        <Badge className="bg-success/20 text-success border-success/30">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Validée
                        </Badge>
                      )}
                      {duplicateCandidates.has(item.id) && (
                        <Badge variant="outline" className="text-warning border-warning">
                          Doublon potentiel
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
                        handleToggleValidation(item.id, item.is_validated);
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
                    onClick={() => handleDelete(selectedItem.id)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Supprimer
                  </Button>
                  <Button 
                    variant={selectedItem.is_validated ? "outline" : "default"}
                    onClick={() => handleToggleValidation(selectedItem.id, selectedItem.is_validated)}
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
