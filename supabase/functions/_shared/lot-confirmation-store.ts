/** MULTI-LOT-TERMINAL-1 — structural adapter over `read_lot_confirmation_context`.
 * Used by the Edge reader, the PAD store (multi-lot readiness) and run-pricing. No browser
 * input; an unreadable context is an error, never an absence of decisions.
 */
import { LOT_LOCKED_STATUSES, parseLotContext, resolveLotConfirmations, type LotContext, type LotResolution } from "./lot-confirmation.ts";

type Client = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
export type LotConfirmationState = { context: LotContext; resolution: LotResolution; read_only: boolean };

export async function loadLotConfirmationState(client: unknown, caseId: string): Promise<LotConfirmationState> {
  const response = await (client as Client).rpc("read_lot_confirmation_context", { p_case_id: caseId });
  if (response.error || !response.data || typeof response.data !== "object") throw new Error("LOT_CONTEXT_UNAVAILABLE");
  const context = parseLotContext(response.data, caseId);
  return { context, resolution: resolveLotConfirmations(context), read_only: LOT_LOCKED_STATUSES.includes(context.case_status) };
}
