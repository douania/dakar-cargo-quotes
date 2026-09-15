import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuoteScenariosPanel } from "../QuoteScenariosPanel";
import { buildScopeSnapshot, type ScenarioDraft } from "@/lib/quoteScenarios";

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), rows: [] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({}),
  useQuery: () => ({ data: mocks.rows, isLoading: false }),
  useMutation: () => ({ mutate: mocks.mutate, isPending: false }),
}));
// Exercise form callbacks and submitted DTOs, not Radix portal/pointer behavior.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) =>
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

afterEach(() => { cleanup(); mocks.mutate.mockClear(); });
function choose(label: string, value: string) {
  const select = screen.getByText(label, { selector: "label" }).parentElement!.querySelector("select")!;
  fireEvent.change(select, { target: { value } });
}
function submit() {
  const input = screen.getByText("Titre du scénario", { selector: "label" }).parentElement!.querySelector("input")!;
  fireEvent.change(input, { target: { value: "Synthetic local scenario" } });
  fireEvent.click(screen.getByRole("button", { name: /Enregistrer le scénario/ }));
  return mocks.mutate.mock.lastCall![0].draft as ScenarioDraft;
}

describe("scenario creation contract routing", () => {
  it("general creation submits AIR v1, without a maritime cargo contract", () => {
    render(<QuoteScenariosPanel caseId="synthetic-case" />);
    fireEvent.click(screen.getByRole("button", { name: "Nouveau scénario" }));
    choose("Mode de transport", "AIR");
    choose("Type de lot", "PACKAGE");
    expect(screen.queryByRole("button", { name: /Passer ce brouillon/ })).not.toBeInTheDocument();
    const snapshot = buildScopeSnapshot(submit()).snapshot;
    expect(snapshot.schema_version).toBe(1);
    expect(snapshot.transport_mode).toBe("AIR");
    expect((snapshot.cargo_units as Record<string, unknown>[])[0]).toMatchObject({ unit_kind: "PACKAGE" });
    expect((snapshot.cargo_units as Record<string, unknown>[])[0]).not.toHaveProperty("weight_basis");
  });

  it("maritime group creation remains v2 and cancellation does not contaminate general creation", () => {
    render(<QuoteScenariosPanel caseId="synthetic-case" />);
    fireEvent.click(screen.getByRole("button", { name: "Nouveau maritime par groupes" }));
    expect(screen.getByText(/sans ajustement tarifaire SOC\/COC/)).toBeInTheDocument();
    expect(screen.getByText("Base du poids brut", { selector: "label" })).toBeInTheDocument();
    const snapshot = buildScopeSnapshot(submit()).snapshot;
    expect(snapshot.schema_version).toBe(2);
    expect(snapshot.transport_mode).toBe("MARITIME");
    expect((snapshot.cargo_units as Record<string, unknown>[])[0].dangerous_goods).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    fireEvent.click(screen.getByRole("button", { name: "Nouveau scénario" }));
    expect(buildScopeSnapshot(submit()).snapshot.schema_version).toBe(1);
  });

  it("requires an explicit maritime upgrade and leaves general AIR creation available", () => {
    render(<QuoteScenariosPanel caseId="synthetic-case" />);
    fireEvent.click(screen.getByRole("button", { name: "Nouveau scénario" }));
    choose("Mode de transport", "MARITIME");
    expect(screen.getByText(/Les résultats historiques restent conservés/)).toBeInTheDocument();
    expect(buildScopeSnapshot(submit()).snapshot.schema_version).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: /Passer ce brouillon en v2 maritime/ }));
    expect(buildScopeSnapshot(submit()).snapshot.schema_version).toBe(2);
    expect(screen.getByText(/sans ajustement tarifaire SOC\/COC/)).toBeInTheDocument();
  });

  it("changing a maritime v2 draft to AIR warns without discarding its assumptions", () => {
    render(<QuoteScenariosPanel caseId="synthetic-case" />);
    fireEvent.click(screen.getByRole("button", { name: "Nouveau maritime par groupes" }));
    const label = "Justification des hypothèses du lot (obligatoire pour calculer)";
    const input = screen.getByText(label, { selector: "label" }).parentElement!.querySelector("input")!;
    fireEvent.change(input, { target: { value: "Keep this synthetic assumption" } });
    choose("Mode de transport", "AIR");
    expect(screen.getByText(/Le calcul par groupes v2 est limité au maritime conteneurisé/)).toBeInTheDocument();
    expect(input).toHaveValue("Keep this synthetic assumption");
    const snapshot = buildScopeSnapshot(submit()).snapshot;
    expect(snapshot.schema_version).toBe(2);
    expect(snapshot.transport_mode).toBe("AIR");
    expect((snapshot.cargo_units as Record<string, unknown>[])[0].scenario_basis).toBe("Keep this synthetic assumption");
  });
});
