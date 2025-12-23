import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from "recharts";
import { TrendingUp, Route, Package, DollarSign, Calendar } from "lucide-react";
import { format, subMonths } from "date-fns";
import { fr } from "date-fns/locale";
import { Json } from "@/integrations/supabase/types";

interface TariffLine {
  service: string;
  amount: number;
  currency: string;
  unit?: string;
}

interface QuotationRecord {
  id: string;
  route_destination: string;
  route_origin: string | null;
  route_port: string;
  cargo_type: string;
  tariff_lines: Json;
  total_amount: number | null;
  total_currency: string | null;
  created_at: string;
  client_company: string | null;
  partner_company: string | null;
}

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

const parseTariffLines = (lines: Json): TariffLine[] => {
  if (Array.isArray(lines)) {
    return lines.map(line => ({
      service: (line as Record<string, unknown>)?.service as string || '',
      amount: Number((line as Record<string, unknown>)?.amount) || 0,
      currency: (line as Record<string, unknown>)?.currency as string || 'FCFA',
      unit: (line as Record<string, unknown>)?.unit as string | undefined
    }));
  }
  return [];
};

export default function TariffReports() {
  const [selectedRoute, setSelectedRoute] = useState<string>("all");
  const [selectedPeriod, setSelectedPeriod] = useState<string>("6m");

  // Fetch quotation history
  const { data: quotations = [], isLoading: quotationsLoading } = useQuery({
    queryKey: ['quotation-history-reports'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quotation_history')
        .select('*')
        .order('created_at', { ascending: true });
      
      if (error) throw error;
      return (data || []) as QuotationRecord[];
    }
  });

  // Fetch learned knowledge tariffs as fallback
  const { data: learnedTariffs = [], isLoading: tariffsLoading } = useQuery({
    queryKey: ['learned-tariffs-reports'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('learned_knowledge')
        .select('*')
        .in('category', ['tarif', 'quotation_template', 'quotation_exchange'])
        .order('created_at', { ascending: true });
      
      if (error) throw error;
      return data || [];
    }
  });

  // Get unique routes
  const routes = [...new Set(quotations.map(q => q.route_destination).filter(Boolean))];
  
  // Filter by period
  const getPeriodDate = () => {
    const months = selectedPeriod === "3m" ? 3 : selectedPeriod === "6m" ? 6 : 12;
    return subMonths(new Date(), months);
  };

  const filteredQuotations = quotations.filter(q => {
    const matchesRoute = selectedRoute === "all" || q.route_destination === selectedRoute;
    const matchesPeriod = new Date(q.created_at) >= getPeriodDate();
    return matchesRoute && matchesPeriod;
  });

  // Prepare evolution data by month
  const evolutionData = (() => {
    const monthlyData: Record<string, Record<string, number[]>> = {};
    
    filteredQuotations.forEach(q => {
      const month = format(new Date(q.created_at), 'MMM yyyy', { locale: fr });
      if (!monthlyData[month]) monthlyData[month] = {};
      
      const route = q.route_destination || 'Inconnu';
      if (!monthlyData[month][route]) monthlyData[month][route] = [];
      
      const totalAmount = q.total_amount;
      if (totalAmount) {
        monthlyData[month][route].push(totalAmount);
      }
    });

    return Object.entries(monthlyData).map(([month, routes]) => {
      const entry: Record<string, string | number> = { month };
      Object.entries(routes).forEach(([route, amounts]) => {
        entry[route] = amounts.length > 0 
          ? Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length)
          : 0;
      });
      return entry;
    });
  })();

  // Top services by frequency
  const topServices = (() => {
    const serviceCounts: Record<string, { count: number; totalAmount: number }> = {};
    
    filteredQuotations.forEach(q => {
      const tariffLines = parseTariffLines(q.tariff_lines);
      tariffLines.forEach((line) => {
        const service = line.service || 'Service inconnu';
        if (!serviceCounts[service]) serviceCounts[service] = { count: 0, totalAmount: 0 };
        serviceCounts[service].count++;
        serviceCounts[service].totalAmount += line.amount || 0;
      });
    });

    return Object.entries(serviceCounts)
      .map(([name, { count, totalAmount }]) => ({
        name: name.length > 20 ? name.substring(0, 20) + '...' : name,
        fullName: name,
        count,
        avgAmount: count > 0 ? Math.round(totalAmount / count) : 0
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  })();

  // Route distribution
  const routeDistribution = (() => {
    const routeCounts: Record<string, number> = {};
    filteredQuotations.forEach(q => {
      const route = q.route_destination || 'Inconnu';
      routeCounts[route] = (routeCounts[route] || 0) + 1;
    });

    return Object.entries(routeCounts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  })();

  // Stats summary
  const stats = {
    totalQuotations: filteredQuotations.length,
    uniqueRoutes: new Set(filteredQuotations.map(q => q.route_destination)).size,
    avgAmount: filteredQuotations.length > 0
      ? Math.round(
          filteredQuotations
            .filter(q => q.total_amount)
            .reduce((sum, q) => sum + (q.total_amount || 0), 0) / 
          filteredQuotations.filter(q => q.total_amount).length
        )
      : 0,
    uniqueClients: new Set(filteredQuotations.map(q => q.client_company).filter(Boolean)).size
  };

  // Knowledge-based insights
  const knowledgeInsights = (() => {
    const tariffsByRoute: Record<string, { count: number; sources: string[] }> = {};
    
    learnedTariffs.forEach(k => {
      const data = k.data as Record<string, unknown>;
      const destination = (data?.destination as string) || (data?.route as string) || 'Inconnu';
      if (!tariffsByRoute[destination]) tariffsByRoute[destination] = { count: 0, sources: [] };
      tariffsByRoute[destination].count++;
      if (k.source_type && !tariffsByRoute[destination].sources.includes(k.source_type)) {
        tariffsByRoute[destination].sources.push(k.source_type);
      }
    });

    return Object.entries(tariffsByRoute)
      .map(([route, { count, sources }]) => ({ route, count, sources }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  })();

  const isLoading = quotationsLoading || tariffsLoading;
  const hasData = filteredQuotations.length > 0 || learnedTariffs.length > 0;

  return (
    <MainLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <TrendingUp className="h-6 w-6 text-primary" />
              Rapports Tarifs
            </h1>
            <p className="text-muted-foreground">
              Analyse de l'évolution des tarifs par route et service
            </p>
          </div>

          <div className="flex gap-3">
            <Select value={selectedRoute} onValueChange={setSelectedRoute}>
              <SelectTrigger className="w-[200px]">
                <Route className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Toutes les routes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les routes</SelectItem>
                {routes.map(route => (
                  <SelectItem key={route} value={route}>{route}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <SelectTrigger className="w-[150px]">
                <Calendar className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3m">3 mois</SelectItem>
                <SelectItem value="6m">6 mois</SelectItem>
                <SelectItem value="12m">12 mois</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Cotations</p>
                  <p className="text-2xl font-bold">{stats.totalQuotations}</p>
                </div>
                <Package className="h-8 w-8 text-primary/20" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Routes</p>
                  <p className="text-2xl font-bold">{stats.uniqueRoutes}</p>
                </div>
                <Route className="h-8 w-8 text-primary/20" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Montant moyen</p>
                  <p className="text-2xl font-bold">
                    {stats.avgAmount > 0 ? `${stats.avgAmount.toLocaleString()} FCFA` : '-'}
                  </p>
                </div>
                <DollarSign className="h-8 w-8 text-primary/20" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Connaissances tarifs</p>
                  <p className="text-2xl font-bold">{learnedTariffs.length}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-primary/20" />
              </div>
            </CardContent>
          </Card>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : !hasData ? (
          <Card>
            <CardContent className="py-12 text-center">
              <TrendingUp className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">Aucune donnée disponible</h3>
              <p className="text-muted-foreground">
                Utilisez "Peupler historique" sur la page Connaissances pour migrer les tarifs existants
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Evolution Chart */}
            {evolutionData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Évolution des tarifs moyens par route</CardTitle>
                  <CardDescription>Montant moyen des cotations par mois</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={350}>
                    <LineChart data={evolutionData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" />
                      <YAxis stroke="hsl(var(--muted-foreground))" />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--background))', 
                          border: '1px solid hsl(var(--border))' 
                        }} 
                      />
                      <Legend />
                      {routes.slice(0, 5).map((route, index) => (
                        <Line
                          key={route}
                          type="monotone"
                          dataKey={route}
                          stroke={CHART_COLORS[index % CHART_COLORS.length]}
                          strokeWidth={2}
                          dot={{ fill: CHART_COLORS[index % CHART_COLORS.length] }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Top Services */}
              <Card>
                <CardHeader>
                  <CardTitle>Top 10 Services</CardTitle>
                  <CardDescription>Services les plus fréquents dans les cotations</CardDescription>
                </CardHeader>
                <CardContent>
                  {topServices.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={topServices} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" stroke="hsl(var(--muted-foreground))" />
                        <YAxis dataKey="name" type="category" width={120} stroke="hsl(var(--muted-foreground))" />
                        <Tooltip
                          contentStyle={{ 
                            backgroundColor: 'hsl(var(--background))', 
                            border: '1px solid hsl(var(--border))' 
                          }}
                          formatter={(value: number, name: string) => [
                            name === 'count' ? `${value} cotations` : `${value.toLocaleString()} FCFA`,
                            name === 'count' ? 'Fréquence' : 'Montant moyen'
                          ]}
                        />
                        <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-muted-foreground text-center py-8">Aucun service trouvé</p>
                  )}
                </CardContent>
              </Card>

              {/* Route Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle>Répartition par route</CardTitle>
                  <CardDescription>Distribution des cotations par destination</CardDescription>
                </CardHeader>
                <CardContent>
                  {routeDistribution.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={routeDistribution}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={2}
                          dataKey="value"
                          label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                        >
                          {routeDistribution.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ 
                            backgroundColor: 'hsl(var(--background))', 
                            border: '1px solid hsl(var(--border))' 
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-muted-foreground text-center py-8">Aucune route trouvée</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Knowledge Insights */}
            <Card>
              <CardHeader>
                <CardTitle>Connaissances tarifaires par route</CardTitle>
                <CardDescription>Tarifs appris depuis les emails et documents</CardDescription>
              </CardHeader>
              <CardContent>
                {knowledgeInsights.length > 0 ? (
                  <div className="space-y-3">
                    {knowledgeInsights.map(({ route, count, sources }) => (
                      <div key={route} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                        <div className="flex items-center gap-3">
                          <Route className="h-5 w-5 text-primary" />
                          <span className="font-medium">{route}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {sources.map(s => (
                            <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                          ))}
                          <Badge>{count} tarif{count > 1 ? 's' : ''}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">
                    Aucune connaissance tarifaire disponible
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </MainLayout>
  );
}
