import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuoteScenarioAssumptionsPanel } from "../QuoteScenarioAssumptionsPanel";

// Alerte Lovable 8 (GO CTO 2026-09-28): an active assumption already holding the exact target
// case + scope_key + gap_key + assumed_fact_key is detected before submission, its explicit
// revision is offered with the current input, and a concurrent server conflict keeps the input.
const mocks = vi.hoisted(() => ({
  data: [] as unknown[],
  mutate: vi.fn(),
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
  onError: undefined as undefined | ((err: unknown, input: { operation: string }) => void),
  toastError: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: mocks.toastError } }));
vi.mock("../AssumptionPromotionDialog", () => ({ AssumptionPromotionDialog: () => null }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mocks.data, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useMutation: (options: { onError: typeof mocks.onError }) => {
    mocks.onError = options.onError;
    return { mutate: mocks.mutate, isPending: false };
  },
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.data = []; mocks.onError = undefined; });

const row = (over: Record<string, unknown>) => ({
  id: "a-existing", scope_key: "case", statement: "Poids brut estimé à 12 t", basis: null, assumption_type: "value",
  status: "active", risk_level: "medium", client_visible: false, gap_key: null, assumed_fact_key: null,
  source_type: "operator_guidance", source_refs: [], metadata: {}, assumed_value_type: "text", assumed_value: "12 t",
  promoted_fact_id: null, superseded_by_assumption_id: null, supersedes_assumption_id: null,
  created_at: "2026-09-28T08:00:00Z", updated_at: "2026-09-28T08:00:00Z", ...over,
});
const openCreate = () => fireEvent.click(screen.getByRole("button", { name: /Ajouter/ }));
const statement = () => document.getElementById("assumption-statement") as HTMLTextAreaElement;
const submit = () => screen.getByRole("button", { name: /Enregistrer l'hypothèse/ });

describe("active assumption conflict", () => {
  it("explains the default conflict and blocks the doomed creation", () => {
    mocks.data = [row({})];
    render(<QuoteScenarioAssumptionsPanel caseId="11111111-1111-4111-8111-111111111111" />);
    openCreate();
    const alert = screen.getByTestId("assumption-active-conflict");
    expect(alert.textContent).toContain("Poids brut estimé à 12 t");
    expect(alert.textContent).toContain("périmètre « case »");
    expect(submit()).toBeDisabled();
    fireEvent.click(submit());
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("offers the explicit revision of the existing assumption, keeping the input", () => {
    mocks.data = [row({})];
    render(<QuoteScenarioAssumptionsPanel caseId="11111111-1111-4111-8111-111111111111" />);
    openCreate();
    fireEvent.change(statement(), { target: { value: "Poids brut estimé à 14 t" } });
    fireEvent.click(screen.getByRole("button", { name: /Réviser l'hypothèse existante avec cette saisie/ }));
    expect(statement().value).toBe("Poids brut estimé à 14 t");
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer la révision/ }));
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    const input = mocks.mutate.mock.calls[0][0];
    expect(input.operation).toBe("revise");
    expect(input.assumptionId).toBe("a-existing");
    expect(input.draft.statement).toBe("Poids brut estimé à 14 t");
  });

  it("allows a genuinely distinct business target, with the contract normalisation", () => {
    mocks.data = [row({ assumed_fact_key: "cargo.weight_kg", gap_key: "" })];
    render(<QuoteScenarioAssumptionsPanel caseId="11111111-1111-4111-8111-111111111111" />);
    openCreate();
    expect(screen.queryByTestId("assumption-active-conflict")).toBeNull();
    const fact = document.getElementById("assumption-fact-key") as HTMLInputElement;
    fireEvent.change(fact, { target: { value: "  cargo.weight_kg " } });
    expect(screen.getByTestId("assumption-active-conflict")).toBeTruthy();
    const scope = document.getElementById("assumption-scope") as HTMLInputElement;
    fireEvent.change(scope, { target: { value: "lot:2" } });
    expect(screen.queryByTestId("assumption-active-conflict")).toBeNull();
    fireEvent.change(statement(), { target: { value: "Poids du lot 2" } });
    expect(submit()).not.toBeDisabled();
    fireEvent.click(submit());
    expect(mocks.mutate.mock.calls[0][0].operation).toBe("create");
    expect(mocks.mutate.mock.calls[0][0].draft.scopeKey).toBe("lot:2");
  });

  it("non-active statuses never block", () => {
    mocks.data = ["superseded", "client_confirmed", "refuted"].map((status, i) => row({ id: `a-${i}`, status }));
    render(<QuoteScenarioAssumptionsPanel caseId="11111111-1111-4111-8111-111111111111" />);
    openCreate();
    expect(screen.queryByTestId("assumption-active-conflict")).toBeNull();
  });

  it("a concurrent server conflict keeps the input and reloads the list; an idempotency conflict is not mistaken for it", () => {
    render(<QuoteScenarioAssumptionsPanel caseId="11111111-1111-4111-8111-111111111111" />);
    openCreate();
    fireEvent.change(statement(), { target: { value: "Saisie à conserver" } });
    act(() => {
      mocks.onError!(new Error("CONFLICT_INVALID_STATE: une hypothèse active existe déjà pour ce périmètre (scope=case, gap=-, fait=-). Réviser l'existante."), { operation: "create" });
    });
    expect(mocks.toastError.mock.calls[0][0]).toMatch(/Votre saisie est conservée/);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["quote-scenario-assumptions", "11111111-1111-4111-8111-111111111111"] });
    expect(statement().value).toBe("Saisie à conserver");
    act(() => {
      mocks.onError!(new Error("IDEMPOTENCY_CONFLICT: la clé x a déjà été utilisée avec un contenu différent"), { operation: "create" });
    });
    expect(mocks.toastError.mock.calls[1][0]).toMatch(/^IDEMPOTENCY_CONFLICT/);
  });
});
