// DCQ-MARITIME-FEES-INTEGRATION-B2 / PATCH B2
// Edge Function read-only SÉPARÉE exposant le moteur PUR de propositions de
// frais maritimes (B1 : `_shared/maritime-fee-proposals/engine.ts`).
//
// DOCTRINE (héritée de B1, non négociable) :
//  - Enveloppe `proposal_only` strictement séparée du pricing ferme.
//  - `amount` reste TOUJOURS null ; `suggested_amount_xof` est une SUGGESTION à
//    confirmer par un humain, jamais un montant ferme, jamais compté dans un total.
//  - La réponse ne contient JAMAIS de clé lines / tariff_lines / total_ht /
//    total_ttc / totals.
//  - Aucun appel run-pricing. Aucun appel quotation-engine. Aucune écriture DB.
//  - La seule interaction DB possible est un SELECT read-only après preuve
//    `has_case_read_access` sous le JWT appelant, pour construire un
//    `MaritimeFeeInput` à partir d'un `case_id` (faits strictement nécessaires).
//
// Le moteur B1 n'est pas modifié : import strict, sans changement de doctrine.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { errorResponse, handleCors, jsonResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  buildMaritimeFeeProposals,
  type MaritimeFeeInput,
  type MaritimeFeeProposal,
  type Parametrage,
} from "../_shared/maritime-fee-proposals/engine.ts";
import parametrageJson from "../_shared/maritime-fee-proposals/dcq_pad_parametrage.json" with {
  type: "json",
};
import {
  type FactRow,
  mapFactsToMaritimeInput,
} from "../_shared/maritime-fee-proposals/fact-mapping.ts";

const PARAMETRAGE = parametrageJson as unknown as Parametrage;

// ---------------------------------------------------------------------------
// Enveloppe de réponse : proposal_only (aucun total, aucun montant ferme)
// ---------------------------------------------------------------------------

export interface ProposalOnlyEnvelope {
  ok: true;
  mode: "proposal_only";
  accounting_effect: "none";
  amount_policy: "HUMAN_CONFIRMATION_REQUIRED_DO_NOT_COUNT";
  proposals: MaritimeFeeProposal[];
  warnings: string[];
  input_debug: {
    operation_type: string | null;
    cargo_mode: string | null;
    carrier: string | null;
    has_tonnage: boolean;
    has_seafreight: boolean;
  };
}

/**
 * Construit l'enveloppe read-only `proposal_only`. FONCTION PURE.
 * Ne produit AUCUN total et n'expose AUCUN montant ferme (`amount` reste null,
 * garanti par le moteur B1). `suggested_amount_xof` n'est jamais recopié dans
 * `amount`.
 */
export function buildProposalOnlyEnvelope(
  input: MaritimeFeeInput,
  parametrage: Parametrage = PARAMETRAGE,
): ProposalOnlyEnvelope {
  const { proposals, warnings } = buildMaritimeFeeProposals(input, parametrage);

  const hasTonnage = typeof input.tonnage === "number" &&
    Number.isFinite(input.tonnage) &&
    input.tonnage > 0;
  const hasSeafreight = !!input.seafreight &&
    typeof input.seafreight.value === "number" &&
    Number.isFinite(input.seafreight.value) &&
    input.seafreight.value > 0;

  return {
    ok: true,
    mode: "proposal_only",
    accounting_effect: "none",
    amount_policy: "HUMAN_CONFIRMATION_REQUIRED_DO_NOT_COUNT",
    proposals,
    warnings,
    input_debug: {
      operation_type: input.operation_type ?? null,
      cargo_mode: input.cargo_mode ?? null,
      carrier: input.carrier ?? null,
      has_tonnage: hasTonnage,
      has_seafreight: hasSeafreight,
    },
  };
}

// ---------------------------------------------------------------------------
// Handler HTTP read-only
// ---------------------------------------------------------------------------

interface RequestBody {
  input?: MaritimeFeeInput;
  case_id?: string;
}

export async function handleRequest(req: Request): Promise<Response> {
  const pre = handleCors(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed. Use POST.", 405);
  }

  // Sécurité : aucun accès case_id / service role sans utilisateur authentifié.
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return errorResponse("Invalid JSON body.", 400);
  }

  try {
    let input: MaritimeFeeInput;

    if (body && typeof body.input === "object" && body.input !== null) {
      // (1) Input direct : aucune lecture DB.
      input = body.input;
    } else if (typeof body?.case_id === "string" && body.case_id.length) {
      // (2) case_id : lecture read-only des faits strictement nécessaires.
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!supabaseUrl || !anonKey || !serviceKey) {
        return errorResponse("Missing Supabase environment variables.", 503);
      }
      // Le reset canonique n'accorde pas de SELECT direct sur quote_cases /
      // quote_facts. La RPC SECURITY DEFINER existante prouve l'accès partagé
      // sous le JWT appelant ; l'élévation read-only n'arrive qu'APRÈS ce oui.
      const caller = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${auth.token}` } },
      });
      const { data: canRead, error: accessError } = await caller.rpc(
        "has_case_read_access",
        { _case_id: body.case_id },
      );
      if (accessError || canRead !== true) {
        return errorResponse("Dossier introuvable ou accès refusé.", 403);
      }
      const client = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false },
      });
      const { data: caseContext, error: contextError } = await client.rpc(
        "read_maritime_fee_case_context",
        { p_case_id: body.case_id },
      );
      if (contextError || !caseContext) {
        return errorResponse("Lecture du dossier impossible.", 500);
      }
      const context = caseContext as {
        request_type?: string | null;
        facts?: FactRow[];
      };

      input = mapFactsToMaritimeInput(
        context.request_type ?? null,
        Array.isArray(context.facts) ? context.facts : [],
      );
    } else {
      return errorResponse(
        "Provide either `input` (MaritimeFeeInput) or `case_id`.",
        400,
      );
    }

    const envelope = buildProposalOnlyEnvelope(input, PARAMETRAGE);
    return jsonResponse(envelope, 200);
  } catch (e) {
    return errorResponse(
      `Unexpected error: ${e instanceof Error ? e.message : String(e)}`,
      500,
    );
  }
}

// N'ouvre le listener que comme point d'entrée réel (déploiement edge). Sous
// `deno test`, ce module est importé (import.meta.main = false) : aucun serveur,
// aucune permission net requise.
if (import.meta.main) {
  Deno.serve(handleRequest);
}
