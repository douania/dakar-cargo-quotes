import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Brain, Database, FileText, Route, Users, 
  CheckCircle, AlertCircle, TrendingUp
} from 'lucide-react';

interface LearningStatsData {
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
        .select('category, is_validated, data');

      // Fetch email threads
      const { data: threads } = await supabase
        .from('email_threads')
        .select('is_quotation_thread');

      // Fetch contacts
      const { data: contacts } = await supabase
        .from('known_business_contacts')
        .select('default_role');

      // Process tariffs
      const tariffs = (knowledge || []).filter(k => k.category === 'tariff');
      const tariffsByDestination: Record<string, number> = {};
      tariffs.forEach(t => {
        const dest = (t.data as any)?.destination || (t.data as any)?.pod || 'Unknown';
        tariffsByDestination[dest] = (tariffsByDestination[dest] || 0) + 1;
      });

      // Process templates
      const templates = (knowledge || []).filter(k => k.category === 'template');

      // Process patterns
      const patterns = (knowledge || []).filter(k => 
        k.category === 'negotiation_pattern' || 
        k.category === 'operational_condition' ||
        k.category === 'pattern'
      );

      // Process contacts by role
      const contactsByRole: Record<string, number> = {};
      (contacts || []).forEach(c => {
        contactsByRole[c.default_role] = (contactsByRole[c.default_role] || 0) + 1;
      });

      // Process threads
      const quotationThreads = (threads || []).filter(t => t.is_quotation_thread).length;

      setStats({
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
          negotiation: patterns.filter(p => p.category === 'negotiation_pattern').length,
          operational: patterns.filter(p => p.category === 'operational_condition').length
        }
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
        {/* Main Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Tariffs */}
          <div className="bg-background/80 rounded-lg p-3 border">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Database className="h-4 w-4" />
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
