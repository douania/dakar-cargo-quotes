import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { QuoteScenarioAssumptionsPanel } from "../QuoteScenarioAssumptionsPanel";

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
  onSuccess: undefined as undefined | ((data: unknown, input: { operation: string }) => Promise<void>),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../AssumptionPromotionDialog", () => ({ AssumptionPromotionDialog: () => null }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [], isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useMutation: (options: { onSuccess: typeof mocks.onSuccess }) => {
    mocks.onSuccess = options.onSuccess;
    return { mutate: vi.fn(), isPending: false };
  },
}));
afterEach(() => { cleanup(); mocks.invalidateQueries.mockClear(); mocks.onSuccess = undefined; });

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
