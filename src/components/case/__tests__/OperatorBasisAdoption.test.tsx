import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OperatorBasisAdoption } from "../OperatorBasisAdoption";
import type { SelectedScenarioEstimate } from "../ScenarioEstimateResult";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const estimate: SelectedScenarioEstimate = {
  caseId: "case-test", scopeHash: "a".repeat(64), title: "SYNTHETIC", pending: false, error: null,
  run: { id: "run-test", scenario_id: "scenario-test", run_seq: 1, status: "success", qualification: "partial", blockers: [], reservations: [], assumptions_snapshot: [], firm_total_ht: 0, firm_total_ttc: 0, indicative_total_ht: 100, indicative_total_ttc: 118, currency: "XOF", completed_at: "2026-09-28T12:00:00Z" },
};
it("requires an explicit click, submits identifiers only, refreshes canonical result after success", async () => {
  invoke.mockResolvedValue({ data: { data: { pricing_run_id: "canonical", run_number: 2 } }, error: null });
  const done = vi.fn(); render(<OperatorBasisAdoption estimate={estimate} onAdopted={done} />);
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Préparer le devis sur ces bases"));
  await screen.findByText(/Pricing Run #2 créé/);
  expect(done).toHaveBeenCalledOnce();
  expect(invoke).toHaveBeenCalledWith("adopt-operator-quotation-basis", { body: {
    case_id: "case-test", scenario_id: "scenario-test", scenario_pricing_run_id: "run-test", expected_scope_hash: "a".repeat(64), idempotency_key: "operator-basis:run-test",
  } });
});
it("blocks double clicks and reports a stale refusal without claiming a new run", async () => {
  let finish: (value: unknown) => void = () => {};
  invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const done = vi.fn(); render(<OperatorBasisAdoption estimate={estimate} onAdopted={done} />);
  fireEvent.click(screen.getByText("Préparer le devis sur ces bases"));
  fireEvent.click(screen.getByText("Préparation en cours…"));
  expect(invoke).toHaveBeenCalledOnce();
  finish({ error: { message: "SCENARIO_STATE_CHANGED" } });
  await screen.findByRole("alert"); expect(done).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByText("Préparer le devis sur ces bases")).not.toBeDisabled());
});
it("does not offer adoption of a failed run or an unknown current scope", () => {
  const { rerender } = render(<OperatorBasisAdoption estimate={{ ...estimate, scopeHash: undefined }} />);
  expect(screen.queryByRole("button")).toBeNull();
  rerender(<OperatorBasisAdoption estimate={{ ...estimate, run: { ...estimate.run!, status: "failed" } }} />);
  expect(screen.queryByRole("button")).toBeNull();
});
