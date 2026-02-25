/**
 * P1.1 — Panneau read-only "Multi-demande détectée"
 *
 * Affiche les quote_request_lines si >= 2 lignes détectées.
 * Limité à 5 lignes affichées (protection anti-hallucination IA).
 * Accordion fermé par défaut.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Package, Loader2 } from "lucide-react";

const MAX_DISPLAYED = 5;

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
            <ul className="space-y-2">
              {displayed.map((line: any) => {
                const factsCount = Array.isArray(line.extracted_facts_json)
                  ? line.extracted_facts_json.length
                  : 0;
                const confidence = line.confidence;
                const label = line.line_label || `Ligne ${line.line_index}`;
                const typeHint = line.request_type_hint;

                return (
                  <li
                    key={line.id ?? line.line_index}
                    className="flex items-center gap-2 p-2 rounded-md bg-background border text-sm"
                  >
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
