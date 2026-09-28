import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { AssumptionPromotionDialog } from "../AssumptionPromotionDialog";

// Alerte Lovable 7 (contre-revue du 28/09): with a real QueryClient, a successful promotion makes
// the active consumers of promotable facts read the new data again, for this case only; a refused
// promotion refreshes nothing.
const CASE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ASSUMPTION = "33333333-3333-4333-8333-333333333333";

const store = vi.hoisted(() => ({ facts: {} as Record<string, string>, reads: {} as Record<string, number>, answer: null as unknown }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = (result: unknown) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "limit"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: null, error: null });
    b.then = (resolve: (v: unknown) => unknown) => resolve(result);
    return b;
  };
  return { supabase: {
    from: () => chain({ data: [], error: null }),
    functions: { invoke: vi.fn(async () => {
      const answer = store.answer as { data: { ok: boolean } };
      if (answer.data.ok) store.facts[CASE] = "promu"; // the edge function wrote the fact
      return answer;
    }) },
  } };
});

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: () => false },
    setPointerCapture: { configurable: true, value: () => undefined },
    releasePointerCapture: { configurable: true, value: () => undefined },
    scrollIntoView: { configurable: true, value: () => undefined },
  });
});

const KEYS = ["case-facts", "case-timeline", "scope-gate-facts", "quote-scenario-pad-scope-facts", "quote-scenario-linkable-assumptions"];

function Consumer({ name, caseId }: { name: string; caseId: string }) {
  const { data } = useQuery({
    queryKey: [name, caseId],
    staleTime: Infinity,
    queryFn: async () => {
      const id = `${name}:${caseId}`;
      store.reads[id] = (store.reads[id] ?? 0) + 1;
      return store.facts[caseId] ?? "initial";
    },
  });
  return <p data-testid={`${name}:${caseId}`}>{data ?? "…"}</p>;
}

const assumption = { id: ASSUMPTION, status: "active", statement: "Poids brut 12 t", assumed_value: 12000,
  assumed_value_type: "number", assumed_fact_key: "cargo.weight_kg", scope_key: "case" };

async function promote(answer: unknown) {
  store.answer = answer;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      {KEYS.map((k) => <Consumer key={k} name={k} caseId={CASE} />)}
      <Consumer name="case-facts" caseId={OTHER} />
      <Consumer name="scope-gate-facts" caseId={OTHER} />
      <AssumptionPromotionDialog caseId={CASE} assumption={assumption} onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
  for (const k of KEYS) await waitFor(() => expect(screen.getByTestId(`${k}:${CASE}`).textContent).toBe("initial"));
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox"));
  await user.click(await screen.findByRole("option", { name: "Expertise opérateur assumée" }));
  await user.click(screen.getByRole("checkbox"));
  const button = screen.getByRole("button", { name: /Promouvoir en fait/ });
  await waitFor(() => expect(button).not.toBeDisabled());
  await user.click(button);
}

describe("promotion refresh with a real QueryClient", () => {
  afterEach(() => { cleanup(); store.facts = {}; store.reads = {}; vi.clearAllMocks(); });

  it("active consumers of this case read the promoted fact again; the other case is untouched", async () => {
    store.facts[OTHER] = "autre dossier";
    await promote({ data: { ok: true, data: { promoted_fact_id: "f1" } }, error: null });
    for (const k of KEYS) {
      await waitFor(() => expect(screen.getByTestId(`${k}:${CASE}`).textContent).toBe("promu"));
      expect(store.reads[`${k}:${CASE}`]).toBe(2);
    }
    expect(screen.getByTestId(`case-facts:${OTHER}`).textContent).toBe("autre dossier");
    expect(store.reads[`case-facts:${OTHER}`]).toBe(1);
    expect(store.reads[`scope-gate-facts:${OTHER}`]).toBe(1);
  });

  it("a refused promotion refreshes nothing", async () => {
    await promote({ data: { ok: false, error: { code: "CONFLICT_INVALID_STATE", message: "Fait déjà promu" } }, error: null });
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Fait déjà promu"));
    expect(toast.success).not.toHaveBeenCalled();
    for (const k of KEYS) {
      expect(screen.getByTestId(`${k}:${CASE}`).textContent).toBe("initial");
      expect(store.reads[`${k}:${CASE}`]).toBe(1);
    }
  });
});
