/**
 * P1-A4 — pricing isolé par scénario.
 *
 * Voie strictement parallèle à run-pricing : aucune transition de dossier,
 * aucun pricing_run canonique, aucun gap, aucune timeline dossier et aucun
 * écrit dans quote_facts. Les résultats vivent exclusivement dans le ledger
 * quote_scenario_pricing_runs via une RPC atomique service_role-only.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { handleCors } from "../_shared/cors.ts";
import {
  ERROR_CONFIG,
  getCorrelationId,
  getStatusFromErrorCode,
  logRuntimeEvent,
  respondError,
  respondOk,
} from "../_shared/runtime.ts";
import {
  readOverridesFromFacts,
  resolveExplicitlyRemovedServiceKeys,
  resolveEffectiveServiceKeys,
  SERVICE_PACKAGES,
} from "../_shared/service-scope.ts";
import { resolvePadScopeBlocker } from "../_shared/pad-scope-blocker.ts";
import { priceScenarioPad } from "./pad-pricing.ts";
import { priceScenarioFees } from "./fee-pricing.ts";
import { scenarioEmptyReturnLines } from "./ownership-pricing.ts";
import type { FeeLineRow, FeeRuleRow } from "../_shared/fee-rules.ts";
import {
  buildEngineRequest,
  buildScenarioCargoPricing,
  resolveScenarioContainerTerminal,
  applyScenarioContainerTerminalLines,
  applyScenarioExplicitServiceRemovals,
  buildFingerprintInput,
  buildMissingServiceReserveLines,
  buildPricingInputs,
  buildScenarioOverlay,
  computeRequestFingerprint,
  computeScenarioTotals,
  deriveQualification,
  inferCoveredServices,
  mapRpcErrorCode,
  stableStringify,
  validateScenarioPricingRequest,
  type PricingAssumptionRow,
  type PricingFactRow,
  type ScenarioPricingRequest,
  type ScenarioTariffLine,
} from "./domain.ts";

export {
  buildEngineRequest,
  buildFingerprintInput,
  buildMissingServiceReserveLines,
  buildPricingInputs,
  buildScenarioOverlay,
  computeRequestFingerprint,
  computeScenarioTotals,
  deriveQualification,
  inferCoveredServices,
  mapRpcErrorCode,
  stableStringify,
  validateScenarioPricingRequest,
} from "./domain.ts";

const FUNCTION_NAME = "run-scenario-pricing";

function getServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function logEvent(
  client: unknown,
  entry: Parameters<typeof logRuntimeEvent>[1],
): Promise<void> {
  await logRuntimeEvent(client as Parameters<typeof logRuntimeEvent>[0], entry);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function buildFactsSnapshot(rows: PricingFactRow[]): PricingFactRow[] {
  return (rows ?? []).map((row) => ({
    id: row.id,
    fact_key: row.fact_key,
    value_text: row.value_text ?? null,
    value_number: row.value_number ?? null,
    value_json: row.value_json ?? null,
    value_date: row.value_date ?? null,
    source_type: row.source_type ?? null,
    confidence: row.confidence ?? null,
  })).sort((a, b) => a.id.localeCompare(b.id));
}

function buildAssumptionsSnapshot(rows: PricingAssumptionRow[]): PricingAssumptionRow[] {
  return (rows ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    assumption_type: row.assumption_type ?? null,
    assumed_fact_key: row.assumed_fact_key ?? null,
    assumed_value_type: row.assumed_value_type ?? null,
    assumed_value: row.assumed_value ?? null,
    statement: row.statement ?? null,
    basis: row.basis ?? null,
    source_type: row.source_type ?? null,
    source_refs: row.source_refs ?? [],
    risk_level: row.risk_level ?? null,
  })).sort((a, b) => a.id.localeCompare(b.id));
}

function buildTariffSources(lines: ScenarioTariffLine[]): Record<string, unknown>[] {
  const sources = new Map<string, Record<string, unknown>>();
  for (const line of lines) {
    const source = asObject(line.source);
    if (String(source.type ?? "").trim().toUpperCase() === "TO_CONFIRM") continue;
    const reference = String(source.reference ?? "").trim();
    const type = String(source.type ?? "").trim();
    if (!type && !reference) continue;
    const normalized = {
      type: type || null,
      reference: reference || null,
      table: source.table ?? null,
      confidence: source.confidence ?? null,
    };
    sources.set(stableStringify(normalized), normalized);
  }
  return Array.from(sources.values());
}

async function partnerFactsAreSelected(
  serviceClient: ReturnType<typeof getServiceClient>,
  caseId: string,
  effectiveFacts: PricingFactRow[],
): Promise<boolean> {
  const usedPartnerFacts = effectiveFacts.filter((fact) =>
    fact.source_type === "partner_response"
  );
  if (usedPartnerFacts.length === 0) return true;

  const [requestsResult, factsResult] = await Promise.all([
    serviceClient.from("external_quote_requests")
      .select("id,is_selected")
      .eq("case_id", caseId)
      .eq("is_selected", true),
    serviceClient.from("external_quote_response_facts")
      .select("request_id,injected_fact_id,validation_status")
      .eq("case_id", caseId)
      .eq("validation_status", "validated"),
  ]);
  if (requestsResult.error || factsResult.error) {
    throw new Error("Impossible de vérifier la provenance partenaire");
  }
  const selected = requestsResult.data ?? [];
  if (selected.length !== 1) return false;
  const selectedId = selected[0].id;
  const validatedIds = new Set(
    (factsResult.data ?? [])
      .filter((row) => row.request_id === selectedId && row.injected_fact_id)
      .map((row) => row.injected_fact_id),
  );
  return usedPartnerFacts.every((fact) => validatedIds.has(fact.id));
}

async function recordRun(params: {
  serviceClient: ReturnType<typeof getServiceClient>;
  request: ScenarioPricingRequest;
  userId: string;
  fingerprint: string;
  result: Record<string, unknown>;
}): Promise<{
  data: Record<string, unknown>;
  error: { message?: string } | null;
}> {
  const { data, error } = await params.serviceClient.rpc("record_quote_scenario_pricing_run", {
    p_case_id: params.request.case_id,
    p_scenario_id: params.request.scenario_id,
    p_expected_scope_hash: params.request.expected_scope_hash,
    p_idempotency_key: params.request.idempotency_key,
    p_request_fingerprint: params.fingerprint,
    p_actor_user_id: params.userId,
    p_result: params.result,
  });
  return {
    data: asObject(data),
    error: error as { message?: string } | null,
  };
}

async function handleRequest(req: Request): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const correlationId = getCorrelationId(req);
  const startedAt = Date.now();
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  let serviceClient: ReturnType<typeof getServiceClient> | null = null;

  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return respondError({
        code: "VALIDATION_FAILED",
        message: "Corps JSON invalide",
        correlationId,
      });
    }
    const validated = validateScenarioPricingRequest(raw);
    if (!validated.ok) {
      return respondError({
        code: "VALIDATION_FAILED",
        message: validated.message,
        correlationId,
      });
    }
    const request = validated.value;

    const authorization = req.headers.get("Authorization")!;
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    // Preuve RLS sous l'identité de l'appelant AVANT création du client
    // service_role. Le ledger de scénarios possède le grant SELECT explicite
    // et sa policy d'équipe ; quote_cases conserve un ancien écart de grants
    // dans le reset local. Aucun privilège n'est élargi pour contourner cet
    // écart : l'objet exact demandé doit être visible et appartenir au dossier.
    const { data: visibleScenario, error: scenarioAccessError } = await userClient
      .from("quote_scenarios")
      .select("id,case_id")
      .eq("id", request.scenario_id)
      .eq("case_id", request.case_id)
      .maybeSingle();
    if (scenarioAccessError || !visibleScenario) {
      return respondError({
        code: "FORBIDDEN_OWNER",
        message: "Scénario introuvable ou accès refusé",
        correlationId,
      });
    }

    serviceClient = getServiceClient();
    const [scenarioResult, factsResult, linksResult, linesCountResult, selectionResult] =
      await Promise.all([
        serviceClient.from("quote_scenarios")
          .select("id,case_id,status,scope_hash,scope_snapshot,open_points")
          .eq("id", request.scenario_id)
          .maybeSingle(),
        serviceClient.from("quote_facts")
          .select("id,fact_key,value_text,value_number,value_json,value_date,source_type,confidence")
          .eq("case_id", request.case_id)
          .eq("is_current", true),
        serviceClient.from("quote_scenario_links")
          .select("assumption_id,reserve_code,open_point_key")
          .eq("scenario_id", request.scenario_id),
        serviceClient.from("quote_request_lines")
          .select("id", { count: "exact", head: true })
          .eq("case_id", request.case_id),
        serviceClient.from("quote_scenario_selections")
          .select("scenario_id")
          .eq("case_id", request.case_id)
          .is("released_at", null)
          .maybeSingle(),
      ]);

    if (scenarioResult.error || !scenarioResult.data) {
      return respondError({
        code: "VALIDATION_FAILED",
        message: "Scénario introuvable",
        correlationId,
      });
    }
    if (scenarioResult.data.case_id !== request.case_id) {
      return respondError({
        code: "FORBIDDEN_OWNER",
        message: "Le scénario n'appartient pas à ce dossier",
        correlationId,
      });
    }
    if (scenarioResult.data.scope_hash !== request.expected_scope_hash) {
      return respondError({
        code: "CONFLICT_INVALID_STATE",
        message: "Le périmètre du scénario a changé",
        correlationId,
      });
    }
    if (factsResult.error || linksResult.error || linesCountResult.error || selectionResult.error) {
      throw new Error("Lecture cohérente du scénario impossible");
    }

    const links = linksResult.data ?? [];
    const assumptionIds = unique(
      links.map((link) => String(link.assumption_id ?? "")).filter(Boolean),
    );
    let assumptionRows: PricingAssumptionRow[] = [];
    if (assumptionIds.length > 0) {
      const { data, error } = await serviceClient.from("quote_scenario_assumptions")
        .select(
          "id,status,assumption_type,assumed_fact_key,assumed_value_type,assumed_value," +
          "statement,basis,source_type,source_refs,risk_level",
        )
        .in("id", assumptionIds);
      if (error || (data ?? []).length !== assumptionIds.length) {
        throw new Error("Lecture exhaustive des hypothèses liées impossible");
      }
      assumptionRows = (data ?? []) as unknown as PricingAssumptionRow[];
    }

    const factsSnapshot = buildFactsSnapshot((factsResult.data ?? []) as PricingFactRow[]);
    const assumptionsSnapshot = buildAssumptionsSnapshot(assumptionRows);
    const scenarioSnapshot = asObject(scenarioResult.data.scope_snapshot);
    const openPoints = asArray(scenarioResult.data.open_points);
    const overlay = buildScenarioOverlay(factsSnapshot, assumptionsSnapshot);
    const cargo = buildScenarioCargoPricing(buildPricingInputs(overlay.facts), scenarioSnapshot, factsSnapshot);
    const { inputs, context: cargoContext, plan: cargoPlan } = cargo;
    const localTransportBasis = asObject(inputs.localTransportEstimate);
    const localTransportDestinationCountry = String(
      inputs.destinationCountry ?? localTransportBasis.country ?? "",
    ).trim() || undefined;
    const localTransportDischargePort = String(
      inputs.destinationPort ?? localTransportBasis.origin ?? "",
    ).trim() || undefined;
    const blockers = [...overlay.blockers, ...cargo.blockers];
    if (cargoPlan) overlay.assumptionKeys.add("scenario.cargo_units");

    if (["superseded", "promoted_to_final"].includes(scenarioResult.data.status)) {
      blockers.push("SCENARIO_NOT_LIVE");
    }
    if (scenarioResult.data.status === "blocked") blockers.push("SCENARIO_MARKED_BLOCKED");
    if (selectionResult.data?.scenario_id !== request.scenario_id) {
      blockers.push("SCENARIO_NOT_SELECTED");
    }
    if ((linesCountResult.count ?? 0) >= 2) blockers.push("SCENARIO_MULTI_LOT_UNSUPPORTED");

    const transportMode = String(scenarioSnapshot.transport_mode ?? "").toUpperCase();
    const movementDirection = String(scenarioSnapshot.movement_direction ?? "").toUpperCase();
    if (!["MARITIME", "AIR"].includes(transportMode)) {
      blockers.push("SCENARIO_TRANSPORT_MODE_UNSUPPORTED");
    }
    if (!["IMPORT", "TRANSIT"].includes(movementDirection)) {
      blockers.push("SCENARIO_MOVEMENT_UNSUPPORTED");
    }

    const packageKey = String(inputs.servicePackage ?? "").trim().toUpperCase();
    if (!packageKey || !SERVICE_PACKAGES[packageKey]) {
      blockers.push("SERVICE_PACKAGE_REQUIRED_OR_UNKNOWN");
    }
    const overrides = readOverridesFromFacts(overlay.facts.map((fact) => ({
      fact_key: fact.fact_key,
      value_json: fact.value_json,
      value_text: typeof fact.value_text === "string" ? fact.value_text : undefined,
    })));
    const effectiveServiceKeys = SERVICE_PACKAGES[packageKey]
      ? resolveEffectiveServiceKeys(packageKey, overrides)
      : [];
    const explicitlyRemovedServiceKeys = resolveExplicitlyRemovedServiceKeys(overrides);

    const terminalPolicy = resolveScenarioContainerTerminal(scenarioSnapshot, overlay.facts, effectiveServiceKeys);
    blockers.push(...terminalPolicy.blockers);
    if (terminalPolicy.eligible) overlay.assumptionKeys.add("scenario.container_thc_policy");

    // GO estimation partielle : contrat v2 validé uniquement. Un package DDP
    // ne devient jamais DAP du seul fait de l'incoterm du dossier.
    const servicesOnly = cargoPlan !== null && cargoContext !== null && transportMode === "MARITIME" &&
      String(inputs.incoterm ?? "").trim().toUpperCase() === "DAP" &&
      !packageKey.split("_").includes("DDP");
    // Never silently discard v3 group classifications in the legacy valuation path.
    if (scenarioSnapshot.schema_version === 3 && !servicesOnly) {
      blockers.push("SCENARIO_PAD_PRICING_SCOPE_UNSUPPORTED");
    }

    const padBlocker = resolvePadScopeBlocker({
      facts: overlay.facts,
      servicePackage: packageKey,
      effectiveServiceKeys,
      incoterm: inputs.incoterm ?? "",
    });
    if (padBlocker) blockers.push(...padBlocker.pricing_blockers.filter(code =>
      !servicesOnly || code !== "PAD_CATEGORY_REQUIRED"));

    if (!inputs.finalDestination) blockers.push("FINAL_DESTINATION_REQUIRED");
    if (!inputs.incoterm) blockers.push("INCOTERM_REQUIRED");
    if (!servicesOnly && (!inputs.cargoValue || inputs.cargoValue <= 0)) {
      blockers.push("CARGO_VALUE_REQUIRED_FOR_SCENARIO_ENGINE");
    }
    if (!(inputs.containers?.length) && !(inputs.cargoWeight && inputs.cargoWeight > 0)) {
      blockers.push("CARGO_SCOPE_REQUIRED");
    }
    const wantsDuties = packageKey.endsWith("_DDP") ||
      String(inputs.incoterm ?? "").trim().toUpperCase() === "DDP";
    const incoterm = String(inputs.incoterm ?? "").trim().toUpperCase();
    if (wantsDuties && ["FOB", "FCA", "FAS", "EXW"].includes(incoterm) &&
      !(inputs.freightCost && inputs.freightCost > 0)) {
      blockers.push("FREIGHT_REQUIRED_FOR_FOB");
    }
    if (wantsDuties && !inputs.regimeCode) blockers.push("CUSTOMS_REGIME_REQUIRED");

    if (!(await partnerFactsAreSelected(serviceClient, request.case_id, overlay.facts))) {
      blockers.push("SELECTED_PARTNER_OFFER_MISMATCH");
    }

    const reserveLinks = links
      .filter((link) => link.reserve_code)
      .map((link) => ({
        code: link.reserve_code,
        source: "scenario_link",
        open_point_key: link.open_point_key ?? null,
      }));
    const openPointReservations = openPoints.map((point) => {
      const openPoint = asObject(point);
      return {
        code: "OPEN_POINT",
        source: "scenario_open_point",
        open_point_key: openPoint.key ?? null,
        reason: openPoint.code ?? null,
      };
    });
    const reservations: Record<string, unknown>[] = [
      ...(servicesOnly ? [{
        code: "SCENARIO_DAP_SERVICES_ONLY", source: "scenario_services_policy_v1",
        message: "Estimation des prestations DAP uniquement. Droits et taxes douaniers et calcul CAF exclus ; aucune valeur marchandise de remplacement.",
      }] : []),
      ...(servicesOnly && padBlocker && scenarioSnapshot.schema_version !== 3 ? [{
        code: "SCENARIO_PAD_PENDING", source: "scenario_services_policy_v1",
        message: "Droit de passage PAD non chiffré : catégorie et tarif applicables à déterminer. Ce poste n’est pas gratuit et n’est pas inclus dans le sous-total.",
      }] : []),
      ...terminalPolicy.reservations,
      ...(cargoPlan?.reservations ?? []).map(r => servicesOnly && r.code === "SCENARIO_OWNERSHIP_NOT_PRICED" ? {
        ...r, code: "SCENARIO_OWNERSHIP_SCOPE",
        message: "Hypothèses SOC/COC : surestaries armateur limitées aux lots COC, retour vide évalué par lot. Les autres frais de séjour et de repositionnement ne sont pas présumés gratuits.",
      } : servicesOnly && r.code === "SCENARIO_DG_UNKNOWN" ? {
        ...r, message: `Lot ${r.unit_ref} : danger inconnu ; une base de manutention peut être estimée si son tarif est vérifié, supplément IMO éventuel non compris.`,
      } : r),
      ...reserveLinks,
      ...openPointReservations,
    ];

    const fingerprint = await computeRequestFingerprint(buildFingerprintInput({
      request,
      scopeSnapshot: scenarioSnapshot,
      factsSnapshot,
      assumptionsSnapshot,
      reservations,
    }));

    let engineRequest: Record<string, unknown> | null = null;
    let engineResponse: Record<string, unknown> | null = null;
    let tariffLines: ScenarioTariffLine[] = [];
    let status: "success" | "blocked" | "failed" = "blocked";

    if (blockers.length === 0) {
      engineRequest = {
        ...buildEngineRequest(inputs, transportMode),
        ...(cargoContext ? { scenarioCargoContext: cargoContext } : {}),
        ...(servicesOnly ? { scenarioPricingMode: "DAP_SERVICES_ONLY" } : {}),
        ...(servicesOnly && inputs.containerStayEstimate !== undefined ? { scenarioStay: {
          basis: inputs.containerStayEstimate, movement_direction: movementDirection,
          destination_country: inputs.destinationCountry, discharge_port: inputs.destinationPort,
          terminal_mode: terminalPolicy.effectiveMode,
        } } : {}),
        ...(servicesOnly && inputs.localTransportEstimate !== undefined ? { scenarioLocalTransport: {
          basis: inputs.localTransportEstimate, movement_direction: movementDirection,
          destination_country: localTransportDestinationCountry,
          discharge_port: localTransportDischargePort,
        } } : {}),
        includeCustomsClearance: effectiveServiceKeys.includes("CUSTOMS_DAKAR"),
        includeLocalTransport: effectiveServiceKeys.includes("TRUCKING"),
      };
      const engineUrl = `${Deno.env.get("SUPABASE_URL")!}/functions/v1/quotation-engine`;
      try {
        const engineResult = await fetch(engineUrl, {
          method: "POST",
          headers: {
            Authorization: authorization,
            "Content-Type": "application/json",
            "x-correlation-id": correlationId,
          },
          body: JSON.stringify({ action: "generate", params: engineRequest }),
        });
        if (!engineResult.ok) {
          blockers.push("QUOTATION_ENGINE_FAILED");
          status = "failed";
        } else {
          const parsed = await engineResult.json();
          engineResponse = asObject(parsed);
          if (engineResponse.success !== true || !Array.isArray(engineResponse.lines)) {
            blockers.push("QUOTATION_ENGINE_INVALID_RESPONSE");
            status = "failed";
          } else if (servicesOnly && (asObject(engineResponse.metadata).estimate_mode !== "DAP_SERVICES_ONLY" ||
            asObject(engineResponse.metadata).duties_excluded !== true ||
            asObject(engineResponse.metadata).caf !== null)) {
            // Refuser un moteur ancien qui ignorerait le mode et utiliserait 1 FCFA.
            blockers.push("QUOTATION_ENGINE_MODE_NOT_ACKNOWLEDGED");
            status = "failed";
          } else {
            const scopeFiltered = applyScenarioExplicitServiceRemovals(
              applyScenarioContainerTerminalLines(engineResponse.lines as ScenarioTariffLine[], terminalPolicy),
              explicitlyRemovedServiceKeys,
            );
            tariffLines = scopeFiltered.keptLines;
            if (servicesOnly && scenarioSnapshot.schema_version === 3 && effectiveServiceKeys.includes("PORT_DAKAR_HANDLING")) {
              const rates = await serviceClient.from("port_tariffs")
                .select("id,provider,category,operation_type,cargo_type,classification,amount,unit,source_document,evidence_level,effective_date,expiry_date,is_active", { count: "exact" })
                .eq("provider", "PAD").eq("category", "DROIT_PASSAGE").eq("operation_type", "IMPORT").eq("cargo_type", "CONTENEUR").eq("is_active", true).limit(201);
              const complete = !rates.error && rates.count !== null && rates.count <= 200 && rates.count === rates.data?.length;
              if (!complete) reservations.push({ code: "PAD_CATALOG_UNAVAILABLE", source: "scenario_catalog_read" });
              const padLines = priceScenarioPad(scenarioSnapshot, complete ? rates.data ?? [] : [], new Date().toISOString().slice(0, 10));
              // Do not retain an aggregate PAD line alongside the per-group lines.
              tariffLines = [...tariffLines.filter(l => l.category !== "PAD_DROIT_PASSAGE"), ...padLines];
            }
            if (servicesOnly && scenarioSnapshot.schema_version === 3 && cargoContext && cargoPlan) {
              const [feeLines, feeRules] = await Promise.all([
                serviceClient.from("fee_lines").select("*", { count: "exact" }).eq("is_active", true).limit(501),
                serviceClient.from("fee_rules").select("*", { count: "exact" }).eq("is_active", true).limit(2001),
              ]);
              const complete = !feeLines.error && !feeRules.error && feeLines.count !== null && feeRules.count !== null &&
                feeLines.count <= 500 && feeRules.count <= 2000 && feeLines.count === feeLines.data?.length && feeRules.count === feeRules.data?.length;
              if (!complete) reservations.push({ code: "SCENARIO_FEE_CATALOG_UNAVAILABLE", source: "scenario_catalog_read" });
              const fees = priceScenarioFees({ facts: overlay.facts, cargo: cargoContext, containers: cargoPlan.containers,
                weightKg: cargoPlan.cargoWeight === undefined ? null : cargoPlan.cargoWeight * 1000,
                requested: effectiveServiceKeys, lines: complete ? feeLines.data as FeeLineRow[] : [],
                rules: complete ? feeRules.data as FeeRuleRow[] : [], today: new Date().toISOString().slice(0, 10) });
              const replaced = new Set(fees.map(f => String(f.category)));
              tariffLines = [...tariffLines.filter(line => !replaced.has(String(line.category).toUpperCase()) && ![...inferCoveredServices([line])].some(key => replaced.has(key))), ...fees];
            }
            if (scopeFiltered.removedLines.length > 0) {
              reservations.push(...scopeFiltered.removedLines.map((line) => ({
                code: "SERVICE_EXPLICITLY_REMOVED",
                source: "service.overrides.remove",
                service_key: line.category ?? null,
              })));
            }
            if (servicesOnly && cargoContext && effectiveServiceKeys.includes("EMPTY_RETURN") &&
              !inferCoveredServices(tariffLines).has("EMPTY_RETURN")) {
              const returns = scenarioEmptyReturnLines(cargoContext, overlay.facts, movementDirection);
              tariffLines.push(...returns);
              // Existing PDF/email snapshots consume reservations, not line.notes.
              reservations.push(...returns.map(line => ({ code: "SCENARIO_EMPTY_RETURN_SCOPE", source: "scenario_ownership_policy",
                unit_ref: asObject(line.source).unit_ref, message: `${line.description}. ${line.notes}` })));
            }
            reservations.push(...tariffLines.filter(line => servicesOnly && String(line.id).startsWith("thc_") &&
              asObject(line.source).type === "CALCULATED").map(line => ({ code: "SCENARIO_THC_BASE_ESTIMATE",
                source: "scenario_thc_policy", message: line.notes })));
            reservations.push(...tariffLines.filter(line => String(line.id).startsWith("transport_km_")).map(line => ({
              code: "SCENARIO_TRANSPORT_KM_ESTIMATE", source: "SN_NORMAL_CONTAINER_KM_V1", message: line.notes,
            })));
            reservations.push(...tariffLines.filter(line => servicesOnly &&
              ["warehouse_franchise_", "demurrage_estimate_"].some(prefix => String(line.id).startsWith(prefix)))
              .map(line => ({ code: "SCENARIO_CONTAINER_STAY_ESTIMATE", source: "container_stay_v1",
                message: `${line.description}. ${line.notes}`, line_id: line.id })));
            const missingLines = buildMissingServiceReserveLines(
              effectiveServiceKeys,
              inferCoveredServices(tariffLines),
            );
            if (missingLines.length > 0) {
              reservations.push(...missingLines.map((line) => ({
                code: "RATE_PENDING_CONFIRMATION",
                source: "missing_service_coverage",
                service_key: line.category,
              })));
              tariffLines = [...tariffLines, ...missingLines];
            }
            status = "success";
          }
        }
      } catch {
        blockers.push("QUOTATION_ENGINE_FAILED");
        status = "failed";
      }
    }

    const uniqueBlockers = unique(blockers);
    const totals = computeScenarioTotals(tariffLines, overlay.assumptionKeys);
    const qualification = deriveQualification({
      blockers: uniqueBlockers,
      assumptionsCount: assumptionsSnapshot.length,
      reserveCount: reservations.length +
        tariffLines.filter((line) =>
          String(asObject(line.source).type ?? "").trim().toUpperCase() === "TO_CONFIRM"
        ).length,
      openPointsCount: openPoints.length,
    });
    if (uniqueBlockers.length > 0 && status === "success") status = "blocked";

    const result: Record<string, unknown> = {
      status,
      qualification: status === "success" ? qualification : "blocked",
      blockers: uniqueBlockers,
      scenario_snapshot: scenarioSnapshot,
      inputs_json: {
        ...inputs,
        service_package: packageKey || null,
        effective_service_keys: effectiveServiceKeys,
        transport_mode: transportMode || null,
        movement_direction: movementDirection || null,
      },
      facts_snapshot: factsSnapshot,
      assumptions_snapshot: assumptionsSnapshot,
      overlay_json: overlay.overlay,
      reservations,
      engine_request: engineRequest,
      engine_response: engineResponse,
      tariff_lines: totals.lines,
      tariff_sources: buildTariffSources(totals.lines),
      firm_total_ht: status === "success" ? totals.firm_total_ht : null,
      firm_total_ttc: status === "success" ? totals.firm_total_ttc : null,
      indicative_total_ht: status === "success" ? totals.indicative_total_ht : null,
      indicative_total_ttc: status === "success" ? totals.indicative_total_ttc : null,
      currency: "XOF",
      duration_ms: Date.now() - startedAt,
    };

    const rpc = await recordRun({ serviceClient, request, userId, fingerprint, result });
    if (rpc.error) {
      const message = rpc.error.message ?? JSON.stringify(rpc.error);
      const code = mapRpcErrorCode(message);
      await logEvent(serviceClient, {
        correlationId,
        functionName: FUNCTION_NAME,
        op: "record",
        userId,
        status: getStatusFromErrorCode(code),
        errorCode: code,
        httpStatus: ERROR_CONFIG[code].httpStatus,
        durationMs: Date.now() - startedAt,
        meta: { scenario_id: request.scenario_id },
      });
      return respondError({ code, message, correlationId });
    }

    await logEvent(serviceClient, {
      correlationId,
      functionName: FUNCTION_NAME,
      op: "price",
      userId,
      status: "ok",
      httpStatus: 200,
      durationMs: Date.now() - startedAt,
      meta: {
        scenario_id: request.scenario_id,
        result_status: status,
        qualification: result.qualification,
        blockers_count: uniqueBlockers.length,
      },
    });
    return respondOk({ ...rpc.data, blockers: uniqueBlockers }, correlationId);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    try {
      if (serviceClient) {
        await logEvent(serviceClient, {
          correlationId,
          functionName: FUNCTION_NAME,
          op: "catch",
          userId,
          status: "fatal_error",
          errorCode: "UNKNOWN",
          httpStatus: 500,
          durationMs: Date.now() - startedAt,
        });
      }
    } catch { /* best effort */ }
    return respondError({ code: "UNKNOWN", message, correlationId });
  }
}

if (import.meta.main) Deno.serve(handleRequest);

export { handleRequest };
