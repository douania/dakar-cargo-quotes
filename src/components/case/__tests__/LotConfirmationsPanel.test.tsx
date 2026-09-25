import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LotConfirmationsPanel } from "../LotConfirmationsPanel";

const io = vi.hoisted(() => ({ invoke: vi.fn(), count: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  functions: { invoke: io.invoke },
  from: () => ({ select: () => ({ eq: () => io.count() }) }),
} }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const H = "b".repeat(64);
const lineA = { id: "l1", line_index: 1, line_label: "Lot conteneurs A", request_type_hint: "SEA_FCL_IMPORT", extracted_facts: [], fingerprint: "1".repeat(64) };
const lineB = { id: "l2", line_index: 2, line_label: "Lot conteneurs B", request_type_hint: "SEA_FCL_IMPORT", extracted_facts: [], fingerprint: "2".repeat(64) };
const unitA = { unit_ref: "a", unit_kind: "CONTAINER", equipment_code: "40hc", quantity: 2, scenario_basis: "Synthetic lot A" };
const unitB = { unit_ref: "b", unit_kind: "CONTAINER", equipment_code: "20dv", quantity: 1, scenario_basis: "Synthetic lot B" };
const staleHead = { id: "old-binding", case_id: "case", scenario_id: "scenario", scope_hash: H, context_hash: "c".repeat(64), unit_ref: "a",
  decision_kind: "line_binding", action: "confirm", line_fingerprint: lineA.fingerprint, terminal_mode: null, source_reference: "Ancienne vérification",
  decided_by: "actor", created_at: "2026-09-24T10:00:00Z", decision_version: 1 };
const state = (patch: Record<string, unknown> = {}) => ({
  read_only: false,
  context: { case_id: "case", case_status: "READY_TO_PRICE", context_hash: H, request_count: 2, scenario: { id: "scenario" }, lines: [lineA, lineB],
    heads: [staleHead], pad_heads: [], weight_head_id: null },
  resolution: { units: [unitA, unitB], bindings: [], terminals: [], issues: [
    { unit_ref: "a", line_id: "", kind: "line_binding", code: "LOT_CONFIRMATION_STALE" },
    { unit_ref: "b", line_id: "", kind: "line_binding", code: "LOT_BINDING_REQUIRED" }] },
  ...patch,
});
function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <LotConfirmationsPanel caseId="case" onChanged={vi.fn()} />
  </QueryClientProvider>);
}

it("single-request dossier: nothing rendered and the lot function is never called", async () => {
  io.count.mockResolvedValue({ count: 1, error: null });
  const { container } = mount();
  await waitFor(() => expect(io.count).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
  expect(io.invoke).not.toHaveBeenCalled();
});

it("stale decision stays visible, is not applied, and a new binding needs a line, a source and a check", async () => {
  io.count.mockResolvedValue({ count: 2, error: null });
  io.invoke.mockResolvedValue({ data: state(), error: null });
  mount();
  const lot = (await screen.findByText("Lot a")).closest("article")!;
  expect(within(lot).getByText(/ancienne valeur, non appliquée : Ligne 1 — Lot conteneurs A/)).toBeInTheDocument();
  expect(within(lot).getByText(/une nouvelle confirmation est nécessaire/)).toBeInTheDocument();
  expect(within(lot).getByText("Liez d’abord ce lot à sa ligne de demande.")).toBeInTheDocument();
  const bind = within(lot).getByRole("button", { name: "Lier ce lot à la ligne" });
  expect(bind).toBeDisabled();
  const user = userEvent.setup();
  await user.selectOptions(within(lot).getByLabelText("Ligne de demande de ce lot — a"), lineA.fingerprint);
  await user.type(within(lot).getByLabelText("Source vérifiée"), "Courriel client du 24/09, lot A");
  expect(bind).toBeDisabled();
  await user.click(within(lot).getByRole("checkbox", { name: "J’ai vérifié que ce lot correspond à cette ligne" }));
  await user.click(bind);
  await waitFor(() => expect(io.invoke).toHaveBeenCalledWith("manage-lot-confirmation", { body: expect.objectContaining({ action: "record",
    decision: expect.objectContaining({ unit_ref: "a", decision_kind: "line_binding", action: "confirm", line_fingerprint: lineA.fingerprint,
      terminal_mode: null, expected_context_hash: H, expected_head_id: "old-binding" }) }) }));
});

it("indiscernible lines cannot be selected; locked dossier offers no enabled decision", async () => {
  io.count.mockResolvedValue({ count: 2, error: null });
  const twins = state({ read_only: true });
  (twins.context as { lines: unknown[] }).lines = [lineA, { ...lineB, fingerprint: lineA.fingerprint }];
  io.invoke.mockResolvedValue({ data: twins, error: null });
  mount();
  const lot = (await screen.findByText("Lot b")).closest("article")!;
  expect(screen.getByText("Dossier verrouillé : consultation uniquement.")).toBeInTheDocument();
  for (const option of within(lot).getAllByRole("option").filter(o => o.getAttribute("value"))) {
    expect(option).toBeDisabled();
    expect(option.textContent).toMatch(/indiscernable/);
  }
  expect(within(lot).getByRole("button", { name: "Lier ce lot à la ligne" })).toBeDisabled();
});

it("service failure: no lot is presented as confirmed", async () => {
  io.count.mockResolvedValue({ count: 3, error: null });
  io.invoke.mockResolvedValue({ data: null, error: new Error("not deployed") });
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Confirmations par lot indisponibles");
  expect(screen.queryByText(/— confirmé/)).not.toBeInTheDocument();
});
