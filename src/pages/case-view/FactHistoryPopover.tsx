/**
 * C1.2a — FactHistoryPopover extrait de CaseView.tsx
 * Composant auto-contenu : props simples (caseId, factKey), propre state interne.
 */

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { mapSourceType } from "./helpers";

export function FactHistoryPopover({ caseId, factKey }: { caseId: string; factKey: string }) {
  const cacheKey = `${caseId}::${factKey}`;
  const [historyCache, setHistoryCache] = useState<Record<string, any[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const history = historyCache[cacheKey] ?? [];

  const handleOpen = async (open: boolean) => {
    if (!open) return;
    if (historyCache[cacheKey]) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("quote_facts")
        .select("id, value_text, value_number, value_json, source_type, confidence, created_at")
        .eq("case_id", caseId)
        .eq("fact_key", factKey)
        .eq("is_current", false)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      const result = data ?? [];
      setHistoryCache(prev => ({ ...prev, [cacheKey]: result }));
    } catch {
      setHistoryCache(prev => ({ ...prev, [cacheKey]: [] }));
    } finally {
      setIsLoading(false);
    }
  };

  const formatValue = (h: any) => {
    if (h.value_text != null) return h.value_text;
    if (h.value_number != null) return String(h.value_number);
    if (h.value_json != null) {
      const str = JSON.stringify(h.value_json);
      return str.length > 120 ? str.slice(0, 120) + "…" : str;
    }
    return "—";
  };

  return (
    <Popover onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Historique">
          <Clock className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-h-64 overflow-auto" align="end">
        <p className="font-semibold text-sm mb-2">Historique</p>
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : history.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucune version précédente</p>
        ) : (
          <div className="space-y-2">
            {history.map((h) => (
              <div key={h.id} className="border rounded p-2 space-y-1">
                <p className="text-sm font-medium break-all">{formatValue(h)}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {mapSourceType(h.source_type)}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {h.confidence != null ? `${Math.round(h.confidence * 100)}%` : "—"}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {formatDistanceToNow(new Date(h.created_at), { addSuffix: true, locale: fr })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
