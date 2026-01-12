import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Search, Check, ExternalLink, Loader2 } from 'lucide-react';

interface TenderSegment {
  id: string;
  segment_type: string;
  origin_location: string;
  destination_location: string;
  rate_per_unit: number | null;
  currency: string | null;
  source_learned_knowledge_id: string | null;
}

interface KnowledgeMatch {
  id: string;
  name: string;
  description: string | null;
  category: string;
  data: {
    montant?: number;
    devise?: string;
    destination?: string;
    origine?: string;
    service?: string;
    [key: string]: any;
  };
  confidence: number;
  is_validated: boolean;
  source_type: string | null;
}

interface MatchKnowledgeToSegmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  segment: TenderSegment | null;
  onMatch: (segmentId: string, knowledgeId: string, rate: number, currency: string) => void;
}

export function MatchKnowledgeToSegmentDialog({
  open,
  onOpenChange,
  segment,
  onMatch
}: MatchKnowledgeToSegmentDialogProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [matches, setMatches] = useState<KnowledgeMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Auto-search when dialog opens with segment info
  useEffect(() => {
    if (open && segment) {
      const autoQuery = `${segment.origin_location} ${segment.destination_location}`.trim();
      setSearchQuery(autoQuery);
      searchKnowledge(autoQuery);
    }
  }, [open, segment]);

  const searchKnowledge = async (query: string) => {
    if (!query.trim()) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('data-admin', {
        body: {
          action: 'search',
          data: {
            query,
            categories: ['tarif_transport', 'tarif', 'rate', 'transport']
          }
        }
      });

      if (error) throw error;
      
      // Filter and score results based on location matching
      const results = (data?.results || []) as KnowledgeMatch[];
      const scored = results.map(r => {
        let score = r.confidence || 0.5;
        const dataStr = JSON.stringify(r.data).toLowerCase();
        const nameStr = r.name.toLowerCase();
        
        // Boost score for location matches
        if (segment) {
          const origin = segment.origin_location.toLowerCase();
          const dest = segment.destination_location.toLowerCase();
          
          if (dataStr.includes(origin) || nameStr.includes(origin)) score += 0.2;
          if (dataStr.includes(dest) || nameStr.includes(dest)) score += 0.2;
          
          // Check specific data fields
          if (r.data.origine?.toLowerCase().includes(origin)) score += 0.1;
          if (r.data.destination?.toLowerCase().includes(dest)) score += 0.1;
        }
        
        return { ...r, matchScore: score };
      });
      
      // Sort by match score
      scored.sort((a, b) => b.matchScore - a.matchScore);
      setMatches(scored.slice(0, 10));
    } catch (error) {
      console.error('Search error:', error);
      toast.error('Erreur de recherche');
    }
    setLoading(false);
  };

  const handleSelect = (knowledge: KnowledgeMatch) => {
    if (!segment) return;
    
    const rate = knowledge.data.montant || knowledge.data.rate || 0;
    const currency = knowledge.data.devise || knowledge.data.currency || 'USD';
    
    onMatch(segment.id, knowledge.id, rate, currency);
    onOpenChange(false);
    toast.success('Tarif lié au segment');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Rechercher un tarif</DialogTitle>
          <DialogDescription>
            {segment && (
              <span>
                Segment: <strong>{segment.origin_location}</strong> → <strong>{segment.destination_location}</strong>
                {' '}({segment.segment_type})
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search input */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher par localité, route..."
                className="pl-9"
                onKeyDown={(e) => e.key === 'Enter' && searchKnowledge(searchQuery)}
              />
            </div>
            <Button onClick={() => searchKnowledge(searchQuery)} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Rechercher'}
            </Button>
          </div>

          {/* Results */}
          <div className="space-y-2">
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                Recherche en cours...
              </div>
            ) : matches.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Aucun tarif trouvé. Essayez une autre recherche.
              </div>
            ) : (
              matches.map((match) => (
                <Card
                  key={match.id}
                  className={`cursor-pointer transition-colors hover:bg-muted/50 ${
                    selectedId === match.id ? 'ring-2 ring-primary' : ''
                  }`}
                  onClick={() => setSelectedId(match.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">{match.name}</span>
                          {match.is_validated && (
                            <Badge variant="default" className="text-xs">
                              <Check className="h-3 w-3 mr-1" />
                              Validé
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs">
                            {match.category}
                          </Badge>
                        </div>
                        
                        {match.description && (
                          <p className="text-sm text-muted-foreground mb-2">
                            {match.description}
                          </p>
                        )}
                        
                        <div className="flex flex-wrap gap-2 text-sm">
                          {match.data.montant && (
                            <Badge variant="secondary">
                              {match.data.montant.toLocaleString()} {match.data.devise || 'USD'}
                            </Badge>
                          )}
                          {match.data.origine && (
                            <Badge variant="outline">
                              De: {match.data.origine}
                            </Badge>
                          )}
                          {match.data.destination && (
                            <Badge variant="outline">
                              Vers: {match.data.destination}
                            </Badge>
                          )}
                          {match.source_type && (
                            <Badge variant="outline" className="text-xs">
                              <ExternalLink className="h-3 w-3 mr-1" />
                              {match.source_type}
                            </Badge>
                          )}
                        </div>
                      </div>
                      
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelect(match);
                        }}
                      >
                        Utiliser
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
