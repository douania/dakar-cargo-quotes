import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FileText,
  Loader2,
  AlertCircle,
  ArrowLeft,
  Paperclip,
  History,
  Puzzle,
  RefreshCw,
  Play,
} from "lucide-react";
import { toast } from "sonner";
import { TASK_STATUS_COLORS } from "@/features/quotation/constants";
import { MainLayout } from "@/components/layout/MainLayout";
import CaseDocumentsTab from "@/components/case/CaseDocumentsTab";

// ── Category labels for display ──
const CATEGORY_LABELS: Record<string, string> = {
  cargo: "Cargo",
  routing: "Routing",
  timing: "Timing",
  pricing: "Tarification",
  documents: "Documents",
  contacts: "Contacts",
  service: "Service",
  regulatory: "Réglementaire",
  carrier: "Transporteur",
  survey: "Survey",
  other: "Autre",
};

const STATUS_LABELS: Record<string, string> = {
  INTAKE: "Réception",
  NEED_INFO: "Infos manquantes",
  READY_TO_PRICE: "Prêt à chiffrer",
  PRICED: "Chiffré",
  SENT: "Envoyé",
  ACCEPTED: "Accepté",
  LOST: "Perdu",
  ARCHIVED: "Archivé",
};

export default function CaseView() {
  const { caseId } = useParams<{ caseId: string }>();
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);
  const navigate = useNavigate();

  // ── Fetch quote_cases ──
  const {
    data: caseData,
    isLoading: caseLoading,
    error: caseError,
    refetch: refetchCase,
  } = useQuery({
    queryKey: ["case-view", caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_cases")
        .select("*")
        .eq("id", caseId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!caseId,
  });

  // ── Fetch quote_facts (current only) ──
  const { data: facts = [], refetch: refetchFacts } = useQuery({
    queryKey: ["case-facts", caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_facts")
        .select("*")
        .eq("case_id", caseId!)
        .eq("is_current", true)
        .order("fact_category")
        .order("fact_key");
      if (error) throw error;
      return data;
    },
    enabled: !!caseId,
  });

  // ── Fetch timeline events ──
  const { data: events = [], refetch: refetchEvents } = useQuery({
    queryKey: ["case-timeline", caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("case_timeline_events")
        .select("*")
        .eq("case_id", caseId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!caseId,
  });

  // ── Fetch documents count ──
  const { data: documentsCount = 0 } = useQuery({
    queryKey: ["case-documents-count", caseId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("case_documents")
        .select("id", { count: "exact", head: true })
        .eq("case_id", caseId!);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!caseId,
  });

  function handleRefresh() {
    refetchCase();
    refetchFacts();
    refetchEvents();
  }

  async function handleLaunchAnalysis() {
    if (!caseId || isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      const { error } = await supabase.functions.invoke("build-case-puzzle", {
        body: { case_id: caseId },
      });
      if (error) throw error;
      toast.success("Analyse lancée avec succès");
      handleRefresh();
    } catch (err) {
      toast.error("Erreur lors de l'analyse : " + (err as Error).message);
    } finally {
      setIsAnalyzing(false);
    }
  }

  // ── Group facts by category ──
  const factsByCategory = facts.reduce<Record<string, typeof facts>>((acc, fact) => {
    const cat = fact.fact_category || "other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(fact);
    return acc;
  }, {});

  // ── Derive client name from facts ──
  const clientFact = facts.find(
    (f) => f.fact_key === "contacts.client_name" || f.fact_key === "client_name"
  );
  const clientName = clientFact?.value_text || null;

  // ── Loading state ──
  if (caseLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  // ── Error state ──
  if (caseError || !caseData) {
    return (
      <MainLayout>
        <div className="container mx-auto py-8 px-4 max-w-4xl">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {(caseError as any)?.message || "Dossier introuvable"}
            </AlertDescription>
          </Alert>
          <Button variant="outline" onClick={() => navigate("/intake")} className="mt-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour
          </Button>
        </div>
      </MainLayout>
    );
  }

  const completeness = caseData.puzzle_completeness ?? 0;

  return (
    <MainLayout>
      <div className="container mx-auto py-8 px-4 max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Button variant="ghost" onClick={() => navigate("/intake")} className="mb-2">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Retour
            </Button>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <FileText className="h-6 w-6 text-primary" />
              Dossier {caseId?.slice(0, 8)}…
            </h1>
            {clientName && (
              <p className="text-muted-foreground">Client : {clientName}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Badge className={TASK_STATUS_COLORS[caseData.status.toLowerCase()] || "bg-muted text-muted-foreground"}>
              {STATUS_LABELS[caseData.status] || caseData.status}
            </Badge>
            {caseData.request_type && (
              <Badge variant="outline">{caseData.request_type}</Badge>
            )}
          </div>
        </div>

        {/* Info bar */}
        <Card className="mb-6">
          <CardContent className="py-4 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Complétude</span>
                <div className="flex items-center gap-2">
                  <Progress value={completeness} className="w-32 h-2" />
                  <span className="text-sm font-semibold">{completeness}%</span>
                </div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Faits</span>
                <p className="text-sm font-semibold">{caseData.facts_count ?? facts.length}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Gaps</span>
                <p className="text-sm font-semibold">{caseData.gaps_count ?? 0}</p>
              </div>
              {caseData.priority && (
                <div>
                  <span className="text-xs text-muted-foreground">Priorité</span>
                  <p className="text-sm font-semibold capitalize">{caseData.priority}</p>
                </div>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Rafraîchir
            </Button>
          </CardContent>
        </Card>

        {/* Action Panel — visible for actionable statuses */}
        {['INTAKE', 'FACTS_PARTIAL', 'NEED_INFO'].includes(caseData.status) && (
          <Card className="mb-6 border-primary/30 bg-primary/5">
            <CardContent className="py-4 flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Dossier prêt à analyser</h3>
                <p className="text-sm text-muted-foreground">
                  {documentsCount} document(s) uploadé(s) — {facts.length} fait(s) extrait(s)
                </p>
              </div>
              <Button
                onClick={handleLaunchAnalysis}
                disabled={isAnalyzing || documentsCount === 0 || caseData.status === 'PRICING_RUNNING'}
              >
                {isAnalyzing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                Lancer l'analyse
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs defaultValue="facts" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="facts" className="flex items-center gap-2">
              <Puzzle className="h-4 w-4" />
              Faits ({facts.length})
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex items-center gap-2">
              <Paperclip className="h-4 w-4" />
              Documents
            </TabsTrigger>
            <TabsTrigger value="timeline" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              Timeline ({events.length})
            </TabsTrigger>
          </TabsList>

          {/* Facts Tab */}
          <TabsContent value="facts">
            {Object.keys(factsByCategory).length === 0 ? (
              <Card>
                <CardContent className="py-8">
                  <p className="text-muted-foreground text-center">
                    Aucun fait extrait. Uploadez un document pour commencer l'analyse.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {Object.entries(factsByCategory).map(([category, catFacts]) => (
                  <Card key={category}>
                    <CardHeader className="py-3">
                      <CardTitle className="text-base">
                        {CATEGORY_LABELS[category] || category}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-1/3">Clé</TableHead>
                            <TableHead>Valeur</TableHead>
                            <TableHead className="w-24">Confiance</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {catFacts.map((fact) => (
                            <TableRow key={fact.id}>
                              <TableCell className="font-mono text-xs">
                                {fact.fact_key}
                              </TableCell>
                              <TableCell>
                                {fact.value_text ||
                                  (fact.value_number != null ? String(fact.value_number) : null) ||
                                  (fact.value_json ? JSON.stringify(fact.value_json) : "—")}
                              </TableCell>
                              <TableCell>
                                {fact.confidence != null ? (
                                  <Badge
                                    variant="outline"
                                    className={
                                      fact.confidence >= 0.8
                                        ? "border-green-500 text-green-700"
                                        : fact.confidence >= 0.5
                                        ? "border-yellow-500 text-yellow-700"
                                        : "border-red-500 text-red-700"
                                    }
                                  >
                                    {Math.round(fact.confidence * 100)}%
                                  </Badge>
                                ) : (
                                  "—"
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documents">
            {caseId && <CaseDocumentsTab caseId={caseId} />}
          </TabsContent>

          {/* Timeline Tab */}
          <TabsContent value="timeline">
            <Card>
              <CardHeader>
                <CardTitle>Historique des événements</CardTitle>
              </CardHeader>
              <CardContent>
                {events.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    Aucun événement enregistré.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-auto">
                    {events.map((event) => (
                      <div
                        key={event.id}
                        className="flex items-start gap-3 p-3 bg-muted rounded text-sm"
                      >
                        <div className="text-muted-foreground whitespace-nowrap">
                          {event.created_at
                            ? new Date(event.created_at).toLocaleString()
                            : ""}
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          {event.event_type}
                        </Badge>
                        {event.new_value && (
                          <span className="text-xs text-muted-foreground truncate">
                            {event.new_value}
                          </span>
                        )}
                        {event.event_data && (
                          <code className="text-xs text-muted-foreground">
                            {JSON.stringify(event.event_data)}
                          </code>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
