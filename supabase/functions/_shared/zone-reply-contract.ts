import { zoneComplexityFactor } from "./delivery-zone-resolution.ts";

/** Payload capability only; never an authorization or permission. */
export const OPTIONAL_ZONE_REPLY_CONTRACT = "optional_factor_v1";
export type ZoneReplyDecision =
  | { allowed: true; factor: number | undefined; clarification: string | null }
  | { allowed: false; status: 409 | 503; code: string; message: string };

/** Fresh quote generation only. Historical snapshots are not subject to this gate. */
export function decideZoneReply(
  clientContract: unknown,
  engine: unknown,
): ZoneReplyDecision {
  const result = engine as {
    success?: boolean;
    metadata?: { zone_resolution?: { status?: string; source?: string } };
  } | null;
  const resolution = result?.metadata?.zone_resolution;
  if (
    result?.success !== true ||
    !["matched", "unknown", "ambiguous"].includes(resolution?.status ?? "") ||
    !["delivery_zones", "static_fallback"].includes(resolution?.source ?? "")
  ) {
    return {
      allowed: false,
      status: 503,
      code: "ZONE_ENGINE_CONTRACT_NOT_READY",
      message:
        "La vérification de la zone n’est pas disponible. Aucun brouillon n’a été produit ; réessayez après la fin de la mise à jour.",
    };
  }
  const factor = zoneComplexityFactor(result.metadata);
  if (resolution?.status === "matched" && factor !== undefined) {
    return { allowed: true, factor, clarification: null };
  }
  const clarification = resolution?.status === "ambiguous"
    ? "Zone de livraison ambiguë : précisez la destination. Le facteur de zone est indéterminé."
    : "Zone de livraison à confirmer. Le facteur de zone est indéterminé.";
  return clientContract === OPTIONAL_ZONE_REPLY_CONTRACT
    ? { allowed: true, factor: undefined, clarification }
    : {
      allowed: false,
      status: 409,
      code: "ZONE_CONFIRMATION_REQUIRED",
      message: clarification,
    };
}

export function zoneReplyRefusal(
  decision: Extract<ZoneReplyDecision, { allowed: false }>,
  correlationId: string,
  headers: HeadersInit,
): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code: decision.code,
        message: decision.message,
        retryable: false,
      },
      correlation_id: correlationId,
    }),
    {
      status: decision.status,
      headers: { ...headers, "Content-Type": "application/json" },
    },
  );
}
