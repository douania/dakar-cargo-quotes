/**
 * COCKPIT-5 Phase 1+2+11 — Suggestion prudente des partenaires à contacter.
 * Composant autonome avec ses propres queries.
 * Lecture seule + callback onPrefill pour préremplir le formulaire d'ExternalRequestsPanel.
 *
 * COCKPIT-11: derivePurpose utilise le scope détecté comme source prioritaire.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, CheckCircle2, ArrowRight, Mail } from "lucide-react";
import { buildPartnerEmailBody } from "@/lib/partnerEmailTemplate";
import { derivePartnerRequestScope, type PartnerScopeItem } from "@/lib/partnerRequestScope";

interface Props {
  caseId: string;
  threadId?: string | null;
  onPrefill: (partnerName: string, purpose: string, partnerEmail?: string, briefText?: string) => void;
}

/** Normalize for "already contacted" matching: trim + lowercase + collapse spaces */
function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Map between service_types values and scope purposes */
const SERVICE_TYPE_TO_SCOPE: Record<string, string> = {
  freight_maritime: "freight_rate",
  freight_aerien: "air_tariff",
  origin_charges: "origin_charges",
  stuffing_factory: "stuffing_factory",
  stuffing_port_cfs: "stuffing_port_cfs",
};

/**
 * COCKPIT-11: Derive purpose using detected scope as priority source.
 * 1. If scope is detected, find the best match between partner service_types and scope purposes
 * 2. Fallback to legacy heuristic (service_types → role/notes)
 */
function derivePurpose(
  serviceTypes: string[],
  role: string,
  notes: string | null,
  scopePurposes: Set<string>,
): string {
  // Phase 11: try to match partner capabilities to detected scope
  if (scopePurposes.size > 0 && serviceTypes.length > 0) {
    for (const st of serviceTypes) {
      const mapped = SERVICE_TYPE_TO_SCOPE[st] ?? st;
      if (scopePurposes.has(mapped)) return mapped;
    }
  }

  // Phase 2 fallback: service_types without scope context
  if (serviceTypes.length > 0) {
    if (serviceTypes.includes("freight_maritime")) return "freight_rate";
    if (serviceTypes.includes("freight_aerien")) return "air_tariff";
    if (serviceTypes.includes("origin_charges")) return "origin_charges";
    return serviceTypes[0];
  }

  // Phase 1 fallback: heuristic from notes/role
  const n = (notes ?? "").toLowerCase();
  if (n.includes("armateur")) return "freight_rate";
  if (role === "agent") return "origin_charges";
  return "freight_rate";
}

const PURPOSE_LABELS: Record<string, string> = {
  freight_rate: "Taux de fret",
  origin_charges: "Frais d'origine",
  air_tariff: "Tarif aérien",
  freight_maritime: "Fret maritime",
  freight_aerien: "Fret aérien",
  terminal: "Terminal",
  transport_local: "Transport local",
  stuffing_factory: "Empotage usine",
  stuffing_port_cfs: "Empotage port / CFS",
  general: "Général",
};

export function PartnerSuggestionPanel({ caseId, threadId, onPrefill }: Props) {
  // 0. Case facts for brief generation
  const { data: caseFacts = {} } = useQuery({
    queryKey: ["partner-brief-facts", caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_facts")
        .select("fact_key, value_text")
        .eq("case_id", caseId)
        .eq("is_current", true)
        .in("fact_key", [
          "routing.transport_mode", "routing.origin_port", "routing.destination_port",
          "routing.origin_country", "routing.destination_country", "routing.destination_city",
          "routing.final_destination", "routing.incoterm",
          "cargo.description", "cargo.articles_detail", "cargo.container_type",
          "cargo.container_count", "cargo.weight_kg", "cargo.volume_cbm",
          "cargo.fcl_lcl",
          "cargo.hs_code", "cargo.value", "cargo.value_currency",
          "contacts.client_company", "contacts.client_email",
          "timing.loading_date",
        ]);
      if (error) throw error;
      const map: Record<string, string | null> = {};
      for (const row of data ?? []) {
        map[row.fact_key] = row.value_text;
      }
      return map;
    },
    staleTime: 30_000,
  });

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

  // 2. Active partner contacts (Phase 2: includes contact_email, service_types)
  const { data: contacts = [] } = useQuery({
    queryKey: ["partner-suggestion-contacts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("known_business_contacts")
        .select("company_name, default_role, domain_pattern, notes, contact_email, service_types")
        .eq("is_active", true)
        .in("default_role", ["supplier", "partner", "agent"]);
      if (error) throw error;
      return (data ?? []) as Array<{
        company_name: string;
        default_role: string;
        domain_pattern: string | null;
        notes: string | null;
        contact_email: string | null;
        service_types: string[];
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
        // Phase 2: check service_types first
        if (c.service_types.length > 0) {
          return c.service_types.includes("freight_maritime") || c.service_types.includes("origin_charges");
        }
        // Phase 1 fallback
        const n = (c.notes ?? "").toLowerCase();
        return n.includes("armateur") || c.default_role === "agent";
      }
      // Fallback: all active suppliers/partners/agents
      return true;
    })
    .map((c) => ({
      name: c.company_name,
      domain: c.domain_pattern,
      email: c.contact_email,
      role: c.default_role,
      notes: c.notes,
      serviceTypes: c.service_types,
      purpose: derivePurpose(c.service_types, c.default_role, c.notes),
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
            {s.email && (
              <span title={s.email}><Mail className="h-3 w-3 text-muted-foreground shrink-0" /></span>
            )}
            <span className="text-muted-foreground">
              · {PURPOSE_LABELS[s.purpose] ?? s.purpose}
            </span>
            {!s.alreadyContacted && (
              <Button
                size="sm"
                variant="ghost"
                className="h-5 px-1.5 text-[10px]"
                onClick={() => onPrefill(s.name, s.purpose, s.email ?? undefined, buildPartnerEmailBody(caseFacts, s.name, s.purpose))}
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
