// F2-deploy-verify: 2026-03-27 runtime proof for M24b
/**
 * Phase 11: run-pricing
 * Executes deterministic pricing via quotation-engine
 * CTO Update: Now requires ACK_READY_FOR_PRICING status (Phase 10 gate)
 * CTO Fixes: Atomic run_number, Status rollback compensation, Blocking gaps guard
 * Phase 16: Hard guard unifié + coherence checks (no gap upsert, audit trail preserved)
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { resolvePadClassification } from "../_shared/pad/resolvePadClassification.ts";
import {
  isLocalTransportDebours,
  isLocalTransportRateSource,
  withLocalTransportDebours,
} from "../_shared/local-transport-debours.ts";
import { computeCommercialTotals } from "./commercial-totals.ts";
import {
  PAD_SCOPE_SERVICE_KEYS,
  type PadScopeFact,
  readPadPricingInputs,
  resolvePadScopeBlocker,
} from "../_shared/pad-scope-blocker.ts";
// Garde terminal (doctrine 2026-08-25) : décision PURE et partagée, cf. le module.
import {
  resolveTerminalOperationBlockers,
  TERMINAL_OPERATION_MODE_FACT_KEY,
  terminalOperationBlockerMessage,
  type TerminalScopeFact,
} from "../_shared/terminal-operation-mode.ts";
// P5 helpers moved verbatim to _shared so build-case-puzzle computes the SAME
// effectiveServiceKeys before calling resolvePadScopeBlocker (no doctrine change).
import {
  PACKAGE_SERVICE_DEFAULT_UNITS,
  readOverridesFromFacts,
  resolveEffectiveServiceKeys,
  resolveExplicitlyRemovedServiceKeys,
  SERVICE_PACKAGES,
} from "../_shared/service-scope.ts";
// ═══ P1-B2 — consommation des décisions humaines maritimes ═══
// Toute la doctrine (table close des correspondances, fraîcheur, dédoublonnage,
// codes de blocage) vit dans le module PUR ci-dessous ; run-pricing ne fait que
// lire le registre et appliquer le plan retourné.
import {
  buildMaritimeFeeConsumption,
  hasActiveMaritimeDecision,
  MARITIME_FEE_DECISION_BLOCKER_MESSAGES,
  MARITIME_FEE_DECISION_MULTI_LOT_UNSUPPORTED,
  MARITIME_FEE_DECISION_READ_FAILED,
  type MaritimeFeeConsumptionResult,
  type MaritimeFeeDecisionRow,
} from "../_shared/maritime-fee-decisions/pricing-consumption.ts";
import {
  computeCurrentProposalIdentities,
  type CurrentProposalIdentity,
} from "../_shared/maritime-fee-decisions/proposal-identity.ts";
import {
  buildMaritimeFeeProposals,
  type Parametrage,
} from "../_shared/maritime-fee-proposals/engine.ts";
import maritimeParametrageJson from "../_shared/maritime-fee-proposals/dcq_pad_parametrage.json" with {
  type: "json",
};
import { mapFactsToMaritimeInput } from "../_shared/maritime-fee-proposals/fact-mapping.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface RunPricingRequest {
  case_id: string;
}

interface PricingInputs {
  originPort?: string;
  originAirport?: string;
  destinationPort?: string;
  destinationAirport?: string;
  finalDestination?: string;
  incoterm?: string;
  servicePackage?: string;
  containers?: Array<{ type: string; quantity: number; coc_soc?: string }>;
  cargoWeight?: number;
  cargoVolume?: number;
  cargoValue?: number;
  cargoValueCurrency?: string;
  cargoDescription?: string;
  carrier?: string;
  clientEmail?: string;
  clientCompany?: string;
  hsCode?: string;
  cnCode?: string;
  nhmCode?: string;
  nstCode?: string;
  nstrCode?: string;
  articlesDetail?: Array<{ hs_code: string; value: number; currency: string; description?: string }>;
  regimeCode?: string;
  exemptionTitle?: string;
  // P0 CAF strict: fret réel obligatoire pour FOB/FCA/FAS/EXW
  freightCost?: number;
  freightCurrency?: string;
  // Phase 3: PAD droit de passage (fact-based, mono-lot only)
  padCategory?: string;
  padRateFcfaPerTon?: number;
}

// Backend guard: pricing must not start while client or partner communication loops are still open.
const OPEN_PARTNER_REQUEST_STATUSES = [
  "draft",
  "sent",
  "response_received",
  "response_analyzed",
  "partially_validated",
];
const PENDING_PARTNER_FACT_STATUS = "proposed";
const OPEN_CLIENT_GAP_REQUEST_STATUSES = ["drafted", "sent", "answered"];
const VALIDATED_PARTNER_FACT_STATUS = "validated";
const PARTNER_PRICING_CRITICAL_FACT_KEYS = [
  "cargo.freight_cost",
  "cargo.freight_currency",
  "cargo.freight_rate_per_kg",
  "pricing.sea_freight",
  "pricing.sea_freight_rate",
  "sea_freight",
];
const PARTNER_PRICING_CRITICAL_FACT_KEY_SET = new Set(PARTNER_PRICING_CRITICAL_FACT_KEYS);

type OpenCommunicationLoopsRows = {
  partnerRequests?: Array<{ id?: string | null }>;
  partnerFacts?: Array<{ id?: string | null }>;
  clientGapRequests?: Array<{ id?: string | null; gap_key?: string | null }>;
  openGaps?: Array<{ gap_key?: string | null }>;
};

type SelectedPartnerOfferRows = {
  partnerRequests?: Array<{ id?: string | null; is_selected?: boolean | null }>;
  partnerFacts?: Array<{
    request_id?: string | null;
    fact_key?: string | null;
    validation_status?: string | null;
    injected_fact_id?: string | null;
  }>;
  currentQuoteFacts?: Array<{ id?: string | null; fact_key?: string | null; source_type?: string | null }>;
};

export type OpenCommunicationLoopsGuard = {
  blocked: boolean;
  open_partner_requests_count: number;
  pending_partner_facts_count: number;
  open_client_gap_requests_count: number;
};

export type SelectedPartnerOfferGuard = {
  blocked: boolean;
  selected_partner_request_id: string | null;
  selected_partner_request_ids: string[];
  validated_partner_request_ids: string[];
  mismatched_fact_keys: string[];
  reason: string | null;
};

type SupabaseQueryLike = {
  select: (columns: string, options?: Record<string, unknown>) => SupabaseQueryLike;
  eq: (column: string, value: unknown) => SupabaseQueryLike;
  in: (column: string, values: string[]) => SupabaseQueryLike;
  then: (
    resolve: (value: { data: Array<Record<string, unknown>> | null; error: { message?: string } | null }) => void,
    reject: (reason?: unknown) => void,
  ) => void;
};

type SupabaseClientLike = {
  from: (table: string) => SupabaseQueryLike;
};

export function buildOpenCommunicationLoopsGuard(
  rows: OpenCommunicationLoopsRows,
): OpenCommunicationLoopsGuard {
  const openGapKeys = new Set(
    (rows.openGaps || [])
      .map((gap) => String(gap.gap_key || "").trim())
      .filter(Boolean),
  );
  const openClientGapRequestsCount = (rows.clientGapRequests || []).filter((request) =>
    openGapKeys.has(String(request.gap_key || "").trim()),
  ).length;

  const openPartnerRequestsCount = rows.partnerRequests?.length ?? 0;
  const pendingPartnerFactsCount = rows.partnerFacts?.length ?? 0;

  return {
    blocked: openPartnerRequestsCount > 0 || pendingPartnerFactsCount > 0 || openClientGapRequestsCount > 0,
    open_partner_requests_count: openPartnerRequestsCount,
    pending_partner_facts_count: pendingPartnerFactsCount,
    open_client_gap_requests_count: openClientGapRequestsCount,
  };
}

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

export function buildSelectedPartnerOfferGuard(
  rows: SelectedPartnerOfferRows,
): SelectedPartnerOfferGuard {
  const validatedPartnerFacts = (rows.partnerFacts || []).filter((fact) =>
    cleanString(fact.validation_status) === VALIDATED_PARTNER_FACT_STATUS
  );
  const validatedPartnerRequestIds = Array.from(new Set(
    validatedPartnerFacts
      .map((fact) => cleanString(fact.request_id))
      .filter(Boolean),
  )).sort();
  const selectedPartnerRequestIds = Array.from(new Set(
    (rows.partnerRequests || [])
      .filter((request) => request.is_selected === true)
      .map((request) => cleanString(request.id))
      .filter(Boolean),
  )).sort();
  const selectedPartnerRequestId =
    selectedPartnerRequestIds.length === 1 ? selectedPartnerRequestIds[0] : null;

  const baseGuard: SelectedPartnerOfferGuard = {
    blocked: false,
    selected_partner_request_id: selectedPartnerRequestId,
    selected_partner_request_ids: selectedPartnerRequestIds,
    validated_partner_request_ids: validatedPartnerRequestIds,
    mismatched_fact_keys: [],
    reason: null,
  };

  if (validatedPartnerRequestIds.length === 0) {
    return baseGuard;
  }

  const hasMultipleValidatedPartnerRequests = validatedPartnerRequestIds.length >= 2;
  if (hasMultipleValidatedPartnerRequests && selectedPartnerRequestIds.length !== 1) {
    return {
      ...baseGuard,
      blocked: true,
      reason: selectedPartnerRequestIds.length === 0
        ? "missing_selected_partner_request"
        : "multiple_selected_partner_requests",
    };
  }

  if (!selectedPartnerRequestId) {
    return baseGuard;
  }

  const selectedInjectedFactIds = new Set<string>();
  const mismatchedFactKeys = new Set<string>();

  for (const fact of validatedPartnerFacts) {
    const factKey = cleanString(fact.fact_key);
    if (!PARTNER_PRICING_CRITICAL_FACT_KEY_SET.has(factKey)) continue;

    const injectedFactId = cleanString(fact.injected_fact_id);
    if (!injectedFactId && hasMultipleValidatedPartnerRequests) {
      mismatchedFactKeys.add(factKey);
      continue;
    }

    if (cleanString(fact.request_id) === selectedPartnerRequestId && injectedFactId) {
      selectedInjectedFactIds.add(injectedFactId);
    }
  }

  for (const quoteFact of rows.currentQuoteFacts || []) {
    const factKey = cleanString(quoteFact.fact_key);
    if (!PARTNER_PRICING_CRITICAL_FACT_KEY_SET.has(factKey)) continue;
    if (cleanString(quoteFact.source_type) !== "partner_response") continue;

    const quoteFactId = cleanString(quoteFact.id);
    if (!quoteFactId || !selectedInjectedFactIds.has(quoteFactId)) {
      mismatchedFactKeys.add(factKey);
    }
  }

  if (mismatchedFactKeys.size > 0) {
    return {
      ...baseGuard,
      blocked: true,
      mismatched_fact_keys: Array.from(mismatchedFactKeys).sort(),
      reason: "selected_partner_offer_mismatch",
    };
  }

  return baseGuard;
}

export async function getOpenCommunicationLoopsGuard(
  serviceClient: SupabaseClientLike,
  caseId: string,
): Promise<OpenCommunicationLoopsGuard> {
  const [
    partnerRequestsResult,
    partnerFactsResult,
    clientGapRequestsResult,
    openGapsResult,
  ] = await Promise.all([
    serviceClient
      .from("external_quote_requests")
      .select("id")
      .eq("case_id", caseId)
      .in("status", OPEN_PARTNER_REQUEST_STATUSES),
    serviceClient
      .from("external_quote_response_facts")
      .select("id")
      .eq("case_id", caseId)
      .eq("validation_status", PENDING_PARTNER_FACT_STATUS),
    serviceClient
      .from("client_gap_requests")
      .select("id, gap_key")
      .eq("case_id", caseId)
      .in("status", OPEN_CLIENT_GAP_REQUEST_STATUSES),
    serviceClient
      .from("quote_gaps")
      .select("gap_key")
      .eq("case_id", caseId)
      .eq("status", "open"),
  ]);

  const guardError =
    partnerRequestsResult.error ||
    partnerFactsResult.error ||
    clientGapRequestsResult.error ||
    openGapsResult.error;
  if (guardError) {
    throw new Error(`Failed to check open communication loops: ${guardError.message || "unknown error"}`);
  }

  return buildOpenCommunicationLoopsGuard({
    partnerRequests: partnerRequestsResult.data || [],
    partnerFacts: partnerFactsResult.data || [],
    clientGapRequests: clientGapRequestsResult.data || [],
    openGaps: openGapsResult.data || [],
  });
}

export async function getSelectedPartnerOfferGuard(
  serviceClient: SupabaseClientLike,
  caseId: string,
): Promise<SelectedPartnerOfferGuard> {
  const [
    partnerRequestsResult,
    partnerFactsResult,
    currentQuoteFactsResult,
  ] = await Promise.all([
    serviceClient
      .from("external_quote_requests")
      .select("id, status, is_selected")
      .eq("case_id", caseId),
    serviceClient
      .from("external_quote_response_facts")
      .select("request_id, fact_key, validation_status, injected_fact_id")
      .eq("case_id", caseId)
      .eq("validation_status", VALIDATED_PARTNER_FACT_STATUS),
    serviceClient
      .from("quote_facts")
      .select("id, fact_key, source_type")
      .eq("case_id", caseId)
      .eq("is_current", true)
      .eq("source_type", "partner_response")
      .in("fact_key", PARTNER_PRICING_CRITICAL_FACT_KEYS),
  ]);

  const guardError =
    partnerRequestsResult.error ||
    partnerFactsResult.error ||
    currentQuoteFactsResult.error;
  if (guardError) {
    throw new Error(`Failed to check selected partner offer coherence: ${guardError.message || "unknown error"}`);
  }

  return buildSelectedPartnerOfferGuard({
    partnerRequests: partnerRequestsResult.data || [],
    partnerFacts: partnerFactsResult.data || [],
    currentQuoteFacts: currentQuoteFactsResult.data || [],
  });
}

// P5: SERVICE_PACKAGES mapping (mirror of src/features/quotation/constants.ts)
// → moved verbatim to ../_shared/service-scope.ts, imported above.

// ═══ EXPORT-GUARD: Classification convention (Option A — provisoire) ═══
// AGENCY = honoraires SODATRA (soumis TVA 18%)
// Toutes les autres lignes export P5 = opérationnel (non soumis TVA SODATRA)
// debours = 0 (pas de droits & taxes de sortie en export sénégalais)
// Cette convention est minimale et réversible — à réévaluer si package EXPORT_DDP apparaît.
const EXPORT_HONORAIRES_KEYS = new Set(['AGENCY']);

function classifyExportTotals(lines: any[]): { honoraires: number; operationnel: number; debours: number } {
  let honoraires = 0;
  let operationnel = 0;
  for (const line of lines) {
    const amount = Number(line?.amount) || 0;
    const category = String(line?.category || line?.canonical?.service_key || '').trim().toUpperCase();
    if (EXPORT_HONORAIRES_KEYS.has(category)) {
      honoraires += amount;
    } else {
      operationnel += amount;
    }
  }
  return { honoraires, operationnel, debours: 0 };
}

// P5: Default units per service_key (aligned with service_quantity_rules)
// → moved verbatim to ../_shared/service-scope.ts, imported above.

// P5.1: Human-readable labels for service keys (static, no DB call)
const SERVICE_KEY_LABELS: Record<string, string> = {
  PICKUP_ORIGIN: "Enlèvement à l'origine",
  PRE_CARRIAGE: 'Pré-acheminement',
  SEA_FREIGHT: 'Fret maritime',
  AIR_FREIGHT: 'Fret aérien',
  AIR_HANDLING: 'Handling aéroportuaire',
  CUSTOMS_DAKAR: 'Dédouanement Dakar',
  TRUCKING: 'Transport local',
  AGENCY: "Frais d'agence",
  DTHC: 'DTHC',
  EMPTY_RETURN: 'Retour conteneur vide',
  PORT_DAKAR_HANDLING: 'Manutention port Dakar',
  PORT_CHARGES: 'Frais portuaires',
  CUSTOMS_EXPORT: 'Dédouanement export',
  DISCHARGE: 'Déchargement',
  SURVEY: 'Inspection / Survey',
  BORDER_FEES: 'Frais frontière',
  CUSTOMS_BAMAKO: 'Dédouanement Bamako',
  ON_CARRIAGE: 'Post-acheminement',
  // P7: Export-specific labels
  THC_EXPORT: 'THC export',
  DOCUMENTATION_BL: 'Documentation / B/L',
  VGM_WEIGHING: 'VGM / Pesée',
  STUFFING_FACTORY: 'Empotage usine',
  STUFFING_CFS: 'Empotage CFS',
  EMPTY_REPO: 'Repositionnement conteneur vide',
};

// P5: Conservative engine-line-to-service-key deduplication
const ENGINE_CATEGORY_TO_SERVICE_KEY: Record<string, string> = {
  'DTHC': 'DTHC',
  'Terminal (DPW)': 'DTHC',
  'Terminal': 'DTHC',
  'Retour conteneur vide': 'EMPTY_RETURN',
  'Dédouanement': 'CUSTOMS_DAKAR',
  'Douane': 'CUSTOMS_DAKAR',
  'Transport': 'TRUCKING',
  'Transport Mali': 'TRUCKING',
  // SCOPE-REMOVE: border-clearing lines (bloc 'border', quotation-engine §6
  // "BORDER CLEARING (Mali)", table border_clearing_rates) ARE the catalogue
  // service BORDER_FEES ('Frais frontière') carried by the transit packages.
  'Frontière Mali': 'BORDER_FEES',
  // P5.4: Agency sub-components
  'Suivi': 'AGENCY',
  'Administratif': 'AGENCY',
};

const DESCRIPTION_SERVICE_KEY_FALLBACKS: Array<{ tokens: string[]; serviceKey: string }> = [
  { tokens: ['suivi operationnel'], serviceKey: 'AGENCY' },
  { tokens: ['ouverture de dossier'], serviceKey: 'AGENCY' },
  { tokens: ['frais de documentation'], serviceKey: 'AGENCY' },
  { tokens: ['documentation'], serviceKey: 'AGENCY' },
  { tokens: ['dedouanement'], serviceKey: 'CUSTOMS_DAKAR' },
  { tokens: ['douane'], serviceKey: 'CUSTOMS_DAKAR' },
];

const NORMALIZED_ENGINE_CATEGORY_TO_SERVICE_KEY = Object.fromEntries(
  Object.entries(ENGINE_CATEGORY_TO_SERVICE_KEY).map(([category, serviceKey]) => [
    normalizePricingText(category),
    serviceKey,
  ]),
) as Record<string, string>;

function normalizePricingText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeShadowCode(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return normalized === '' ? null : normalized;
}

function findShadowPadCategoryForNst(nstCode: string, nstRules: any[]): string | null {
  const validated = nstRules.filter((rule: any) =>
    rule?.nst_code === nstCode &&
    rule?.validation_status === 'validated' &&
    rule?.requires_operator_validation === false &&
    typeof rule?.pad_category === 'string' &&
    rule.pad_category.trim() !== ''
  );
  const categories = [...new Set(validated.map((rule: any) => rule.pad_category.trim().toUpperCase()))];
  return categories.length === 1 ? categories[0] : null;
}

async function buildPadShadowContext(serviceClient: any, inputs: PricingInputs): Promise<{
  aliases: any[];
  nstRules: any[];
  hsToNstMapping: any[];
}> {
  const normalizedDesignation = normalizePricingText(inputs.cargoDescription);
  const aliasesPromise = normalizedDesignation
    ? serviceClient
        .from('pad_designation_aliases')
        .select('normalized_term, pad_category')
        .eq('normalized_term', normalizedDesignation)
        .eq('is_validated', true)
    : Promise.resolve({ data: [], error: null });

  const nstRulesPromise = serviceClient
    .from('pad_nst_recommendation_rules')
    .select('nst_level,nst_code,pad_category,confidence,validation_status,requires_operator_validation')
    .eq('is_active', true);

  const [{ data: aliasRows, error: aliasError }, { data: nstRuleRows, error: nstRuleError }] = await Promise.all([
    aliasesPromise,
    nstRulesPromise,
  ]);

  if (aliasError) throw aliasError;
  if (nstRuleError) throw nstRuleError;

  const aliases = (aliasRows ?? []).map((row: any) => ({
    normalized_term: row.normalized_term,
    pad_category: row.pad_category,
    alias_kind: 'designation' as const,
    is_validated: true,
    source_type: null,
  }));

  const nstRules = (nstRuleRows ?? []).map((row: any) => ({
    nst_level: row.nst_level,
    nst_code: row.nst_code,
    pad_category: row.pad_category,
    confidence: Number(row.confidence) || 0,
    requires_operator_validation: row.requires_operator_validation === true,
    validation_status: row.validation_status,
  }));

  const hsToNstMapping: any[] = [];
  const cnCode = normalizeShadowCode(inputs.cnCode);
  const nhmCode = normalizeShadowCode(inputs.nhmCode);

  if (cnCode) {
    const { data, error } = await serviceClient
      .from('nst_cn_mappings')
      .select('cn_code,nst_group_code')
      .eq('cn_code', cnCode);
    if (error) throw error;
    const nstCodes = [...new Set((data ?? []).map((row: any) => row.nst_group_code).filter(Boolean))];
    for (const row of data ?? []) {
      hsToNstMapping.push({
        source_code: row.cn_code,
        source_kind: 'cn',
        nst_code: row.nst_group_code,
        nst_level: 'group',
        pad_category: nstCodes.length === 1 ? findShadowPadCategoryForNst(row.nst_group_code, nstRules) : null,
        is_unique: nstCodes.length === 1,
      });
    }
  }

  if (nhmCode) {
    const { data, error } = await serviceClient
      .from('nst_nhm_mappings')
      .select('nhm_code,nst_group_code')
      .eq('nhm_code', nhmCode);
    if (error) throw error;
    const nstCodes = [...new Set((data ?? []).map((row: any) => row.nst_group_code).filter(Boolean))];
    for (const row of data ?? []) {
      hsToNstMapping.push({
        source_code: row.nhm_code,
        source_kind: 'nhm',
        nst_code: row.nst_group_code,
        nst_level: 'group',
        pad_category: nstCodes.length === 1 ? findShadowPadCategoryForNst(row.nst_group_code, nstRules) : null,
        is_unique: nstCodes.length === 1,
      });
    }
  }

  return { aliases, nstRules, hsToNstMapping };
}

function inferServiceKeyFromDescription(description: unknown): string | undefined {
  const normalizedDescription = normalizePricingText(description);
  if (!normalizedDescription) return undefined;

  for (const fallback of DESCRIPTION_SERVICE_KEY_FALLBACKS) {
    if (fallback.tokens.some((token) => normalizedDescription.includes(token))) {
      return fallback.serviceKey;
    }
  }

  return undefined;
}

function inferCoveredServiceKeys(engineLines: any[]): Set<string> {
  return inferCoveredServiceDiagnostics(engineLines).covered;
}

/**
 * P5 + P6: Infer which service_keys are already covered by engine lines.
 * P6 upgrade: prefer canonical.dedup_group → canonical.service_key → text fallback.
 */
function inferCoveredServiceDiagnostics(engineLines: any[]): {
  covered: Set<string>;
  categoriesSeen: string[];
  matchedByDescription: string[];
} {
  const covered = new Set<string>();
  const categoriesSeen = new Set<string>();
  const matchedByDescription = new Set<string>();

  for (const line of engineLines) {
    // P6.1: Always capture rawCategory for diagnostics BEFORE canonical shortcuts
    const rawCategory = typeof line?.category === 'string' ? line.category : '';
    const rawDescription = typeof line?.description === 'string' ? line.description : '';

    if (rawCategory) {
      categoriesSeen.add(rawCategory);
    }

    // P6: prefer canonical fields first
    const canonicalDedupGroup = line?.canonical?.dedup_group;
    const canonicalServiceKey = line?.canonical?.service_key;

    if (typeof canonicalDedupGroup === 'string' && canonicalDedupGroup) {
      covered.add(canonicalDedupGroup);
      if (typeof canonicalServiceKey === 'string' && canonicalServiceKey && canonicalServiceKey !== canonicalDedupGroup) {
        covered.add(canonicalServiceKey);
      }
      continue;
    }
    if (typeof canonicalServiceKey === 'string' && canonicalServiceKey) {
      covered.add(canonicalServiceKey);
      continue;
    }

    const normalizedCategory = normalizePricingText(rawCategory);
    const serviceKeyFromCategory = NORMALIZED_ENGINE_CATEGORY_TO_SERVICE_KEY[normalizedCategory];

    if (serviceKeyFromCategory) {
      covered.add(serviceKeyFromCategory);
      continue;
    }

    const serviceKeyFromDescription = inferServiceKeyFromDescription(rawDescription);
    if (serviceKeyFromDescription) {
      covered.add(serviceKeyFromDescription);
      matchedByDescription.add(rawDescription || rawCategory || 'unknown');
    }
  }

  return {
    covered,
    categoriesSeen: Array.from(categoriesSeen),
    matchedByDescription: Array.from(matchedByDescription),
  };
}

// ═══ P5: Service overrides helpers ═══
// ServiceOverrides / ALL_KNOWN_SERVICE_KEYS / readOverridesFromFacts /
// resolveEffectiveServiceKeys moved verbatim to ../_shared/service-scope.ts
// (imported above) so build-case-puzzle resolves the identical scope.

// PAD scope guard: extracted verbatim into ../_shared/pad-scope-blocker.ts (PACK P0-B) so the
// PAD_CATEGORY_REQUIRED branch is directly testable. Both call sites below already
// compute effectiveServiceKeys via resolveEffectiveServiceKeys + readOverridesFromFacts.

/** Normalisation used by BOTH PAD helpers below, so they can never disagree on a key. */
function isPadScopeMarker(key: unknown): boolean {
  return PAD_SCOPE_SERVICE_KEYS.has(String(key ?? '').trim().toUpperCase());
}

/**
 * P0-E — service keys that must NEVER be sent to `price-service-lines`.
 *
 * `PAD_SCOPE_SERVICE_KEYS` (`PORT_DAKAR_HANDLING`, `PAD_DROIT_PASSAGE`) are the historical
 * MARKERS that put a scope in PAD range; they are not catalogue services. The PAD redevance
 * is a separate charge, priced once and only once further down this file by the
 * `enrichment_pad` block, from the official `cargo.pad_category` / `cargo.pad_rate_fcfa_per_ton`
 * facts. `price-service-lines` holds no PAD tariff, so enriching those keys can only append a
 * 0 XOF / `no_match` line that sits next to the official `PAD_DROIT_PASSAGE` line AND next to
 * DTHC — the destination terminal handling, a distinct service left untouched here.
 *
 * The filter applies to the ENRICHMENT list only. `resolvePadScopeBlocker` keeps receiving the
 * UNFILTERED `effectiveServiceKeys` at both of its call sites, so a scope in PAD range without
 * category and strictly positive official rate still fails closed on `PAD_CATEGORY_REQUIRED`.
 * `PAD_DROIT_PASSAGE` is filtered defensively: it is absent from `PACKAGE_SERVICE_DEFAULT_UNITS`
 * today, hence unreachable through `service.overrides.add`, but a future package must not be
 * able to reintroduce a second PAD line through this path.
 *
 * MULTI-LOT: dropping the 0 XOF marker line is only safe because the `enrichment_pad` block
 * replaces it — and that block is MONO-LOT. In multi-lot the run returns long before it, so a
 * PAD-scoped lot would otherwise end with NO PAD charge at all. `resolvePadBlockersForLot`
 * below closes exactly that hole; the two must be read together.
 */
export function excludePadScopeKeysForEnrichment(serviceKeys: string[]): string[] {
  return (serviceKeys ?? []).filter((key) => !isPadScopeMarker(key));
}

/**
 * Does this scope owe a PAD redevance? Exact complement of the enrichment filter above:
 * a key stripped from the enrichment list is a key that puts the lot in PAD range.
 */
export function scopeRequiresPadPricing(serviceKeys: string[]): boolean {
  return (serviceKeys ?? []).some(isPadScopeMarker);
}

/** Stable blocker code: PAD range reached in multi-lot, where no per-lot PAD line exists. */
export const PAD_MULTI_LOT_UNSUPPORTED = 'PAD_MULTI_LOT_UNSUPPORTED';

/**
 * P0-E — the PAD blockers of ONE lot, fail-closed by construction.
 *
 * `resolvePadScopeBlocker` alone is NOT sufficient in multi-lot mode. It answers a mono-lot
 * question — "can the `enrichment_pad` block price this scope?" — and clears as soon as the
 * GLOBAL `cargo.pad_category` + `cargo.pad_rate_fcfa_per_ton` facts are materialised. But those
 * facts are global, not per-lot, and `enrichment_pad` sits on the mono-lot path only (the
 * multi-lot branch returns before it). So a cleared guard in multi-lot means: PAD range
 * reached, no `PAD_DROIT_PASSAGE` line will ever be appended for this lot.
 *
 * Before the enrichment filter above, that gap was papered over by a bogus 0 XOF / `no_match`
 * `PORT_DAKAR_HANDLING` line from `price-service-lines` — visible, but worth zero. Removing it
 * without this guard would turn a wrong line into a SILENT under-charge, so the ordering here
 * is deliberate:
 *
 *   - scope out of PAD range              → `[]`, nothing changes for that lot;
 *   - scope in PAD range, facts missing   → `['PAD_CATEGORY_REQUIRED']` (unchanged behaviour);
 *   - scope in PAD range, facts complete  → `['PAD_MULTI_LOT_UNSUPPORTED']`, the new fail-closed
 *     branch, to be REPLACED (not merely deleted) the day a per-lot PAD computation lands.
 *
 * Pure: no I/O, no ordering dependency, safe to call per lot.
 */
export function resolvePadBlockersForLot(params: {
  facts: PadScopeFact[];
  servicePackage: string;
  effectiveServiceKeys: string[];
  incoterm: string;
}): string[] {
  const scopeBlocker = resolvePadScopeBlocker(params);
  if (scopeBlocker) return [...scopeBlocker.pricing_blockers];
  if (scopeRequiresPadPricing(params.effectiveServiceKeys)) return [PAD_MULTI_LOT_UNSUPPORTED];
  return [];
}

/**
 * TERMINAL-GUARD, côté multi-lot — les faits DÉCLARÉS PAR LE LOT, jamais le global.
 *
 * `mergeFactsForLot` fait descendre les faits globaux dans chaque lot, ce qui est le
 * bon défaut pour un poids ou un incoterm mais serait FAUX ici : le mode d'opération
 * terminal est une propriété du navire/terminal qui traite CE lot. Un dossier mixte
 * (un lot conteneur LoLo chez DP World + un lot roulant chez Dakar Terminal) verrait
 * sinon le mode global `LOLO` autoriser silencieusement le chemin DTHC de DP World
 * pour le lot roulant. On ne déduit donc pas le mode global comme mode du lot : un lot
 * qui ne déclare pas le sien tombe sur `TERMINAL_OPERATION_MODE_REQUIRED`.
 *
 * Codes identiques au mono-lot (`TERMINAL_OPERATION_MODE_REQUIRED` /
 * `DAKAR_TERMINAL_RATE_REQUIRED`) : un seul vocabulaire de blocage, quel que soit le
 * mode d'exécution. Pur, non mutant, sans I/O.
 */
export function resolveTerminalBlockersForLot(params: {
  lotExtractedFacts: Array<{ key?: string; value?: unknown }>;
  effectiveServiceKeys: string[];
}): string[] {
  // Seule la clé du mode est extraite, et seulement si le lot porte une VALEUR
  // textuelle : tout le reste (nombre, objet, absence) reste invalide donc bloquant.
  const lotDeclaredFacts: TerminalScopeFact[] = (params.lotExtractedFacts ?? [])
    .filter((lf) => lf?.key === TERMINAL_OPERATION_MODE_FACT_KEY)
    .map((lf) => ({
      fact_key: TERMINAL_OPERATION_MODE_FACT_KEY,
      value_text: typeof lf?.value === "string" ? lf.value : null,
    }));

  return resolveTerminalOperationBlockers({
    facts: lotDeclaredFacts,
    effectiveServiceKeys: params.effectiveServiceKeys,
  });
}

// ═══ P6: Canonical Pricing Line Metadata ═══

/**
 * Maps fine-grained service keys to collision/dedup groups.
 * Lines in the same dedup_group are considered as covering the same business service.
 */
const DEDUP_GROUP_MAP: Record<string, string> = {
  'SUIVI_OPERATIONNEL': 'AGENCY',
  'OUVERTURE_DOSSIER': 'AGENCY',
  'FRAIS_DOCUMENTATION': 'AGENCY',
  'AGENCY': 'AGENCY',
  'CUSTOMS_DAKAR': 'CUSTOMS_DAKAR',
  'DEDOUANEMENT': 'CUSTOMS_DAKAR',
  'CUSTOMS_BAMAKO': 'CUSTOMS_BAMAKO',
  'CUSTOMS_EXPORT': 'CUSTOMS_EXPORT',
  'TRUCKING': 'TRUCKING',
  'ON_CARRIAGE': 'ON_CARRIAGE',
  'PRE_CARRIAGE': 'PRE_CARRIAGE',
  // TARIFF-COHERENCE-1: DTHC remains terminal handling. PORT_DAKAR_HANDLING
  // is a non-billable PAD scope marker filtered before generic enrichment.
  'DTHC': 'TERMINAL_HANDLING',
  // P7: Export-specific dedup groups
  'THC_EXPORT': 'THC_EXPORT',
  'DOCUMENTATION_BL': 'DOCUMENTATION_BL',
  'VGM_WEIGHING': 'VGM_WEIGHING',
  'STUFFING_FACTORY': 'STUFFING_FACTORY',
  'STUFFING_CFS': 'STUFFING_CFS',
  'EMPTY_REPO': 'EMPTY_REPO',
};

/** Maps source.type values to standardized pricing_method labels. */
const SOURCE_TYPE_TO_METHOD: Record<string, string> = {
  'CALCULATED': 'internal_rule',
  'OFFICIAL': 'official_tariff',
  'TO_CONFIRM': 'to_confirm',
  'HISTORICAL': 'historical_match',
  'NO_MATCH': 'no_match',
  'catalogue_sodatra': 'catalogue_match',
  'price-service-lines': 'catalogue_match',
};

/** Maps engine source.type to known source_table (conservative, null if unknown). */
const ENGINE_SOURCE_TYPE_TO_TABLE: Record<string, string> = {
  'CALCULATED': 'sodatra_fee_rules',
  'OFFICIAL': 'port_tariffs',
};

/**
 * P6.1: Conservative normalizer for source.type — strips only `+suffix` and `:suffix`.
 * Returns null for non-string or empty input. Does NOT split on whitespace or semicolons.
 */
function normalizeSourceType(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withoutPlus = trimmed.split('+')[0];
  const base = withoutPlus.split(':')[0];
  return base || null;
}

interface CanonicalBlock {
  service_key: string | null;
  dedup_group: string | null;
  origin_layer: 'engine_structural' | 'package_enrichment' | 'manual_override' | 'enrichment_pad' | 'enrichment_terminal_storage' | 'enrichment_carrier_commission' | 'enrichment_carrier_charges';
  source_system: string | null;
  source_table: string | null;
  pricing_method: string | null;
}

const CMA_CGM_DEBOURS_COMMISSION_RATE = 0.028;
const CMA_CGM_DEBOURS_COMMISSION_PERCENT = 2.8;
const VALID_CARRIER_COMMISSION_EVIDENCE_LEVELS = new Set(['official', 'validated_internal']);

function normalizeCarrierCode(value: unknown): string {
  const normalized = normalizePricingText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized === 'CMACGM' ? 'CMA_CGM' : normalized;
}

function isTransitLikeFlow(caseData: any, inputs: PricingInputs, packageKey: string): boolean {
  const requestTypeUpper = String(caseData?.request_type || '').toUpperCase();
  const packageUpper = String(packageKey || inputs.servicePackage || '').toUpperCase();

  return (
    packageUpper.includes('TRANSIT') ||
    packageUpper.includes('TRANSBORDEMENT') ||
    packageUpper.includes('TRANSSHIPMENT') ||
    requestTypeUpper.includes('TRANSIT') ||
    requestTypeUpper.includes('TRANSBORDEMENT') ||
    requestTypeUpper.includes('TRANSSHIPMENT')
  );
}

function isEligibleCmaCgmCommissionTemplate(template: any): boolean {
  return (
    normalizeCarrierCode(template?.carrier) === 'CMA_CGM' &&
    String(template?.charge_code || '').trim().toUpperCase() === 'COMM' &&
    template?.is_active === true &&
    VALID_CARRIER_COMMISSION_EVIDENCE_LEVELS.has(String(template?.evidence_level || '').trim().toLowerCase()) &&
    String(template?.calculation_method || '').trim().toUpperCase() === 'PERCENTAGE' &&
    Number(template?.default_amount) === CMA_CGM_DEBOURS_COMMISSION_PERCENT
  );
}

function getSourceReferenceFromTemplate(template: any): string {
  const sourceDocuments = Array.isArray(template?.source_documents)
    ? template.source_documents.filter((doc: unknown): doc is string => typeof doc === 'string' && doc.trim() !== '')
    : [];

  return sourceDocuments[0] || template?.base_reference || template?.notes || 'CMA CGM/CNC SENEGAL LOCAL CHARGES';
}

/**
 * P6: Stamps a tariff line with a canonical metadata block.
 * Idempotent: if line.canonical already exists, returns the line unchanged.
 * Conservative: uses null when truth is uncertain.
 */
export function canonicalizeLine(
  line: any,
  context: { origin_layer: CanonicalBlock['origin_layer'] },
): any {
  // Idempotent guard
  if (line?.canonical) return line;

  const canonical: CanonicalBlock = {
    service_key: null,
    dedup_group: null,
    origin_layer: context.origin_layer,
    source_system: null,
    source_table: null,
    pricing_method: null,
  };

  if (context.origin_layer === 'engine_structural') {
    // Derive service_key from category + description fallback
    const rawCategory = typeof line?.category === 'string' ? line.category : '';
    const normalizedCategory = normalizePricingText(rawCategory);
    let serviceKey = NORMALIZED_ENGINE_CATEGORY_TO_SERVICE_KEY[normalizedCategory] || null;
    if (!serviceKey) {
      serviceKey = inferServiceKeyFromDescription(line?.description) || null;
    }

    canonical.service_key = serviceKey;
    canonical.dedup_group = serviceKey ? (DEDUP_GROUP_MAP[serviceKey] || serviceKey) : null;
    canonical.source_system = 'quotation-engine';

    const normalizedSrcType = normalizeSourceType(line?.source?.type);
    if (normalizedSrcType) {
      canonical.source_table = ENGINE_SOURCE_TYPE_TO_TABLE[normalizedSrcType] || null;
      canonical.pricing_method = SOURCE_TYPE_TO_METHOD[normalizedSrcType] || null;
    }
  } else if (context.origin_layer === 'package_enrichment') {
    // P5 lines: category is already the service_key
    const serviceKey = typeof line?.category === 'string' ? line.category : null;
    canonical.service_key = serviceKey;
    canonical.dedup_group = serviceKey ? (DEDUP_GROUP_MAP[serviceKey] || serviceKey) : null;
    canonical.source_system = 'price-service-lines';

    const normalizedSrcType = normalizeSourceType(line?.source?.type);
    if (normalizedSrcType) {
      canonical.source_table = normalizedSrcType === 'catalogue_sodatra' ? 'pricing_service_catalogue' : null;
      canonical.pricing_method = SOURCE_TYPE_TO_METHOD[normalizedSrcType] || null;
    }
  } else if (context.origin_layer === 'enrichment_pad') {
    canonical.service_key = 'PAD_DROIT_PASSAGE';
    canonical.dedup_group = 'PAD_DROIT_PASSAGE';
    canonical.source_system = 'fact_dossier';
    canonical.source_table = null;
    canonical.pricing_method = 'fact_based';
  } else if (context.origin_layer === 'enrichment_terminal_storage') {
    canonical.service_key = 'TERMINAL_STORAGE_PROVISION_ESTIMATE';
    canonical.dedup_group = 'TERMINAL_STORAGE';
    canonical.source_system = 'terminal_designations';
    canonical.source_table = 'terminal_tariff_codes';
    canonical.pricing_method = 'provision_estimate';
  } else if (context.origin_layer === 'enrichment_carrier_commission') {
    canonical.service_key = 'CMA_CGM_COMM';
    canonical.dedup_group = 'CMA_CGM_COMM';
    canonical.source_system = 'carrier_billing_templates';
    canonical.source_table = 'carrier_billing_templates';
    canonical.pricing_method = 'percentage_on_pad';
  } else if (context.origin_layer === 'enrichment_carrier_charges') {
    // Dynamic per carrier/charge_code — category is `${CARRIER}_${CHARGE_CODE}`
    const serviceKey = typeof line?.category === 'string' ? line.category : null;
    canonical.service_key = serviceKey;
    canonical.dedup_group = serviceKey;
    canonical.source_system = 'carrier_billing_templates';
    canonical.source_table = 'carrier_billing_templates';
    const srcType = normalizeSourceType(line?.source?.type);
    canonical.pricing_method = srcType ? (SOURCE_TYPE_TO_METHOD[srcType] || null) : null;
  }

  return { ...line, canonical };
}

// ═══ SCOPE-REMOVE: explicit service removals on engine structural lines ═══
// STRUCTURAL_PATCH_ALLOWED — see docs/MASTER_CONTEXT.md. GO CTO 2026-08-25
// (lot SCOPE-REMOVE): proven business defect — services explicitly present in
// `service.overrides.remove` resurfaced in the final structural lines. Bounded
// diff (this helper + its two call sites + the Frontière Mali mapping), no
// tariff or commercial doctrine touched, idempotent, pinned by
// explicit-service-removal_test.ts.

/** Engine totals buckets that are pure sums of lines by `bloc` (quotation-engine). */
const ENGINE_TOTALS_BLOC_KEYS = new Set(['operationnel', 'honoraires', 'debours', 'border', 'terminal']);

/** Minimal structural view of a canonicalized line — only what the removal reads. */
interface ScopeRemovalLine {
  amount?: number | null;
  bloc?: string;
  canonical?: {
    service_key?: string | null;
    origin_layer?: string;
  } | null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * SCOPE-REMOVE — drops the structural lines whose service the operator has
 * EXPLICITLY removed (`service.overrides.remove`, add wins — see
 * `resolveExplicitlyRemovedServiceKeys`) and subtracts the dropped amounts from
 * the raw engine totals by replaying the engine's own bucket arithmetic
 * (quotation-engine sums lines by `bloc`, local-transport débours in their
 * dedicated bucket, then dap = Σ non-debours buckets and ddp = dap + debours).
 *
 * Fail-closed by construction:
 * - only `canonical.origin_layer === 'engine_structural'` lines are candidates;
 * - a `canonical.service_key === null` line is NEVER dropped (« Droits &
 *   Taxes », Port (PAD), Magasinage… — débours and mandatory charges stay);
 * - empty removal set or no matching line → lines and totals pass through;
 * - a removed line whose amount is not a finite non-zero number weighed 0 in
 *   the engine totals: it leaves without delta and without requiring a bucket;
 * - once at least one FIRM line must leave, a COHERENT totals adjustment is
 *   mandatory: every firm removed line needs a finite adjustable bucket
 *   (local-transport → `local_transport_debours_ttc`, or its legacy bloc when
 *   that bucket is absent; any other line → its known bloc). Otherwise the
 *   helper throws `SCOPE_REMOVE_TOTALS_INCOHERENT` so run-pricing fails and
 *   rolls back instead of quoting partially adjusted numbers. `dap`/`ddp`
 *   stay optional (legacy shape) and are adjusted only when present.
 *
 * Idempotent: a second application removes nothing and subtracts 0.
 */
export const SCOPE_REMOVE_TOTALS_INCOHERENT = 'SCOPE_REMOVE_TOTALS_INCOHERENT';

export function applyExplicitServiceRemovals(
  lines: ScopeRemovalLine[],
  engineTotals: unknown,
  removedKeys: Set<string>,
): { keptLines: ScopeRemovalLine[]; removedLines: ScopeRemovalLine[]; adjustedTotals: unknown } {
  const safeLines = Array.isArray(lines) ? lines : [];
  if (!(removedKeys instanceof Set) || removedKeys.size === 0) {
    return { keptLines: safeLines, removedLines: [], adjustedTotals: engineTotals };
  }

  const keptLines: ScopeRemovalLine[] = [];
  const removedLines: ScopeRemovalLine[] = [];
  for (const line of safeLines) {
    const serviceKey = line?.canonical?.service_key;
    const isRemovable =
      line?.canonical?.origin_layer === 'engine_structural' &&
      typeof serviceKey === 'string' &&
      serviceKey !== '' &&
      removedKeys.has(serviceKey);
    (isRemovable ? removedLines : keptLines).push(line);
  }

  // A line whose amount is not a finite non-zero number weighed 0 in the engine
  // totals: it may leave without delta and without requiring a bucket.
  const firmRemovedLines = removedLines.filter((line) => {
    const amount = Number(line?.amount);
    return Number.isFinite(amount) && amount !== 0;
  });
  if (removedLines.length === 0 || firmRemovedLines.length === 0) {
    return { keptLines, removedLines, adjustedTotals: engineTotals };
  }

  // Fail-closed: from here on a coherent totals adjustment is MANDATORY — a
  // partially adjusted quote (lines dropped, amounts kept) must never exist.
  if (!isPlainRecord(engineTotals)) {
    throw new Error(
      `${SCOPE_REMOVE_TOTALS_INCOHERENT}: engine totals are not a record while ` +
        `${firmRemovedLines.length} firm structural line(s) must leave the totals`,
    );
  }

  const adjustedTotals: Record<string, unknown> = { ...engineTotals };
  const isFiniteTotal = (v: unknown): boolean =>
    v !== undefined && v !== null && Number.isFinite(Number(v));
  // Mirror of computeCommercialTotals' old-engine compatibility read: without the
  // dedicated bucket, local-transport débours were counted inside their bloc.
  const hasLocalTransportBucket = isFiniteTotal(adjustedTotals.local_transport_debours_ttc);

  let dapDelta = 0;
  let deboursDelta = 0;
  for (const line of firmRemovedLines) {
    const amount = Number(line?.amount);
    const blocValue = line?.bloc;
    const bloc = typeof blocValue === 'string' ? blocValue : '';

    let bucketKey: string;
    if (isLocalTransportDebours(line)) {
      bucketKey = hasLocalTransportBucket
        ? 'local_transport_debours_ttc'
        : (ENGINE_TOTALS_BLOC_KEYS.has(bloc) ? bloc : 'operationnel');
    } else if (ENGINE_TOTALS_BLOC_KEYS.has(bloc)) {
      bucketKey = bloc;
    } else {
      throw new Error(
        `${SCOPE_REMOVE_TOTALS_INCOHERENT}: removed line '${line?.canonical?.service_key}' ` +
          `carries unknown bloc '${bloc}' — no adjustable bucket`,
      );
    }

    if (!isFiniteTotal(adjustedTotals[bucketKey])) {
      throw new Error(
        `${SCOPE_REMOVE_TOTALS_INCOHERENT}: bucket '${bucketKey}' is not a finite total ` +
          `while removing '${line?.canonical?.service_key}' (${amount})`,
      );
    }
    adjustedTotals[bucketKey] = Number(adjustedTotals[bucketKey]) - amount;
    if (bucketKey === 'debours') deboursDelta += amount;
    else dapDelta += amount;
  }

  // dap/ddp are closing sums in the engine (dap = Σ non-debours buckets,
  // ddp = dap + debours): subtract the same deltas instead of rebuilding the
  // sums, so a shape missing some buckets can never be corrupted.
  if (isFiniteTotal(adjustedTotals.dap)) {
    adjustedTotals.dap = Number(adjustedTotals.dap) - dapDelta;
  }
  if (isFiniteTotal(adjustedTotals.ddp)) {
    adjustedTotals.ddp = Number(adjustedTotals.ddp) - dapDelta - deboursDelta;
  }

  return { keptLines, removedLines, adjustedTotals };
}

// Carrier port charge ambiguity guard (mirrored from quotation-engine/index.ts).
// Blocks charges whose label/code overlaps with PAD_DROIT_PASSAGE to prevent double-counting.
// HAPAG_LLOYD/TXI exception: validated_internal/official PER_BL 25000 — known firm carrier charge.
export function isAmbiguousCarrierPortChargeBasic(charge: any): boolean {
  const norm = (v: unknown): string => normalizePricingText(v).toUpperCase();
  const carrier = norm(charge?.carrier);
  const code = norm(charge?.charge_code);
  const name = norm(charge?.charge_name);
  const notes = norm(charge?.notes);
  const evidenceLevel = norm(charge?.evidence_level);
  const calcMethod = norm(charge?.calculation_method);
  const defaultAmt = Number(charge?.default_amount);
  const labelText = `${name} ${notes}`;

  // HAPAG_LLOYD/TXI exception: firm validated carrier charge, not a PAD proxy
  if (
    carrier === 'HAPAG_LLOYD' &&
    code === 'TXI' &&
    ['OFFICIAL', 'VALIDATED_INTERNAL'].includes(evidenceLevel) &&
    calcMethod === 'PER_BL' &&
    defaultAmt === 25000
  ) {
    return false;
  }

  // Blocked charge codes
  if ([
    'TXI', 'XPV_20', 'XPV_40', 'PSX_20', 'PSX_40',
    'PCD', 'PORT_TAX', 'PORT_DUES', 'PORT_CHARGES',
  ].includes(code)) {
    return true;
  }

  const ambiguousLabels = [
    'PORT TAX', 'PORT DUES', 'PORT CHARGES', 'TAX IMPORT',
    'TAXE PORT', 'TAXES PORT', 'TAXE DE PORT',
    'DROIT PASSAGE', 'DROITS DE PASSAGE',
    'TAXE PORTUAIRE', 'TAXES PORTUAIRES',
    'REDEVANCE PORTUAIRE', 'REDEVANCES PORTUAIRES',
    'PAD_DROIT_PASSAGE',
  ];

  const containsPortLabel = (text: string, phrase: string): boolean => {
    const tokens = phrase.match(/[A-Z0-9]+/g);
    if (!tokens?.length) return false;
    const escaped = tokens.map((tok) => tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`(^|[^A-Z0-9])${escaped.join('[^A-Z0-9]+')}(?=$|[^A-Z0-9])`).test(text);
  };

  if (ambiguousLabels.some((label) => containsPortLabel(name, label))) {
    return true;
  }

  // COLL only blocked when port/tax wording appears in name or notes
  return code === 'COLL' && ambiguousLabels.some((label) => containsPortLabel(labelText, label));
}

// ═══ P1-B2: lecture du registre des décisions humaines maritimes ═══

const MARITIME_PARAMETRAGE = maritimeParametrageJson as unknown as Parametrage;

/** Colonnes STRICTEMENT nécessaires au pricing — pas de `select('*')`. */
const MARITIME_FEE_DECISION_COLUMNS =
  'id,decision_key,proposal_id,proposal_category,decision_action,suggested_amount_xof,' +
  'decided_amount_xof,currency,evidence_level,source_reference,decision_source,justification,' +
  'proposal_fingerprint,input_snapshot_hash,proposal_snapshot,decision_version,decided_by,created_at';

export interface MaritimeFeeDecisionRead {
  rows: MaritimeFeeDecisionRow[];
  /** Indicateur de disponibilité ; toute erreur bloque le pricing. */
  registryAvailable: boolean;
  /** `true` = lecture en échec : on ne sait rien, donc on bloque. */
  readFailed: boolean;
  errorMessage: string | null;
}

/** Lecture service_role minimale, bornée au dossier courant. Aucun UPDATE. */
export async function readMaritimeFeeDecisions(
  client: { from: (table: string) => {
    select: (columns: string, options: {count: 'exact'}) => {
      eq: (column: string, value: string) => PromiseLike<{
        data: unknown[] | null;
        error: {message?: string} | null;
        count: number | null;
      }>;
    };
  } },
  caseId: string,
): Promise<MaritimeFeeDecisionRead> {
  try {
    const { data, error, count } = await client
      .from('maritime_fee_decisions')
      .select(MARITIME_FEE_DECISION_COLUMNS, { count: 'exact' })
      .eq('case_id', caseId);

    if (error) {
      return {
        rows: [],
        registryAvailable: true,
        readFailed: true,
        errorMessage: String(error?.message ?? 'unknown_error'),
      };
    }

    // SELECT tronqué (limite PostgREST) ou résultat non attesté : on ne sait
    // pas quelles versions sont courantes. Ne jamais choisir dans un historique
    // partiel. Un cache de schéma absent ne prouve pas une table vide non plus.
    if (!Array.isArray(data) || !Number.isSafeInteger(count) || count !== data.length) {
      return { rows: [], registryAvailable: true, readFailed: true,
        errorMessage: 'Registre maritime incomplet ou décompte non vérifiable' };
    }

    return {
      rows: (data ?? []) as MaritimeFeeDecisionRow[],
      registryAvailable: true,
      readFailed: false,
      errorMessage: null,
    };
  } catch (readError) {
    return {
      rows: [],
      registryAvailable: true,
      readFailed: true,
      errorMessage: readError instanceof Error ? readError.message : String(readError),
    };
  }
}

if (Deno.env.get("RUN_PRICING_DISABLE_SERVE") !== "1") {
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // 1. Validate JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = userData.user.id;
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Parse request
    const body = await req.json();
    const case_id: string = body.case_id;
    const allow_provisional: boolean = body.allow_provisional === true;

    if (!case_id) {
      return new Response(
        JSON.stringify({ error: "case_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Load case and verify ownership + status
    const { data: caseData, error: caseError } = await serviceClient
      .from("quote_cases")
      .select("*")
      .eq("id", case_id)
      .single();

    if (caseError || !caseData) {
      return new Response(
        JSON.stringify({ error: "Case not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Phase 16: Intent gate — check latest thread_intent_v1
    const { data: latestIntent } = await serviceClient
      .from("case_timeline_events")
      .select("event_data")
      .eq("case_id", case_id)
      .eq("event_type", "thread_intent_v1")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestIntent) {
      const ed = latestIntent.event_data as Record<string, unknown> | null;
      const intentObj = (ed?.["intent"] as Record<string, unknown>) ?? null;
      const intentType = (intentObj?.["intent_type"] as string) ?? (ed?.["intent_type"] as string) ?? null;
      const pricingGate = intentObj?.["pricing_gate"] ?? ed?.["pricing_gate"] ?? null;

      // Block if pricing_gate is explicitly false OR intent is a blocking type
      const BLOCKING_INTENTS = new Set(["opportunity_check", "general_inquiry", "send_document"]);
      if (pricingGate === false || (intentType && BLOCKING_INTENTS.has(intentType))) {
        console.log(`[Phase16] Pricing blocked by intent: ${intentType}, pricing_gate: ${pricingGate}`);
        return new Response(
          JSON.stringify({
            error: "Pricing blocked by intent",
            blocked_by_intent: true,
            blocking_reason: intentType || "non_pricing_intent",
            hint: "This case requires clarification before pricing",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    // If no intent event exists → continue normally (no block)

    // Mono-tenant app: all authenticated users can access all cases
    // Ownership check removed — JWT auth is sufficient

    // Allow re-pricing from PRICED_DRAFT (corrections) and HUMAN_REVIEW
    const pricingAllowedStatuses = [
      "READY_TO_PRICE",           // legacy — dossiers pré-ACK
      "ACK_READY_FOR_PRICING",
      "PRICED_DRAFT",
      "HUMAN_REVIEW",
      "QUOTED_VERSIONED",
      "SENT",
    ];
    // Lot 4.1 — provisional DDP path: allow upstream statuses ONLY when
    // allow_provisional=true. The PROVISIONAL-DDP-GUARD (mono-lot, scopeWantsDuties,
    // CARGO_VALUE_REQUIRED only) further restricts execution downstream.
    const provisionalUpstreamStatuses = ["NEED_INFO", "FACTS_PARTIAL"];
    const statusAllowedForProvisional =
      allow_provisional && provisionalUpstreamStatuses.includes(caseData.status);
    if (!pricingAllowedStatuses.includes(caseData.status) && !statusAllowedForProvisional) {
      return new Response(
        JSON.stringify({
          error: "Case not ready for pricing",
          current_status: caseData.status,
          allowed_statuses: [...pricingAllowedStatuses, ...provisionalUpstreamStatuses.map(s => `${s} (provisional only)`)],
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const previousStatus = caseData.status;
    const isFinalized = ["SENT", "QUOTED_VERSIONED"].includes(previousStatus);

    // 4. Phase 15.6: Scope query — determine scopeWantsDuties BEFORE hard guard
    const { data: scopeFacts } = await serviceClient
      .from("quote_facts")
      .select("fact_key, value_text, value_number, value_json")
      .eq("case_id", case_id)
      .eq("is_current", true)
      .in("fact_key", [
        "service.package",
        "service.overrides",
        "routing.incoterm",
        "cargo.hs_code",
        "cargo.pad_category",
        "pricing.pad_category",
        "cargo.pad_rate_fcfa_per_ton",
        // Garde terminal : sans cette clé le SELECT ne la remonterait pas et le
        // garde lirait un mode toujours absent, donc bloquerait tous les
        // périmètres DTHC — y compris ceux correctement renseignés.
        TERMINAL_OPERATION_MODE_FACT_KEY,
      ]);

    const servicePackageRaw = (scopeFacts || []).find((f: any) => f.fact_key === "service.package")?.value_text ?? "";
    const pkg = String(servicePackageRaw ?? "").trim().toUpperCase();
    const incotermEarlyRaw = (scopeFacts || []).find((f: any) => f.fact_key === "routing.incoterm")?.value_text ?? "";
    const incotermEarly = String(incotermEarlyRaw ?? "").trim().toUpperCase();
    const scopeWantsDuties = pkg.endsWith("_DDP") || pkg === "DDP" || incotermEarly === "DDP";

    // 4a. Hard guard — ALL blocking gaps must be resolved
    // Lot 4.1 exception: if allow_provisional=true and the ONLY open blocking gap is cargo.value,
    // bypass this guard. The downstream PROVISIONAL-DDP-GUARD remains the final gatekeeper.
    const { data: blockingGapsRows } = await serviceClient
      .from("quote_gaps")
      .select("gap_key")
      .eq("case_id", case_id)
      .eq("is_blocking", true)
      .eq("status", "open");

    const blockingGapsCount = blockingGapsRows?.length ?? 0;
    const provisionalBypass =
      allow_provisional === true &&
      blockingGapsCount > 0 &&
      blockingGapsRows!.every((g: any) => g.gap_key === "cargo.value");

    if (blockingGapsCount > 0 && !provisionalBypass) {
      return new Response(
        JSON.stringify({ 
          error: "Blocking gaps still open",
          blocking_gaps_count: blockingGapsCount,
          hint: "Resolve blocking gaps before pricing"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4a-bis. P3b.1: Multi-lot orchestrator — per-lot pricing when structured lines exist
    const openCommunicationLoopsGuard = await getOpenCommunicationLoopsGuard(serviceClient, case_id);
    if (openCommunicationLoopsGuard.blocked) {
      return new Response(
        JSON.stringify({
          error: "Open communication loops still pending",
          open_partner_requests_count: openCommunicationLoopsGuard.open_partner_requests_count,
          pending_partner_facts_count: openCommunicationLoopsGuard.pending_partner_facts_count,
          open_client_gap_requests_count: openCommunicationLoopsGuard.open_client_gap_requests_count,
          hint: "Close or validate pending client/partner communication loops before pricing",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const selectedPartnerOfferGuard = await getSelectedPartnerOfferGuard(serviceClient, case_id);
    if (selectedPartnerOfferGuard.blocked) {
      return new Response(
        JSON.stringify({
          error: "Selected partner offer mismatch",
          selected_partner_request_id: selectedPartnerOfferGuard.selected_partner_request_id,
          selected_partner_request_ids: selectedPartnerOfferGuard.selected_partner_request_ids,
          validated_partner_request_ids: selectedPartnerOfferGuard.validated_partner_request_ids,
          mismatched_fact_keys: selectedPartnerOfferGuard.mismatched_fact_keys,
          reason: selectedPartnerOfferGuard.reason,
          hint: "Select the partner offer matching the validated pricing facts or revalidate the selected offer before pricing",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ═══ P1-B2: registre des décisions humaines maritimes (lecture unique) ═══
    // Placée ici, APRÈS l'auth et les gardes d'entrée, AVANT la bifurcation
    // mono/multi-lot : les deux branches en dépendent et aucune ne doit lire le
    // registre une seconde fois. Aucun UPDATE, aucune écriture, dossier courant
    // uniquement.
    const maritimeDecisionRead = await readMaritimeFeeDecisions(
      serviceClient as unknown as Parameters<typeof readMaritimeFeeDecisions>[0], case_id,
    );
    if (maritimeDecisionRead.readFailed) {
      console.error(
        `[P1-B2] Lecture du registre des décisions maritimes en échec: ${maritimeDecisionRead.errorMessage}`,
      );
      const { data: mfdReadRunNumber } = await serviceClient
        .rpc("get_next_pricing_run_number", { p_case_id: case_id });
      const mfdReadMessage =
        MARITIME_FEE_DECISION_BLOCKER_MESSAGES[MARITIME_FEE_DECISION_READ_FAILED];

      await serviceClient.from("pricing_runs").insert({
        case_id,
        run_number: mfdReadRunNumber || 1,
        inputs_json: { servicePackage: pkg, incoterm: incotermEarly },
        facts_snapshot: [],
        status: "blocked",
        error_message: mfdReadMessage,
        outputs_json: {
          pricing_blockers: [MARITIME_FEE_DECISION_READ_FAILED],
          message: mfdReadMessage,
          maritime_fee_decisions: { registry_read_failed: true },
        },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        created_by: userId,
      });

      return new Response(
        JSON.stringify({
          pricing_blockers: [MARITIME_FEE_DECISION_READ_FAILED],
          message: mfdReadMessage,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const maritimeDecisionRows = maritimeDecisionRead.rows;

    const { count: mlCount } = await serviceClient
      .from("quote_request_lines")
      .select("*", { count: "exact", head: true })
      .eq("case_id", case_id);

    if ((mlCount ?? 0) >= 2) {
      console.log(`[P3b.1] Multi-lot detected: ${mlCount} quote_request_lines. Entering per-lot orchestration.`);

      // Load all request lines
      const { data: requestLines, error: rlError } = await serviceClient
        .from("quote_request_lines")
        .select("id, line_index, line_label, request_type_hint, extracted_facts_json")
        .eq("case_id", case_id)
        .order("line_index", { ascending: true });

      if (rlError || !requestLines || requestLines.length < 2) {
        console.error("[P3b.1] Failed to load request lines:", rlError);
        return new Response(
          JSON.stringify({ error: "Failed to load multi-lot request lines" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Guard: check all lots have request_type_hint
      const missingHintLots = requestLines
        .filter((rl: any) => !rl.request_type_hint || String(rl.request_type_hint).trim() === "")
        .map((rl: any) => ({
          lot_index: rl.line_index,
          lot_label: rl.line_label || `Lot ${rl.line_index}`,
          blockers: ["LOT_REQUEST_TYPE_REQUIRED"],
          message: `Le lot ${rl.line_index} ne contient pas de request_type_hint exploitable.`,
        }));

      if (missingHintLots.length > 0) {
        const { data: mlGuardRunNumber } = await serviceClient
          .rpc("get_next_pricing_run_number", { p_case_id: case_id });

        const mlGuardMessage = `Pricing multi-lot bloqué : ${missingHintLots.length} lot(s) sans request_type_hint.`;

        await serviceClient.from("pricing_runs").insert({
          case_id,
          run_number: mlGuardRunNumber || 1,
          inputs_json: { mode: "multi_lot", lot_count: requestLines.length },
          facts_snapshot: [],
          status: "blocked",
          error_message: mlGuardMessage,
          outputs_json: {
            pricing_blockers: ["MULTI_LOT_BLOCKED"],
            multi_lot: true,
            blocked_lots: missingHintLots,
            message: mlGuardMessage,
          },
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          created_by: userId,
        });

        return new Response(
          JSON.stringify({
            pricing_blockers: ["MULTI_LOT_BLOCKED"],
            message: mlGuardMessage,
            blocked_lots: missingHintLots,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Load global facts
      const { data: globalFacts, error: gfError } = await serviceClient
        .from("quote_facts")
        .select("*")
        .eq("case_id", case_id)
        .eq("is_current", true);

      if (gfError) {
        return new Response(
          JSON.stringify({ error: "Failed to load global facts" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const globalFactsSnapshot = (globalFacts || []).map((f: any) => ({
        id: f.id, key: f.fact_key, category: f.fact_category,
        value_text: f.value_text, value_number: f.value_number,
        value_json: f.value_json, value_date: f.value_date,
        source_type: f.source_type, confidence: f.confidence,
      }));

      // P1-B2 — évalué UNE fois pour tout le dossier, appliqué à chaque lot.
      const maritimeMultiLotBlocked = hasActiveMaritimeDecision(maritimeDecisionRows);

      // Per-lot coherence checks
      const lotChecks: Array<{
        lot_index: number; lot_label: string; request_type_hint: string;
        mergedFacts: any[]; inputs: PricingInputs; servicePackage: string | undefined;
        transportMode: string; scopeWantsDuties: boolean; blockers: string[];
      }> = [];

      for (const rl of requestLines) {
        const lotIndex = rl.line_index;
        const lotLabel = rl.line_label || `Lot ${lotIndex}`;
        const requestTypeHint = String(rl.request_type_hint || "").trim();
        const extractedFacts = Array.isArray(rl.extracted_facts_json) ? rl.extracted_facts_json : [];

        // Merge facts: lot-specific overrides global
        const mergedFacts = mergeFactsForLot(globalFacts || [], extractedFacts);
        const lotInputs = buildPricingInputs(mergedFacts);

        // Resolve per-lot service package and transport mode
        const lotIncoterm = String(lotInputs.incoterm ?? "").trim().toUpperCase();
        const lotServicePackage = resolveServicePackageForLot(requestTypeHint, lotIncoterm, lotInputs.servicePackage);
        const lotTransportMode = resolveTransportModeForLot(requestTypeHint);


        if (lotServicePackage) {
          lotInputs.servicePackage = lotServicePackage;
        }

        // Per-lot scope analysis
        const lotPkg = String(lotInputs.servicePackage ?? "").toUpperCase();
        const lotScopeWantsDuties = lotPkg.endsWith("_DDP") || lotPkg === "DDP" || lotIncoterm === "DDP";

        const lotBlockers: string[] = [];
        const lotEffectiveServiceKeys = resolveEffectiveServiceKeys(lotPkg, readOverridesFromFacts(mergedFacts));
        // P0-E: fail-closed. PAD_CATEGORY_REQUIRED when the PAD facts are missing (unchanged),
        // PAD_MULTI_LOT_UNSUPPORTED when they are present — the cargo.pad_* facts are GLOBAL and
        // the enrichment_pad block is mono-lot, so no PAD line would ever be produced per lot.
        const lotPadBlockers = resolvePadBlockersForLot({
          facts: mergedFacts,
          servicePackage: lotPkg,
          effectiveServiceKeys: lotEffectiveServiceKeys,
          incoterm: lotIncoterm,
        });
        if (lotPadBlockers.includes(PAD_MULTI_LOT_UNSUPPORTED)) {
          console.warn(
            `[P0-E][multi-lot ${lotIndex}] ${PAD_MULTI_LOT_UNSUPPORTED}: scope ${lotPkg} in PAD range (${lotEffectiveServiceKeys.join(', ')}) but no per-lot PAD computation exists — blocking instead of under-charging.`,
          );
        }
        lotBlockers.push(...lotPadBlockers);

        // TERMINAL-GUARD multi-lot : mêmes codes qu'en mono-lot, sur les faits
        // DÉCLARÉS PAR LE LOT uniquement — le mode global n'est pas propagé.
        const lotTerminalBlockers = resolveTerminalBlockersForLot({
          lotExtractedFacts: extractedFacts,
          effectiveServiceKeys: lotEffectiveServiceKeys,
        });
        if (lotTerminalBlockers.length > 0) {
          console.warn(
            `[TERMINAL-GUARD][multi-lot ${lotIndex}] ${lotTerminalBlockers.join(', ')}: scope ${lotPkg} (${lotEffectiveServiceKeys.join(', ')}) — opérateur terminal ou barème Dakar Terminal indéterminé pour ce lot.`,
          );
        }
        lotBlockers.push(...lotTerminalBlockers);

        // P1-B2 — MARITIME-DECISION multi-lot : une décision humaine porte sur
        // le DOSSIER, jamais sur un lot. Rien dans `maritime_fee_decisions` ne
        // permet de dire à QUEL lot un frais confirmé appartient : l'affecter à
        // un lot serait une invention, l'ignorer une perte silencieuse. On
        // bloque donc tous les lots tant qu'une décision courante n'est pas
        // révoquée. À REMPLACER (jamais simplement supprimer) le jour où le
        // registre portera une identité de lot.
        if (maritimeMultiLotBlocked) {
          console.warn(
            `[P1-B2][multi-lot ${lotIndex}] ${MARITIME_FEE_DECISION_MULTI_LOT_UNSUPPORTED}: décision maritime active sans identité de lot.`,
          );
          lotBlockers.push(MARITIME_FEE_DECISION_MULTI_LOT_UNSUPPORTED);
        }

        // HS code check
        if (lotScopeWantsDuties) {
          const rawHs = String(lotInputs.hsCode ?? "");
          const hsCandidates = rawHs.split(/[;,]/).map((c: string) => c.trim().replace(/\D/g, "")).filter(Boolean);
          const firstValidHs10 = hsCandidates.find((c: string) => c.length === 10);
          const hsDigits = firstValidHs10 || rawHs.replace(/\D/g, "");
          if (!hsDigits || hsDigits.length !== 10) {
            lotBlockers.push("HS_CODE_REQUIRED");
          }
        }

        // Freight check for FOB-type incoterms
        if (lotScopeWantsDuties && ["FOB", "FCA", "FAS", "EXW"].includes(lotIncoterm)) {
          if (!lotInputs.freightCost || lotInputs.freightCost <= 0) {
            lotBlockers.push("FREIGHT_REQUIRED_FOR_FOB");
          }
        }

        // Cargo value check
        if (lotScopeWantsDuties && (!lotInputs.cargoValue || lotInputs.cargoValue <= 0)) {
          lotBlockers.push("CARGO_VALUE_REQUIRED");
        }

        // Fix 1: Service package guard — block if hint present but unresolved
        if (requestTypeHint && !lotServicePackage) {
          lotBlockers.push("LOT_SERVICE_PACKAGE_UNRESOLVED");
        }

        // Fix 2: Regime coherence check per lot (mirrors mono-lot check)
        if (lotScopeWantsDuties) {
          const lotFactMap = new Map(mergedFacts.map((f: any) => [f.fact_key, f]));
          const hasExemptionTitle = !!lotFactMap.get("regulatory.exemption_title")?.value_text;
          const hasRegimeCode = !!lotFactMap.get("customs.regime_code")?.value_text;
          if (hasExemptionTitle && !hasRegimeCode) {
            lotBlockers.push("REGIME_REQUIRED_FOR_EXEMPTION");
          }
        }

        lotChecks.push({
          lot_index: lotIndex,
          lot_label: lotLabel,
          request_type_hint: requestTypeHint,
          mergedFacts,
          inputs: lotInputs,
          servicePackage: lotServicePackage,
          transportMode: lotTransportMode,
          scopeWantsDuties: lotScopeWantsDuties,
          blockers: lotBlockers,
        });
      }

      // If ANY lot has blockers → block entire run
      // Lot 4 micro-fix: multi-lot provisional DDP is NOT supported (no per-lot PROVISIONAL-DDP-GUARD).
      // allow_provisional has no effect in multi-lot mode — pre-Lot 4 behavior preserved.
      const blockedLots = lotChecks.filter(lc => {
        if (lc.blockers.length === 0) return false;
        return true;
      });
      if (blockedLots.length > 0) {
        const { data: mlBlockedRunNumber } = await serviceClient
          .rpc("get_next_pricing_run_number", { p_case_id: case_id });

        const mlBlockedMessage = `Le pricing multi-lot est bloqué : ${blockedLots.length} lot(s) incomplet(s).`;

        await serviceClient.from("pricing_runs").insert({
          case_id,
          run_number: mlBlockedRunNumber || 1,
          inputs_json: {
            mode: "multi_lot",
            lot_count: lotChecks.length,
            lots: lotChecks.map(lc => ({
              lot_index: lc.lot_index, request_type_hint: lc.request_type_hint,
              service_package: lc.servicePackage, transport_mode: lc.transportMode,
            })),
          },
          facts_snapshot: globalFactsSnapshot,
          status: "blocked",
          error_message: mlBlockedMessage,
          outputs_json: {
            pricing_blockers: ["MULTI_LOT_BLOCKED"],
            multi_lot: true,
            blocked_lots: blockedLots.map(bl => ({
              lot_index: bl.lot_index, lot_label: bl.lot_label,
              blockers: bl.blockers,
              message: `Lot ${bl.lot_index} (${bl.lot_label}) : ${bl.blockers.join(", ")}`,
            })),
            message: mlBlockedMessage,
          },
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          created_by: userId,
        });

        return new Response(
          JSON.stringify({
            pricing_blockers: ["MULTI_LOT_BLOCKED"],
            message: mlBlockedMessage,
            blocked_lots: blockedLots.map(bl => ({
              lot_index: bl.lot_index, lot_label: bl.lot_label, blockers: bl.blockers,
            })),
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ALL lots pass — transition to PRICING_RUNNING
      if (!isFinalized) {
        await serviceClient.from("quote_cases").update({
          status: "PRICING_RUNNING",
          last_activity_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", case_id);

        await serviceClient.from("case_timeline_events").insert({
          case_id, event_type: "status_changed",
          previous_value: previousStatus, new_value: "PRICING_RUNNING",
          actor_type: "system",
        });
      }

      // Get run number
      const { data: mlRunNumber, error: mlRpcError } = await serviceClient
        .rpc("get_next_pricing_run_number", { p_case_id: case_id });

      if (mlRpcError || mlRunNumber === null) {
        await rollbackToPreviousStatus(serviceClient, case_id, previousStatus, "ml_run_number_failed");
        throw new Error(`Failed to get multi-lot run number: ${mlRpcError?.message || "null"}`);
      }

      // Create pricing_run record
      const mlInputsJson = {
        mode: "multi_lot",
        lot_count: lotChecks.length,
        lots: lotChecks.map(lc => ({
          lot_index: lc.lot_index, request_type_hint: lc.request_type_hint,
          service_package: lc.servicePackage, transport_mode: lc.transportMode,
        })),
      };

      const { data: mlRunData, error: mlRunInsertError } = await serviceClient
        .from("pricing_runs")
        .insert({
          case_id,
          run_number: mlRunNumber,
          inputs_json: mlInputsJson,
          facts_snapshot: globalFactsSnapshot,
          status: "running",
          started_at: new Date().toISOString(),
          created_by: userId,
        })
        .select("id")
        .single();

      if (mlRunInsertError || !mlRunData) {
        await rollbackToPreviousStatus(serviceClient, case_id, previousStatus, "ml_run_insert_failed");
        throw new Error(`Multi-lot run insert failed: ${mlRunInsertError?.message}`);
      }

      await serviceClient.from("case_timeline_events").insert({
        case_id, event_type: "pricing_started",
        event_data: { run_number: mlRunNumber, mode: "multi_lot", lot_count: lotChecks.length },
        related_pricing_run_id: mlRunData.id,
        actor_type: "system",
      });

      // Execute quotation-engine for each lot
      const engineUrl = `${supabaseUrl}/functions/v1/quotation-engine`;
      const lotResults: Array<{
        lot_index: number; lot_label: string; lines: any[]; sources: any[];
        totals: {
          ht: number; ttc: number; currency: string;
          subtotal_before_sodatra_vat: number; total_payable: number;
          honoraires_ht: number; honoraires_tva: number; honoraires_ttc: number;
          operationnel: number; border: number; terminal: number;
          debours_douaniers: number; debours_enrichment: number;
          local_transport_debours_ttc: number; local_transport_commission: number;
          debours_total: number; dap: number; ddp: number;
        };
        engine_request: any; engine_response: any;
      }> = [];

      for (const lc of lotChecks) {
        try {
          // ═══ EXPORT GUARD (multi-lot): bypass quotation-engine for EXPORT_* packages ═══
          const lotPkgKey = String(lc.servicePackage || '').trim().toUpperCase();
          const isLotExportFlow = lotPkgKey.startsWith('EXPORT_');

          let lotEngineResponse: any;
          let lotEngineParams: any = null;

          if (isLotExportFlow) {
            console.log(`[EXPORT-GUARD] Lot ${lc.lot_index}: EXPORT package "${lotPkgKey}" detected — bypassing quotation-engine`);
            lotEngineParams = { mode: 'export-bypass', package: lotPkgKey };
            // Synthetic response: proven minimal shape consumed by downstream
            lotEngineResponse = {
              lines: [],
              totals: { honoraires: 0, debours: 0 },
              currency: 'XOF',
              duty_breakdown: [],
              version: 'export-guard-v1',
            };
          } else {
          lotEngineParams = {
            finalDestination: lc.inputs.finalDestination,
            originPort: lc.inputs.originPort,
            originAirport: lc.inputs.originAirport,
            incoterm: lc.inputs.incoterm,
            containers: lc.inputs.containers,
            cargoWeight: lc.inputs.cargoWeight,
            cargoVolume: lc.inputs.cargoVolume,
            cargoValue: lc.inputs.cargoValue,
            cargoCurrency: lc.inputs.cargoValueCurrency,
            carrier: lc.inputs.carrier,
            transportMode: lc.transportMode,
            cargoDescription: lc.inputs.cargoDescription,
            clientCompany: lc.inputs.clientCompany,
            hsCode: lc.inputs.hsCode,
            articlesDetail: lc.inputs.articlesDetail,
            regimeCode: lc.inputs.regimeCode || undefined,
            freightAmount: lc.inputs.freightCost,
            freightCurrency: lc.inputs.freightCurrency,
            // Lot 1.2: propagation client.code (passe-plat, consommé en Lot 2)
            clientCode: resolveClientCode(globalFacts || []),
          };

          // Lot 1.2: preuve de propagation (smoke G1.2-A/B)
          console.log(`[LOT1.2][multi-lot ${lc.lot_index}] engineParams.clientCode=${JSON.stringify(lotEngineParams.clientCode)}`);

          const engineRes = await fetch(engineUrl, {
            method: "POST",
            headers: { Authorization: authHeader, "Content-Type": "application/json" },
            body: JSON.stringify({ action: "generate", params: lotEngineParams }),
          });

          if (!engineRes.ok) {
            const errorText = await engineRes.text();
            throw new Error(`Lot ${lc.lot_index}: quotation-engine error: ${engineRes.status} - ${errorText}`);
          }

          lotEngineResponse = await engineRes.json();
          } // end else (non-export)
          const lotCanonicalLines = (lotEngineResponse.lines || lotEngineResponse.quotationLines || [])
            .map((l: any) => canonicalizeLine(l, { origin_layer: 'engine_structural' }));

          // SCOPE-REMOVE: same helper as mono-lot — services explicitly removed via
          // `service.overrides.remove` (add wins) leave the structural lines AND the
          // raw engine totals HERE, before sources, coverage, enrichment and totals.
          const lotRemovedServiceKeys = resolveExplicitlyRemovedServiceKeys(
            readOverridesFromFacts(lc.mergedFacts),
          );
          const lotScopeRemoval = applyExplicitServiceRemovals(
            lotCanonicalLines, lotEngineResponse.totals, lotRemovedServiceKeys,
          );
          if (lotScopeRemoval.removedLines.length > 0) {
            console.log(
              `[SCOPE-REMOVE] Lot ${lc.lot_index}: dropped ${lotScopeRemoval.removedLines.length} structural line(s): ${lotScopeRemoval.removedLines.map((l) => `${l?.canonical?.service_key}=${l?.amount ?? 'null'}`).join(', ')}`,
            );
          }
          // Same precedent as EXPORT-GUARD below: keep engine_response coherent
          // with what the run actually prices downstream (reading the kept lines
          // back through the response keeps downstream typing identical to the
          // engine payload).
          lotEngineResponse.lines = lotScopeRemoval.keptLines;
          lotEngineResponse.totals = lotScopeRemoval.adjustedTotals;
          const lotLines = lotEngineResponse.lines;

          // Build tariff sources for this lot
          const lotSourceMap = new Map<string, any>();
          for (const line of lotLines) {
            if (line.source?.reference && line.source?.type !== "TO_CONFIRM") {
              const key = `${line.source.type}_${line.source.reference}`;
              lotSourceMap.set(key, {
                type: line.source.type, reference: line.source.reference,
                table: line.source.table || line.source.type,
                confidence: line.source.confidence,
              });
            }
          }

          // Keep the raw engine totals until package enrichment is complete.
          const lotEngineTotals = lotEngineResponse.totals;
          const lotCurrency = lotEngineResponse.currency || "XOF";

          // Tag each line with lot_index and lot_label
          const taggedLines = lotLines.map((line: any) => ({
            ...line,
            lot_index: lc.lot_index,
            lot_label: lc.lot_label,
          }));

          // ═══ P5: Package service lines enrichment (multi-lot) ═══
          const lotPackageKey = (lc.servicePackage || '').trim().toUpperCase();
          if (lotPackageKey && SERVICE_PACKAGES[lotPackageKey]) {
            try {
              const lotOverrides = readOverridesFromFacts(lc.mergedFacts);
              const lotEffectiveKeys = resolveEffectiveServiceKeys(lotPackageKey, lotOverrides);
              const lotCoverage = inferCoveredServiceDiagnostics(lotLines);
              const lotCoveredKeys = lotCoverage.covered;
              // P0-E: the PAD markers never go to price-service-lines (see
              // excludePadScopeKeysForEnrichment). lotEffectiveKeys stays unfiltered above,
              // where the per-lot PAD guard reads it.
              // Reaching this point with a PAD-scoped lot is impossible: resolvePadBlockersForLot
              // has already blocked the whole run (PAD_CATEGORY_REQUIRED or
              // PAD_MULTI_LOT_UNSUPPORTED). The filter therefore removes a line that was worth
              // 0 XOF, never a charge the run still owed.
              const lotMissingKeys = excludePadScopeKeysForEnrichment(
                lotEffectiveKeys.filter(k => !lotCoveredKeys.has(k)),
              );

              console.log(
                `[P5] Lot ${lc.lot_index}: categories=${lotCoverage.categoriesSeen.join(' | ') || 'none'}; covered=${Array.from(lotCoveredKeys).join(', ') || 'none'}; missing=${lotMissingKeys.join(', ') || 'none'}${lotCoverage.matchedByDescription.length ? `; desc_fallback=${lotCoverage.matchedByDescription.join(' | ')}` : ''}`,
              );

              if (lotMissingKeys.length > 0) {
                console.log(`[P5] Lot ${lc.lot_index}: ${lotMissingKeys.length} package services to enrich: ${lotMissingKeys.join(', ')}`);

                const lotServiceInputs = lotMissingKeys.map(sk => ({
                  id: crypto.randomUUID(),
                  service: sk,
                  unit: PACKAGE_SERVICE_DEFAULT_UNITS[sk] || 'forfait',
                  quantity: 1,
                  currency: 'XOF',
                }));

                // Build pricing_context_override from lot inputs
                const pricingCtxOverride: Record<string, unknown> = {
                  scope: lotPackageKey.startsWith('EXPORT_') ? 'export' : 'import',
                  containers: Array.isArray(lc.inputs.containers) ? lc.inputs.containers : [],
                  container_type: lc.inputs.containers?.[0]?.type || null,
                  container_count: Array.isArray(lc.inputs.containers)
                    ? lc.inputs.containers.reduce((s: number, c: any) => s + Number(c?.quantity ?? 1), 0)
                    : null,
                  weight_kg: lc.inputs.cargoWeight || null,
                  caf_value: null,
                  destination_city: lc.inputs.finalDestination || null,
                  destination_country: null,
                  origin_country: null,
                  origin_port: lc.inputs.originPort || null,
                  client_code: resolveClientCode(globalFacts || []), // Lot 1.2: propagation depuis quote_facts
                  corridor: null,
                };

                const pslUrl = `${supabaseUrl}/functions/v1/price-service-lines`;
                const pslRes = await fetch(pslUrl, {
                  method: 'POST',
                  headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    case_id,
                    service_lines: lotServiceInputs,
                    pricing_context_override: pricingCtxOverride,
                  }),
                });

                // P5.1: Build UUID→service_key lookup before consuming response
                const idToServiceKey = new Map(lotServiceInputs.map(sl => [sl.id, sl.service]));

                if (pslRes.ok) {
                  const pslData = await pslRes.json();
                  const pricedLines = pslData?.data?.priced_lines || [];
                  for (const pl of pricedLines) {
                    const serviceKey = idToServiceKey.get(pl.id) || pl.id;
                    const label = SERVICE_KEY_LABELS[serviceKey] || serviceKey;
                    const packageLine = canonicalizeLine({
                      category: serviceKey,
                      label: label,
                      amount: pl.rate ?? 0,
                      currency: pl.currency || 'XOF',
                      type: 'service_package',
                      source: { type: pl.source || 'price-service-lines', reference: 'P5', confidence: pl.confidence ?? 0 },
                      quantity: pl.quantity_used ?? 1,
                      unit: pl.unit_used ?? PACKAGE_SERVICE_DEFAULT_UNITS[serviceKey] ?? 'forfait',
                      explanation: pl.explanation || '',
                      lot_index: lc.lot_index,
                      lot_label: lc.lot_label,
                    }, { origin_layer: 'package_enrichment' });
                    taggedLines.push(
                      isLocalTransportRateSource(pl.source)
                        ? withLocalTransportDebours(packageLine)
                        : packageLine,
                    );
                  }
                  console.log(`[P5] Lot ${lc.lot_index}: merged ${pricedLines.length} priced service lines`);
                } else {
                  console.warn(`[P5] Lot ${lc.lot_index}: price-service-lines failed (${pslRes.status}), continuing`);
                }
              }
            } catch (p5LotError) {
              console.warn(`[P5] Lot ${lc.lot_index}: package enrichment failed, continuing:`, p5LotError);
            }
          }

          // ═══ EXPORT-GUARD: Recalculate totals + sources after P5 enrichment for export lots ═══
          if (isLotExportFlow && taggedLines.length > 0) {
            const exportClassification = classifyExportTotals(taggedLines);

            // Update lotEngineResponse.totals so downstream engine_response is coherent
            lotEngineResponse.totals = {
              honoraires: exportClassification.honoraires,
              debours: exportClassification.debours,
              operationnel: exportClassification.operationnel,
            };

            // Complete lotSourceMap with P5 export line sources (Bug 4 fix)
            for (const line of taggedLines) {
              if (line.source?.reference && line.source?.type !== 'TO_CONFIRM') {
                const key = `${line.source.type}_${line.source.reference}`;
                if (!lotSourceMap.has(key)) {
                  lotSourceMap.set(key, {
                    type: line.source.type, reference: line.source.reference,
                    table: line.source.table || line.source.type,
                    confidence: line.source.confidence,
                  });
                }
              }
            }

            console.log(`[EXPORT-GUARD] Lot ${lc.lot_index}: recalculated totals — honoraires=${exportClassification.honoraires}, operationnel=${exportClassification.operationnel}, debours=0`);
          }

          const lotCommercialTotals = computeCommercialTotals({
            engineTotals: lotEngineResponse.totals || lotEngineTotals,
            lines: taggedLines,
          });

          lotResults.push({
            lot_index: lc.lot_index,
            lot_label: lc.lot_label,
            lines: taggedLines,
            sources: Array.from(lotSourceMap.values()),
            totals: {
              ht: lotCommercialTotals.totalHt,
              ttc: lotCommercialTotals.totalTtc,
              currency: lotCurrency,
              subtotal_before_sodatra_vat: lotCommercialTotals.subtotalBeforeSodatraVat,
              total_payable: lotCommercialTotals.totalPayable,
              honoraires_ht: lotCommercialTotals.honorairesHt,
              honoraires_tva: lotCommercialTotals.honorairesTva,
              honoraires_ttc: lotCommercialTotals.honorairesTtc,
              operationnel: lotCommercialTotals.operationnel,
              border: lotCommercialTotals.border,
              terminal: lotCommercialTotals.terminal,
              debours_douaniers: lotCommercialTotals.deboursDouaniers,
              debours_enrichment: lotCommercialTotals.deboursEnrichment,
              local_transport_debours_ttc: lotCommercialTotals.localTransportDeboursTtc,
              local_transport_commission: lotCommercialTotals.localTransportCommission,
              debours_total: lotCommercialTotals.deboursTotal,
              dap: lotCommercialTotals.dap,
              ddp: lotCommercialTotals.ddp,
            },
            engine_request: lotEngineParams,
            engine_response: lotEngineResponse,
          });
        } catch (lotEngineError: any) {
          console.error(`[P3b.1] Engine failed for lot ${lc.lot_index}:`, lotEngineError);

          // ANY lot failure → block entire run
          await serviceClient.from("pricing_runs").update({
            status: "failed",
            error_message: `Lot ${lc.lot_index} engine failure: ${lotEngineError.message}`,
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
          }).eq("id", mlRunData.id);

          await rollbackToPreviousStatus(serviceClient, case_id, previousStatus, `ml_lot_${lc.lot_index}_engine_failed`);

          await serviceClient.from("case_timeline_events").insert({
            case_id, event_type: "pricing_failed",
            event_data: { error: lotEngineError.message, run_number: mlRunNumber, failed_lot: lc.lot_index },
            related_pricing_run_id: mlRunData.id,
            actor_type: "system",
          });

          return new Response(
            JSON.stringify({
              error: "Multi-lot pricing failed",
              failed_lot: lc.lot_index,
              details: lotEngineError.message,
              pricing_run_id: mlRunData.id,
            }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // ALL lots succeeded — aggregate results
      const allTaggedLines = lotResults.flatMap(lr => lr.lines);
      const allSources: any[] = [];
      const sourceDedup = new Set<string>();
      for (const lr of lotResults) {
        for (const src of lr.sources) {
          const key = `${src.type}_${src.reference}`;
          if (!sourceDedup.has(key)) {
            sourceDedup.add(key);
            allSources.push(src);
          }
        }
      }

      const aggregatedHt = lotResults.reduce((sum, lr) => sum + lr.totals.ht, 0);
      const aggregatedTtc = lotResults.reduce((sum, lr) => sum + lr.totals.ttc, 0);
      const aggregatedCurrency = lotResults[0]?.totals.currency || "XOF";
      const sumLotTotal = (key: keyof (typeof lotResults)[number]['totals']) =>
        lotResults.reduce((sum, lot) => {
          const value = lot.totals[key];
          return sum + (typeof value === 'number' ? value : 0);
        }, 0);

      const mlDurationMs = Date.now() - startTime;

      // Dual storage: structured detail in outputs_json + root-level columns
      const mlOutputsJson = {
        multi_lot: true,
        lots: lotResults.map(lr => ({
          lot_index: lr.lot_index,
          label: lr.lot_label,
          lines: lr.lines,
          totals: lr.totals,
          duty_breakdown: lr.engine_response.duty_breakdown || [],
        })),
        totals: {
          ht: aggregatedHt,
          ttc: aggregatedTtc,
          currency: aggregatedCurrency,
          subtotal_before_sodatra_vat: sumLotTotal('subtotal_before_sodatra_vat'),
          total_payable: sumLotTotal('total_payable'),
          honoraires_ht: sumLotTotal('honoraires_ht'),
          honoraires_tva: sumLotTotal('honoraires_tva'),
          honoraires_ttc: sumLotTotal('honoraires_ttc'),
          operationnel: sumLotTotal('operationnel'),
          border: sumLotTotal('border'),
          terminal: sumLotTotal('terminal'),
          debours_douaniers: sumLotTotal('debours_douaniers'),
          debours_enrichment: sumLotTotal('debours_enrichment'),
          local_transport_debours_ttc: sumLotTotal('local_transport_debours_ttc'),
          local_transport_commission: sumLotTotal('local_transport_commission'),
          debours_total: sumLotTotal('debours_total'),
          dap: sumLotTotal('dap'),
          ddp: sumLotTotal('ddp'),
        },
        lines: allTaggedLines,
        metadata: {
          engine_version: lotResults[0]?.engine_response?.version || "v4",
          computed_at: new Date().toISOString(),
          mode: "multi_lot",
          lot_count: lotResults.length,
        },
      };

      await serviceClient.from("pricing_runs").update({
        status: "success",
        engine_request: {
          mode: "multi_lot",
          lot_count: lotResults.length,
          lots: lotResults.map(lr => ({ lot_index: lr.lot_index, params: lr.engine_request })),
        },
        engine_response: {
          mode: "multi_lot",
          lot_count: lotResults.length,
          lots: lotResults.map(lr => ({ lot_index: lr.lot_index, response: lr.engine_response })),
        },
        outputs_json: mlOutputsJson,
        tariff_lines: allTaggedLines,
        total_ht: aggregatedHt,
        total_ttc: aggregatedTtc,
        currency: aggregatedCurrency,
        tariff_sources: allSources,
        completed_at: new Date().toISOString(),
        duration_ms: mlDurationMs,
      }).eq("id", mlRunData.id);

      // Status transition
      if (!isFinalized) {
        await serviceClient.from("quote_cases").update({
          status: "PRICED_DRAFT",
          pricing_runs_count: mlRunNumber,
          last_activity_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", case_id);
      } else {
        await serviceClient.from("quote_cases").update({
          pricing_runs_count: mlRunNumber,
          last_activity_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", case_id);
      }

      await serviceClient.from("case_timeline_events").insert({
        case_id, event_type: "pricing_completed",
        event_data: {
          run_number: mlRunNumber, mode: "multi_lot", lot_count: lotResults.length,
          total_ht: aggregatedHt, lines_count: allTaggedLines.length, duration_ms: mlDurationMs,
        },
        related_pricing_run_id: mlRunData.id,
        actor_type: "system",
      });

      if (!isFinalized) {
        await serviceClient.from("case_timeline_events").insert({
          case_id, event_type: "status_changed",
          previous_value: "PRICING_RUNNING", new_value: "PRICED_DRAFT",
          actor_type: "system",
        });
      }

      console.log(`[P3b.1] Multi-lot pricing run ${mlRunNumber} for case ${case_id} completed in ${mlDurationMs}ms — ${lotResults.length} lots, ${allTaggedLines.length} lines`);

      return new Response(
        JSON.stringify({
          pricing_run_id: mlRunData.id,
          run_number: mlRunNumber,
          mode: "multi_lot",
          lot_count: lotResults.length,
          total_ht: aggregatedHt,
          total_ttc: aggregatedTtc,
          currency: aggregatedCurrency,
          lines_count: allTaggedLines.length,
          duration_ms: mlDurationMs,
          tariff_sources_count: allSources.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const effectiveServiceKeys = resolveEffectiveServiceKeys(pkg, readOverridesFromFacts(scopeFacts || []));
    const padScopeBlocker = resolvePadScopeBlocker({
      facts: scopeFacts || [],
      servicePackage: pkg,
      effectiveServiceKeys,
      incoterm: incotermEarly,
    });

    if (padScopeBlocker) {
      console.error("[COHERENCE] puzzle/pricing drift", {
        case_id,
        missing: "cargo.pad_category",
        blocker: "PAD_CATEGORY_REQUIRED",
        servicePackage: pkg,
        incoterm: incotermEarly,
        effectiveServiceKeys,
      });

      const { data: padBlockerRunNumber } = await serviceClient
        .rpc('get_next_pricing_run_number', { p_case_id: case_id });

      const padBlockerOutputs = {
        pricing_blockers: padScopeBlocker.pricing_blockers,
        message: padScopeBlocker.message,
        scope: padScopeBlocker.scope_debug,
        coherence_drift: true,
      };

      await serviceClient
        .from("pricing_runs")
        .insert({
          case_id,
          run_number: padBlockerRunNumber || 1,
          inputs_json: {
            servicePackage: pkg,
            incoterm: incotermEarly,
            effectiveServiceKeys,
          },
          facts_snapshot: (scopeFacts || []).map((f: any) => ({
            key: f.fact_key,
            value_text: f.value_text,
            value_number: f.value_number,
            value_json: f.value_json,
          })),
          status: "blocked",
          error_message: padScopeBlocker.message,
          outputs_json: padBlockerOutputs,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          created_by: userId,
        });

      return new Response(
        JSON.stringify({
          pricing_blockers: padScopeBlocker.pricing_blockers,
          message: padScopeBlocker.message,
          run_number: padBlockerRunNumber || 1,
          scope_debug: padScopeBlocker.scope_debug,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4a-ter. TERMINAL-GUARD — qui manutentionne ? (doctrine 2026-08-25)
    //
    // Placé APRÈS le garde PAD (les deux périmètres se recouvrent : quand les deux
    // manquent, `PAD_CATEGORY_REQUIRED` reste le premier code retourné, comportement
    // historique inchangé) et AVANT tout chiffrage — aucune ligne, aucun appel
    // price-service-lines, aucun moteur n'est atteint depuis ici.
    //
    // Hors périmètre DTHC : `resolveTerminalOperationBlockers` renvoie `[]` et ce
    // bloc est un no-op strict. Aucun package aérien ni export ne porte `DTHC`.
    const terminalScopeFacts = (scopeFacts || []) as TerminalScopeFact[];
    const terminalBlockers = resolveTerminalOperationBlockers({
      facts: terminalScopeFacts,
      effectiveServiceKeys,
    });

    if (terminalBlockers.length > 0) {
      const terminalMessage = terminalOperationBlockerMessage(terminalBlockers);
      console.error("[TERMINAL-GUARD] terminal operator undetermined", {
        case_id,
        blockers: terminalBlockers,
        servicePackage: pkg,
        incoterm: incotermEarly,
        effectiveServiceKeys,
      });

      const { data: terminalBlockerRunNumber } = await serviceClient
        .rpc('get_next_pricing_run_number', { p_case_id: case_id });

      const terminalBlockerOutputs = {
        pricing_blockers: terminalBlockers,
        message: terminalMessage,
        scope: { servicePackage: pkg, incoterm: incotermEarly, effectiveServiceKeys },
        coherence_drift: true,
      };

      await serviceClient
        .from("pricing_runs")
        .insert({
          case_id,
          run_number: terminalBlockerRunNumber || 1,
          inputs_json: {
            servicePackage: pkg,
            incoterm: incotermEarly,
            effectiveServiceKeys,
          },
          facts_snapshot: terminalScopeFacts.map((f) => ({
            key: f.fact_key,
            value_text: f.value_text,
            value_number: f.value_number,
            value_json: f.value_json,
          })),
          status: "blocked",
          error_message: terminalMessage,
          outputs_json: terminalBlockerOutputs,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          created_by: userId,
        });

      return new Response(
        JSON.stringify({
          pricing_blockers: terminalBlockers,
          message: terminalMessage,
          run_number: terminalBlockerRunNumber || 1,
          scope_debug: { servicePackage: pkg, incoterm: incotermEarly, effectiveServiceKeys },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4b. Coherence check — HS Code (last-resort drift detection, NO gap upsert)
    if (scopeWantsDuties) {
      const rawHs = String((scopeFacts || []).find((f: any) => f.fact_key === "cargo.hs_code")?.value_text ?? "");
      const hsCandidates = rawHs.split(/[;,]/).map((c: string) => c.trim().replace(/\D/g, "")).filter(Boolean);
      const firstValidHs10 = hsCandidates.find((c: string) => c.length === 10);
      const hsDigits = firstValidHs10 || rawHs.replace(/\D/g, "");
      let hsBlocker: string | null = null;

      if (!hsDigits || hsDigits.length !== 10) {
        hsBlocker = "HS_CODE_REQUIRED";
      } else {
        const { data: hsRow } = await serviceClient
          .from("hs_codes")
          .select("code_normalized")
          .eq("code_normalized", hsDigits)
          .limit(1)
          .maybeSingle();
        if (!hsRow) hsBlocker = "HS_CODE_UNKNOWN";
      }

      if (hsBlocker) {
        console.error("[COHERENCE] puzzle/pricing drift", { case_id, missing: "cargo.hs_code", blocker: hsBlocker, scopeWantsDuties, incoterm: incotermEarly, pkg });

        const { data: blockerRunNumber } = await serviceClient
          .rpc('get_next_pricing_run_number', { p_case_id: case_id });

        const blockerOutputs = {
          pricing_blockers: [hsBlocker],
          message: hsBlocker === "HS_CODE_REQUIRED"
            ? "DDP : Code HS 10 chiffres UEMOA requis pour chiffrer droits & taxes. Renseignez cargo.hs_code."
            : `DDP : Code HS "${rawHs}" (${hsDigits}) introuvable dans la nomenclature UEMOA.`,
          current_hs_code: rawHs || null,
          scope: { servicePackage: pkg, incoterm: incotermEarly },
          coherence_drift: true,
        };

        await serviceClient
          .from("pricing_runs")
          .insert({
            case_id,
            run_number: blockerRunNumber || 1,
            inputs_json: { servicePackage: pkg, incoterm: incotermEarly, hsCode: rawHs || null },
            facts_snapshot: [],
            status: "blocked",
            error_message: blockerOutputs.message,
            outputs_json: blockerOutputs,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
            created_by: userId,
          });

        return new Response(
          JSON.stringify({
            pricing_blockers: blockerOutputs.pricing_blockers,
            message: blockerOutputs.message,
            run_number: blockerRunNumber || 1,
            scope_debug: { servicePackage: pkg, incoterm: incotermEarly, scopeWantsDuties },
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    // If !scopeWantsDuties → skip HS coherence check

    // 4c. Coherence check — Regime (last-resort drift detection, NO gap upsert)
    if (scopeWantsDuties) {
      const { data: regimeCheckFacts } = await serviceClient
        .from("quote_facts")
        .select("fact_key, value_text")
        .eq("case_id", case_id)
        .eq("is_current", true)
        .in("fact_key", ["customs.regime_code", "regulatory.exemption_title"]);

      const regimeCheckMap = new Map((regimeCheckFacts || []).map((f: any) => [f.fact_key, f.value_text]));
      const hasExemptionTitle = !!regimeCheckMap.get("regulatory.exemption_title");
      const hasRegimeCode = !!regimeCheckMap.get("customs.regime_code");

      if (hasExemptionTitle && !hasRegimeCode) {
        console.error("[COHERENCE] puzzle/pricing drift", { case_id, missing: "customs.regime_code", scopeWantsDuties, incoterm: incotermEarly, pkg });

        const { data: regimeBlockerRunNumber } = await serviceClient
          .rpc('get_next_pricing_run_number', { p_case_id: case_id });

        const regimeBlockerOutputs = {
          pricing_blockers: ["REGIME_REQUIRED_FOR_EXEMPTION"],
          message: "DDP : Titre d'exonération détecté — renseignez le régime douanier pour calculer les exonérations.",
          exemption_title: regimeCheckMap.get("regulatory.exemption_title"),
          scope: { servicePackage: pkg, incoterm: incotermEarly },
          coherence_drift: true,
        };

        await serviceClient
          .from("pricing_runs")
          .insert({
            case_id,
            run_number: regimeBlockerRunNumber || 1,
            inputs_json: { exemptionTitle: regimeCheckMap.get("regulatory.exemption_title") },
            facts_snapshot: [],
            status: "blocked",
            error_message: regimeBlockerOutputs.message,
            outputs_json: regimeBlockerOutputs,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
            created_by: userId,
          });

        return new Response(
          JSON.stringify({
            pricing_blockers: regimeBlockerOutputs.pricing_blockers,
            message: regimeBlockerOutputs.message,
            run_number: regimeBlockerRunNumber || 1,
            scope_debug: { servicePackage: pkg, incoterm: incotermEarly, scopeWantsDuties },
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    // If !scopeWantsDuties → skip regime coherence check

    // 5. Transition to PRICING_RUNNING (skip for finalized cases)
    if (!isFinalized) {
      await serviceClient
        .from("quote_cases")
        .update({ 
          status: "PRICING_RUNNING",
          last_activity_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", case_id);

      await serviceClient.from("case_timeline_events").insert({
        case_id,
        event_type: "status_changed",
        previous_value: previousStatus,
        new_value: "PRICING_RUNNING",
        actor_type: "system",
      });
    }

    // 6. Load all current facts
    const { data: facts, error: factsError } = await serviceClient
      .from("quote_facts")
      .select("*")
      .eq("case_id", case_id)
      .eq("is_current", true);

    if (factsError) {
      // CTO FIX: Rollback status on error
      await rollbackToPreviousStatus(serviceClient, case_id, previousStatus, "facts_load_failed");
      throw new Error(`Failed to load facts: ${factsError.message}`);
    }

    // 7. Build facts snapshot (frozen copy)
    const factsSnapshot = (facts || []).map((f) => ({
      id: f.id,
      key: f.fact_key,
      category: f.fact_category,
      value_text: f.value_text,
      value_number: f.value_number,
      value_json: f.value_json,
      value_date: f.value_date,
      source_type: f.source_type,
      confidence: f.confidence,
    }));

    // 8. Build inputs_json from facts
    const inputs = buildPricingInputs(facts || []);

    // 8b. Coherence check — FOB freight (last-resort drift detection, NO gap upsert)
    const incoterm = String(inputs.incoterm ?? '').trim().toUpperCase();
    const isFobType = ['FOB', 'FCA', 'FAS', 'EXW'].includes(incoterm);

    if (scopeWantsDuties && isFobType) {
      if (!inputs.freightCost || inputs.freightCost <= 0) {
        console.error("[COHERENCE] puzzle/pricing drift", { case_id, missing: "cargo.freight_cost", scopeWantsDuties, incoterm, pkg });

        const { data: fobBlockerRunNumber } = await serviceClient
          .rpc('get_next_pricing_run_number', { p_case_id: case_id });

        const fobBlockerMessage = "DDP + FOB/FCA/FAS/EXW : le montant du fret réel est obligatoire pour le calcul CAF douanier.";

        await serviceClient
          .from("pricing_runs")
          .insert({
            case_id,
            run_number: fobBlockerRunNumber || 1,
            inputs_json: { incoterm, freightCost: inputs.freightCost, freightCurrency: inputs.freightCurrency, scope: { servicePackage: pkg } },
            facts_snapshot: factsSnapshot,
            status: "blocked",
            error_message: fobBlockerMessage,
            outputs_json: { pricing_blockers: ["FREIGHT_REQUIRED_FOR_FOB"], message: fobBlockerMessage, scope: { servicePackage: pkg, incoterm: incotermEarly }, coherence_drift: true },
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
            created_by: userId,
          });

        if (!isFinalized) {
          await rollbackToPreviousStatus(serviceClient, case_id, previousStatus, "fob_freight_blocker");
        }

        return new Response(
          JSON.stringify({
            pricing_blockers: ["FREIGHT_REQUIRED_FOR_FOB"],
            message: fobBlockerMessage,
            run_number: fobBlockerRunNumber || 1,
            scope_debug: { servicePackage: pkg, incoterm: incotermEarly, scopeWantsDuties },
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    // If !scopeWantsDuties or !isFobType → skip FOB freight coherence check

    // 8c. Coherence check — Cargo Value for DDP (last-resort drift detection, NO gap upsert)
    if (scopeWantsDuties) {
      if (!inputs.cargoValue || inputs.cargoValue <= 0) {
        // ═══ LOT 4: PROVISIONAL-DDP-GUARD ═══
        // If allow_provisional is true and CARGO_VALUE_REQUIRED is the only remaining issue,
        // bypass the blocker and produce a provisional run (no customs engine, no fake data).
        if (allow_provisional) {
          console.log(`[PROVISIONAL-DDP-GUARD] Mono-lot: allow_provisional=true, bypassing cargo.value blocker for case ${case_id}`);
          // Continue to step 9+ but in provisional mode — handled below after run creation
        } else {
          console.error("[COHERENCE] puzzle/pricing drift", { case_id, missing: "cargo.value", scopeWantsDuties, incoterm, pkg });

          const { data: cvBlockerRunNumber } = await serviceClient
            .rpc('get_next_pricing_run_number', { p_case_id: case_id });

          const cvBlockerMessage = "DDP : Valeur marchandise (cargo.value) requise pour calculer droits et taxes.";

          await serviceClient
            .from("pricing_runs")
            .insert({
              case_id,
              run_number: cvBlockerRunNumber || 1,
              inputs_json: { cargoValue: inputs.cargoValue, scope: { servicePackage: pkg, incoterm: incotermEarly } },
              facts_snapshot: factsSnapshot,
              status: "blocked",
              error_message: cvBlockerMessage,
              outputs_json: { pricing_blockers: ["CARGO_VALUE_REQUIRED"], message: cvBlockerMessage, scope: { servicePackage: pkg, incoterm: incotermEarly, scopeWantsDuties }, coherence_drift: true },
              started_at: new Date().toISOString(),
              completed_at: new Date().toISOString(),
              duration_ms: Date.now() - startTime,
              created_by: userId,
            });

          if (!isFinalized) {
            await rollbackToPreviousStatus(serviceClient, case_id, previousStatus, "cargo_value_blocker");
          }

          return new Response(
            JSON.stringify({
              pricing_blockers: ["CARGO_VALUE_REQUIRED"],
              message: cvBlockerMessage,
              run_number: cvBlockerRunNumber || 1,
              scope_debug: { servicePackage: pkg, incoterm: incotermEarly, scopeWantsDuties },
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }
    // If !scopeWantsDuties → skip cargo value coherence check

    // ═══ LOT 4: Detect provisional mode for downstream handling ═══
    const isProvisionalDdp = allow_provisional && scopeWantsDuties && (!inputs.cargoValue || inputs.cargoValue <= 0);

    // 9. CTO FIX: Get next run number via ATOMIC RPC (prevents race conditions)
    const { data: runNumber, error: rpcError } = await serviceClient
      .rpc('get_next_pricing_run_number', { p_case_id: case_id });

    if (rpcError || runNumber === null) {
      // CTO FIX: Rollback status on error
      await rollbackToPreviousStatus(serviceClient, case_id, previousStatus, "run_number_failed");
      throw new Error(`Failed to get run number: ${rpcError?.message || "null result"}`);
    }

    // 10. Create pricing_run record with compensation on failure
    let pricingRun: { id: string } | null = null;
    
    try {
      const { data: runData, error: runInsertError } = await serviceClient
        .from("pricing_runs")
        .insert({
          case_id,
          run_number: runNumber,
          inputs_json: inputs,
          facts_snapshot: factsSnapshot,
          status: "running",
          started_at: new Date().toISOString(),
          created_by: userId,
        })
        .select("id")
        .single();

      if (runInsertError || !runData) {
        throw new Error(`Insert failed: ${runInsertError?.message}`);
      }
      
      pricingRun = runData;
    } catch (insertError: any) {
      // CTO FIX: Rollback status if run creation fails
      await rollbackToPreviousStatus(serviceClient, case_id, previousStatus, "run_insert_failed");
      
      await serviceClient.from("case_timeline_events").insert({
        case_id,
        event_type: "pricing_failed",
        event_data: { error: String(insertError), reason: "run_creation_failed" },
        actor_type: "system",
      });
      
      throw insertError;
    }

    await serviceClient.from("case_timeline_events").insert({
      case_id,
      event_type: "pricing_started",
      event_data: { run_number: runNumber, inputs_summary: summarizeInputs(inputs) },
      related_pricing_run_id: pricingRun.id,
      actor_type: "system",
    });

    // 11. Call quotation-engine
    let engineResponse: any;
    let tariffSources: any[] = [];

    // ═══ EXPORT GUARD (mono-lot): bypass quotation-engine for EXPORT_* packages ═══
    const isExportFlow = pkg.startsWith('EXPORT_');

    try {
      if (isProvisionalDdp) {
        // ═══ PROVISIONAL-DDP-GUARD (mono-lot): bypass quotation-engine, produce firm-only lines + reserve ═══
        console.log(`[PROVISIONAL-DDP-GUARD] Mono-lot: DDP without cargo.value — bypassing customs engine for case ${case_id}`);
        engineResponse = {
          lines: [],
          totals: { honoraires: 0, debours: 0 },
          currency: 'XOF',
          duty_breakdown: [],
          version: 'provisional-ddp-guard-v1',
        };
        tariffSources = [];

        // Enrich non-customs services via price-service-lines
        const CUSTOMS_SERVICE_KEYS = new Set(['CUSTOMS_DAKAR', 'CUSTOMS_EXPORT', 'CUSTOMS_BAMAKO']);
        const provisionalPackageKey = (inputs.servicePackage || '').trim().toUpperCase();
        if (provisionalPackageKey && SERVICE_PACKAGES[provisionalPackageKey]) {
          const overrides = readOverridesFromFacts(facts || []);
          const effectiveKeys = resolveEffectiveServiceKeys(provisionalPackageKey, overrides);
          // P0-E: customs excluded (provisional DDP doctrine) AND the PAD markers excluded
          // from the enrichment — the PAD redevance keeps its own official line.
          const firmKeys = excludePadScopeKeysForEnrichment(
            effectiveKeys.filter(k => !CUSTOMS_SERVICE_KEYS.has(k)),
          );

          console.log(`[PROVISIONAL-DDP-GUARD] Enriching ${firmKeys.length} firm service keys (excluded customs: ${effectiveKeys.filter(k => CUSTOMS_SERVICE_KEYS.has(k)).join(', ')})`);

          if (firmKeys.length > 0) {
            const serviceLineInputs = firmKeys.map(sk => ({
              id: crypto.randomUUID(),
              service: sk,
              unit: PACKAGE_SERVICE_DEFAULT_UNITS[sk] || 'forfait',
              quantity: 1,
              currency: 'XOF',
            }));

            const pslUrl = `${supabaseUrl}/functions/v1/price-service-lines`;
            const pslRes = await fetch(pslUrl, {
              method: 'POST',
              headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
              body: JSON.stringify({ case_id, service_lines: serviceLineInputs }),
            });

            const idToServiceKey = new Map(serviceLineInputs.map(sl => [sl.id, sl.service]));

            if (pslRes.ok) {
              const pslData = await pslRes.json();
              const pricedLines = pslData?.data?.priced_lines || [];
              const firmLines: any[] = [];
              for (const pl of pricedLines) {
                const serviceKey = idToServiceKey.get(pl.id) || pl.id;
                const label = SERVICE_KEY_LABELS[serviceKey] || serviceKey;
                firmLines.push(canonicalizeLine({
                  category: serviceKey,
                  label: label,
                  amount: pl.rate ?? 0,
                  currency: pl.currency || 'XOF',
                  type: 'service_package',
                  source: { type: pl.source || 'price-service-lines', reference: 'LOT4-provisional-firm', confidence: pl.confidence ?? 0 },
                  quantity: pl.quantity_used ?? 1,
                  unit: pl.unit_used ?? PACKAGE_SERVICE_DEFAULT_UNITS[serviceKey] ?? 'forfait',
                  explanation: pl.explanation || '',
                }, { origin_layer: 'package_enrichment' }));
              }
              engineResponse.lines = firmLines;
              console.log(`[PROVISIONAL-DDP-GUARD] Merged ${firmLines.length} firm service lines`);
            } else {
              console.warn(`[PROVISIONAL-DDP-GUARD] price-service-lines failed (${pslRes.status})`);
            }
          }
        }

        // Add explicit reserve line (non-monetary, amount=0, not included in totals)
        engineResponse.lines.push({
          category: 'CUSTOMS_RESERVE',
          label: 'Droits et taxes à confirmer après réception de la valeur marchandise',
          amount: 0,
          currency: 'XOF',
          type: 'provisional_reserve',
          // Lot 4-A: aligned source.type on canonical TO_CONFIRM signal so QQM guards
          // (Lot 3D) and PDF renderer detect this reserve as "À confirmer", never "0 FCFA".
          source: { type: 'TO_CONFIRM', reference: 'LOT4_DDP_CARGO_VALUE_MISSING', confidence: 0 },
          quantity: 1,
          unit: 'forfait',
          explanation: 'Réserve structurée — cargo.value absente, droits et taxes exclus du total',
        });

        // Compute totals from firm lines only (exclude reserve)
        let provHonoraires = 0;
        let provOperationnel = 0;
        for (const line of engineResponse.lines) {
          if (line.type === 'provisional_reserve') continue;
          const amount = Number(line?.amount) || 0;
          const cat = String(line?.category || '').trim().toUpperCase();
          if (EXPORT_HONORAIRES_KEYS.has(cat)) {
            provHonoraires += amount;
          } else {
            provOperationnel += amount;
          }
        }
        engineResponse.totals = { honoraires: provHonoraires, debours: 0, operationnel: provOperationnel };

      } else if (isExportFlow) {
        console.log(`[EXPORT-GUARD] Mono-lot: EXPORT package "${pkg}" detected — bypassing quotation-engine`);
        // Synthetic response: proven minimal shape consumed by downstream (L2142-2163)
        engineResponse = {
          lines: [],
          totals: { honoraires: 0, debours: 0 },
          currency: 'XOF',
          duty_breakdown: [],
          version: 'export-guard-v1',
        };
        tariffSources = [];

        // Export P5 enrichment: use ALL effective service keys (not just "missing")
        // Reuses existing resolution logic: resolveEffectiveServiceKeys + readOverridesFromFacts
        const exportPackageKey = (inputs.servicePackage || '').trim().toUpperCase();
        if (exportPackageKey && SERVICE_PACKAGES[exportPackageKey]) {
          const overrides = readOverridesFromFacts(facts || []);
          // P0-E: defensive — no EXPORT_* package carries a PAD marker today, but
          // `service.overrides.add` accepts PORT_DAKAR_HANDLING on any package.
          const effectiveKeys = excludePadScopeKeysForEnrichment(
            resolveEffectiveServiceKeys(exportPackageKey, overrides),
          );

          console.log(`[EXPORT-GUARD] Mono-lot: enriching ${effectiveKeys.length} export service keys via price-service-lines: ${effectiveKeys.join(', ')}`);

          const serviceLineInputs = effectiveKeys.map(sk => ({
            id: crypto.randomUUID(),
            service: sk,
            unit: PACKAGE_SERVICE_DEFAULT_UNITS[sk] || 'forfait',
            quantity: 1,
            currency: 'XOF',
          }));

          // Build pricing_context_override with scope: 'export' (same shape as multi-lot L958-973)
          const pricingCtxOverride: Record<string, unknown> = {
            scope: 'export',
            containers: Array.isArray(inputs.containers) ? inputs.containers : [],
            container_type: inputs.containers?.[0]?.type || null,
            container_count: Array.isArray(inputs.containers)
              ? inputs.containers.reduce((s: number, c: any) => s + Number(c?.quantity ?? 1), 0)
              : null,
            weight_kg: inputs.cargoWeight || null,
            caf_value: null,
            destination_city: inputs.finalDestination || null,
            destination_country: null,
            origin_country: null,
            origin_port: inputs.originPort || null,
            client_code: resolveClientCode(facts || []), // Lot 1.2: propagation depuis quote_facts
            corridor: null,
          };

          const pslUrl = `${supabaseUrl}/functions/v1/price-service-lines`;
          const pslRes = await fetch(pslUrl, {
            method: 'POST',
            headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              case_id,
              service_lines: serviceLineInputs,
              pricing_context_override: pricingCtxOverride,
            }),
          });

          const idToServiceKey = new Map(serviceLineInputs.map(sl => [sl.id, sl.service]));

          if (pslRes.ok) {
            const pslData = await pslRes.json();
            const pricedLines = pslData?.data?.priced_lines || [];
            const exportLines: any[] = [];
            for (const pl of pricedLines) {
              const serviceKey = idToServiceKey.get(pl.id) || pl.id;
              const label = SERVICE_KEY_LABELS[serviceKey] || serviceKey;
              exportLines.push(canonicalizeLine({
                category: serviceKey,
                label: label,
                amount: pl.rate ?? 0,
                currency: pl.currency || 'XOF',
                type: 'service_package',
                source: { type: pl.source || 'price-service-lines', reference: 'P5-export', confidence: pl.confidence ?? 0 },
                quantity: pl.quantity_used ?? 1,
                unit: pl.unit_used ?? PACKAGE_SERVICE_DEFAULT_UNITS[serviceKey] ?? 'forfait',
                explanation: pl.explanation || '',
              }, { origin_layer: 'package_enrichment' }));
            }
            engineResponse.lines = exportLines;

            // ═══ EXPORT-GUARD: Recalculate totals with Option A classification ═══
            const exportClassification = classifyExportTotals(exportLines);
            engineResponse.totals = {
              honoraires: exportClassification.honoraires,
              debours: exportClassification.debours, // always 0
              operationnel: exportClassification.operationnel,
            };
            console.log(`[EXPORT-GUARD] Mono-lot: classification — honoraires=${exportClassification.honoraires}, operationnel=${exportClassification.operationnel}, debours=0`);

            // Build tariffSources from export lines
            const sourceMap = new Map<string, any>();
            for (const line of exportLines) {
              if (line.source?.reference && line.source?.type !== 'TO_CONFIRM') {
                const key = `${line.source.type}_${line.source.reference}`;
                sourceMap.set(key, {
                  type: line.source.type,
                  reference: line.source.reference,
                  table: line.source.table || line.source.type,
                  confidence: line.source.confidence,
                });
              }
            }
            tariffSources = Array.from(sourceMap.values());

            console.log(`[EXPORT-GUARD] Mono-lot: merged ${pricedLines.length} export priced service lines`);
          } else {
            console.warn(`[EXPORT-GUARD] Mono-lot: price-service-lines failed (${pslRes.status}), export pricing will have 0 lines`);
          }
        }
      } else {
      // ═══ Standard import/transit path (unchanged) ═══
      const engineParams = {
        finalDestination: inputs.finalDestination,
        originPort: inputs.originPort,
        originAirport: inputs.originAirport,
        incoterm: inputs.incoterm,
        containers: inputs.containers,
        cargoWeight: inputs.cargoWeight,
        cargoVolume: inputs.cargoVolume,
        cargoValue: inputs.cargoValue,
        cargoCurrency: inputs.cargoValueCurrency,
        carrier: inputs.carrier,
        transportMode: caseData.request_type?.includes("AIR") ? "aerien" : "maritime",
        cargoDescription: inputs.cargoDescription,
        clientCompany: inputs.clientCompany,
        hsCode: inputs.hsCode,
        articlesDetail: inputs.articlesDetail,
        regimeCode: inputs.regimeCode || undefined,
        freightAmount: inputs.freightCost,
        freightCurrency: inputs.freightCurrency,
        // Lot 1.2: propagation client.code (passe-plat, consommé en Lot 2)
        clientCode: resolveClientCode(facts || []),
      };

      // Lot 1.2: preuve de propagation (smoke G1.2-A/B)
      console.log(`[LOT1.2][mono-lot] engineParams.clientCode=${JSON.stringify(engineParams.clientCode)}`);

      const engineUrl = `${supabaseUrl}/functions/v1/quotation-engine`;
      const engineRes = await fetch(engineUrl, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "generate", params: engineParams }),
      });

      if (!engineRes.ok) {
        const errorText = await engineRes.text();
        throw new Error(`quotation-engine error: ${engineRes.status} - ${errorText}`);
      }

      engineResponse = await engineRes.json();
      // Fix CTO: construire tariffSources depuis les lignes (le moteur ne renvoie pas de champ global)
      const monoCanonicalLines = (engineResponse.lines || engineResponse.quotationLines || [])
        .map((l: any) => canonicalizeLine(l, { origin_layer: 'engine_structural' }));

      // SCOPE-REMOVE: services explicitly removed via `service.overrides.remove`
      // (add wins) leave the structural lines AND the raw engine totals HERE,
      // before sources, coverage, enrichment and totals. Lines with a null
      // canonical.service_key (Droits & Taxes, Port (PAD), …) are never candidates.
      const monoRemovedServiceKeys = resolveExplicitlyRemovedServiceKeys(
        readOverridesFromFacts(facts || []),
      );
      const monoScopeRemoval = applyExplicitServiceRemovals(
        monoCanonicalLines, engineResponse.totals, monoRemovedServiceKeys,
      );
      if (monoScopeRemoval.removedLines.length > 0) {
        console.log(
          `[SCOPE-REMOVE] Mono-lot: dropped ${monoScopeRemoval.removedLines.length} structural line(s): ${monoScopeRemoval.removedLines.map((l) => `${l?.canonical?.service_key}=${l?.amount ?? 'null'}`).join(', ')}`,
        );
      }
      engineResponse.totals = monoScopeRemoval.adjustedTotals;
      // P6: store canonicalized lines back so downstream code uses them
      // (reading them back through the response keeps downstream typing
      // identical to the engine payload).
      engineResponse.lines = monoScopeRemoval.keptLines;
      const rawLines = engineResponse.lines;
      const sourceMap = new Map<string, any>();
      for (const line of rawLines) {
        if (line.source?.reference && line.source?.type !== 'TO_CONFIRM') {
          const key = `${line.source.type}_${line.source.reference}`;
          sourceMap.set(key, {
            type: line.source.type,
            reference: line.source.reference,
            table: line.source.table || line.source.type,
            confidence: line.source.confidence,
          });
        }
      }
      tariffSources = Array.from(sourceMap.values());

      // ═══ P5: Package service lines enrichment (mono-lot, import/transit only) ═══
      // Export P5 is handled above in the EXPORT GUARD block
      const packageKey = (inputs.servicePackage || '').trim().toUpperCase();
      if (!isExportFlow && packageKey && SERVICE_PACKAGES[packageKey]) {
        try {
          const overrides = readOverridesFromFacts(facts || []);
          const effectiveKeys = resolveEffectiveServiceKeys(packageKey, overrides);
          const coverage = inferCoveredServiceDiagnostics(engineResponse.lines || engineResponse.quotationLines || []);
          const coveredKeys = coverage.covered;
          // P0-E: the PAD markers never go to price-service-lines (see
          // excludePadScopeKeysForEnrichment). effectiveServiceKeys computed earlier for
          // resolvePadScopeBlocker is a distinct, unfiltered list — the guard is untouched.
          const missingKeys = excludePadScopeKeysForEnrichment(
            effectiveKeys.filter(k => !coveredKeys.has(k)),
          );

          console.log(
            `[P5] Mono-lot: categories=${coverage.categoriesSeen.join(' | ') || 'none'}; covered=${Array.from(coveredKeys).join(', ') || 'none'}; missing=${missingKeys.join(', ') || 'none'}${coverage.matchedByDescription.length ? `; desc_fallback=${coverage.matchedByDescription.join(' | ')}` : ''}`,
          );

          if (missingKeys.length > 0) {
            console.log(`[P5] Mono-lot: ${missingKeys.length} package services to enrich: ${missingKeys.join(', ')}`);

            // Build ServiceLineInput — exact same shape as QuotationSheet sends
            const serviceLineInputs = missingKeys.map(sk => ({
              id: crypto.randomUUID(),
              service: sk,
              unit: PACKAGE_SERVICE_DEFAULT_UNITS[sk] || 'forfait',
              quantity: 1,
              currency: 'XOF',
            }));

            const pslUrl = `${supabaseUrl}/functions/v1/price-service-lines`;
            const pslRes = await fetch(pslUrl, {
              method: 'POST',
              headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
              body: JSON.stringify({ case_id, service_lines: serviceLineInputs }),
            });

            // P5.1: Build UUID→service_key lookup before consuming response
            const idToServiceKey = new Map(serviceLineInputs.map(sl => [sl.id, sl.service]));

            if (pslRes.ok) {
              const pslData = await pslRes.json();
              const pricedLines = pslData?.data?.priced_lines || [];
              // Inject into engineResponse.lines so tariffLines picks them up
              const engineLines = engineResponse.lines || engineResponse.quotationLines || [];
              for (const pl of pricedLines) {
                const serviceKey = idToServiceKey.get(pl.id) || pl.id;
                const label = SERVICE_KEY_LABELS[serviceKey] || serviceKey;
                const packageLine = canonicalizeLine({
                  category: serviceKey,
                  label: label,
                  amount: pl.rate ?? 0,
                  currency: pl.currency || 'XOF',
                  type: 'service_package',
                  source: { type: pl.source || 'price-service-lines', reference: 'P5', confidence: pl.confidence ?? 0 },
                  quantity: pl.quantity_used ?? 1,
                  unit: pl.unit_used ?? PACKAGE_SERVICE_DEFAULT_UNITS[serviceKey] ?? 'forfait',
                  explanation: pl.explanation || '',
                }, { origin_layer: 'package_enrichment' });
                engineLines.push(
                  isLocalTransportRateSource(pl.source)
                    ? withLocalTransportDebours(packageLine)
                    : packageLine,
                );
              }
              // Update engineResponse.lines so downstream tariffLines = engineResponse.lines picks them up
              engineResponse.lines = engineLines;
              console.log(`[P5] Mono-lot: merged ${pricedLines.length} priced service lines`);
            } else {
              console.warn(`[P5] price-service-lines failed (${pslRes.status}), continuing with engine lines only`);
            }
          }
        } catch (p5Error) {
          console.warn('[P5] Package enrichment failed, continuing:', p5Error);
        }
      }
      } // end else (standard import/transit path)

      // ═══ isMaritime — hoisted for PAD-GAP-1 + terminal storage ═══
      const isMaritime = !isExportFlow && !String(caseData.request_type || '').toUpperCase().includes('AIR');

      // ═══ PAD_SHADOW (Lot C) — capture pré-PAD-1, observation seule ═══
      const SHADOW_ON = Deno.env.get('PAD_RESOLVER_SHADOW') === 'true';
      const padCategoryBeforeAlias = inputs.padCategory ?? null;
      let padShadowAliasRows: any[] = [];

      // ═══ Phase PAD-1: Alias lookup PAD (exact match, validated only) ═══
      // Runs BEFORE passive fact consumption. Facts opérateur toujours prioritaires.
      // commodity_category_id = source de vérité métier, pad_category = copie dénormalisée runtime.
      if (!inputs.padCategory && inputs.cargoDescription) {
        try {
          const normalizedDescPad = normalizePricingText(inputs.cargoDescription);
          if (normalizedDescPad) {
            const { data: padAliasRows } = await serviceClient
              .from('pad_designation_aliases')
              .select('pad_category, bl_term, commodity_category_id')
              .eq('normalized_term', normalizedDescPad)
              .eq('is_validated', true);
            padShadowAliasRows = padAliasRows ?? [];

            if (padAliasRows && padAliasRows.length > 0) {
              if (padAliasRows.length > 1) {
                // Collision detected — multiple validated aliases for same normalized_term
                const cats = padAliasRows.map((r: any) => r.pad_category);
                const uniqueCats = [...new Set(cats)];
                if (uniqueCats.length > 1) {
                  console.warn(`[PAD-ALIAS] COLLISION: normalized="${normalizedDescPad}" → ${uniqueCats.length} catégories distinctes: ${uniqueCats.join(', ')}. Skipping auto-resolve.`);
                } else {
                  // Same category, multiple aliases — safe to use
                  const alias = padAliasRows[0];
                  console.log(`[PAD-ALIAS] Multiple aliases same category: "${inputs.cargoDescription}" → ${alias.pad_category} (${padAliasRows.length} aliases)`);
                  // Lookup tarif in port_tariffs
                  const { data: padTariffRow } = await serviceClient
                    .from('port_tariffs')
                    .select('amount, unit, classification')
                    .eq('provider', 'PAD')
                    .eq('category', 'DROIT_PASSAGE')
                    .eq('operation_type', 'IMPORT')
                    .eq('cargo_type', 'CONTENEUR')
                    .eq('classification', alias.pad_category)
                    .eq('is_active', true)
                    .maybeSingle();

                  if (padTariffRow && padTariffRow.amount != null) {
                    inputs.padCategory = alias.pad_category;
                    inputs.padRateFcfaPerTon = Number(padTariffRow.amount);
                    console.log(`[PAD-ALIAS] Resolved: ${alias.pad_category} → ${padTariffRow.amount} FCFA/t`);
                  }
                }
              } else {
                // Single alias — deterministic
                const alias = padAliasRows[0];
                console.log(`[PAD-ALIAS] Match: "${inputs.cargoDescription}" → ${alias.pad_category} via alias bl_term="${alias.bl_term}"`);

                // Lookup tarif in port_tariffs
                const { data: padTariffRow } = await serviceClient
                  .from('port_tariffs')
                  .select('amount, unit, classification')
                  .eq('provider', 'PAD')
                  .eq('category', 'DROIT_PASSAGE')
                  .eq('operation_type', 'IMPORT')
                  .eq('cargo_type', 'CONTENEUR')
                  .eq('classification', alias.pad_category)
                  .eq('is_active', true)
                  .maybeSingle();

                if (padTariffRow && padTariffRow.amount != null) {
                  inputs.padCategory = alias.pad_category;
                  inputs.padRateFcfaPerTon = Number(padTariffRow.amount);
                  console.log(`[PAD-ALIAS] Resolved: ${alias.pad_category} → ${padTariffRow.amount} FCFA/t`);
                } else {
                  console.warn(`[PAD-ALIAS] Alias found (${alias.pad_category}) but no active tariff in port_tariffs`);
                }
              }
            }
          }
        } catch (padAliasErr) {
          console.warn('[PAD-ALIAS] Lookup failed (non-blocking):', padAliasErr);
        }
      } else if (inputs.padCategory) {
        console.log(`[PAD] Facts opérateur présents: padCategory=${inputs.padCategory} — alias lookup skipped`);
      }

      // ═══ PAD_SHADOW (Lot C) — observation pure, scope IMPORT/CONTENEUR strict ═══
      // Aucune mutation runtime, aucun changement output, OFF par défaut.
      {
        const requestTypeUpper = String(caseData.request_type || '').toUpperCase();
        const packageUpper = String((typeof pkg !== 'undefined' ? pkg : inputs.servicePackage) || '').toUpperCase();
        const isTransitLike =
          packageUpper.includes('TRANSIT') ||
          packageUpper.includes('TRANSBORDEMENT') ||
          packageUpper.includes('TRANSSHIPMENT') ||
          requestTypeUpper.includes('TRANSIT') ||
          requestTypeUpper.includes('TRANSBORDEMENT') ||
          requestTypeUpper.includes('TRANSSHIPMENT');
        const hasContainers = Array.isArray(inputs.containers) && inputs.containers.length > 0;
        const isImportContainer =
          SHADOW_ON &&
          isMaritime &&
          !isExportFlow &&
          !isTransitLike &&
          hasContainers;

        if (isImportContainer) {
          try {
            const normalizeShadowSource = (source: string | null | undefined): string | null => {
              if (!source || source === 'none') return null;
              if (source === 'validated_alias') return 'alias';
              if (source === 'operator_confirmed') return 'operator';
              return source;
            };

            const shadowContext = await buildPadShadowContext(serviceClient, inputs);

            const resolverOut = resolvePadClassification(
              {
                designation: inputs.cargoDescription ?? null,
                invoice_label: null,
                hs_code: inputs.hsCode ?? null,
                cn_code: inputs.cnCode ?? null,
                nhm_code: inputs.nhmCode ?? null,
                nst_code: inputs.nstCode ?? null,
                nstr_code: inputs.nstrCode ?? null,
                operation_type: 'IMPORT',
                cargo_type: 'CONTENEUR',
                container_size: null,
                known_pad_category: padCategoryBeforeAlias,
              },
              {
                aliases: shadowContext.aliases,
                nstRules: shadowContext.nstRules,
                hsToNstMapping: shadowContext.hsToNstMapping,
                designationMatches: [],
              },
            );

            const legacyCategory = inputs.padCategory ?? null;
            const legacySource: string | null = padCategoryBeforeAlias
              ? 'operator'
              : (padShadowAliasRows.length > 0 && legacyCategory ? 'alias' : null);
            const resolverCategory = resolverOut.classification;
            const resolverSource = normalizeShadowSource(resolverOut.source);
            const match = legacyCategory === resolverCategory && legacySource === resolverSource;

            let mismatch_reason: string | null = null;
            if (!match) {
              if (legacyCategory && !resolverCategory) mismatch_reason = 'legacy_only';
              else if (!legacyCategory && resolverCategory) mismatch_reason = 'resolver_only';
              else if (legacyCategory !== resolverCategory) mismatch_reason = 'category_diff';
              else mismatch_reason = 'source_diff';
            }

            console.log(JSON.stringify({
              tag: 'PAD_SHADOW',
              version: 'MAP-RUNTIME-5',
              case_id,
              scope: 'IMPORT/CONTENEUR',
              enabled: true,
              amount_policy: 'DO_NOT_COUNT_FROM_OBSERVATION',
              creates_fact: false,
              modifies_total: false,
              nstr_used: false,
              input_presence: {
                hs_present: !!normalizeShadowCode(inputs.hsCode),
                cn_present: !!normalizeShadowCode(inputs.cnCode),
                nhm_present: !!normalizeShadowCode(inputs.nhmCode),
                nst_present: !!normalizeShadowCode(inputs.nstCode),
                nstr_present: !!normalizeShadowCode(inputs.nstrCode),
              },
              context_counts: {
                aliases: shadowContext.aliases.length,
                nst_rules: shadowContext.nstRules.length,
                hs_to_nst_mappings: shadowContext.hsToNstMapping.length,
              },
              resolver: {
                classification: resolverCategory,
                canonical_rate_family: resolverOut.canonical_rate_family,
                source: resolverOut.source,
                confidence: resolverOut.confidence,
                needs_human_review: resolverOut.needs_human_review,
                blocking_gap: resolverOut.blocking_gap,
                warnings: resolverOut.warnings,
              },
              comparison: {
                legacy_category: legacyCategory,
                resolver_category: resolverCategory,
                match,
                mismatch_reason,
              },
            }));
          } catch (e) {
            console.warn('[PAD_SHADOW] non-blocking error:', e instanceof Error ? e.message : String(e));
          }
        }
      }

      // ═══ PAD-GAP-1: Gap bloquant si PAD applicable mais catégorie non résolue ═══
      // PAD-GAP-1-FIX: condition assouplie — poids non requis pour lever le gap
      // Condition identique au bloc terminal storage (maritime + description + poids > 0)
      if (!inputs.padCategory && isMaritime && inputs.cargoDescription) {
        try {
          // Idempotent: ne pas dupliquer si gap existe déjà (ouvert)
          const { data: existingGap } = await serviceClient
            .from('quote_gaps')
            .select('id')
            .eq('case_id', case_id)
            .eq('gap_key', 'pricing.pad_category')
            .eq('status', 'open')
            .maybeSingle();

          if (!existingGap) {
            const weightMissing = !inputs.cargoWeight || inputs.cargoWeight <= 0;
            const questionText = weightMissing
              ? `Pourriez-vous préciser la nature exacte de la marchandise ainsi que le poids brut total ? Ces informations sont nécessaires pour déterminer les droits de passage portuaires applicables. Description reçue : "${inputs.cargoDescription}". Les tarifs PAD varient de 0 à 28 100 FCFA/t selon la catégorie.`
              : `Pourriez-vous préciser la nature exacte de la marchandise (ex: matériaux de construction, produits chimiques, équipements industriels, céréales, véhicules, etc.) ? Cette information est nécessaire pour déterminer les droits de passage portuaires applicables. Description reçue : "${inputs.cargoDescription}". Les tarifs PAD varient de 0 à 28 100 FCFA/t selon la catégorie.`;
            await serviceClient.from('quote_gaps').insert({
              case_id,
              gap_key: 'pricing.pad_category',
              gap_category: 'pricing',
              question_fr: questionText,
              is_blocking: true,
              status: 'open',
            });
            console.log(`[PAD-GAP] Gap bloquant créé: pricing.pad_category (description="${inputs.cargoDescription}", weightMissing=${weightMissing})`);
          } else {
            console.log(`[PAD-GAP] Gap pricing.pad_category déjà ouvert (id=${existingGap.id}) — skip`);
          }

          // Ligne placeholder TO_CONFIRM (amount=0, non comptée comme tarif confirmé)
          // Garde-fou: vérifier qu'une ligne PAD placeholder n'existe pas déjà
          const engineLines = engineResponse.lines || engineResponse.quotationLines || [];
          const hasExistingPadPlaceholder = engineLines.some(
            (l: any) => l.category === 'PAD_DROIT_PASSAGE' && l.source?.type === 'TO_CONFIRM'
          );
          if (!hasExistingPadPlaceholder) {
            engineLines.push(canonicalizeLine({
              category: 'PAD_DROIT_PASSAGE',
              label: 'Droit de passage PAD — catégorie à déterminer',
              description: 'Taxe de port PAD non résolue — en attente de classification marchandise',
              amount: 0,
              currency: 'FCFA',
              unit: 'tonne',
              quantity: inputs.cargoWeight || 0,
              unitPrice: 0,
              source: {
                type: 'TO_CONFIRM',
                reference: 'Classification PAD requise — gap bloquant ouvert',
                confidence: 0,
              },
              isEditable: false,
            }, { origin_layer: 'enrichment_pad' }));
            engineResponse.lines = engineLines;
            console.log(`[PAD-GAP] Ligne placeholder PAD TO_CONFIRM ajoutée (poids=${inputs.cargoWeight || 0}t)`);
          }
        } catch (padGapErr) {
          console.warn('[PAD-GAP] Gap creation failed (non-blocking):', padGapErr);
        }
      }

      // ═══ Phase 3: PAD Droit de Passage enrichment (mono-lot only) ═══
      // Multi-lot: skipped — cargo.pad_* are global facts, not per-lot. Extension future requise.
      // P0-E: ce bloc est l'UNIQUE producteur de la ligne PAD officielle. Le multi-lot retourne
      // bien avant, donc un lot en périmètre PAD y est bloqué en amont par
      // resolvePadBlockersForLot (PAD_MULTI_LOT_UNSUPPORTED). Implémenter le PAD par lot = lever
      // ce blocker ET ajouter ici l'équivalent multi-lot, jamais l'un sans l'autre.
      if (inputs.padCategory && inputs.padRateFcfaPerTon != null && inputs.padRateFcfaPerTon > 0) {
        const weightTonnes = inputs.cargoWeight || 0;
        if (weightTonnes > 0) {
          const padAmount = Math.round(inputs.padRateFcfaPerTon * weightTonnes);
          const engineLines = engineResponse.lines || engineResponse.quotationLines || [];
          const officialPadLine = canonicalizeLine({
            category: 'PAD_DROIT_PASSAGE',
            label: `Droit de passage PAD ${inputs.padCategory}`,
            description: `Droit de passage PAD ${inputs.padCategory}`,
            amount: padAmount,
            currency: 'FCFA',
            unit: 'tonne',
            quantity: weightTonnes,
            unitPrice: inputs.padRateFcfaPerTon,
            source: {
              type: 'OFFICIAL',
              reference: `Fact dossier PAD (barème Redevances Portuaires 2006)`,
              confidence: 1.0,
            },
            isEditable: false,
          }, { origin_layer: 'enrichment_pad' });
          engineLines.push(officialPadLine);
          engineResponse.lines = engineLines;
          console.log(`[PAD] Droit de passage PAD ${inputs.padCategory}: ${padAmount} FCFA (${inputs.padRateFcfaPerTon} × ${weightTonnes}t)`);

          const shouldTryCmaCommission =
            isMaritime &&
            !isExportFlow &&
            !isTransitLikeFlow(caseData, inputs, pkg) &&
            normalizeCarrierCode(inputs.carrier) === 'CMA_CGM' &&
            Number(officialPadLine.amount) > 0 &&
            String(officialPadLine?.source?.type || '').trim().toUpperCase() === 'OFFICIAL';

          if (shouldTryCmaCommission) {
            try {
              const { data: commTemplates, error: commTemplateError } = await serviceClient
                .from('carrier_billing_templates')
                .select('carrier, charge_code, charge_name, calculation_method, default_amount, currency, operation_type, evidence_level, is_active, source_documents, base_reference, notes')
                .eq('carrier', 'CMA_CGM')
                .eq('charge_code', 'COMM')
                .eq('is_active', true)
                .in('operation_type', ['IMPORT', 'ALL'])
                .in('evidence_level', ['official', 'validated_internal']);

              if (commTemplateError) {
                throw commTemplateError;
              }

              const commTemplate = (commTemplates || []).find(isEligibleCmaCgmCommissionTemplate);
              if (commTemplate) {
                const commissionAmount = Math.round(Number(officialPadLine.amount) * CMA_CGM_DEBOURS_COMMISSION_RATE);
                if (commissionAmount > 0) {
                  engineLines.push(canonicalizeLine({
                    category: 'CMA_CGM_COMM',
                    label: 'Commission sur débours CMA CGM',
                    description: `Commission sur débours CMA CGM — ${CMA_CGM_DEBOURS_COMMISSION_PERCENT}% sur PAD_DROIT_PASSAGE (${officialPadLine.amount} FCFA)`,
                    amount: commissionAmount,
                    currency: 'FCFA',
                    unit: 'percentage',
                    quantity: Number(officialPadLine.amount),
                    unitPrice: CMA_CGM_DEBOURS_COMMISSION_PERCENT,
                    source: {
                      type: 'CALCULATED',
                      reference: getSourceReferenceFromTemplate(commTemplate),
                      confidence: 1.0,
                      table: 'carrier_billing_templates',
                    },
                    isEditable: false,
                  }, { origin_layer: 'enrichment_carrier_commission' }));
                  engineResponse.lines = engineLines;
                  console.log(`[CMA-COMM] Commission sur débours CMA CGM: ${commissionAmount} FCFA (${CMA_CGM_DEBOURS_COMMISSION_PERCENT}% × PAD ${officialPadLine.amount})`);
                }
              } else {
                console.log('[CMA-COMM] No eligible CMA_CGM/COMM template found — skipping commission');
              }
            } catch (cmaCommErr) {
              console.warn('[CMA-COMM] Template lookup failed (non-blocking):', cmaCommErr);
            }
          }
        } else {
          console.warn(`[PAD] cargo.pad_rate set but cargoWeight=0 — skipping droit de passage`);
        }
      }

      // ═══ Phase 3-B.1 + 3-A: Terminal Storage Provision Estimate (Dakar Terminal, P1, mono-lot only) ═══
      // Phase 3-B.1: Alias lookup (validated only) → Phase 3-A: Direct match fallback
      // Exact match only — 0 ILIKE, 0 fuzzy, 0 partial matching
      // handling_code is metadata only — not consumed for pricing
      // isMaritime already computed above (PAD-GAP-1 hoist)
      if (isMaritime && inputs.cargoDescription && inputs.cargoWeight && inputs.cargoWeight > 0) {
        try {
          // Normalize description for exact match
          const normalizedDesc = normalizePricingText(inputs.cargoDescription);
          if (normalizedDesc) {
            let matchedDesignation: { designation_label: string; storage_code_p1: string; unit_basis: string } | null = null;
            let matchSource: 'alias' | 'direct' = 'direct';

            // ── Phase 3-B.1: Alias lookup (validated only, normalized_term exact match) ──
            const { data: aliasRows } = await serviceClient
              .from('terminal_designation_aliases')
              .select('terminal_designation_id, bl_term')
              .eq('normalized_term', normalizedDesc)
              .eq('is_validated', true)
              .limit(1);

            if (aliasRows && aliasRows.length === 1) {
              const aliasRow = aliasRows[0];
              // Resolve the target designation
              const { data: targetDesignation } = await serviceClient
                .from('terminal_designations')
                .select('designation_label, storage_code_p1, unit_basis')
                .eq('id', aliasRow.terminal_designation_id)
                .eq('terminal_provider', 'dakar_terminal')
                .not('storage_code_p1', 'is', null)
                .maybeSingle();

              if (targetDesignation) {
                matchedDesignation = targetDesignation;
                matchSource = 'alias';
                console.log(`[TERMINAL_STORAGE] Alias match: "${inputs.cargoDescription}" → "${targetDesignation.designation_label}" via alias bl_term="${aliasRow.bl_term}"`);
              }
            }

            // ── Phase 3-A fallback: Direct match on designation_label ──
            if (!matchedDesignation) {
              const { data: tdRows } = await serviceClient
                .from('terminal_designations')
                .select('designation_label, storage_code_p1, unit_basis')
                .eq('terminal_provider', 'dakar_terminal')
                .not('storage_code_p1', 'is', null);

              const directMatch = (tdRows || []).find(
                (td: any) => normalizePricingText(td.designation_label) === normalizedDesc
              );

              if (directMatch) {
                matchedDesignation = directMatch;
                matchSource = 'direct';
              }
            }

            if (matchedDesignation) {
              const storageCodeP1 = String(matchedDesignation.storage_code_p1);

              // Lookup rate in terminal_tariff_codes
              const { data: tariffRow } = await serviceClient
                .from('terminal_tariff_codes')
                .select('code, amount_per_unit, unit_basis, currency, evidence_level, source_document')
                .eq('code', storageCodeP1)
                .eq('period', 'P1')
                .eq('tariff_type', 'storage')
                .eq('terminal_provider', 'dakar_terminal')
                .maybeSingle();

              if (tariffRow && tariffRow.amount_per_unit > 0) {
                // Map evidence_level to runtime source.type format
                const evidenceMap: Record<string, string> = {
                  'official': 'OFFICIAL',
                  'to_confirm': 'TO_CONFIRM',
                  'observed': 'OBSERVED',
                };
                const sourceType = evidenceMap[tariffRow.evidence_level] || 'TO_CONFIRM';

                const weightTonnes = inputs.cargoWeight;
                const provisionDays = 3;
                const provisionAmount = Math.round(tariffRow.amount_per_unit * weightTonnes * provisionDays);
                const weightFormatted = weightTonnes % 1 === 0 ? `${weightTonnes}` : weightTonnes.toFixed(1);

                const engineLines = engineResponse.lines || engineResponse.quotationLines || [];
                engineLines.push(canonicalizeLine({
                  category: 'TERMINAL_STORAGE_PROVISION_ESTIMATE',
                  label: 'Provision estimative magasinage terminal Dakar Terminal (hyp. 3j P1)',
                  description: `Provision estimative magasinage Dakar Terminal — Désignation: ${matchedDesignation.designation_label} — Taux P1 (code ${storageCodeP1}): ${tariffRow.amount_per_unit} FCFA/T/j × ${weightFormatted} T × ${provisionDays}j — Match: ${matchSource} — Caractère estimatif, non contractuel`,
                  amount: provisionAmount,
                  currency: 'FCFA',
                  unit: 'tonne',
                  quantity: weightTonnes,
                  unitPrice: tariffRow.amount_per_unit,
                  source: {
                    type: sourceType,
                    reference: tariffRow.source_document || 'Grille Officielle Dakar Terminal 2014',
                    confidence: 0.5,
                  },
                  isEditable: true,
                }, { origin_layer: 'enrichment_terminal_storage' }));
                engineResponse.lines = engineLines;
                console.log(`[TERMINAL_STORAGE] Provision P1: ${provisionAmount} FCFA — designation="${matchedDesignation.designation_label}" code=${storageCodeP1} rate=${tariffRow.amount_per_unit} weight=${weightFormatted}T days=${provisionDays} evidence=${sourceType} match=${matchSource}`);
              } else {
                console.warn(`[TERMINAL_STORAGE] No P1 tariff found for code ${storageCodeP1} — skipping`);
              }
            } else {
              // ═══ Phase 3-B.2-A: AI suggestion fallback (no pricing line produced) ═══
              console.warn(`[TERMINAL_STORAGE] No alias or direct match for "${inputs.cargoDescription}" — attempting AI suggestion`);
              try {
                // Anti-duplication: check if pending suggestions already exist for this normalized text
                const { data: existingSuggestions } = await serviceClient
                  .from('terminal_designation_suggestions')
                  .select('id')
                  .eq('normalized_source_text', normalizedDesc)
                  .eq('suggestion_status', 'pending')
                  .limit(1);

                if (existingSuggestions && existingSuggestions.length > 0) {
                  console.log(`[TERMINAL_STORAGE] AI suggestion already pending for "${normalizedDesc}" — skipping AI call`);
                } else {
                  // Load minimal designation reference for AI (Dakar Terminal, storage_code_p1 NOT NULL only)
                  const { data: aiRefDesignations } = await serviceClient
                    .from('terminal_designations')
                    .select('id, designation_label, unit_basis, notes')
                    .eq('terminal_provider', 'dakar_terminal')
                    .not('storage_code_p1', 'is', null);

                  if (aiRefDesignations && aiRefDesignations.length > 0) {
                    // Build minimal ref payload (id + label + unit_basis only, strip notes for payload size)
                    const refPayload = aiRefDesignations.map(d => ({
                      id: d.id,
                      label: d.designation_label,
                      unit: d.unit_basis,
                    }));

                    const validDesignationIds = new Set(aiRefDesignations.map(d => d.id));

                    const systemPrompt = `Tu es un expert en nomenclature portuaire du terminal Dakar Terminal (Bolloré).
Tu dois associer une description de marchandise (provenant d'un connaissement / BL) à une ou plusieurs désignations officielles du référentiel terminal.

Règles strictes :
- Ne propose QUE des désignations présentes dans le référentiel fourni ci-dessous
- Maximum 3 suggestions, classées par pertinence décroissante
- Si le texte semble composite (ex: "1 car and 2 motos"), signale-le dans le reasoning
- Si le texte est ambigu, dis-le explicitement et baisse le confidence_score
- Préfère dire "incertain" plutôt qu'inventer une correspondance
- confidence_score doit être un nombre entre 0.0 et 1.0

Réponds uniquement en JSON valide avec cette structure :
{
  "suggestions": [
    {
      "designation_id": "<uuid de la désignation>",
      "designation_label": "<libellé exact>",
      "confidence_score": <0.0 à 1.0>,
      "reasoning": "<explication courte>"
    }
  ],
  "is_composite": <true/false>,
  "composite_note": "<si composite, explication>"
}`;

                    const userPrompt = `Description BL : "${inputs.cargoDescription}"
Mode transport : maritime
Poids : ${inputs.cargoWeight} tonnes

Référentiel des désignations terminales Dakar Terminal :
${JSON.stringify(refPayload)}`;

                    // Call AI via Lovable AI Gateway
                    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
                    if (LOVABLE_API_KEY) {
                      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
                        method: "POST",
                        headers: {
                          Authorization: `Bearer ${LOVABLE_API_KEY}`,
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                          model: "google/gemini-2.5-flash",
                          messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: userPrompt },
                          ],
                          stream: false,
                          temperature: 0.2,
                        }),
                        signal: AbortSignal.timeout(15000),
                      });

                      if (aiResponse.ok) {
                        const aiData = await aiResponse.json();
                        const aiContent = aiData.choices?.[0]?.message?.content || "";

                        // Parse AI response — extract JSON
                        let aiResult: { suggestions?: Array<{ designation_id: string; designation_label: string; confidence_score: number; reasoning: string }>; is_composite?: boolean; composite_note?: string } | null = null;
                        try {
                          // Strip code fences if present
                          let jsonStr = aiContent.trim();
                          if (jsonStr.startsWith("```")) {
                            const firstNl = jsonStr.indexOf("\n");
                            if (firstNl !== -1) jsonStr = jsonStr.slice(firstNl + 1);
                            const lastFence = jsonStr.lastIndexOf("```");
                            if (lastFence !== -1) jsonStr = jsonStr.slice(0, lastFence);
                            jsonStr = jsonStr.trim();
                          }
                          aiResult = JSON.parse(jsonStr);
                        } catch (parseErr) {
                          console.warn(`[TERMINAL_STORAGE] AI response JSON parse failed:`, parseErr);
                        }

                        if (aiResult?.suggestions && Array.isArray(aiResult.suggestions)) {
                          // Filter: valid scores, valid IDs, max 3
                          const validSuggestions = aiResult.suggestions
                            .filter(s => {
                              const score = Number(s.confidence_score);
                              return (
                                s.designation_id &&
                                validDesignationIds.has(s.designation_id) &&
                                !isNaN(score) &&
                                score >= 0 &&
                                score <= 1
                              );
                            })
                            .slice(0, 3)
                            .map((s, idx) => ({
                              source_text: inputs.cargoDescription,
                              normalized_source_text: normalizedDesc,
                              terminal_designation_id: s.designation_id,
                              suggested_label: s.designation_label,
                              confidence_score: Math.min(1, Math.max(0, Number(s.confidence_score))),
                              reasoning: s.reasoning || (aiResult?.is_composite ? `Composite: ${aiResult.composite_note || ''}` : ''),
                              suggestion_rank: idx + 1,
                              suggestion_status: 'pending',
                              source_type: 'ai',
                            }));

                          if (validSuggestions.length > 0) {
                            const { error: insertErr } = await serviceClient
                              .from('terminal_designation_suggestions')
                              .insert(validSuggestions);

                            if (insertErr) {
                              console.warn(`[TERMINAL_STORAGE] Failed to insert AI suggestions:`, insertErr);
                            } else {
                              console.log(`[TERMINAL_STORAGE] AI suggestions stored for "${inputs.cargoDescription}" — ${validSuggestions.length} suggestions, awaiting operator review`);
                            }
                          } else {
                            console.log(`[TERMINAL_STORAGE] AI returned no valid suggestions for "${inputs.cargoDescription}"`);
                          }
                        }
                      } else {
                        console.warn(`[TERMINAL_STORAGE] AI call failed (${aiResponse.status}) — skipping suggestion`);
                      }
                    } else {
                      console.warn(`[TERMINAL_STORAGE] LOVABLE_API_KEY not available — skipping AI suggestion`);
                    }
                  }
                }
              } catch (aiError) {
                console.warn(`[TERMINAL_STORAGE] AI suggestion fallback failed, continuing:`, aiError);
              }
            }
          }
        } catch (tsError) {
          console.warn('[TERMINAL_STORAGE] Enrichment failed, continuing:', tsError);
        }
      }

      // ═══ Phase 3-C: Carrier Billing Charges Enrichment (ALL operation_type) ═══
      // Corrects G2: operation_type='ALL' missed by quotation-engine strict filter.
      // Mono-lot only — multi-lot returns before this point.
      // CMA_CGM/COMM skipped: already enriched in Phase 3 PAD commission block.
      // Ambiguous port charges skipped: would double-count PAD_DROIT_PASSAGE.
      {
        const carrierForEnrichment = normalizeCarrierCode(inputs.carrier);
        const isCarrierEnrichmentEligible =
          isMaritime &&
          !isExportFlow &&
          !isTransitLikeFlow(caseData, inputs, pkg) &&
          !!carrierForEnrichment;

        if (isCarrierEnrichmentEligible) {
          try {
            const { data: carrierTemplates, error: carrierTemplatesError } = await serviceClient
              .from('carrier_billing_templates')
              .select('carrier, charge_code, charge_name, calculation_method, default_amount, currency, operation_type, evidence_level, is_active, is_variable, base_reference, source_documents, notes')
              .eq('carrier', carrierForEnrichment)
              .eq('is_active', true)
              .in('operation_type', ['IMPORT', 'ALL']);

            if (carrierTemplatesError) throw carrierTemplatesError;

            const enrichLines = engineResponse.lines || engineResponse.quotationLines || [];

            // Engine line IDs for deduplication — engine uses 'carrier_${charge_code.lower}_N'
            const engineLineIdSet = new Set<string>(
              enrichLines.map((l: any) => String(l?.id || '')).filter(Boolean)
            );

            // Categories already enriched (defensive dedup)
            const enrichedCategorySet = new Set<string>(
              enrichLines.map((l: any) => String(l?.category || '')).filter(Boolean)
            );

            // Container quantities for PER_TEU / PER_CNT / PER_CONTAINER
            const enrichContainers = inputs.containers || [];
            const getTeuCount = (): number =>
              enrichContainers.reduce((s: number, c: { type: string; quantity: number }) =>
                s + (String(c.type || '').includes('40') ? 2 : 1) * c.quantity, 0);
            const getCntCount = (): number =>
              enrichContainers.reduce((s: number, c: { type: string; quantity: number }) => s + c.quantity, 0);

            for (const t of (carrierTemplates || [])) {
              const chargeCode = String(t.charge_code || '').trim().toUpperCase();
              const car = normalizeCarrierCode(t.carrier);
              const method = String(t.calculation_method || '').trim().toUpperCase();
              const evl = String(t.evidence_level || '').trim().toLowerCase();
              const isOfficialEvl = VALID_CARRIER_COMMISSION_EVIDENCE_LEVELS.has(evl);
              const isVar = t.is_variable === true;
              const amtRaw = t.default_amount;
              const amt = Number(amtRaw ?? NaN);
              const amtMissing = amtRaw === null || amtRaw === undefined || !Number.isFinite(amt) || amt <= 0;
              const cur = String(t.currency || 'XOF').trim().toUpperCase();
              const isXof = cur === 'XOF' || cur === 'FCFA';
              const categoryKey = `${car}_${chargeCode}`;

              // SKIP 1 — CMA_CGM/COMM: handled by Phase 3 PAD commission
              if (car === 'CMA_CGM' && chargeCode === 'COMM') {
                console.log('[CARRIER-ENRICH] Skip CMA_CGM/COMM — handled by Phase 3 PAD commission');
                continue;
              }

              // SKIP 2 — already produced by engine (operation_type=IMPORT)
              const engineIdPrefix = `carrier_${chargeCode.toLowerCase()}_`;
              if ([...engineLineIdSet].some((id) => id.startsWith(engineIdPrefix))) {
                console.log(`[CARRIER-ENRICH] Skip ${car}/${chargeCode} — already in engine lines`);
                continue;
              }

              // SKIP 3 — category already enriched (defensive dedup)
              if (enrichedCategorySet.has(categoryKey)) {
                console.log(`[CARRIER-ENRICH] Skip ${car}/${chargeCode} — category ${categoryKey} already present`);
                continue;
              }

              // SKIP 4 — ambiguous port/PAD charge (would double-count PAD_DROIT_PASSAGE)
              if (isAmbiguousCarrierPortChargeBasic(t)) {
                console.log(`[CARRIER-ENRICH] Skip ${car}/${chargeCode} — ambiguous port charge`);
                continue;
              }

              // Determine line type and amount
              let lineAmt = 0;
              let srcType: string;
              let toConfirmReason: string | null = null;

              if (isVar) {
                srcType = 'TO_CONFIRM';
                toConfirmReason = 'is_variable=true';
              } else if (amtMissing) {
                srcType = 'TO_CONFIRM';
                toConfirmReason = 'default_amount null ou invalide';
              } else if (!isOfficialEvl) {
                srcType = 'TO_CONFIRM';
                toConfirmReason = `evidence_level="${evl}" (hors official/validated_internal)`;
              } else if (!isXof) {
                // Foreign currency — no conversion in run-pricing
                srcType = 'TO_CONFIRM';
                toConfirmReason = `currency="${cur}" — conversion non disponible dans run-pricing`;
              } else {
                // Firm candidate: official/validated_internal + XOF/FCFA + amount > 0 + !is_variable
                switch (method) {
                  case 'PER_BL':
                    lineAmt = Math.round(amt);  // 1 BL mono-lot convention
                    srcType = 'OFFICIAL';
                    break;
                  case 'PER_TEU': {
                    const teu = getTeuCount();
                    if (teu > 0) {
                      lineAmt = Math.round(amt * teu);
                      srcType = 'OFFICIAL';
                    } else {
                      srcType = 'TO_CONFIRM';
                      toConfirmReason = 'PER_TEU — aucun conteneur (TEU=0)';
                    }
                    break;
                  }
                  case 'PER_CNT':
                  case 'PER_CONTAINER': {
                    const cnt = getCntCount();
                    if (cnt > 0) {
                      lineAmt = Math.round(amt * cnt);
                      srcType = 'OFFICIAL';
                    } else {
                      srcType = 'TO_CONFIRM';
                      toConfirmReason = 'PER_CNT/PER_CONTAINER — aucun conteneur (CNT=0)';
                    }
                    break;
                  }
                  case 'PERCENTAGE':
                    srcType = 'TO_CONFIRM';
                    toConfirmReason = `PERCENTAGE — V1 conservateur : aucun calcul ferme (base_reference="${t.base_reference || 'non défini'}")`;
                    break;
                  case 'PER_TONNE':
                    srcType = 'TO_CONFIRM';
                    toConfirmReason = 'PER_TONNE — montant variable ou non contractualisé';
                    break;
                  default:
                    srcType = 'TO_CONFIRM';
                    toConfirmReason = `méthode de calcul non gérée: ${method}`;
                }
              }

              const lineLabel = String(t.charge_name || chargeCode);
              const lineDesc = srcType === 'TO_CONFIRM'
                ? `${lineLabel} — À confirmer : ${toConfirmReason}`
                : `${lineLabel} (${car})`;

              enrichLines.push(canonicalizeLine({
                category: categoryKey,
                label: lineLabel,
                description: lineDesc,
                amount: lineAmt,
                currency: isXof ? 'XOF' : cur,
                source: {
                  type: srcType,
                  reference: getSourceReferenceFromTemplate(t),
                  confidence: srcType === 'TO_CONFIRM' ? 0 : 0.9,
                  table: 'carrier_billing_templates',
                },
                isEditable: srcType === 'TO_CONFIRM',
              }, { origin_layer: 'enrichment_carrier_charges' }));

              console.log(`[CARRIER-ENRICH] ${car}/${chargeCode} → ${srcType}${lineAmt > 0 ? ` ${lineAmt} ${isXof ? 'XOF' : cur}` : (toConfirmReason ? ` (${toConfirmReason})` : '')}`);
            }

            engineResponse.lines = enrichLines;
          } catch (carrierEnrichErr) {
            console.warn('[CARRIER-ENRICH] Non-blocking error:', String(carrierEnrichErr));
          }
        }
      }

    } catch (engineError: any) {
      console.error("Pricing engine error:", engineError);

      // Phase EQ1.2-quinquies: detect recoverable exchange rate blocker
      const errorMsg = String(engineError?.message || '');
      const exchangeRateMatch = errorMsg.match(/Exchange rate for\s+([A-Z]{3})/i);
      const isExchangeRateBlocker =
        exchangeRateMatch && errorMsg.includes('expired or missing');

      if (isExchangeRateBlocker) {
        const missingCurrency = exchangeRateMatch[1]?.toUpperCase() || 'USD';
        console.log(`[EQ1.2] Exchange rate blocker detected for ${missingCurrency}, returning soft blocker`);

        // Record as blocked (not failed)
        await serviceClient
          .from("pricing_runs")
          .update({
            status: "blocked",
            error_message: `Exchange rate for ${missingCurrency} expired or missing`,
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
          })
          .eq("id", pricingRun.id);

        await rollbackToPreviousStatus(serviceClient, case_id, previousStatus, "exchange_rate_blocked");

        await serviceClient.from("case_timeline_events").insert({
          case_id,
          event_type: "pricing_blocked",
          event_data: {
            blocker_code: "EXCHANGE_RATE_REQUIRED",
            missing_currency: missingCurrency,
            run_number: runNumber,
          },
          related_pricing_run_id: pricingRun.id,
          actor_type: "system",
        });

        return new Response(
          JSON.stringify({
            success: false,
            status: "blocked",
            pricing_blockers: ["EXCHANGE_RATE_REQUIRED"],
            missing_currency: missingCurrency,
            message: `Aucun taux de change ${missingCurrency}/XOF valide n'est disponible.`,
            pricing_run_id: pricingRun.id,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // All other engine errors: genuine failure (500)
      await serviceClient
        .from("pricing_runs")
        .update({
          status: "failed",
          error_message: engineError.message,
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
        })
        .eq("id", pricingRun.id);

      await rollbackToPreviousStatus(serviceClient, case_id, previousStatus, "engine_failed");

      await serviceClient.from("case_timeline_events").insert({
        case_id,
        event_type: "pricing_failed",
        event_data: { error: engineError.message, run_number: runNumber },
        related_pricing_run_id: pricingRun.id,
        actor_type: "system",
      });

      return new Response(
        JSON.stringify({ 
          error: "Pricing failed", 
          details: engineError.message,
          pricing_run_id: pricingRun.id,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ═══ P1-B2: consommation des décisions humaines maritimes (mono-lot) ═══
    //
    // Placée APRÈS tous les enrichissements et AVANT le calcul des totaux, pour
    // trois raisons indissociables :
    //  - elle voit l'état FINAL des lignes, donc elle peut dédoublonner un frais
    //    déjà porté par un template ou par le moteur ;
    //  - rien de ce qu'elle produit n'échappe à `computeCommercialTotals`, qui
    //    lit les lignes juste après ;
    //  - `service.overrides.remove` a déjà été appliqué en amont : la table close
    //    du module refuse en plus de produire une ligne pour un service retiré,
    //    donc aucune ligne retirée ne peut réapparaître par ce chemin.
    //
    // Le moteur PUR décide ; ce bloc ne fait que lui donner l'état du dossier et
    // appliquer son verdict.
    const maritimeRemovedServiceKeys = resolveExplicitlyRemovedServiceKeys(
      readOverridesFromFacts(facts || []),
    );
    let maritimeIdentities: CurrentProposalIdentity[] = [];
    if (hasActiveMaritimeDecision(maritimeDecisionRows)) {
      // Fraîcheur = empreinte B1 recalculée sur les faits COURANTS, via le même
      // module que `manage-maritime-fee-decision`. Calculée seulement s'il existe
      // une décision à juger : zéro coût pour les dossiers sans décision.
      const maritimeInput = mapFactsToMaritimeInput(
        caseData.request_type,
        facts || [],
      );
      const { proposals: maritimeProposals } = buildMaritimeFeeProposals(
        maritimeInput,
        MARITIME_PARAMETRAGE,
      );
      maritimeIdentities = await computeCurrentProposalIdentities(
        maritimeInput,
        maritimeProposals,
      );
    }

    const maritimeConsumption: MaritimeFeeConsumptionResult = buildMaritimeFeeConsumption({
      decisions: maritimeDecisionRows,
      identities: maritimeIdentities,
      lines: engineResponse.lines || engineResponse.quotationLines || [],
      removedServiceKeys: maritimeRemovedServiceKeys,
      carrierCode: normalizeCarrierCode(inputs.carrier),
      registryAvailable: maritimeDecisionRead.registryAvailable,
    });

    if (maritimeConsumption.blockers.length > 0) {
      const maritimeBlockMessage = maritimeConsumption.message ??
        "Décision maritime non consommable : chiffrage bloqué.";
      console.warn(
        `[P1-B2] Pricing bloqué: ${maritimeConsumption.blockers.join(', ')} — ` +
          maritimeConsumption.blocker_details.map((d) => `${d.code}/${d.decision_key}: ${d.detail}`).join(' | '),
      );

      await serviceClient
        .from("pricing_runs")
        .update({
          status: "blocked",
          error_message: maritimeBlockMessage,
          outputs_json: {
            pricing_blockers: maritimeConsumption.blockers,
            message: maritimeBlockMessage,
            maritime_fee_decisions: {
              blockers: maritimeConsumption.blockers,
              blocker_details: maritimeConsumption.blocker_details,
              entries: maritimeConsumption.entries,
            },
          },
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
        })
        .eq("id", pricingRun.id);

      await rollbackToPreviousStatus(
        serviceClient, case_id, previousStatus, "maritime_fee_decision_blocked",
      );

      await serviceClient.from("case_timeline_events").insert({
        case_id,
        event_type: "pricing_blocked",
        event_data: {
          blocker_code: maritimeConsumption.blockers[0],
          blockers: maritimeConsumption.blockers,
          blocker_details: maritimeConsumption.blocker_details,
          run_number: runNumber,
        },
        related_pricing_run_id: pricingRun.id,
        actor_type: "system",
      });

      return new Response(
        JSON.stringify({
          success: false,
          status: "blocked",
          pricing_blockers: maritimeConsumption.blockers,
          message: maritimeBlockMessage,
          maritime_fee_decisions: {
            blockers: maritimeConsumption.blockers,
            blocker_details: maritimeConsumption.blocker_details,
          },
          pricing_run_id: pricingRun.id,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    engineResponse.lines = maritimeConsumption.lines;
    if (maritimeConsumption.entries.length > 0) {
      console.log(
        `[P1-B2] Décisions maritimes consommées: ${
          maritimeConsumption.entries
            .map((e) => `${e.decision_key}=${e.state}${e.amount_xof !== null ? `:${e.amount_xof}` : ''}`)
            .join(', ')
        }`,
      );
    }

    // 12. Parse and store results
    const tariffLines = engineResponse.lines || engineResponse.quotationLines || [];
    const engineTotals = engineResponse.totals;
    const incotermUpper = (inputs.incoterm || "").toUpperCase();

    // A single pure implementation is shared by runtime and unit tests.
    // `totalHt` remains the legacy DB column name; the precise semantic is
    // `subtotal_before_sodatra_vat` because supplier-TTC debours may be present.
    const commercialTotals = computeCommercialTotals({ engineTotals, lines: tariffLines });
    const totalHt = commercialTotals.totalHt;
    const totalTtc = commercialTotals.totalTtc;
    const currency = engineResponse.currency || "XOF";

    const outputsJson = {
      lines: tariffLines,
      warnings: Array.isArray(engineResponse.warnings) ? engineResponse.warnings : [],
      totals: {
        ht: totalHt,
        ttc: totalTtc,
        subtotal_before_sodatra_vat: commercialTotals.subtotalBeforeSodatraVat,
        total_payable: commercialTotals.totalPayable,
        honoraires_ht: commercialTotals.honorairesHt,
        honoraires_tva: commercialTotals.honorairesTva,
        honoraires_ttc: commercialTotals.honorairesTtc,
        operationnel: commercialTotals.operationnel,
        border: commercialTotals.border,
        terminal: commercialTotals.terminal,
        // Legacy field retained for compatibility: customs/pass-through enrichments only.
        debours: commercialTotals.deboursLegacy,
        debours_engine: commercialTotals.deboursDouaniers,
        debours_douaniers: commercialTotals.deboursDouaniers,
        debours_enrichment: commercialTotals.deboursEnrichment,
        local_transport_debours_ttc: commercialTotals.localTransportDeboursTtc,
        local_transport_commission: commercialTotals.localTransportCommission,
        debours_total: commercialTotals.deboursTotal,
        dap: commercialTotals.dap,
        ddp: commercialTotals.ddp,
        dap_engine_raw: commercialTotals.dapEngineRaw,
        ddp_engine_raw: commercialTotals.ddpEngineRaw,
        enrichment_amount: commercialTotals.enrichmentAmount,
        currency,
        incoterm_applied:
          engineResponse.metadata?.normalized_incoterm
          ?? engineResponse.metadata?.incoterm?.code
          ?? incotermUpper
          ?? "N/A",
      },
      duty_breakdown: engineResponse.duty_breakdown || [],
      // P1-B2 — état ferme / provisoire / exclu de chaque frais maritime décidé.
      // Bloc PUREMENT documentaire : il ne porte aucun total et n'est lu par
      // aucun calcul. La provenance qui compte reste portée par les lignes
      // elles-mêmes (`maritime_fee_decision`), donc les raw lines suffisent au
      // snapshot de version, au PDF et à l'e-mail — inchangés par ce lot.
      maritime_fee_decisions: {
        registry_available: maritimeDecisionRead.registryAvailable,
        entries: maritimeConsumption.entries,
      },
      metadata: {
        engine_version: engineResponse.version || "v4",
        computed_at: new Date().toISOString(),
        request_type: caseData.request_type,
        duties_regime_code: inputs.regimeCode || null,
        original_incoterm: engineResponse.metadata?.original_incoterm ?? inputs.incoterm ?? null,
        normalized_incoterm:
          engineResponse.metadata?.normalized_incoterm
          ?? engineResponse.metadata?.incoterm?.code
          ?? null,
        incoterm: engineResponse.metadata?.incoterm ?? null,
      },
      client: {
        email: inputs.clientEmail,
        company: inputs.clientCompany,
      },
      routing: {
        origin: inputs.originPort || inputs.originAirport,
        destination: inputs.finalDestination,
        incoterm: inputs.incoterm,
        normalized_incoterm:
          engineResponse.metadata?.normalized_incoterm
          ?? engineResponse.metadata?.incoterm?.code
          ?? null,
      },
    };

    // ═══ LOT 4: Inject quoteQualification for provisional DDP runs ═══
    if (isProvisionalDdp) {
      (outputsJson as any).quoteQualification = {
        level: "provisional",
        reasons: [{ code: "MISSING_CARGO_VALUE", message: "Droits et taxes à confirmer après réception de la valeur marchandise" }],
        firmTotalPolicy: "excludes_reserved_items",
      };
    }

    const durationMs = Date.now() - startTime;

    // 13. Update pricing_run with results
    await serviceClient
      .from("pricing_runs")
      .update({
        status: "success",
        engine_request: {
          finalDestination: inputs.finalDestination,
          originPort: inputs.originPort,
          containers: inputs.containers,
        },
        engine_response: engineResponse,
        outputs_json: outputsJson,
        tariff_lines: tariffLines,
        total_ht: totalHt,
        total_ttc: totalTtc,
        currency,
        tariff_sources: tariffSources,
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
      })
      .eq("id", pricingRun.id);

    // 14. Transition case to PRICED_DRAFT (skip for finalized cases)
    if (!isFinalized) {
      await serviceClient
        .from("quote_cases")
        .update({ 
          status: "PRICED_DRAFT",
          pricing_runs_count: runNumber,
          last_activity_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", case_id);
    } else {
      // Finalized case: only update pricing_runs_count, no status change
      await serviceClient
        .from("quote_cases")
        .update({ 
          pricing_runs_count: runNumber,
          last_activity_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", case_id);
    }

    await serviceClient.from("case_timeline_events").insert({
      case_id,
      event_type: "pricing_completed",
      event_data: { 
        run_number: runNumber, 
        total_ht: totalHt,
        lines_count: tariffLines.length,
        duration_ms: durationMs,
        ...(isProvisionalDdp ? { provisional_mode: true } : {}),
      },
      related_pricing_run_id: pricingRun.id,
      actor_type: "system",
    });

    if (!isFinalized) {
      await serviceClient.from("case_timeline_events").insert({
        case_id,
        event_type: "status_changed",
        previous_value: "PRICING_RUNNING",
        new_value: "PRICED_DRAFT",
        actor_type: "system",
      });
    }

    console.log(`Pricing run ${runNumber} for case ${case_id} completed in ${durationMs}ms`);

    return new Response(
      JSON.stringify({
        pricing_run_id: pricingRun.id,
        run_number: runNumber,
        total_ht: totalHt,
        total_ttc: totalTtc,
        currency,
        lines_count: tariffLines.length,
        duration_ms: durationMs,
        tariff_sources_count: tariffSources.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in run-pricing:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
}

/**
 * CTO FIX: Rollback case status on pricing initialization failure
 * Prevents cases from being stuck in PRICING_RUNNING
 */
async function rollbackToPreviousStatus(
  client: any,
  caseId: string,
  targetStatus: string,
  reason: string
): Promise<void> {
  try {
    await client
      .from("quote_cases")
      .update({ 
        status: targetStatus, 
        updated_at: new Date().toISOString() 
      })
      .eq("id", caseId);

    await client.from("case_timeline_events").insert({
      case_id: caseId,
      event_type: "status_rollback",
      event_data: { reason, target_status: targetStatus },
      actor_type: "system",
    });

    console.log(`Rolled back case ${caseId} to ${targetStatus} due to: ${reason}`);
  } catch (rollbackError) {
    console.error(`Failed to rollback case ${caseId}:`, rollbackError);
  }
}

// ═══ Lot 1.2 — Résolution défensive du client.code depuis quote_facts ═══
// Lecture stricte du fact canonique. Aucune heuristique (pas de fallback
// depuis clientCompany ou clientEmail). Retourne null si absent ou vide.
function resolveClientCode(facts: any[]): string | null {
  if (!Array.isArray(facts)) return null;
  const f = facts.find((x: any) => x?.fact_key === 'client.code');
  if (!f) return null;
  const raw = f.value_text;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function buildPricingInputs(facts: any[]): PricingInputs {
  const inputs: PricingInputs = {};

  for (const fact of facts) {
    const value = fact.value_json ?? fact.value_number ?? fact.value_text;

    switch (fact.fact_key) {
      case "routing.origin_port":
        inputs.originPort = String(value);
        break;
      case "routing.origin_airport":
        inputs.originAirport = String(value);
        break;
      case "routing.destination_port":
        inputs.destinationPort = String(value);
        break;
      case "routing.destination_airport":
        inputs.destinationAirport = String(value);
        break;
      case "routing.destination_city":
        inputs.finalDestination = String(value);
        break;
      case "routing.incoterm":
        inputs.incoterm = String(value);
        break;
      case "cargo.containers": {
        // V4.1.5: Defensive parse for double-encoded JSON strings
        let parsedContainers = value;
        if (typeof parsedContainers === "string") {
          try { parsedContainers = JSON.parse(parsedContainers); } catch { parsedContainers = []; }
        }
        inputs.containers = Array.isArray(parsedContainers) ? parsedContainers : [];
        break;
      }
      case "cargo.weight_kg":
        inputs.cargoWeight = Number(value) / 1000; // kg → tonnes (quotation-engine attend des tonnes)
        break;
      case "cargo.volume_cbm":
        inputs.cargoVolume = Number(value);
        break;
      case "cargo.value":
        inputs.cargoValue = Number(value);
        break;
      case "cargo.value_currency":
        inputs.cargoValueCurrency = String(value);
        break;
      case "cargo.description":
        inputs.cargoDescription = String(value);
        break;
      case "carrier.name":
        inputs.carrier = String(value);
        break;
      case "contacts.client_email":
        inputs.clientEmail = String(value);
        break;
      case "contacts.client_company":
        inputs.clientCompany = String(value);
        break;
      case "cargo.hs_code":
        inputs.hsCode = String(value);
        break;
      case "cargo.cn_code":
        inputs.cnCode = String(value);
        break;
      case "cargo.nhm_code":
        inputs.nhmCode = String(value);
        break;
      case "cargo.nst_code":
        inputs.nstCode = String(value);
        break;
      case "cargo.nstr_code":
        inputs.nstrCode = String(value);
        break;
      case "cargo.articles_detail": {
        let parsed = value;
        if (typeof parsed === "string") {
          try { parsed = JSON.parse(parsed); } catch { parsed = []; }
        }
        inputs.articlesDetail = Array.isArray(parsed) ? parsed : [];
        break;
      }
      case "customs.regime_code":
        inputs.regimeCode = String(value);
        break;
      case "regulatory.exemption_title":
        inputs.exemptionTitle = String(value);
        break;
      case "cargo.freight_cost": {
        const raw = String(value ?? "").trim();
        const normalized = raw.replace(/\s/g, "").replace(/,/g, ".");
        const n = Number(normalized);
        inputs.freightCost = Number.isFinite(n) ? n : undefined;
        break;
      }
      case "cargo.freight_currency":
        inputs.freightCurrency = String(value);
        break;
      case "service.package":
        inputs.servicePackage = String(value);
        break;
    }
  }

  // ═══ PAD: business value, not propagation metadata ═══
  // The generic `value` above is correct for facts whose value really IS JSON
  // (cargo.containers, cargo.articles_detail, …) but NOT for cargo.pad_category /
  // cargo.pad_rate_fcfa_per_ton: MAP-6/7B/8B write the business value in value_text /
  // value_number and reserve value_json for propagation metadata, so `value` was the
  // metadata object → padCategory "[object Object]", padRateFcfaPerTon NaN, and the
  // PAD_DROIT_PASSAGE line was dropped from a run that still reported success.
  // Read here through the same readers as resolvePadScopeBlocker; the keys stay unset
  // when no usable value exists, so the enrichment below still fails closed.
  Object.assign(inputs, readPadPricingInputs(facts));

  // P8: Fallback — export dossiers have destination_port but not destination_city
  if (!inputs.finalDestination) {
    inputs.finalDestination =
      inputs.destinationPort ||
      inputs.destinationAirport ||
      undefined;
  }

  return inputs;
}

function summarizeInputs(inputs: PricingInputs): string {
  const parts: string[] = [];
  if (inputs.originPort) parts.push(`from ${inputs.originPort}`);
  if (inputs.originAirport) parts.push(`from ${inputs.originAirport}`);
  if (inputs.finalDestination) parts.push(`to ${inputs.finalDestination}`);
  if (inputs.incoterm) parts.push(inputs.incoterm);
  if (inputs.containers?.length) {
    parts.push(`${inputs.containers.map(c => `${c.quantity}x${c.type}`).join(", ")}`);
  }
  return parts.join(" ") || "No routing info";
}

/**
 * P3b.1: Merge lot-specific extracted_facts_json over global facts by key.
 * CTO-corrected: converts values based on valueType (number, json, text).
 */
function mergeFactsForLot(globalFacts: any[], lotExtractedFacts: any[]): any[] {
  const merged = new Map<string, any>();

  for (const f of globalFacts) {
    merged.set(f.fact_key, f);
  }

  for (const lf of lotExtractedFacts || []) {
    if (!lf?.key) continue;

    const valueType = String(lf.valueType || "").toLowerCase();
    const raw = lf.value;

    let value_text: string | null = null;
    let value_number: number | null = null;
    let value_json: any = null;

    if (valueType === "number") {
      const n = Number(raw);
      value_number = Number.isFinite(n) ? n : null;
      value_text = raw != null ? String(raw) : null;
    } else if (valueType === "json") {
      value_json = raw;
      value_text = typeof raw === "string" ? raw : JSON.stringify(raw);
    } else {
      value_text = raw != null ? String(raw) : null;
    }

    // HS-NORMALIZATION Phase A guard: don't let a lot-level short HS code
    // overwrite a more precise global 10-digit code sharing the same SH6.
    // STRUCTURAL_PATCH_ALLOWED — see docs/MASTER_CONTEXT.md
    if (lf.key === 'cargo.hs_code' && value_text) {
      const lotDigits = value_text.replace(/\D/g, '');
      if (lotDigits.length > 0 && lotDigits.length < 10) {
        const existing = merged.get('cargo.hs_code');
        const existingDigits = existing?.value_text?.replace(/\D/g, '') || '';
        if (existingDigits.length === 10 &&
            lotDigits.substring(0, 6) === existingDigits.substring(0, 6)) {
          // Same SH6, global more precise → keep global
          continue;
        }
      }
    }

    merged.set(lf.key, {
      fact_key: lf.key,
      value_text,
      value_number,
      value_json,
      source_type: "lot_override",
      confidence: typeof lf.confidence === "number" ? lf.confidence : 0.8,
    });
  }

  return Array.from(merged.values());
}

/**
 * P3b.1: Resolve service package for a lot based on request_type_hint and incoterm.
 * Aligned with P3a — covers only currently emitted request types.
 * Does NOT replace the global service package registry.
 */
function resolveServicePackageForLot(requestTypeHint: string, incoterm: string, globalServicePackage?: string): string | undefined {
  // If global package is explicitly export, respect it over import resolution
  const gp = String(globalServicePackage || "").trim().toUpperCase();
  if (gp && SERVICE_PACKAGES[gp] && gp.startsWith("EXPORT_")) {
    return gp;
  }

  const rt = String(requestTypeHint || "").trim().toUpperCase();
  const ic = String(incoterm || "").trim().toUpperCase();
  const isOrigin = ["EXW", "FCA", "FAS"].includes(ic);
  const isDDP = ic === "DDP";

  // Package-DDP micro-lot: 3-branch resolution (EXW / DDP / DAP) for AIR & LCL imports.
  if (rt === "SEA_LCL_IMPORT") {
    if (isOrigin) return "LCL_IMPORT_EXW";
    if (isDDP) return "LCL_IMPORT_DDP";
    return "LCL_IMPORT_DAP";
  }
  if (rt === "AIR_LCL_IMPORT" || rt === "AIR_IMPORT") {
    if (isOrigin) return "AIR_IMPORT_EXW";
    if (isDDP) return "AIR_IMPORT_DDP";
    return "AIR_IMPORT_DAP";
  }
  if (rt === "SEA_FCL_IMPORT" || rt === "IMPORT_PROJECT_DAP") return isOrigin ? "DAP_PROJECT_IMPORT_EXW" : "DAP_PROJECT_IMPORT";

  return undefined;
}

/**
 * P3b.1: Resolve transport mode for a lot from its request_type_hint.
 */
function resolveTransportModeForLot(requestTypeHint: string): string {
  return String(requestTypeHint || "").toUpperCase().includes("AIR") ? "aerien" : "maritime";
}
