import React, { useMemo, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
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
  Package,
  RefreshCw,
  Play,
  Pencil,
  Check,
  X,
  Calculator,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TASK_STATUS_COLORS, SERVICE_PACKAGES, serviceTemplates } from "@/features/quotation/constants";
import { Checkbox } from "@/components/ui/checkbox";

// ── Fact keys rendered as Select dropdown instead of Input ──
const SELECT_FACT_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  "service.package": Object.keys(SERVICE_PACKAGES).map((pkg) => ({
    value: pkg,
    label: pkg.replace(/_/g, " "),
  })),
};
import { MainLayout } from "@/components/layout/MainLayout";
import CaseDocumentsTab from "@/components/case/CaseDocumentsTab";
import { PricingLaunchPanel } from "@/components/puzzle/PricingLaunchPanel";
import { PricingResultPanel } from "@/components/puzzle/PricingResultPanel";

// ── Editable fact keys (must match set-case-fact whitelist) ──
const EDITABLE_FACT_KEYS = new Set([
  "cargo.weight_kg",
  "cargo.container_count",
  "cargo.container_type",
  "cargo.caf_value",
  "cargo.chargeable_weight_kg",
  "cargo.weight_per_container_kg",
  "cargo.articles_detail",
  "client.code",
  "routing.incoterm",
  "routing.destination_city",
  "service.mode",
  "service.package",
]);

const NUMERIC_FACT_KEYS = new Set([
  "cargo.weight_kg",
  "cargo.container_count",
  "cargo.caf_value",
  "cargo.chargeable_weight_kg",
  "cargo.weight_per_container_kg",
]);

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

// ── Contextual service filtering ──
function isServiceRelevant(service: string, mode: string): boolean {
  if (mode.startsWith("SEA")) {
    if (service.startsWith("AIR_")) return false;
    if (service === "CUSTOMS_BAMAKO") return false;
    if (service === "BORDER_FEES") return false;
    if (service === "DISCHARGE") return false;
  }
  if (mode.startsWith("AIR")) {
    if (service.startsWith("PORT_")) return false;
    if (service === "DTHC") return false;
    if (service === "EMPTY_RETURN") return false;
    if (service === "DISCHARGE") return false;
  }
  if (mode.includes("IMPORT") && service === "CUSTOMS_EXPORT") return false;
  if (mode.includes("EXPORT") && service === "CUSTOMS_DAKAR") return false;
  return true;
}

const EXCLUSIVE_GROUPS = [
  ["TRUCKING", "ON_CARRIAGE"],
  ["PORT_DAKAR_HANDLING", "PORT_CHARGES"],
  ["CUSTOMS_DAKAR", "CUSTOMS"],
];

// ── Service Override Panel ──
function ServiceOverridePanel({
  facts,
  caseId,
  isLocked,
  onSaved,
}: {
  facts: any[];
  caseId: string;
  isLocked: boolean;
  onSaved: () => void;
}) {
  const packageFact = facts.find(
    (f: any) => f.fact_key === "service.package" && f.is_current
  );
  const packageKey = packageFact?.value_text;
  const packageServices = packageKey ? SERVICE_PACKAGES[packageKey] : null;

  // Parse existing overrides
  const overrideFact = facts.find(
    (f: any) => f.fact_key === "service.overrides" && f.is_current
  );
  const existingOverrides = useMemo<{ add: string[]; remove: string[] }>(() => {
    if (!overrideFact?.value_json) return { add: [], remove: [] };
    try {
      const raw = overrideFact.value_json;
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return {
        add: Array.isArray(parsed.add) ? parsed.add : [],
        remove: Array.isArray(parsed.remove) ? parsed.remove : [],
      };
    } catch {
      return { add: [], remove: [] };
    }
  }, [overrideFact]);

  const [removedServices, setRemovedServices] = useState<Set<string>>(
    new Set(existingOverrides.remove)
  );
  const [addedServices, setAddedServices] = useState<Set<string>>(
    new Set(existingOverrides.add)
  );
  const [isSaving, setIsSaving] = useState(false);
  const [showMore, setShowMore] = useState(false);

  // Reset when package changes
  React.useEffect(() => {
    setRemovedServices(new Set(existingOverrides.remove));
    setAddedServices(new Set(existingOverrides.add));
  }, [packageKey, existingOverrides]);

  // Read service.mode for contextual filtering
  const modeFact = facts.find(
    (f: any) => f.fact_key === "service.mode" && f.is_current
  );
  const serviceMode = modeFact?.value_text || "";

  if (!packageServices || !packageKey) return null;

  const ALL_SERVICE_KEYS = new Set(serviceTemplates.map((t) => t.service));

  // Exclusive groups: if one member is in the package, hide the others
  const excludedByExclusive = new Set(
    EXCLUSIVE_GROUPS.flatMap((group) => {
      const inPackage = group.filter((k) => packageServices.includes(k));
      return inPackage.length > 0
        ? group.filter((k) => !packageServices.includes(k))
        : [];
    })
  );

  const extraServices = serviceTemplates.filter((t) => {
    if (packageServices.includes(t.service)) return false;
    if (!isServiceRelevant(t.service, serviceMode)) return false;
    if (excludedByExclusive.has(t.service)) return false;
    return true;
  });
  const frequentExtra = extraServices.slice(0, 4);
  const restExtra = extraServices.slice(4);

  const toggleRemove = (key: string) => {
    setRemovedServices((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAdd = (key: string) => {
    setAddedServices((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const hasChanges =
    JSON.stringify([...removedServices].sort()) !==
      JSON.stringify([...new Set(existingOverrides.remove)].sort()) ||
    JSON.stringify([...addedServices].sort()) !==
      JSON.stringify([...new Set(existingOverrides.add)].sort());

  const handleSaveOverrides = async () => {
    setIsSaving(true);
    try {
      // Sanitize against allowlist
      const add = [...addedServices].filter((k) => ALL_SERVICE_KEYS.has(k));
      const remove = [...removedServices].filter((k) => ALL_SERVICE_KEYS.has(k));

      const { error } = await supabase.functions.invoke("set-case-fact", {
        body: {
          case_id: caseId,
          fact_key: "service.overrides",
          value_json: { add, remove },
        },
      });
      if (error) throw error;
      toast.success("Ajustements sauvegardés");
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const getLabel = (key: string) =>
    serviceTemplates.find((t) => t.service === key)?.description || key;

  // Derive effective services for display
  const effectiveKeys = packageServices
    .filter((k: string) => !removedServices.has(k))
    .concat([...addedServices].filter((k) => !packageServices.includes(k)));

  return (
    <Card className="mt-4 border-primary/20">
      <CardHeader className="py-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          Services du package : {packageKey.replace(/_/g, " ")}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {/* Package services (removable) */}
        <div className="space-y-2">
          {packageServices.map((key: string) => (
            <label
              key={key}
              className="flex items-center gap-2 text-sm cursor-pointer"
            >
              <Checkbox
                checked={!removedServices.has(key)}
                onCheckedChange={() => toggleRemove(key)}
                disabled={isLocked}
              />
              <span className={removedServices.has(key) ? "line-through text-muted-foreground" : ""}>
                {getLabel(key)}
              </span>
              <Badge variant="outline" className="text-[10px] ml-auto">
                {key}
              </Badge>
            </label>
          ))}
        </div>

        {/* Extra services (addable) */}
        {(frequentExtra.length > 0) && (
          <>
            <Separator />
            <p className="text-xs text-muted-foreground font-medium">
              Services supplémentaires
            </p>
            <div className="space-y-2">
              {frequentExtra.map((t) => (
                <label
                  key={t.service}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={addedServices.has(t.service)}
                    onCheckedChange={() => toggleAdd(t.service)}
                    disabled={isLocked}
                  />
                  <span>{t.description}</span>
                  <Badge variant="outline" className="text-[10px] ml-auto">
                    {t.service}
                  </Badge>
                </label>
              ))}
              {restExtra.length > 0 && !showMore && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => setShowMore(true)}
                >
                  + {restExtra.length} autres services
                </Button>
              )}
              {showMore &&
                restExtra.map((t) => (
                  <label
                    key={t.service}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={addedServices.has(t.service)}
                      onCheckedChange={() => toggleAdd(t.service)}
                      disabled={isLocked}
                    />
                    <span>{t.description}</span>
                    <Badge variant="outline" className="text-[10px] ml-auto">
                      {t.service}
                    </Badge>
                  </label>
                ))}
            </div>
          </>
        )}

        {/* Effective count + save */}
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">
            {effectiveKeys.length} service(s) effectif(s)
          </span>
          <Button
            size="sm"
            onClick={handleSaveOverrides}
            disabled={isLocked || isSaving || !hasChanges}
          >
            {isSaving ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Check className="mr-1 h-3 w-3" />
            )}
            Valider les ajustements
          </Button>
        </div>
        {isLocked && (
          <p className="text-xs text-muted-foreground italic">
            Pricing en cours — modifications désactivées
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function CaseView() {
  const { caseId } = useParams<{ caseId: string }>();
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);
  const [editingFactId, setEditingFactId] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState("");
  const [isSavingFact, setIsSavingFact] = React.useState(false);
  const [dismissedSuggestions, setDismissedSuggestions] = React.useState<string[]>([]);
  const [isApplyingSuggestion, setIsApplyingSuggestion] = React.useState(false);
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

  const isLocked = caseData?.status === "PRICING_RUNNING";

  function startEdit(fact: any) {
    const currentValue =
      fact.value_text ||
      (fact.value_number != null ? String(fact.value_number) : "") ||
      (fact.value_json ? JSON.stringify(fact.value_json) : "");
    setEditingFactId(fact.id);
    setEditValue(currentValue);
  }

  function cancelEdit() {
    setEditingFactId(null);
    setEditValue("");
  }

  async function handleSaveFact(fact: any) {
    if (!caseId) {
      toast.error("Dossier invalide");
      return;
    }
    setIsSavingFact(true);
    try {
      const isNumeric = NUMERIC_FACT_KEYS.has(fact.fact_key);
      const payload: Record<string, unknown> = {
        case_id: caseId,
        fact_key: fact.fact_key,
      };

      if (isNumeric) {
        const num = Number(editValue);
        if (!Number.isFinite(num) || num < 0) {
          throw new Error("Valeur numérique invalide");
        }
        payload.value_number = num;
        payload.value_text = null;
      } else {
        if (!editValue || !editValue.trim()) {
          throw new Error("Valeur texte invalide");
        }
        payload.value_text = editValue.trim();
        payload.value_number = null;
      }

      const { error } = await supabase.functions.invoke("set-case-fact", {
        body: payload,
      });
      if (error) throw error;

      toast.success("Fait mis à jour");
      cancelEdit();
      handleRefresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSavingFact(false);
    }
  }

  // ── Group facts by category ──
  const factsByCategory = facts.reduce<Record<string, typeof facts>>((acc, fact) => {
    const cat = fact.fact_category || "other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(fact);
    return acc;
  }, {});

  // ── Derived suggestions ──
  interface DerivedSuggestion {
    id: string;
    label: string;
    description: string;
    suggestedValue: number;
    unit: string;
    fact_key: string;
  }

  const derivedSuggestions = useMemo<DerivedSuggestion[]>(() => {
    const suggestions: DerivedSuggestion[] = [];
    const weightFact = facts.find((f) => f.fact_key === "cargo.weight_kg" && f.is_current);
    const countFact = facts.find((f) => f.fact_key === "cargo.container_count" && f.is_current);
    const perContainerFact = facts.find(
      (f) => f.fact_key === "cargo.weight_per_container_kg" && f.is_current
    );

    if (
      weightFact?.value_number != null &&
      countFact?.value_number != null &&
      countFact.value_number > 1 &&
      !perContainerFact
    ) {
      const avg = Math.round(weightFact.value_number / countFact.value_number);
      if (Number.isFinite(avg) && avg > 0) {
        suggestions.push({
          id: "weight_per_container",
          label: "Poids moyen par conteneur",
          description: `${weightFact.value_number.toLocaleString()} kg ÷ ${countFact.value_number} conteneurs`,
          suggestedValue: avg,
          unit: "kg",
          fact_key: "cargo.weight_per_container_kg",
        });
      }
    }
    return suggestions;
  }, [facts]);

  const visibleSuggestions = derivedSuggestions.filter(
    (s) => !dismissedSuggestions.includes(s.id)
  );

  async function applySuggestion(suggestion: DerivedSuggestion) {
    if (!caseId) {
      toast.error("Dossier invalide");
      return;
    }
    setIsApplyingSuggestion(true);
    try {
      const { error } = await supabase.functions.invoke("set-case-fact", {
        body: {
          case_id: caseId,
          fact_key: suggestion.fact_key,
          value_number: suggestion.suggestedValue,
        },
      });
      if (error) throw error;
      toast.success("Fait dérivé créé");
      setDismissedSuggestions((prev) =>
        prev.includes(suggestion.id) ? prev : [...prev, suggestion.id]
      );
      handleRefresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsApplyingSuggestion(false);
    }
  }

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

        {/* Pricing Launch Panel — visible for READY_TO_PRICE */}
        {caseData.status === 'READY_TO_PRICE' && (
          <div className="mb-6">
            <PricingLaunchPanel caseId={caseId!} onComplete={handleRefresh} />
          </div>
        )}

        {/* Pricing Result Panel — visible after pricing */}
        {['PRICED_DRAFT', 'HUMAN_REVIEW', 'QUOTED_VERSIONED', 'SENT'].includes(caseData.status) && (
          <div className="mb-6">
            <PricingResultPanel caseId={caseId!} isLocked={caseData.status === 'SENT'} />
          </div>
        )}

        {/* Derived Suggestions Panel */}
        {visibleSuggestions.length > 0 && !isLocked && (
          <Card className="mb-6 border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700">
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Calculator className="h-4 w-4 text-amber-600" />
                Suggestions intelligentes
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {visibleSuggestions.map((suggestion) => (
                <div
                  key={suggestion.id}
                  className="flex items-center justify-between p-3 rounded-md bg-background border"
                >
                  <div>
                    <p className="font-medium text-sm">{suggestion.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {suggestion.description} ={" "}
                      <strong>
                        {suggestion.suggestedValue.toLocaleString()} {suggestion.unit}
                      </strong>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => applySuggestion(suggestion)}
                      disabled={isApplyingSuggestion}
                    >
                      {isApplyingSuggestion ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <Check className="mr-1 h-3 w-3" />
                      )}
                      Créer le fait dérivé
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setDismissedSuggestions((prev) =>
                          prev.includes(suggestion.id) ? prev : [...prev, suggestion.id]
                        )
                      }
                    >
                      Ignorer
                    </Button>
                  </div>
                </div>
              ))}
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
                            <TableHead className="w-20">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {catFacts.map((fact) => {
                            const isEditing = editingFactId === fact.id;
                            const displayValue =
                              fact.value_text ||
                              (fact.value_number != null ? String(fact.value_number) : null) ||
                              (fact.value_json ? JSON.stringify(fact.value_json) : "—");

                            return (
                              <TableRow key={fact.id}>
                                <TableCell className="font-mono text-xs">
                                  {fact.fact_key}
                                </TableCell>
                                <TableCell>
                                  {isEditing ? (
                                    SELECT_FACT_OPTIONS[fact.fact_key] ? (
                                      <Select value={editValue} onValueChange={setEditValue}>
                                        <SelectTrigger className="h-8">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {SELECT_FACT_OPTIONS[fact.fact_key].map((opt) => (
                                            <SelectItem key={opt.value} value={opt.value}>
                                              {opt.label}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    ) : (
                                      <Input
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") handleSaveFact(fact);
                                          if (e.key === "Escape") cancelEdit();
                                        }}
                                        className="h-8"
                                        autoFocus
                                      />
                                    )
                                  ) : (
                                    <div className="flex items-center gap-2">
                                      <span>{displayValue}</span>
                                      {fact.source_type === "manual_input" && (
                                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                          Opérateur
                                        </Badge>
                                      )}
                                    </div>
                                  )}
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
                                <TableCell>
                                  {isEditing ? (
                                    <div className="flex gap-1">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={() => handleSaveFact(fact)}
                                        disabled={isSavingFact}
                                      >
                                        {isSavingFact ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                          <Check className="h-3 w-3" />
                                        )}
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={cancelEdit}
                                        disabled={isSavingFact}
                                      >
                                        <X className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  ) : (
                                    EDITABLE_FACT_KEYS.has(fact.fact_key) && !isLocked && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={() => startEdit(fact)}
                                      >
                                        <Pencil className="h-3 w-3" />
                                      </Button>
                                    )
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Service Override Panel */}
            <ServiceOverridePanel
              facts={facts}
              caseId={caseId!}
              isLocked={isLocked}
              onSaved={handleRefresh}
            />
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
