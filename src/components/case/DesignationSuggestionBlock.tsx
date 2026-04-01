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
import { Check, Edit2, Loader2, Search } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { normalizeForMatch, extractTokens } from "@/lib/normalizeForMatch";

interface SuggestionCandidate {
  categoryId: string | null;
  padCategory: string | null;
  label: string;
  score: number;
  reason: string;
  source: "validated_match" | "unvalidated_match" | "reference";
}

interface DesignationSuggestionBlockProps {
  goodsDescription: string;
  caseDocumentId: string;
  /** Build source_reference from available doc fields */
  sourceReference: string;
}

export default function DesignationSuggestionBlock({
  goodsDescription,
  caseDocumentId,
  sourceReference,
}: DesignationSuggestionBlockProps) {
  const queryClient = useQueryClient();
  const [correcting, setCorrecting] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");

  const normInput = normalizeForMatch(goodsDescription);
  const tokens = extractTokens(normInput);

  // Fetch matches (bounded: limit 20 per source)
  const { data: suggestions, isLoading } = useQuery({
    queryKey: ["designation-suggestions", normInput],
    enabled: normInput.length >= 3,
    queryFn: async () => {
      // Source 1: commodity_designation_matches
      const { data: matches } = await supabase
        .from("commodity_designation_matches")
        .select("*")
        .limit(20);

      // Source 2: commodity_categories
      const { data: categories } = await supabase
        .from("commodity_categories")
        .select("*")
        .limit(20);

      const candidates: SuggestionCandidate[] = [];

      // Score matches from designation_matches
      (matches || []).forEach((m) => {
        const obsNorm = normalizeForMatch(m.observed_term || "");
        const termNorm = normalizeForMatch(m.normalized_term || "");

        let matchFound = false;
        let baseScore = (m.match_score as number) || 0.5;

        // Bidirectional matching on observed_term and normalized_term
        if (obsNorm && (obsNorm.includes(normInput) || normInput.includes(obsNorm))) {
          matchFound = true;
        }
        if (termNorm && (termNorm.includes(normInput) || normInput.includes(termNorm))) {
          matchFound = true;
        }

        // Token fallback
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
          // Ranking boost
          let boost = 0;
          if (m.is_validated && obsNorm === normInput) boost = 0.3;
          else if (m.is_validated && termNorm === normInput) boost = 0.2;
          else if (m.is_validated) boost = 0.1;

          candidates.push({
            categoryId: m.commodity_category_id,
            padCategory: m.pad_category_candidate,
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

        // Token fallback on reference
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

      // Deduplicate by categoryId or padCategory, keep highest score
      const deduped = new Map<string, SuggestionCandidate>();
      candidates
        .sort((a, b) => b.score - a.score)
        .forEach((c) => {
          const key = c.categoryId || c.padCategory || c.label;
          if (!deduped.has(key)) deduped.set(key, c);
        });

      return Array.from(deduped.values()).slice(0, 3);
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

  // Upsert mutation with proper source tracing
  const confirmMutation = useMutation({
    mutationFn: async (candidate: SuggestionCandidate) => {
      const normalized = normalizeForMatch(goodsDescription);

      const { data: session } = await supabase.auth.getSession();
      const userId = session?.session?.user?.id || null;

      // Check existing (upsert logic for partial unique indexes)
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

  // Correct with manual category pick
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

  if (!goodsDescription?.trim() || normInput.length < 3) return null;
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="h-3 w-3 animate-spin" />
        Recherche de correspondances...
      </div>
    );
  }
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="border rounded-md p-3 bg-muted/30 space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <Search className="h-3 w-3" />
        Catégories suggérées
      </div>

      {suggestions.map((s, i) => (
        <div key={i} className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Badge
              variant={s.source === "validated_match" ? "default" : "outline"}
              className="text-xs shrink-0"
            >
              {s.padCategory || "—"}
            </Badge>
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
      ))}

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
