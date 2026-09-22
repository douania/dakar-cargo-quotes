import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { QuoteScenariosPanel, type ScenarioPricingAction } from "../QuoteScenariosPanel";
import { buildScopeSnapshot, emptyScenarioDraftV2, type ScenarioDraft } from "@/lib/quoteScenarios";
import { proposalToDraft } from "@/lib/scenarioProposal";
import { proposeGroups } from "../../../../supabase/functions/recommend-pad-category/scenario-domain";

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), rows: [], invoke: vi.fn(),
  queryRows: {} as Record<string, unknown[]>,
  mutations: [] as { mutationFn: (input: unknown) => Promise<unknown> }[],
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({}),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: mocks.queryRows[queryKey[0]] ?? mocks.rows, isLoading: false }),
  useMutation: (options: { mutationFn: (input: unknown) => Promise<unknown> }) => {
    mocks.mutations.push(options);
    return { mutate: mocks.mutate, isPending: false };
  },
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

afterEach(() => { cleanup(); mocks.mutate.mockClear(); mocks.invoke.mockReset(); mocks.queryRows = {}; mocks.mutations = []; });
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
  it("renders one row per revision, one selected detail, and never repeats reservations", () => {
    const original = [{ id: "scenario-r2", root_scenario_id: "root-a", case_id: "synthetic-case", title: "Révision deux", status: "draft",
      scope_hash: "b".repeat(64), scope_snapshot: buildScopeSnapshot(emptyScenarioDraftV2()).snapshot, open_points: [{ key: "cargo.weight" }],
      revision_no: 2, revision_reason: "Poids corrigé", created_at: "2026-09-22T10:00:00Z", superseded_by_scenario_id: null },
    { id: "scenario-r1", root_scenario_id: "root-a", case_id: "synthetic-case", title: "Révision une", status: "superseded",
      scope_hash: "a".repeat(64), scope_snapshot: buildScopeSnapshot(emptyScenarioDraftV2()).snapshot, open_points: [],
      revision_no: 1, revision_reason: null, created_at: "2026-09-21T10:00:00Z", superseded_by_scenario_id: "scenario-r2" }];
    const before = JSON.stringify(original);
    mocks.queryRows["quote-scenarios"] = original;
    mocks.queryRows["quote-scenario-selections"] = [{ scenario_id: "scenario-r2", selected_at: "2026-09-22T11:00:00Z", released_at: null }];
    mocks.queryRows["quote-scenario-pricing-runs"] = [{ id: "run-r2", scenario_id: "scenario-r2", run_seq: 1, status: "success", qualification: "partial",
      reservations: ["SCENARIO_DG_UNKNOWN"], blockers: [], assumptions_snapshot: ["Poids opérateur"], firm_total_ht: 0, firm_total_ttc: 0,
      indicative_total_ht: 350, indicative_total_ttc: 350, currency: "XOF" }];
    render(<QuoteScenariosPanel caseId="synthetic-case" />);
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getAllByLabelText(/Détail de la révision/)).toHaveLength(1);
    expect(screen.getByText("Les réserves de cette révision vivent dans la carte Estimation et ne sont pas répétées ici.")).toBeVisible();
    expect(screen.queryByText(/Le caractère dangereux/)).toBeNull();
    expect(JSON.stringify(original)).toBe(before);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("disables every scenario command when the dossier is locked", () => {
    mocks.queryRows["quote-scenarios"] = [{ id: "scenario-a", root_scenario_id: "root-a", case_id: "synthetic-case", title: "Synthetic", status: "draft",
      scope_hash: "a".repeat(64), scope_snapshot: buildScopeSnapshot(emptyScenarioDraftV2()).snapshot, open_points: [], revision_no: 1,
      created_at: "2026-09-22T10:00:00Z", superseded_by_scenario_id: null }];
    mocks.queryRows["quote-scenario-selections"] = [{ scenario_id: "scenario-a", selected_at: "2026-09-22T11:00:00Z", released_at: null }];
    render(<QuoteScenariosPanel caseId="synthetic-case" isLocked />);
    for (const name of ["Nouveau scénario", "Nouveau maritime par groupes", "Proposer les groupes et catégories PAD depuis les e-mails", "Recalculer l’estimation", "Réviser le périmètre"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("routes sourced PAD-only choices to revision of the selected scenario, never creation or pricing", async () => {
    const proposal = { ...proposeGroups("client@example.invalid", [{ id: "22222222-2222-4222-8222-222222222222",
      from_address: "client@example.invalid", body_text: "1.8 cabinets: 55t/unit, 20HQ SOC, UN3536" }]),
      case_id: "synthetic-case", source_fingerprint: "a".repeat(64), pad_candidates: [{ unit_ref: "lot-1", category: "T02", justification: "Équipement électrique",
        matching_aliases: ["MATERIELS ELECTRIQUES"], rate: 9678, qualification: "PROPOSAL_ONLY" as const, tariff_source: { id: "source-id" } }] };
    const initial = proposalToDraft(proposal);
    const snapshot = buildScopeSnapshot(initial).snapshot;
    mocks.queryRows["quote-scenarios"] = [{ id: "scenario-a", case_id: "synthetic-case", title: "Keep selected title", status: "draft",
      scope_hash: "a".repeat(64), scope_snapshot: snapshot, open_points: [], revision_no: 1 }];
    mocks.queryRows["quote-scenario-selections"] = [{ scenario_id: "scenario-a", released_at: null }];
    mocks.invoke.mockResolvedValueOnce({ data: proposal, error: null }).mockResolvedValueOnce({ data: { verified: true }, error: null });
    render(<QuoteScenariosPanel caseId="synthetic-case" />);
    fireEvent.click(screen.getByRole("button", { name: "Proposer les groupes et catégories PAD depuis les e-mails" }));
    fireEvent.change(await screen.findByLabelText("Choix PAD pour lot-1"), { target: { value: "T02" } });
    fireEvent.click(screen.getByRole("button", { name: "Réviser seulement les choix PAD du scénario sélectionné" }));
    const save = await screen.findByRole("button", { name: "Enregistrer la révision" });
    expect(mocks.mutate).not.toHaveBeenCalled();
    fireEvent.click(save);
    expect(mocks.mutate).toHaveBeenCalledOnce();
    const input = mocks.mutate.mock.lastCall![0];
    expect(input.operation).toBe("revise"); expect(input.scenarioId).toBe("scenario-a");
    expect(input.draft.title).toBe("Keep selected title");
    expect(input.draft.padChoices).toMatchObject([{ unit_ref: "lot-1", category: "T02" }]);
    expect(buildScopeSnapshot(input.draft).snapshot?.cargo_units).toEqual(snapshot?.cargo_units);
    expect(mocks.invoke.mock.calls.every(call => call[0] === "recommend-pad-category")).toBe(true);
  });
  it("publishes the selected latest result and clears it when selection disappears", () => {
    const scope = buildScopeSnapshot(emptyScenarioDraftV2()).snapshot;
    mocks.queryRows["quote-scenarios"] = [{ id: "scenario-a", case_id: "synthetic-case", title: "Synthetic",
      status: "draft", scope_hash: "a".repeat(64), scope_snapshot: scope, open_points: [], revision_no: 1 }];
    mocks.queryRows["quote-scenario-selections"] = [{ scenario_id: "scenario-a", released_at: null }];
    const run = { id: "run-new", scenario_id: "scenario-a", run_seq: 2, status: "success", qualification: "partial",
      reservations: [], blockers: [], assumptions_snapshot: [], firm_total_ht: 0, firm_total_ttc: 0,
      indicative_total_ht: 350, indicative_total_ttc: 350, currency: "XOF", tariff_lines: [{ amount: null }] };
    mocks.queryRows["quote-scenario-pricing-runs"] = [run, { ...run, id: "run-old", run_seq: 1 }];
    const changed = vi.fn();
    const view = render(<QuoteScenariosPanel caseId="synthetic-case" onSelectedEstimateChange={changed} />);
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ caseId: "synthetic-case", run, pending: false, error: null }));
    mocks.queryRows["quote-scenario-selections"] = [];
    view.rerender(<QuoteScenariosPanel caseId="synthetic-case" onSelectedEstimateChange={changed} />);
    expect(changed).toHaveBeenLastCalledWith(null);
  });

  it("labels a partial amount as a subtotal and never displays a zero as a firm quotation", () => {
    mocks.queryRows["quote-scenarios"] = [{ id: "scenario-a", case_id: "synthetic-case", title: "Synthetic",
      status: "draft", scope_hash: "a".repeat(64), scope_snapshot: buildScopeSnapshot(emptyScenarioDraftV2()).snapshot,
      open_points: [], revision_no: 1 }];
    mocks.queryRows["quote-scenario-pricing-runs"] = [{ id: "run-a", scenario_id: "scenario-a", run_seq: 1,
      status: "success", qualification: "partial", reservations: [], blockers: [], assumptions_snapshot: [],
      firm_total_ht: 0, firm_total_ttc: 0, indicative_total_ht: 350, indicative_total_ttc: 350, currency: "XOF" }];
    render(<QuoteScenariosPanel caseId="synthetic-case" />);
    expect(screen.getByText("Sous-total indicatif des postes chiffrés")).toBeInTheDocument();
    expect(screen.getByText("Aucun montant ferme démontré")).toBeInTheDocument();
  });

  it("main action uses the selected scenario and the existing isolated endpoint, once per in-flight request", async () => {
    const scope = buildScopeSnapshot(emptyScenarioDraftV2()).snapshot;
    mocks.queryRows["quote-scenarios"] = [{ id: "scenario-a", case_id: "synthetic-case", title: "Synthetic",
      status: "draft", scope_hash: "a".repeat(64), scope_snapshot: scope, open_points: [], revision_no: 1 }];
    mocks.queryRows["quote-scenario-selections"] = [{ scenario_id: "scenario-a", released_at: null }];
    const ref = createRef<ScenarioPricingAction>();
    render(<QuoteScenariosPanel caseId="synthetic-case" actionRef={ref} />);
    expect(mocks.mutate).not.toHaveBeenCalled();
    act(() => { ref.current!.estimateSelected(); ref.current!.estimateSelected(); });
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    const input = mocks.mutate.mock.lastCall![0];
    expect(input).toMatchObject({ scenarioId: "scenario-a", scopeHash: "a".repeat(64) });
    mocks.invoke.mockResolvedValue({ data: { ok: true, data: { pricing_run_id: "run-a", scenario_id: "scenario-a", run_seq: 1, status: "success",
      qualification: "partial", blockers: [], idempotent_replay: false } }, error: null });
    await mocks.mutations[1].mutationFn(input);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("run-scenario-pricing", { body: {
      case_id: "synthetic-case", scenario_id: "scenario-a", expected_scope_hash: "a".repeat(64), idempotency_key: input.idempotencyKey,
    } });
  });

  it("main action without a selected scenario asks for a read-only proposal, never creates, selects or prices", async () => {
    mocks.invoke.mockResolvedValue({ data: { case_id: "synthetic-case", status: "needs_review", groups: [], reasons: [], pad_candidates: [] }, error: null });
    const ref = createRef<ScenarioPricingAction>();
    render(<QuoteScenariosPanel caseId="synthetic-case" actionRef={ref} />);
    await act(async () => ref.current!.estimateSelected());
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("recommend-pad-category", { body: { action: "propose_scenario", case_id: "synthetic-case" } });
  });

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
    expect(screen.getByText(/retour vide examinés séparément par lot/)).toBeInTheDocument();
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
    expect(screen.getByText(/retour vide examinés séparément par lot/)).toBeInTheDocument();
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
