/**
 * COCKPIT-5 Phase 1+2+11 + P2-D — Suggestion prudente des partenaires à contacter.
 * P2-D: Consomme useServiceScope + qualifyScope pour les règles de promotion.
 *
 * Règles de surface (promotion) :
 *   confirmed    → CTA "Préremplir" actif, style normal
 *   unconfirmed  → visible, badge "provisoire", PAS de CTA engageant
 *   out_of_scope → opacity-60, badge "hors scope", PAS de CTA, non compté
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, CheckCircle2, ArrowRight, Mail } from "lucide-react";
import { buildPartnerEmailBody } from "@/lib/partnerEmailTemplate";
import { derivePartnerRequestScope, type PartnerScopeItem } from "@/lib/partnerRequestScope";
import { buildFactMapWithSynthetics } from "@/lib/extractContainerSynthetics";
import { useServiceScope } from "@/hooks/useServiceScope";
import { qualifyScope, isServiceOutOfScope } from "@/lib/scopeQualification";
import { statusAtLeast } from "@/lib/cockpitStatusConstants";
import { useCockpitState } from "@/hooks/useCockpitState";

interface Props {
  caseId: string;
  threadId?: string | null;
  onPrefill: (partnerName: string, purpose: string, partnerEmail?: string, briefText?: string) => void;
}

/** Normalize for "already contacted" matching */
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

/** Map purpose → service for scope qualification lookup */
const PURPOSE_TO_SERVICE: Record<string, string> = {
  freight_rate: "freight",
  air_tariff: "freight",
  origin_charges: "customs",
  general: "freight", // fallback check
};

function derivePurpose(
  serviceTypes: string[],
  role: string,
  notes: string | null,
  scopePurposes: Set<string>,
  freightScope?: boolean | null,
): string {
  if (scopePurposes.size > 0 && serviceTypes.length > 0) {
    for (const st of serviceTypes) {
      const mapped = SERVICE_TYPE_TO_SCOPE[st] ?? st;
      if (scopePurposes.has(mapped)) return mapped;
    }
  }
  if (serviceTypes.length > 0) {
    if (serviceTypes.includes("freight_maritime")) return freightScope === false ? "general" : "freight_rate";
    if (serviceTypes.includes("freight_aerien")) return freightScope === false ? "general" : "air_tariff";
    if (serviceTypes.includes("origin_charges")) return "origin_charges";
    return serviceTypes[0];
  }
  const n = (notes ?? "").toLowerCase();
  if (n.includes("armateur")) return freightScope === false ? "general" : "freight_rate";
  if (role === "agent") return "origin_charges";
  return freightScope === false ? "general" : "freight_rate";
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
  // P2-D: centralized service scope
  const { data: serviceScope } = useServiceScope(caseId);
  const { data: cockpitState } = useCockpitState(caseId);
  const freightScope = serviceScope?.freightScope ?? undefined;

  // 0. Case facts for brief generation
  const { data: caseFacts = {} } = useQuery({
    queryKey: ["partner-brief-facts", caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_facts")
        .select("fact_key, value_text, value_number, value_json")
        .eq("case_id", caseId)
        .eq("is_current", true)
        .in("fact_key", [
          "routing.transport_mode", "routing.origin_port", "routing.destination_port",
          "routing.origin_country", "routing.destination_country", "routing.destination_city",
          "routing.final_destination", "routing.incoterm",
          "cargo.description", "cargo.articles_detail", "cargo.container_type",
          "cargo.container_count", "cargo.weight_kg", "cargo.volume_cbm",
          "cargo.fcl_lcl", "cargo.containers",
          "cargo.hs_code", "cargo.value", "cargo.value_currency",
          "contacts.client_company", "contacts.client_email",
          "timing.loading_date",
        ]);
      if (error) throw error;
      return buildFactMapWithSynthetics(data ?? []);
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

  // 2. Active partner contacts
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

  const contactedNames = new Set(existingRequests.map((r) => norm(r.partner_name)));

  // P2-D: Qualified scope
  const qualifiedScope = useMemo(
    () => qualifyScope({
      serviceScope: serviceScope ?? null,
      facts: caseFacts,
      caseStatus: cockpitState?.status ?? "INTAKE",
    }),
    [serviceScope, caseFacts, cockpitState?.status],
  );

  // Derive partner request scope items
  const scope = useMemo(
    () => derivePartnerRequestScope({ facts: caseFacts, freightScope }),
    [caseFacts, freightScope],
  );
  const scopePurposes = useMemo(
    () => new Set(scope.map((s) => s.purpose)),
    [scope],
  );

  // P2-D: Status gate — if priced and no existing requests, hide panel entirely
  const status = cockpitState?.status ?? "INTAKE";
  const totalPartnerRequests = cockpitState?.totalPartnerRequests ?? 0;
  if (statusAtLeast(status, "PRICED_DRAFT") && totalPartnerRequests === 0) {
    return null;
  }
  const isPostPricing = statusAtLeast(status, "PRICED_DRAFT");

  // Filter contacts by transport mode
  const transportMode = transportModeFact?.toLowerCase() ?? "";
  const isMaritime = transportMode.includes("marit") || transportMode.includes("sea") || transportMode.includes("mer");

  const suggested = contacts
    .filter((c) => {
      if (isMaritime) {
        if (c.service_types.length > 0) {
          return c.service_types.includes("freight_maritime") || c.service_types.includes("origin_charges");
        }
        const n = (c.notes ?? "").toLowerCase();
        return n.includes("armateur") || c.default_role === "agent";
      }
      return true;
    })
    .map((c) => {
      const purpose = derivePurpose(c.service_types, c.default_role, c.notes, scopePurposes, freightScope);
      const relatedService = PURPOSE_TO_SERVICE[purpose] ?? "freight";
      const serviceItem = qualifiedScope.items.find((i) => i.service === relatedService);
      const qualification = serviceItem?.qualification ?? "unconfirmed";

      return {
        name: c.company_name,
        domain: c.domain_pattern,
        email: c.contact_email,
        role: c.default_role,
        notes: c.notes,
        serviceTypes: c.service_types,
        purpose,
        qualification,
        outOfScope: qualification === "out_of_scope",
        unconfirmed: qualification === "unconfirmed",
        alreadyContacted: contactedNames.has(norm(c.company_name)),
      };
    })
    .sort((a, b) => {
      if (a.outOfScope !== b.outOfScope) return a.outOfScope ? 1 : -1;
      if (a.unconfirmed !== b.unconfirmed) return a.unconfirmed ? 1 : -1;
      return a.alreadyContacted === b.alreadyContacted ? 0 : a.alreadyContacted ? 1 : -1;
    });

  if (suggested.length === 0) return null;

  // Count only confirmed + not-yet-contacted for the "à contacter" badge
  const notContactedCount = suggested.filter(
    (s) => !s.alreadyContacted && !s.outOfScope && !s.unconfirmed,
  ).length;

  // P2-D: Can we show engaging CTAs?
  const canPromote = !isPostPricing;

  return (
    <div className={`border rounded-lg p-3 bg-muted/30 space-y-2 ${isPostPricing ? "opacity-50" : ""}`}>
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
        {isPostPricing && (
          <Badge variant="outline" className="text-[10px] border-muted-foreground/30">
            Phase consolidation
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {suggested.map((s) => {
          const canShowCTA = canPromote && !s.alreadyContacted && !s.outOfScope && !s.unconfirmed;

          return (
            <div
              key={s.name}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                s.outOfScope
                  ? "bg-muted/30 text-muted-foreground border-muted opacity-60"
                  : s.unconfirmed
                    ? "bg-muted/20 text-muted-foreground border-muted/80"
                    : s.alreadyContacted
                      ? "bg-muted/50 text-muted-foreground border-muted"
                      : "bg-background border-border"
              }`}
            >
              {s.alreadyContacted && !s.outOfScope && (
                <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
              )}
              <span className={s.alreadyContacted ? "line-through" : s.outOfScope ? "" : "font-medium"}>
                {s.name}
              </span>
              {s.outOfScope && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 border-muted-foreground/30 text-muted-foreground">
                  hors scope
                </Badge>
              )}
              {s.unconfirmed && !s.outOfScope && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 border-muted-foreground/30 text-muted-foreground">
                  provisoire
                </Badge>
              )}
              {s.email && (
                <span title={s.email}><Mail className="h-3 w-3 text-muted-foreground shrink-0" /></span>
              )}
              <span className="text-muted-foreground">
                · {PURPOSE_LABELS[s.purpose] ?? s.purpose}
              </span>
              {canShowCTA && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 px-1.5 text-[10px]"
                  onClick={() => onPrefill(s.name, s.purpose, s.email ?? undefined, buildPartnerEmailBody(caseFacts, s.name, s.purpose, undefined, scope))}
                >
                  <ArrowRight className="h-3 w-3" />
                  Préremplir
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
