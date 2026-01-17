import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Brain, Database, FileText, Route, Users, 
  CheckCircle, AlertCircle, TrendingUp, Ship, DollarSign, Sparkles
} from 'lucide-react';

interface LearningStatsData {
  total: number;
  validated: number;
  validatedRate: number;
  usageCount: number;
  tariffs: {
    total: number;
    validated: number;
    byDestination: Record<string, number>;
  };
  templates: {
    total: number;
    validated: number;
  };
  contacts: {
    total: number;
    byRole: Record<string, number>;
  };
  threads: {
    total: number;
    quotation: number;
    other: number;
  };
  patterns: {
    total: number;
    negotiation: number;
    operational: number;
  };
  carriers: {
    total: number;
    names: string[];
  };
  bySource: {
    email: number;
    document: number;
    expert: number;
    other: number;
  };
}

export function LearningStats() {
  const [stats, setStats] = useState<LearningStatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      // Fetch learned knowledge
      const { data: knowledge } = await supabase
        .from('learned_knowledge')
        .select('category, is_validated, data, source_type, usage_count, name');

      // Fetch email threads
      const { data: threads } = await supabase
        .from('email_threads')
        .select('is_quotation_thread');

      // Fetch contacts
      const { data: contacts } = await supabase
        .from('known_business_contacts')
        .select('default_role');

      const allKnowledge = knowledge || [];
      const totalKnowledge = allKnowledge.length;
      const validatedKnowledge = allKnowledge.filter(k => k.is_validated).length;
      const totalUsageCount = allKnowledge.reduce((sum, k) => sum + (k.usage_count || 0), 0);

      // Process tariffs - accept both English and French category names
      const tariffs = allKnowledge.filter(k => 
        k.category === 'tariff' || k.category === 'tarif'
      );
      const tariffsByDestination: Record<string, number> = {};
      tariffs.forEach(t => {
        const dest = (t.data as any)?.destination || (t.data as any)?.pod || (t.data as any)?.matching_criteria?.destination || 'Unknown';
        tariffsByDestination[dest] = (tariffsByDestination[dest] || 0) + 1;
      });

      // Process templates
      const templates = allKnowledge.filter(k => k.category === 'template');

      // Process patterns - include French category names
      const patterns = allKnowledge.filter(k => 
        k.category === 'negotiation_pattern' || 
        k.category === 'negociation' ||
        k.category === 'patterns_de_negociation' ||
        k.category === 'operational_condition' ||
        k.category === 'condition' ||
        k.category === 'pattern'
      );

      // Process carriers
      const carriers = allKnowledge.filter(k => k.category === 'carrier');
      const carrierNames = carriers.map(c => {
        const name = (c.data as any)?.carrier_name || c.name?.replace('Armateur: ', '');
        return name;
      }).filter(Boolean);
      const uniqueCarriers = [...new Set(carrierNames)];

      // Process by source
      const bySource = {
        email: allKnowledge.filter(k => k.source_type === 'email').length,
        document: allKnowledge.filter(k => k.source_type === 'document').length,
        expert: allKnowledge.filter(k => k.source_type === 'expert').length,
        other: allKnowledge.filter(k => !['email', 'document', 'expert'].includes(k.source_type || '')).length,
      };

      // Process contacts by role
      const contactsByRole: Record<string, number> = {};
      (contacts || []).forEach(c => {
        contactsByRole[c.default_role] = (contactsByRole[c.default_role] || 0) + 1;
      });

      // Process threads
      const quotationThreads = (threads || []).filter(t => t.is_quotation_thread).length;

      setStats({
        total: totalKnowledge,
        validated: validatedKnowledge,
        validatedRate: totalKnowledge > 0 ? Math.round((validatedKnowledge / totalKnowledge) * 100) : 0,
        usageCount: totalUsageCount,
        tariffs: {
          total: tariffs.length,
          validated: tariffs.filter(t => t.is_validated).length,
          byDestination: tariffsByDestination
        },
        templates: {
          total: templates.length,
          validated: templates.filter(t => t.is_validated).length
        },
        contacts: {
          total: contacts?.length || 0,
          byRole: contactsByRole
        },
        threads: {
          total: threads?.length || 0,
          quotation: quotationThreads,
          other: (threads?.length || 0) - quotationThreads
        },
        patterns: {
          total: patterns.length,
          negotiation: patterns.filter(p => 
            p.category === 'negotiation_pattern' || 
            p.category === 'negociation' || 
            p.category === 'patterns_de_negociation'
          ).length,
          operational: patterns.filter(p => 
            p.category === 'operational_condition' || 
            p.category === 'condition'
          ).length
        },
        carriers: {
          total: carriers.length,
          names: uniqueCarriers.slice(0, 5),
        },
        bySource,
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <Card className="bg-muted/30">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Brain className="h-4 w-4 animate-pulse" />
            <span>Chargement des statistiques...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!stats) return null;

  const topDestinations = Object.entries(stats.tariffs.byDestination)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  return (
    <Card className="bg-gradient-to-br from-primary/5 to-secondary/5 border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Brain className="h-5 w-5 text-primary" />
          Statistiques d'Apprentissage
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Global Stats */}
        <div className="bg-gradient-to-r from-primary/10 to-secondary/10 rounded-lg p-4 border border-primary/20">
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Total connaissances</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-green-600">{stats.validatedRate}%</div>
              <div className="text-xs text-muted-foreground">Validées</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-amber-600">{stats.usageCount}</div>
              <div className="text-xs text-muted-foreground">Utilisations</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-purple-600">{stats.carriers.total}</div>
              <div className="text-xs text-muted-foreground">Armateurs</div>
            </div>
          </div>
        </div>

        {/* Main Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Tariffs */}
          <div className="bg-background/80 rounded-lg p-3 border">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <DollarSign className="h-4 w-4" />
              <span className="text-xs">Tarifs</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-primary">{stats.tariffs.validated}</span>
              <span className="text-xs text-muted-foreground">/ {stats.tariffs.total}</span>
            </div>
            <div className="flex items-center gap-1 mt-1">
              <CheckCircle className="h-3 w-3 text-green-500" />
              <span className="text-xs text-green-600">validés</span>
            </div>
          </div>

          {/* Templates */}
          <div className="bg-background/80 rounded-lg p-3 border">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <FileText className="h-4 w-4" />
              <span className="text-xs">Templates</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-secondary">{stats.templates.validated}</span>
              <span className="text-xs text-muted-foreground">/ {stats.templates.total}</span>
            </div>
            <div className="flex items-center gap-1 mt-1">
              <CheckCircle className="h-3 w-3 text-green-500" />
              <span className="text-xs text-green-600">validés</span>
            </div>
          </div>

          {/* Threads */}
          <div className="bg-background/80 rounded-lg p-3 border">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Route className="h-4 w-4" />
              <span className="text-xs">Fils Cotation</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-amber-600">{stats.threads.quotation}</span>
              <span className="text-xs text-muted-foreground">/ {stats.threads.total}</span>
            </div>
            <div className="flex items-center gap-1 mt-1">
              <TrendingUp className="h-3 w-3 text-amber-500" />
              <span className="text-xs text-amber-600">threads</span>
            </div>
          </div>

          {/* Contacts */}
          <div className="bg-background/80 rounded-lg p-3 border">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Users className="h-4 w-4" />
              <span className="text-xs">Contacts</span>
            </div>
            <div className="text-2xl font-bold text-purple-600">{stats.contacts.total}</div>
            <div className="flex flex-wrap gap-1 mt-1">
              {Object.entries(stats.contacts.byRole).slice(0, 2).map(([role, count]) => (
                <Badge key={role} variant="outline" className="text-[10px] px-1 py-0">
                  {role}: {count}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        {/* Carriers */}
        {stats.carriers.names.length > 0 && (
          <div className="bg-background/80 rounded-lg p-3 border">
            <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
              <Ship className="h-3 w-3" />
              Armateurs détectés
            </div>
            <div className="flex flex-wrap gap-1">
              {stats.carriers.names.map((name) => (
                <Badge key={name} variant="secondary" className="text-xs">
                  {name}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Top Destinations */}
        {topDestinations.length > 0 && (
          <div className="bg-background/80 rounded-lg p-3 border">
            <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
              <Route className="h-3 w-3" />
              Top Destinations (tarifs)
            </div>
            <div className="flex flex-wrap gap-1">
              {topDestinations.map(([dest, count]) => (
                <Badge key={dest} variant="secondary" className="text-xs">
                  {dest}: {count}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Source breakdown */}
        {stats.bySource && (
          <div className="bg-background/80 rounded-lg p-3 border">
            <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              Répartition par source
            </div>
            <div className="flex flex-wrap gap-2">
              {(stats.bySource.email || 0) > 0 && (
                <Badge variant="outline" className="text-xs">
                  📧 Emails: {stats.bySource.email}
                </Badge>
              )}
              {(stats.bySource.document || 0) > 0 && (
                <Badge variant="outline" className="text-xs">
                  📄 Documents: {stats.bySource.document}
                </Badge>
              )}
              {(stats.bySource.expert || 0) > 0 && (
                <Badge variant="outline" className="text-xs">
                  👨‍💼 Expert: {stats.bySource.expert}
                </Badge>
              )}
              {(stats.bySource.other || 0) > 0 && (
                <Badge variant="outline" className="text-xs">
                  📦 Autre: {stats.bySource.other}
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Patterns */}
        {stats.patterns.total > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertCircle className="h-3 w-3" />
            <span>
              {stats.patterns.negotiation} patterns de négociation, 
              {stats.patterns.operational} conditions opérationnelles
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
