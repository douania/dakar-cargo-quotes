import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  Mail, 
  FileText, 
  Clock, 
  TrendingUp, 
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ArrowRight,
  Ship,
  Calculator,
  Package,
  BarChart3,
  RefreshCw
} from 'lucide-react';
import { Header } from '@/components/Header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface DashboardStats {
  totalEmails: number;
  quotationRequests: number;
  pendingDrafts: number;
  sentDrafts: number;
  recentEmails: Array<{
    id: string;
    subject: string;
    from_address: string;
    received_at: string;
    is_quotation_request: boolean;
  }>;
  recentDrafts: Array<{
    id: string;
    subject: string;
    status: string;
    created_at: string;
  }>;
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchStats = async () => {
    try {
      // Fetch email stats
      const { data: emails, count: emailCount } = await supabase
        .from('emails')
        .select('id, subject, from_address, received_at, is_quotation_request', { count: 'exact' })
        .order('received_at', { ascending: false })
        .limit(10);

      // Fetch quotation request count
      const { count: quotationCount } = await supabase
        .from('emails')
        .select('id', { count: 'exact' })
        .eq('is_quotation_request', true);

      // Fetch draft stats
      const { data: drafts } = await supabase
        .from('email_drafts')
        .select('id, subject, status, created_at')
        .order('created_at', { ascending: false })
        .limit(5);

      const { count: pendingCount } = await supabase
        .from('email_drafts')
        .select('id', { count: 'exact' })
        .eq('status', 'draft');

      const { count: sentCount } = await supabase
        .from('email_drafts')
        .select('id', { count: 'exact' })
        .eq('status', 'sent');

      setStats({
        totalEmails: emailCount || 0,
        quotationRequests: quotationCount || 0,
        pendingDrafts: pendingCount || 0,
        sentDrafts: sentCount || 0,
        recentEmails: emails || [],
        recentDrafts: drafts || [],
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
      toast.error('Erreur lors du chargement des statistiques');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchStats();
  };

  const formatDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), "dd MMM 'à' HH:mm", { locale: fr });
    } catch {
      return '-';
    }
  };

  const kpiCards = [
    {
      title: 'Emails reçus',
      value: stats?.totalEmails || 0,
      icon: Mail,
      color: 'text-ocean',
      bgColor: 'bg-ocean/10',
    },
    {
      title: 'Demandes de cotation',
      value: stats?.quotationRequests || 0,
      icon: FileText,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      title: 'Brouillons en attente',
      value: stats?.pendingDrafts || 0,
      icon: Clock,
      color: 'text-amber-500',
      bgColor: 'bg-amber-500/10',
    },
    {
      title: 'Réponses envoyées',
      value: stats?.sentDrafts || 0,
      icon: CheckCircle2,
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
    },
  ];

  const quickActions = [
    {
      title: 'Nouvelle cotation',
      description: 'Créer une cotation manuelle',
      icon: Calculator,
      href: '/quotation/new',
      color: 'text-primary',
    },
    {
      title: 'Gérer les emails',
      description: 'Voir tous les emails',
      icon: Mail,
      href: '/admin/emails',
      color: 'text-ocean',
    },
    {
      title: 'Codes SH',
      description: 'Rechercher un code douanier',
      icon: Package,
      href: '/admin/hs-codes',
      color: 'text-green-500',
    },
    {
      title: 'Tarifs portuaires',
      description: 'Consulter les tarifs DPW/PAD',
      icon: Ship,
      href: '/admin/tarifs-portuaires',
      color: 'text-amber-500',
    },
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gradient-gold">Tableau de bord</h1>
            <p className="text-muted-foreground mt-1">Vue d'ensemble de l'activité cotation</p>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Actualiser
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {kpiCards.map((kpi) => (
            <Card key={kpi.title} className="border-border/50 bg-gradient-card">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{kpi.title}</p>
                    <p className="text-3xl font-bold mt-1">{kpi.value}</p>
                  </div>
                  <div className={`p-3 rounded-xl ${kpi.bgColor}`}>
                    <kpi.icon className={`h-6 w-6 ${kpi.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Emails */}
          <Card className="lg:col-span-2 border-border/50 bg-gradient-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="h-5 w-5 text-ocean" />
                  Emails récents
                </CardTitle>
                <CardDescription>Derniers emails reçus</CardDescription>
              </div>
              <Link to="/admin/emails">
                <Button variant="ghost" size="sm">
                  Voir tout
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]">
                <div className="space-y-3">
                  {stats?.recentEmails.map((email) => (
                    <div 
                      key={email.id} 
                      className="flex items-start justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium truncate">{email.subject || 'Sans sujet'}</p>
                          {email.is_quotation_request && (
                            <Badge variant="secondary" className="text-xs bg-primary/20 text-primary">
                              Cotation
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{email.from_address}</p>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                        {formatDate(email.received_at)}
                      </span>
                    </div>
                  ))}
                  {(!stats?.recentEmails || stats.recentEmails.length === 0) && (
                    <p className="text-center text-muted-foreground py-8">
                      Aucun email récent
                    </p>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card className="border-border/50 bg-gradient-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                Actions rapides
              </CardTitle>
              <CardDescription>Accès direct aux fonctionnalités</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {quickActions.map((action) => (
                  <Link key={action.href} to={action.href}>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                      <div className={`p-2 rounded-lg bg-muted`}>
                        <action.icon className={`h-5 w-5 ${action.color}`} />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{action.title}</p>
                        <p className="text-xs text-muted-foreground">{action.description}</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Drafts */}
        {stats?.recentDrafts && stats.recentDrafts.length > 0 && (
          <Card className="mt-6 border-border/50 bg-gradient-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-amber-500" />
                Brouillons récents
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {stats.recentDrafts.map((draft) => (
                  <div 
                    key={draft.id}
                    className="p-3 rounded-lg bg-muted/30 border border-border/50"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <Badge 
                        variant={draft.status === 'sent' ? 'default' : 'secondary'}
                        className={draft.status === 'sent' ? 'bg-green-500/20 text-green-500' : ''}
                      >
                        {draft.status === 'sent' ? 'Envoyé' : 'Brouillon'}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(draft.created_at)}
                      </span>
                    </div>
                    <p className="text-sm font-medium truncate">{draft.subject}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
