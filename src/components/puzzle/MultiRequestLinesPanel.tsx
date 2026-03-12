/**
 * P1.1 — Panneau read-only "Multi-demande détectée"
 * P1a  — Alert + per-line facts display
 *
 * Affiche les quote_request_lines si >= 2 lignes détectées.
 * Limité à 5 lignes affichées (protection anti-hallucination IA).
 * Accordion fermé par défaut.
 * P1a: amber alert + per-line key facts from extracted_facts_json.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Package, AlertTriangle } from "lucide-react";

const MAX_DISPLAYED = 5;

/** Fact keys displayed per line (from extracted_facts_json) */
const PER_LINE_DISPLAY_KEYS = new Set([
  "cargo.weight_kg",
  "cargo.pieces_count",
  "cargo.description",
]);

interface Props {
  caseId: string;
}

export function MultiRequestLinesPanel({ caseId }: Props) {
  const { data: lines = [], isLoading } = useQuery({
    queryKey: ["quote-request-lines", caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_request_lines" as any)
        .select("*")
        .eq("case_id", caseId)
        .order("line_index", { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!caseId,
    staleTime: 60000,
  });

  if (isLoading) return null;
  if (lines.length < 2) return null;

  const displayed = lines.slice(0, MAX_DISPLAYED);
  const totalCount = lines.length;

  return (
    <div className="mb-6">
      <Accordion type="single" collapsible>
        <AccordionItem value="multi-request" className="border rounded-lg bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
          <AccordionTrigger className="px-4 py-3 hover:no-underline">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-blue-600" />
              <span className="font-semibold text-sm text-blue-800 dark:text-blue-200">
                Multi-demande détectée ({totalCount} lignes)
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            {/* P1a — Amber warning about global facts */}
            <Alert className="mb-3 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-xs text-amber-800 dark:text-amber-200">
                Dossier multi-lot : les facts globaux (poids, colis, mode) reflètent le dernier lot traité, pas l'ensemble.
                Fiez-vous aux détails par ligne ci-dessous.
              </AlertDescription>
            </Alert>

            <ul className="space-y-2">
              {displayed.map((line: any) => {
                const extractedFacts = Array.isArray(line.extracted_facts_json)
                  ? (line.extracted_facts_json as Array<{ key: string; value: string | number }>)
                  : [];
                const factsCount = extractedFacts.length;
                const confidence = line.confidence;
                const label = line.line_label || `Ligne ${line.line_index}`;
                // P1a: prefer request_type_hint for mode display
                const typeHint = line.request_type_hint;

                // P1a: per-line key facts
                const keyFacts = extractedFacts.filter(f => PER_LINE_DISPLAY_KEYS.has(f.key));

                return (
                  <li
                    key={line.id ?? line.line_index}
                    className="p-2 rounded-md bg-background border text-sm space-y-1"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs font-mono shrink-0">
                        #{line.line_index}
                      </Badge>
                      <span className="flex-1 truncate">{label}</span>
                      {typeHint && (
                        <Badge variant="secondary" className="text-xs">
                          {typeHint}
                        </Badge>
                      )}
                      {confidence != null && (
                        <Badge
                          variant={confidence >= 0.8 ? "default" : "outline"}
                          className="text-xs"
                        >
                          {Math.round(confidence * 100)}%
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground shrink-0">
                        {factsCount} fact{factsCount !== 1 ? "s" : ""}
                      </span>
                    </div>

                    {/* P1a: per-line key facts display */}
                    {keyFacts.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 ml-8">
                        {keyFacts.map((f, i) => {
                          const shortKey = f.key.split(".").pop() ?? f.key;
                          return (
                            <span
                              key={i}
                              className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded"
                            >
                              {shortKey}: {String(f.value)}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {totalCount > MAX_DISPLAYED && (
              <p className="text-xs text-muted-foreground mt-2">
                {MAX_DISPLAYED} lignes affichées / {totalCount} détectées
              </p>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
