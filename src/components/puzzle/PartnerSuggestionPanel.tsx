/**
 * COCKPIT-5 Phase 1 — Suggestion prudente des partenaires à contacter.
 * Composant autonome avec ses propres queries.
 * Lecture seule + callback onPrefill pour préremplir le formulaire d'ExternalRequestsPanel.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, CheckCircle2, ArrowRight } from "lucide-react";

interface Props {
  caseId: string;
  onPrefill: (partnerName: string, purpose: string) => void;
}

/** Normalize for "already contacted" matching: trim + lowercase + collapse spaces */
function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Derive purpose from role/notes */
function derivePurpose(role: string, notes: string | null): string {
  const n = (notes ?? "").toLowerCase();
  if (n.includes("armateur")) return "freight_rate";
  if (role === "agent") return "origin_charges";
  return "freight_rate";
}

const PURPOSE_LABELS: Record<string, string> = {
  freight_rate: "Taux de fret",
  origin_charges: "Frais d'origine",
  air_tariff: "Tarif aérien",
  general: "Général",
};

export function PartnerSuggestionPanel({ caseId, onPrefill }: Props) {
  // 1. Transport mode from quote_facts
  const { data: transportModeFact } = useQuery({
    queryKey: ["partner-suggestion-mode", caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_facts")
        .select("value_text")
        .eq("case_id", caseId)
        .eq("fact_key", "routing.transport_mode")
        .eq("is_current", true)
        .maybeSingle();
      if (error) throw error;
      return data?.value_text ?? null;
    },
    staleTime: 30_000,
  });

  // 2. Active partner contacts
  const { data: contacts = [] } = useQuery({
    queryKey: ["partner-suggestion-contacts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("known_business_contacts")
        .select("company_name, default_role, domain_pattern, notes")
        .eq("is_active", true)
        .in("default_role", ["supplier", "partner", "agent"]);
      if (error) throw error;
      return (data ?? []) as Array<{
        company_name: string;
        default_role: string;
        domain_pattern: string | null;
        notes: string | null;
      }>;
    },
    staleTime: 60_000,
  });

  // 3. Existing requests for "already contacted" detection
  const { data: existingRequests = [] } = useQuery({
    queryKey: ["partner-suggestion-existing", caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("external_quote_requests")
        .select("partner_name")
        .eq("case_id", caseId);
      if (error) throw error;
      return (data ?? []) as Array<{ partner_name: string }>;
    },
    staleTime: 30_000,
  });

  // Build already-contacted set (normalized)
  const contactedNames = new Set(existingRequests.map((r) => norm(r.partner_name)));

  // Filter contacts by transport mode
  const transportMode = transportModeFact?.toLowerCase() ?? "";
  const isMaritime = transportMode.includes("marit") || transportMode.includes("sea") || transportMode.includes("mer");

  const suggested = contacts
    .filter((c) => {
      if (isMaritime) {
        const n = (c.notes ?? "").toLowerCase();
        return n.includes("armateur") || c.default_role === "agent";
      }
      // Fallback: all active suppliers/partners/agents
      return true;
    })
    .map((c) => ({
      name: c.company_name,
      domain: c.domain_pattern,
      role: c.default_role,
      notes: c.notes,
      purpose: derivePurpose(c.default_role, c.notes),
      alreadyContacted: contactedNames.has(norm(c.company_name)),
    }))
    // Sort: not-yet-contacted first
    .sort((a, b) => (a.alreadyContacted === b.alreadyContacted ? 0 : a.alreadyContacted ? 1 : -1));

  if (suggested.length === 0) return null;

  const notContactedCount = suggested.filter((s) => !s.alreadyContacted).length;

  return (
    <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Partenaires suggérés
        </span>
        {notContactedCount > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            {notContactedCount} à contacter
          </Badge>
        )}
        {isMaritime && (
          <Badge variant="outline" className="text-[10px]">
            Transport maritime
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {suggested.map((s) => (
          <div
            key={s.name}
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
              s.alreadyContacted
                ? "bg-muted/50 text-muted-foreground border-muted"
                : "bg-background border-border"
            }`}
          >
            {s.alreadyContacted && (
              <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400 shrink-0" />
            )}
            <span className={s.alreadyContacted ? "line-through" : "font-medium"}>
              {s.name}
            </span>
            <span className="text-muted-foreground">
              · {PURPOSE_LABELS[s.purpose] ?? s.purpose}
            </span>
            {!s.alreadyContacted && (
              <Button
                size="sm"
                variant="ghost"
                className="h-5 px-1.5 text-[10px]"
                onClick={() => onPrefill(s.name, s.purpose)}
              >
                <ArrowRight className="h-3 w-3" />
                Préremplir
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
