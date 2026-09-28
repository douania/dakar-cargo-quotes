import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { AssumptionPromotionDialog } from "../AssumptionPromotionDialog";

// Alerte Lovable 7 (GO CTO 2026-09-28): a successful promotion refreshes the consumers of the new
// fact for this case only; a refusal produces no success effect. Payload, attestation and
// idempotency stay those of the existing contract (not exercised here).
const CASE = "11111111-1111-4111-8111-111111111111";
const mocks = vi.hoisted(() => ({
  options: undefined as undefined | { mutationFn: () => Promise<unknown>; onSuccess: () => Promise<void>; onError: (e: unknown) => void },
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
  invoke: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: null, isLoading: false, error: null }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useMutation: (options: typeof mocks.options) => { mocks.options = options; return { mutate: vi.fn(), isPending: false }; },
}));
vi.mock("@/lib/factPromotion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/factPromotion")>()),
  buildPromotionRequestBody: () => ({ ok: true, body: { case_id: CASE } }),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.options = undefined; });

const assumption = { id: "a1", status: "active", statement: "Poids 12 t", assumed_value: 12000, assumed_value_type: "number", assumed_fact_key: "cargo.weight_kg", scope_key: "case" };
const renderDialog = (onOpenChange = vi.fn()) => { render(<AssumptionPromotionDialog caseId={CASE} assumption={assumption} onOpenChange={onOpenChange} />); return onOpenChange; };

describe("AssumptionPromotionDialog — after the edge function answers", () => {
  it("success refreshes the case facts, the timeline and the linkable assumptions of this case only", async () => {
    const onOpenChange = renderDialog();
    await act(async () => { await mocks.options!.onSuccess(); });
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.invalidateQueries.mock.calls.map((c) => c[0].queryKey)).toEqual([
      ["quote-scenario-assumptions", CASE],
      ["quote-fact-current", CASE],
      ["case-facts", CASE],
      ["case-timeline", CASE],
      ["quote-scenario-linkable-assumptions", CASE],
      ["scope-gate-facts", CASE],
      ["quote-scenario-pad-scope-facts", CASE],
    ]);
  });

  it("a refusal envelope rejects the mutation: no success effect", async () => {
    renderDialog();
    mocks.invoke.mockResolvedValueOnce({ data: { ok: false, error: { code: "CONFLICT_INVALID_STATE", message: "Fait déjà promu" } }, error: null });
    await expect(mocks.options!.mutationFn()).rejects.toThrow("Fait déjà promu");
    mocks.invoke.mockResolvedValueOnce({ data: null, error: { message: "Edge Function returned a non-2xx status code" } });
    await expect(mocks.options!.mutationFn()).rejects.toThrow();
    act(() => mocks.options!.onError(new Error("Fait déjà promu")));
    expect(mocks.toastError).toHaveBeenCalledWith("Fait déjà promu");
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
  });

  it("an accepted answer resolves", async () => {
    renderDialog();
    mocks.invoke.mockResolvedValueOnce({ data: { ok: true, data: { promoted_fact_id: "f1" } }, error: null });
    await expect(mocks.options!.mutationFn()).resolves.toEqual({ ok: true, data: { promoted_fact_id: "f1" } });
  });
});
