/**
 * PAD-NST-2E-C-D — Panneau UI opérateur "Suggestions PAD-NST".
 *
 * FRONTEND-ONLY. Strictement aucune écriture DB.
 * - Lit nst_groups / nst_divisions (RLS authentifié, SELECT only).
 * - Appelle l'edge function get-pad-nst-suggestions sur clic explicite.
 * - Affiche les suggestions comme TO_CONFIRM (jamais OFFICIAL).
 * - "Copier le code PAD" = clipboard only — n'écrit PAS dans cargo.pad_category,
 *   quote_facts ni case_facts ; n'appelle PAS set-case-fact ; ne déclenche PAS run-pricing.
 * - nst_code reste local au composant (state React), jamais persisté.
 */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Anchor, Search, Copy, AlertTriangle, Loader2, ChevronDown, Info } from "lucide-react";
import { toast } from "sonner";
import {
  getPadCategoryLabel,
  getEvidenceLevelLabel,
  getConfidenceTier,
  CONFIDENCE_TIER_LABELS,
  findConflictAlert,
} from "./padNstConstants";

interface NstGroup {
  group_code: string;
  label_en: string | null;
  label_fr: string | null;
  division_code: string;
}

interface NstDivision {
  division_code: string;
  label_en: string | null;
  label_fr: string | null;
}

interface PadNstSuggestion {
  rule_id: string;
  nst_level: "group" | "division";
  nst_code: string;
  pad_category: string;
  confidence: number;
  evidence_level: string;
  notes: string | null;
  source_document: string | null;
  source_reference: string | null;
}

type FetchState = "idle" | "loading" | "success" | "empty" | "error";

interface Props {
  /** Si une catégorie PAD opérateur est déjà validée pour le dossier, on affiche un état neutre. */
  padCategoryAlreadySet?: string | null;
}

export default function PadNstSuggestionsPanel({ padCategoryAlreadySet }: Props) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<NstGroup[]>([]);
  const [divisions, setDivisions] = useState<NstDivision[]>([]);
  const [padLabels, setPadLabels] = useState<Record<string, string>>({});
  const [refLoading, setRefLoading] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);

  const [tab, setTab] = useState<"group" | "division">("group");
  const [search, setSearch] = useState("");
  const [selectedCode, setSelectedCode] = useState<string>("");

  const [fetchState, setFetchState] = useState<FetchState>("idle");
  const [suggestions, setSuggestions] = useState<PadNstSuggestion[]>([]);
  const [lastQueriedCode, setLastQueriedCode] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Chargement des libellés PAD officiels (commodity_categories) AU MONTAGE,
  // indépendamment de `open`, pour couvrir aussi l'état padCategoryAlreadySet
  // (carte lecture seule, sans ouverture possible du Collapsible).
  // Erreur NON bloquante : console.warn + padLabels = {} → fallback strict.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("commodity_categories")
      .select("pad_category,pad_category_label")
      .not("pad_category", "is", null)
      .not("pad_category_label", "is", null)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn("[PadNstSuggestionsPanel] commodity_categories load failed (non-blocking):", error.message);
          return;
        }
        const dict: Record<string, string> = {};
        for (const row of (data ?? []) as Array<{ pad_category: string | null; pad_category_label: string | null }>) {
          if (row.pad_category && row.pad_category_label) {
            dict[row.pad_category] = row.pad_category_label;
          }
        }
        setPadLabels(dict);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Charge nst_groups / nst_divisions une seule fois à l'ouverture du panneau.
  // Référentiel NST : erreur bloquante (état refError affiché).
  useEffect(() => {
    if (!open || (groups.length > 0 && divisions.length > 0) || refLoading) return;
    let cancelled = false;
    setRefLoading(true);
    setRefError(null);
    Promise.all([
      supabase.from("nst_groups").select("group_code,label_en,label_fr,division_code").order("group_code"),
      supabase.from("nst_divisions").select("division_code,label_en,label_fr").order("division_code"),
    ])
      .then(([gRes, dRes]) => {
        if (cancelled) return;
        if (gRes.error) throw gRes.error;
        if (dRes.error) throw dRes.error;
        setGroups((gRes.data ?? []) as NstGroup[]);
        setDivisions((dRes.data ?? []) as NstDivision[]);
      })
      .catch((err) => {
        if (cancelled) return;
        setRefError(err?.message ?? "Erreur de chargement des référentiels NST");
      })
      .finally(() => {
        if (!cancelled) setRefLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, groups.length, divisions.length, refLoading]);

  // Réinitialise la sélection à la fermeture (pas de persistance entre sessions).
  useEffect(() => {
    if (!open) {
      setSelectedCode("");
      setSearch("");
      setSuggestions([]);
      setFetchState("idle");
      setErrorMsg(null);
      setLastQueriedCode("");
    }
  }, [open]);

  // Reset sélection quand on change d'onglet group/division.
  useEffect(() => {
    setSelectedCode("");
  }, [tab]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (tab === "group") {
      const items = groups.map((g) => ({
        code: g.group_code,
        label_fr: g.label_fr ?? "",
        label_en: g.label_en ?? "",
      }));
      if (!q) return items;
      return items.filter(
        (i) =>
          i.code.toLowerCase().includes(q) ||
          i.label_fr.toLowerCase().includes(q) ||
          i.label_en.toLowerCase().includes(q),
      );
    }
    const items = divisions.map((d) => ({
      code: d.division_code,
      label_fr: d.label_fr ?? "",
      label_en: d.label_en ?? "",
    }));
    if (!q) return items;
    return items.filter(
      (i) =>
        i.code.toLowerCase().includes(q) ||
        i.label_fr.toLowerCase().includes(q) ||
        i.label_en.toLowerCase().includes(q),
    );
  }, [tab, search, groups, divisions]);

  const handleSearch = async () => {
    if (!selectedCode) return;
    setFetchState("loading");
    setErrorMsg(null);
    setLastQueriedCode(selectedCode);
    try {
      const { data, error } = await supabase.functions.invoke("get-pad-nst-suggestions", {
        body: { nst_level: tab, nst_code: selectedCode },
      });
      if (error) throw error;
      const list: PadNstSuggestion[] = (data?.suggestions ?? []) as PadNstSuggestion[];
      setSuggestions(list);
      setFetchState(list.length === 0 ? "empty" : "success");
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Erreur lors de l'appel à get-pad-nst-suggestions");
      setSuggestions([]);
      setFetchState("error");
    }
  };

  const conflictAlert = useMemo(
    () => (fetchState === "success" ? findConflictAlert(lastQueriedCode) : null),
    [fetchState, lastQueriedCode],
  );

  // Si une catégorie PAD opérateur est déjà saisie, panneau en lecture seule (§5 État 7).
  if (padCategoryAlreadySet) {
    return (
      <Card className="mb-6 border-muted">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Anchor className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Suggestions PAD-NST
            </CardTitle>
          </div>
          <CardDescription className="text-xs">
            Catégorie PAD opérateur déjà saisie : <span className="font-mono font-semibold">{padCategoryAlreadySet}</span>
            {" — "}
            {getPadCategoryLabel(padCategoryAlreadySet, padLabels)}. Aucune suggestion affichée par-dessus une décision opérateur.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="mb-6">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Anchor className="h-4 w-4 text-blue-600" />
              <CardTitle className="text-sm">Suggestions PAD-NST (assistance opérateur)</CardTitle>
              <Badge variant="outline" className="text-[10px]">TO_CONFIRM</Badge>
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">
                <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
                <span className="ml-1">{open ? "Fermer" : "Ouvrir"}</span>
              </Button>
            </CollapsibleTrigger>
          </div>
          <CardDescription className="text-xs">
            Sélectionnez manuellement un groupe ou une division NST puis recherchez les catégories PAD candidates.
            Aucune écriture automatique — l'opérateur reste seul décideur.
          </CardDescription>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-4">
            {refError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{refError}</AlertDescription>
              </Alert>
            )}

            {refLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : (
              <Tabs value={tab} onValueChange={(v) => setTab(v as "group" | "division")}>
                <TabsList>
                  <TabsTrigger value="group">Groupe NST (recommandé)</TabsTrigger>
                  <TabsTrigger value="division">Division NST (fallback)</TabsTrigger>
                </TabsList>
                <TabsContent value="group" className="mt-3 space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Rechercher par code (ex : 08.4) ou libellé"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                  <NstSelect
                    items={filteredItems}
                    value={selectedCode}
                    onChange={setSelectedCode}
                    placeholder="Choisir un groupe NST"
                  />
                </TabsContent>
                <TabsContent value="division" className="mt-3 space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Rechercher par code (ex : 08) ou libellé"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                  <NstSelect
                    items={filteredItems}
                    value={selectedCode}
                    onChange={setSelectedCode}
                    placeholder="Choisir une division NST"
                  />
                </TabsContent>
              </Tabs>
            )}

            <div className="flex items-center gap-2">
              <Button
                onClick={handleSearch}
                disabled={!selectedCode || fetchState === "loading"}
                size="sm"
              >
                {fetchState === "loading" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Rechercher suggestions PAD
              </Button>
              {selectedCode && (
                <span className="text-xs text-muted-foreground">
                  Sélection : <span className="font-mono">{selectedCode}</span>
                </span>
              )}
            </div>

            {/* Résultats */}
            {fetchState === "error" && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Impossible de récupérer les suggestions NST</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p className="text-xs">{errorMsg}</p>
                  <Button size="sm" variant="outline" onClick={handleSearch}>
                    Réessayer
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {fetchState === "empty" && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Aucune correspondance NST → PAD trouvée pour <span className="font-mono">{lastQueriedCode}</span>.
                  Catégorie PAD à saisir manuellement.
                </AlertDescription>
              </Alert>
            )}

            {fetchState === "success" && conflictAlert && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="text-sm">Conflit P1-C — {conflictAlert.family}</AlertTitle>
                <AlertDescription className="text-xs">{conflictAlert.message}</AlertDescription>
              </Alert>
            )}

            {fetchState === "success" &&
              suggestions.map((s) => <SuggestionCard key={s.rule_id} suggestion={s} padLabels={padLabels} />)}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/* ---------- Sous-composants ---------- */

function NstSelect({
  items,
  value,
  onChange,
  placeholder,
}: {
  items: Array<{ code: string; label_fr: string; label_en: string }>;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {items.length === 0 ? (
          <div className="p-2 text-xs text-muted-foreground">Aucun résultat</div>
        ) : (
          items.map((i) => (
            <SelectItem key={i.code} value={i.code}>
              <span className="font-mono mr-2">{i.code}</span>
              <span>{i.label_fr || i.label_en || "(sans libellé)"}</span>
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}

function SuggestionCard({ suggestion, padLabels }: { suggestion: PadNstSuggestion; padLabels: Record<string, string> }) {
  const tier = getConfidenceTier(suggestion.confidence);
  const tierColor =
    tier === "strong"
      ? "bg-green-100 text-green-800 border-green-300 dark:bg-green-950/40 dark:text-green-300"
      : tier === "probable"
      ? "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-950/40 dark:text-yellow-300"
      : "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/40 dark:text-orange-300";

  const handleCopy = async () => {
    // CLIPBOARD ONLY — aucune écriture cargo / quote_facts / set-case-fact.
    try {
      await navigator.clipboard.writeText(suggestion.pad_category);
      toast.success(`Code PAD ${suggestion.pad_category} copié dans le presse-papiers`);
    } catch {
      toast.error("Impossible d'accéder au presse-papiers");
    }
  };

  return (
    <Card className="border-muted">
      <CardContent className="pt-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className="font-mono text-sm">{suggestion.pad_category}</Badge>
              <span className="text-sm font-medium">{getPadCategoryLabel(suggestion.pad_category, padLabels)}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {suggestion.nst_level === "group" ? "Groupe NST" : "Division NST"}{" "}
              <span className="font-mono">{suggestion.nst_code}</span>
              {" · "}
              {getEvidenceLevelLabel(suggestion.evidence_level)}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={handleCopy} title="Copier le code PAD (presse-papiers uniquement)">
            <Copy className="mr-1 h-3 w-3" />
            Copier
          </Button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {tier && (
            <Badge variant="outline" className={`text-[10px] ${tierColor}`}>
              {CONFIDENCE_TIER_LABELS[tier]} ({(suggestion.confidence * 100).toFixed(0)}%)
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px]">TO_CONFIRM</Badge>
        </div>

        {suggestion.notes && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                <ChevronDown className="h-3 w-3 mr-1" />
                Voir la justification
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-1 text-xs text-muted-foreground">
              <p>{suggestion.notes}</p>
              {(suggestion.source_document || suggestion.source_reference) && (
                <p className="italic">
                  Source : {suggestion.source_document}
                  {suggestion.source_reference ? ` — ${suggestion.source_reference}` : ""}
                </p>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
