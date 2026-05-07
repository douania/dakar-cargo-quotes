import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, Edit2, FileInput, Loader2, Search, Sparkles } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { normalizeForMatch, extractTokens } from "@/lib/normalizeForMatch";
import { expandTokensWithSynonyms } from "@/lib/commoditySynonyms";

interface SuggestionCandidate {
  categoryId: string | null;
  padCategory: string | null;
  label: string;
  score: number;
  reason: string;
  source: "validated_match" | "unvalidated_match" | "reference" | "pad_official_alias";
}

interface AIRecommendation {
  pad_category: string;
  confidence: string;
  justification_fr: string;
  matching_aliases: string[];
  pad_rate_fcfa_per_ton: number | null;
  requires_operator_confirmation: boolean;
  is_conservative_pick: boolean;
}

interface AIResponse {
  qualification: string;
  recommendations: AIRecommendation[];
  conservative_category: string | null;
  message?: string;
}

interface DesignationSuggestionBlockProps {
  goodsDescription: string;
  caseDocumentId: string;
  caseId: string;
  sourceReference: string;
}

export default function DesignationSuggestionBlock({
  goodsDescription,
  caseDocumentId,
  caseId,
  sourceReference,
}: DesignationSuggestionBlockProps) {
  const queryClient = useQueryClient();
  const [correcting, setCorrecting] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [aiResult, setAiResult] = useState<AIResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const normInput = normalizeForMatch(goodsDescription);
  const rawTokens = extractTokens(normInput);
  const tokens = expandTokensWithSynonyms(rawTokens);

  // Fetch matches (bounded)
  const { data: suggestions, isLoading } = useQuery({
    queryKey: ["designation-suggestions", normInput],
    enabled: normInput.length >= 3,
    queryFn: async () => {
      // Source 1: commodity_designation_matches
      const { data: matches } = await supabase
        .from("commodity_designation_matches")
        .select("*")
        .limit(200);

      // Source 2: commodity_categories
      const { data: categories } = await supabase
        .from("commodity_categories")
        .select("*")
        .limit(50);

      // Source 3: pad_designation_aliases (PAD-R1A)
      const { data: padAliases } = await supabase
        .from("pad_designation_aliases")
        .select("normalized_term, bl_term, pad_category, commodity_category_id, source_type, is_validated")
        .eq("is_validated", true)
        .order("normalized_term");

      const candidates: SuggestionCandidate[] = [];

      // Build categoryId -> pad_category map
      const categoryPadMap = new Map(
        (categories || [])
          .filter((c) => c.id && c.pad_category)
          .map((c) => [c.id, c.pad_category] as const)
      );

      // Score matches from designation_matches
      (matches || []).forEach((m) => {
        const obsNorm = normalizeForMatch(m.observed_term || "");
        const termNorm = normalizeForMatch(m.normalized_term || "");

        let matchFound = false;
        let baseScore = (m.match_score as number) || 0.5;

        if (obsNorm && (obsNorm.includes(normInput) || normInput.includes(obsNorm))) {
          matchFound = true;
        }
        if (termNorm && (termNorm.includes(normInput) || normInput.includes(termNorm))) {
          matchFound = true;
        }

        if (!matchFound && tokens.length > 0) {
          const tokenHits = tokens.filter(
            (t) => obsNorm.includes(t) || termNorm.includes(t)
          );
          if (tokenHits.length > 0) {
            matchFound = true;
            baseScore = Math.min(baseScore, 0.4 + tokenHits.length * 0.1);
          }
        }

        if (matchFound) {
          let boost = 0;
          if (m.is_validated && obsNorm === normInput) boost = 0.3;
          else if (m.is_validated && termNorm === normInput) boost = 0.2;
          else if (m.is_validated) boost = 0.1;

          const resolvedPadCategory =
            m.pad_category_candidate ||
            (m.commodity_category_id
              ? categoryPadMap.get(m.commodity_category_id) ?? null
              : null);

          candidates.push({
            categoryId: m.commodity_category_id,
            padCategory: resolvedPadCategory,
            label: m.observed_term,
            score: Math.min(1, baseScore + boost),
            reason: m.match_reason || (m.is_validated ? "Correspondance validée" : "Correspondance observée"),
            source: m.is_validated ? "validated_match" : "unvalidated_match",
          });
        }
      });

      // Score from commodity_categories (reference fallback)
      (categories || []).forEach((c) => {
        const rawNorm = normalizeForMatch(c.designation_raw || "");
        const desNorm = normalizeForMatch(c.designation_normalized || "");

        let matchFound = false;

        if (rawNorm && (rawNorm.includes(normInput) || normInput.includes(rawNorm))) {
          matchFound = true;
        }
        if (desNorm && (desNorm.includes(normInput) || normInput.includes(desNorm))) {
          matchFound = true;
        }

        if (!matchFound && tokens.length > 0) {
          const tokenHits = tokens.filter(
            (t) => rawNorm.includes(t) || desNorm.includes(t)
          );
          if (tokenHits.length > 0) matchFound = true;
        }

        if (matchFound) {
          candidates.push({
            categoryId: c.id,
            padCategory: c.pad_category,
            label: c.designation_normalized || c.designation_raw,
            score: 0.5,
            reason: `Référentiel officiel${c.pad_category ? ` (${c.pad_category})` : ""}`,
            source: "reference",
          });
        }
      });

      // Source 3: Score from pad_designation_aliases (PAD-R1A)
      (padAliases || []).forEach((a) => {
        const aliasNorm = normalizeForMatch(a.normalized_term || "");
        const blNorm = normalizeForMatch(a.bl_term || "");

        let matchFound = false;
        let score = 0.3;

        // Exact match
        if (aliasNorm === normInput || blNorm === normInput) {
          matchFound = true;
          score = 0.95;
        }

        // Substring match
        if (!matchFound) {
          if (aliasNorm && (aliasNorm.includes(normInput) || normInput.includes(aliasNorm))) {
            matchFound = true;
            score = 0.7;
          }
          if (blNorm && (blNorm.includes(normInput) || normInput.includes(blNorm))) {
            matchFound = true;
            score = 0.7;
          }
        }

        // Token match with synonym expansion
        if (!matchFound && tokens.length > 0) {
          const tokenHits = tokens.filter(
            (t) => aliasNorm.includes(t) || blNorm.includes(t)
          );
          if (tokenHits.length > 0) {
            matchFound = true;
            const maxTokens = Math.max(tokens.length, 1);
            score = 0.3 + (tokenHits.length / maxTokens) * 0.5;
          }
        }

        if (matchFound) {
          // Boost for official_nomenclature
          if (a.source_type === "official_nomenclature") {
            score = Math.min(1, score + 0.1);
          }

          candidates.push({
            categoryId: a.commodity_category_id,
            padCategory: a.pad_category,
            label: a.normalized_term,
            score,
            reason: `Alias PAD officiel (${a.pad_category})`,
            source: "pad_official_alias",
          });
        }
      });

      // Deduplicate by categoryId or padCategory, keep highest score
      const deduped = new Map<string, SuggestionCandidate>();
      candidates
        .sort((a, b) => b.score - a.score)
        .forEach((c) => {
          const key = c.categoryId || c.padCategory || c.label;
          if (!deduped.has(key)) deduped.set(key, c);
        });

      return Array.from(deduped.values()).slice(0, 5);
    },
  });

  // --- PAD official rate lookup ---
  const detectedPadCodes = Array.from(
    new Set(
      (suggestions || [])
        .map((s) => s.padCategory)
        .filter((c): c is string => !!c)
    )
  ).sort();

  const { data: padRates } = useQuery({
    queryKey: ["pad-official-rates", detectedPadCodes],
    enabled: detectedPadCodes.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("port_tariffs")
        .select("classification, amount, unit, source_document, evidence_level")
        .eq("provider", "PAD")
        .eq("category", "DROIT_PASSAGE")
        .eq("operation_type", "IMPORT")
        .eq("is_active", true)
        .in("classification", detectedPadCodes);
      if (error) throw error;
      const map: Record<string, { amount: number; unit: string; source_document: string | null; evidence_level: string | null }> = {};
      (data || []).forEach((r) => {
        map[r.classification] = { amount: r.amount, unit: r.unit, source_document: r.source_document, evidence_level: r.evidence_level };
      });
      return map;
    },
  });

  // Categories for correction picker
  const { data: allCategories } = useQuery({
    queryKey: ["commodity-categories-list"],
    enabled: correcting,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("commodity_categories")
        .select("id, designation_raw, designation_normalized, pad_category")
        .order("designation_normalized");
      if (error) throw error;
      return data;
    },
  });

  // --- AI recommendation (PAD-R1B) ---
  const requestAIRecommendation = async () => {
    setAiLoading(true);
    setAiResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("recommend-pad-category", {
        body: {
          goods_description: goodsDescription.trim(),
          context_hints: [], // Minimized: no client names sent
        },
      });
      if (error) throw error;
      if (data?.error) {
        toast({ title: "Erreur IA", description: data.error, variant: "destructive" });
        return;
      }
      setAiResult(data as AIResponse);
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message || "Échec de la recommandation IA", variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  };

  // Upsert mutation with proper source tracing
  const confirmMutation = useMutation({
    mutationFn: async (candidate: SuggestionCandidate) => {
      const normalized = normalizeForMatch(goodsDescription);

      const { data: session } = await supabase.auth.getSession();
      const userId = session?.session?.user?.id || null;

      let existingId: string | null = null;
      if (candidate.categoryId) {
        const { data } = await supabase
          .from("commodity_designation_matches")
          .select("id")
          .eq("normalized_term", normalized)
          .eq("commodity_category_id", candidate.categoryId)
          .maybeSingle();
        existingId = data?.id || null;
      } else if (candidate.padCategory) {
        const { data } = await supabase
          .from("commodity_designation_matches")
          .select("id")
          .eq("normalized_term", normalized)
          .eq("pad_category_candidate", candidate.padCategory)
          .is("commodity_category_id", null)
          .maybeSingle();
        existingId = data?.id || null;
      }

      const payload = {
        observed_term: goodsDescription.trim(),
        normalized_term: normalized,
        commodity_category_id: candidate.categoryId,
        pad_category_candidate: candidate.padCategory,
        match_score: candidate.score,
        match_reason: candidate.reason,
        match_method: "operator_correction",
        source_type: "operator_correction" as const,
        source_document_id: caseDocumentId,
        source_reference: sourceReference || null,
        is_validated: true,
        validated_by: userId,
        validated_at: new Date().toISOString(),
      };

      if (existingId) {
        const { error } = await supabase
          .from("commodity_designation_matches")
          .update(payload)
          .eq("id", existingId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("commodity_designation_matches")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["designation-suggestions"] });
      toast({ title: "Correspondance validée et enregistrée" });
      setCorrecting(false);
    },
    onError: (err: any) => {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    },
  });

  // --- Apply to dossier mutation (existing behavior — UNCHANGED per CTO) ---
  const applyToDossierMutation = useMutation({
    mutationFn: async (candidate: SuggestionCandidate) => {
      await supabase.functions.invoke("set-case-fact", {
        body: {
          case_id: caseId,
          fact_key: "cargo.pad_category",
          value_text: candidate.padCategory,
        },
      });

      const rate = candidate.padCategory ? padRates?.[candidate.padCategory] : null;
      if (rate) {
        await supabase.functions.invoke("set-case-fact", {
          body: {
            case_id: caseId,
            fact_key: "cargo.pad_rate_fcfa_per_ton",
            value_number: rate.amount,
          },
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["case-facts", caseId] });
      queryClient.invalidateQueries({ queryKey: ["quote_facts"] });
      toast({ title: "Catégorie PAD appliquée au dossier" });
    },
    onError: (err: any) => {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    },
  });

  const handleCorrect = () => {
    if (!selectedCategoryId) return;
    const cat = allCategories?.find((c) => c.id === selectedCategoryId);
    if (!cat) return;
    confirmMutation.mutate({
      categoryId: cat.id,
      padCategory: cat.pad_category,
      label: cat.designation_normalized || cat.designation_raw,
      score: 1.0,
      reason: "Correction manuelle opérateur",
      source: "validated_match",
    });
  };

  // Check if local suggestions are weak (best score < 0.5)
  const bestLocalScore = Math.max(0, ...(suggestions || []).map((s) => s.score));
  const showAIButton = bestLocalScore < 0.5 && !aiResult;

  if (!goodsDescription?.trim() || normInput.length < 3) return null;
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="h-3 w-3 animate-spin" />
        Recherche de correspondances...
      </div>
    );
  }

  const hasAnySuggestion = (suggestions && suggestions.length > 0) || aiResult;
  if (!hasAnySuggestion && !showAIButton) return null;

  return (
    <div className="border rounded-md p-3 bg-muted/30 space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <Search className="h-3 w-3" />
        Catégories suggérées
      </div>

      {/* Local suggestions */}
      {(suggestions || []).map((s, i) => {
        const rate = s.padCategory ? padRates?.[s.padCategory] : null;
        return (
          <div key={i} className="space-y-0.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Badge
                  variant={s.source === "validated_match" ? "default" : s.source === "pad_official_alias" ? "secondary" : "outline"}
                  className="text-xs shrink-0"
                >
                  {s.padCategory || "—"}
                </Badge>
                {s.source === "pad_official_alias" && (
                  <Badge variant="outline" className="text-[10px] shrink-0 border-primary/30 text-primary">
                    PAD officiel
                  </Badge>
                )}
                <span className="truncate">{s.label}</span>
                <span className="text-muted-foreground shrink-0">
                  {Math.round(s.score * 100)}%
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                disabled={confirmMutation.isPending}
                onClick={() => confirmMutation.mutate(s)}
              >
                <Check className="h-3 w-3 mr-1" />
                Confirmer
              </Button>
            </div>
            {s.padCategory && (
              <div className="pl-6 flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground flex-1">
                  {rate ? (
                    <>
                      └ Droit de passage PAD : {Number(rate.amount).toLocaleString("fr-FR")} FCFA/t
                      {rate.evidence_level === "official" && (
                        <span className="ml-1 text-primary">· Source officielle</span>
                      )}
                    </>
                  ) : (
                    <>└ Pas de barème PAD trouvé pour {s.padCategory}</>
                  )}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-5 px-2 text-[10px] shrink-0"
                  disabled={applyToDossierMutation.isPending}
                  onClick={() => applyToDossierMutation.mutate(s)}
                >
                  <FileInput className="h-3 w-3 mr-1" />
                  Appliquer au dossier
                </Button>
              </div>
            )}
          </div>
        );
      })}

      {/* AI Recommendation Button (PAD-R1C) — only when local suggestions are weak */}
      {showAIButton && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-3 text-xs w-full border-amber-500/30 text-amber-700 hover:bg-amber-50"
          disabled={aiLoading}
          onClick={requestAIRecommendation}
        >
          {aiLoading ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3 mr-1" />
          )}
          {aiLoading ? "Analyse IA en cours..." : "Demander une suggestion IA"}
        </Button>
      )}

      {/* AI Recommendations display (PAD-R1C) */}
      {aiResult && (
        <div className="border border-amber-300/50 rounded-md p-2 bg-amber-50/30 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-700">
            <Sparkles className="h-3 w-3" />
            Estimé IA — À confirmer par opérateur
          </div>
          {aiResult.recommendations.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {aiResult.message || "Aucune catégorie PAD plausible identifiée."}
            </p>
          )}
          {aiResult.recommendations.map((rec, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Badge className="text-xs shrink-0 bg-amber-500 hover:bg-amber-600">
                    {rec.pad_category}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] shrink-0 border-amber-400 text-amber-700">
                    Estimé IA
                  </Badge>
                  {rec.is_conservative_pick && (
                    <Badge variant="outline" className="text-[10px] shrink-0 border-orange-400 text-orange-700">
                      Conservateur
                    </Badge>
                  )}
                  <span className="text-muted-foreground shrink-0 capitalize">
                    {rec.confidence}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  disabled={confirmMutation.isPending}
                  onClick={() =>
                    confirmMutation.mutate({
                      categoryId: null,
                      padCategory: rec.pad_category,
                      label: rec.matching_aliases[0] || rec.pad_category,
                      score: rec.confidence === "high" ? 0.8 : rec.confidence === "medium" ? 0.6 : 0.4,
                      reason: `Recommandation IA confirmée : ${rec.justification_fr}`,
                      source: "validated_match",
                    })
                  }
                >
                  <Check className="h-3 w-3 mr-1" />
                  Confirmer
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground pl-2">
                {rec.justification_fr}
              </p>
              {rec.matching_aliases.length > 0 && (
                <p className="text-[10px] text-muted-foreground pl-2">
                  Alias proches : {rec.matching_aliases.join(", ")}
                </p>
              )}
              {rec.pad_rate_fcfa_per_ton != null && (
                <p className="text-[11px] text-muted-foreground pl-2">
                  └ Droit de passage PAD : {Number(rec.pad_rate_fcfa_per_ton).toLocaleString("fr-FR")} FCFA/t
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Correct button */}
      {!correcting ? (
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-xs w-full"
          onClick={() => setCorrecting(true)}
        >
          <Edit2 className="h-3 w-3 mr-1" />
          Corriger — choisir une autre catégorie
        </Button>
      ) : (
        <div className="flex gap-2">
          <Select value={selectedCategoryId} onValueChange={setSelectedCategoryId}>
            <SelectTrigger className="h-7 text-xs flex-1">
              <SelectValue placeholder="Choisir catégorie..." />
            </SelectTrigger>
            <SelectContent>
              {allCategories?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.pad_category ? `${c.pad_category} — ` : ""}
                  {c.designation_normalized || c.designation_raw}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={!selectedCategoryId || confirmMutation.isPending}
            onClick={handleCorrect}
          >
            OK
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setCorrecting(false)}
          >
            ✕
          </Button>
        </div>
      )}
    </div>
  );
}
