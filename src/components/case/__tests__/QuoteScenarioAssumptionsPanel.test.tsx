import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuoteScenarioAssumptionsPanel } from "../QuoteScenarioAssumptionsPanel";

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
  onSuccess: undefined as undefined | ((data: unknown, input: { operation: string }) => Promise<void>),
  data: [] as unknown[],
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../AssumptionPromotionDialog", () => ({ AssumptionPromotionDialog: () => null }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mocks.data, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useMutation: (options: { onSuccess: typeof mocks.onSuccess }) => {
    mocks.onSuccess = options.onSuccess;
    return { mutate: vi.fn(), isPending: false };
  },
}));
afterEach(() => { cleanup(); mocks.invalidateQueries.mockClear(); mocks.onSuccess = undefined; mocks.data = []; });

it.each(["create", "revise", "confirm_client", "refute"])(
  "%s refreshes both case-scoped lists so scenario links cannot keep stale assumptions", async (operation) => {
    render(<QuoteScenarioAssumptionsPanel caseId="test-case" />);
    await act(async () => { await mocks.onSuccess!(null, { operation }); });
    expect(mocks.invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ["quote-scenario-assumptions", "test-case"] }],
      [{ queryKey: ["quote-scenario-linkable-assumptions", "test-case"] }],
    ]);
  },
);

it("shows readable structured values and keeps raw JSON inside the technical detail", async () => {
  mocks.data = [{
    id: "assumption-1", scope_key: "case", statement: "Transport jusqu'à Ndioum",
    basis: "Distance vérifiée", assumption_type: "other", status: "active", risk_level: "medium",
    client_visible: true, gap_key: null, assumed_fact_key: "routing.local_transport_estimate",
    source_type: "operator_guidance", source_refs: [], metadata: {}, assumed_value_type: "json",
    assumed_value: { schema_version: 1, origin: "Dakar Port", destination: "Ndioum", distance_km: 468,
      distance_source: "Itinéraire vérifié", verified_on: "2026-09-21", groups: [{ unit_ref: "lot-a",
        equipment_code: "20GP", quantity: 1, weight_per_container_kg: 10000, max_payload_kg: null,
        ordinary_transport: false, qualification_source: "Décision opérateur" }] },
    promoted_fact_id: null, superseded_by_assumption_id: null, supersedes_assumption_id: null,
    created_at: "2026-09-21T10:00:00Z", updated_at: "2026-09-21T10:00:00Z",
  }];
  render(<QuoteScenarioAssumptionsPanel caseId="test-case" />);
  expect(screen.getByText("Portée : Dossier")).toBeInTheDocument();
  expect(screen.getByText("Type : Estimation du transport local")).toBeInTheDocument();
  expect(screen.getByText("Ndioum")).toBeInTheDocument();
  expect(screen.getByText("468 km")).toBeInTheDocument();
  const detail = screen.getByText("Détail technique").closest("details");
  expect(detail).not.toHaveAttribute("open");
  expect(within(detail as HTMLElement).getByText(/"destination": "Ndioum"/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Réviser" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Autres actions" }));
  expect(screen.getByRole("button", { name: "Confirmer client" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Réfuter" })).toBeInTheDocument();
});
