/**
 * H2-d2 — simulate-fee-lines : simulation des honoraires sur un dossier.
 *
 * Répond à la question de l'administrateur qui vient de paramétrer une ligne ou
 * une règle : « qu'est-ce que cela donnerait sur ce dossier ? », sans relancer
 * le chiffrage et sans rien écrire.
 *
 * Garanties :
 *   * LECTURE SEULE — aucun INSERT, UPDATE ni DELETE, aucune écriture d'audit,
 *     aucun `pricing_run` créé. La simulation ne laisse aucune trace.
 *   * FIDÉLITÉ — le contexte du dossier est dérivé par le module partagé
 *     `_shared/fee-case-facts.ts` et résolu par `_shared/fee-rules.ts`, soit
 *     exactement le code qu'exécute `price-service-lines` lors d'un vrai
 *     chiffrage mono-lot. Une simulation qui divergerait du chiffrage réel
 *     serait pire que pas de simulation.
 *   * PROPRIÉTÉ — le dossier est lu avec le JWT de l'appelant (RLS) ; les
 *     lignes et règles d'honoraires sont lisibles par tout utilisateur
 *     authentifié (policies H2-a).
 *
 * Limite : la simulation vaut pour un dossier mono-lot. En multi-lot, le
 * chiffrage réel applique un contexte par lot (conteneurs et poids du lot) que
 * cette fonction ne reconstitue pas ; la réponse porte alors sur le dossier
 * entier. Le champ `scope_note` de la réponse le signale.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  getCorrelationId,
  respondOk,
  respondError,
  structuredLog,
} from "../_shared/runtime.ts";
import { buildFeeCaseContextFromFacts, type FeeFactRow } from "../_shared/fee-case-facts.ts";
import {
  resolveFeeLines,
  type FeeLineRow,
  type FeeRuleRow,
} from "../_shared/fee-rules.ts";

const FUNCTION_NAME = "simulate-fee-lines";

Deno.serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const correlationId = getCorrelationId(req);
  const t0 = Date.now();

  try {
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const jwtClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${auth.token}` } },
    });

    const body = await req.json().catch(() => ({}));
    const { case_id, as_of_date } = body as { case_id?: string; as_of_date?: string };

    if (!case_id || typeof case_id !== "string") {
      return respondError({
        code: "VALIDATION_FAILED",
        message: "case_id requis",
        correlationId,
      });
    }

    if (as_of_date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(as_of_date))) {
      return respondError({
        code: "VALIDATION_FAILED",
        message: "as_of_date doit être au format AAAA-MM-JJ",
        correlationId,
      });
    }

    const asOfDate = as_of_date ? String(as_of_date) : new Date().toISOString().slice(0, 10);

    // ═══ Propriété du dossier : lecture RLS avec le JWT de l'appelant ═══
    const { data: caseData, error: caseError } = await jwtClient
      .from("quote_cases")
      .select("id, request_type")
      .eq("id", case_id)
      .single();

    if (caseError || !caseData) {
      return respondError({
        code: "FORBIDDEN_OWNER",
        message: "Dossier introuvable ou accès refusé",
        correlationId,
      });
    }

    // ═══ Faits courants du dossier, lignes et règles d'honoraires actives ═══
    const [factsResult, linesResult, rulesResult, lotCountResult] = await Promise.all([
      jwtClient
        .from("quote_facts")
        .select("fact_key, value_text, value_json, value_number")
        .eq("case_id", case_id)
        .eq("is_current", true),
      jwtClient
        .from("fee_lines")
        .select("id, code, label_fr, vat_applicable, missing_rule_behavior, display_order, is_active")
        .eq("is_active", true)
        .order("display_order"),
      jwtClient
        .from("fee_rules")
        .select("*")
        .eq("is_active", true),
      // Multi-lot : run-pricing bascule en orchestration par lot dès 2 lignes
      // de demande (quote_request_lines).
      jwtClient
        .from("quote_request_lines")
        .select("id", { count: "exact", head: true })
        .eq("case_id", case_id),
    ]);

    if (factsResult.error) throw factsResult.error;
    if (linesResult.error) throw linesResult.error;
    if (rulesResult.error) throw rulesResult.error;

    const factsMap = new Map<string, FeeFactRow>(
      (factsResult.data || []).map((f: { fact_key: string } & FeeFactRow) => [f.fact_key, f]),
    );

    const feeLines = (linesResult.data || []) as FeeLineRow[];
    const feeRules = (rulesResult.data || []) as FeeRuleRow[];

    // ═══ Contexte et résolution — même code que le chiffrage réel ═══
    const feeCtx = buildFeeCaseContextFromFacts({
      factsMap,
      requestType: caseData.request_type,
      asOfDate,
    });

    const resolutions = resolveFeeLines(feeLines, feeRules, feeCtx);

    const firmTotal = resolutions.reduce(
      (sum, r) => sum + (r.status === "RESOLVED" && typeof r.amount === "number" ? r.amount : 0),
      0,
    );

    const isMultiLot = (lotCountResult.count ?? 0) >= 2;

    structuredLog({
      level: "info",
      service: FUNCTION_NAME,
      op: "simulate",
      correlationId,
      status: "ok",
      durationMs: Date.now() - t0,
      meta: {
        case_id,
        as_of_date: asOfDate,
        lines: resolutions.length,
        resolved: resolutions.filter((r) => r.status === "RESOLVED").length,
        to_confirm: resolutions.filter((r) => r.status === "TO_CONFIRM").length,
      },
    });

    return respondOk(
      {
        case_id,
        as_of_date: asOfDate,
        context: feeCtx,
        lines: resolutions,
        firm_total_xof: firmTotal,
        scope_note: isMultiLot
          ? "Dossier multi-lot : le chiffrage réel applique un contexte par lot (conteneurs et poids du lot). Cette simulation porte sur le dossier entier."
          : null,
      },
      correlationId,
    );
  } catch (error) {
    structuredLog({
      level: "error",
      service: FUNCTION_NAME,
      op: "simulate",
      correlationId,
      status: "fatal_error",
      errorCode: "UPSTREAM_DB_ERROR",
      durationMs: Date.now() - t0,
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return respondError({
      code: "UPSTREAM_DB_ERROR",
      message: error instanceof Error ? error.message : "Erreur interne",
      correlationId,
    });
  }
});
