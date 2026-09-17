import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PadGroupConfirmationsPanel } from "../PadGroupConfirmationsPanel";
const io = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: io.invoke } } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const state = () => ({ mode: "groups", required: true, read_only: false, ready: false, heads: [], issues: [{ unit_ref: "a", code: "PAD_CONFIRMATION_REQUIRED" }],
  context: { case_id: "case", scenario_id: "scenario", scope_hash: "a".repeat(64), context_hash: "b".repeat(64), groups: [
    { unit_ref: "a", equipment_code: "20HQ", quantity: 2, ownership: "SOC", total_weight_kg: 36000, description: "Transformateurs — source synthétique", proposed_category: "T02", proposed_basis: "Équipements électriques" },
  ] } });
function mount() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
  <PadGroupConfirmationsPanel caseId="case" onChanged={vi.fn()} onEstimateReview={vi.fn()} />
</QueryClientProvider>); }
it("distinguishes estimation from explicit category/weight confirmation without automatic writes", async () => {
  io.invoke.mockResolvedValue({ data: state(), error: null }); mount();
  expect(await screen.findByText(/catégorie proposée T02/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirmer pour le devis" })).toBeDisabled();
  expect(io.invoke).toHaveBeenCalledTimes(1);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Source et justification de la catégorie"), "Document électrique source");
  await user.type(screen.getByLabelText("Source du poids et de l’allocation du groupe"), "Deux unités de 18 tonnes dans la source");
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Confirmer pour le devis" }));
  await waitFor(() => expect(io.invoke).toHaveBeenCalledWith("manage-pad-group-confirmation", { body: expect.objectContaining({ action: "record",
    decision: expect.objectContaining({ unit_ref: "a", category: "T02", expected_head_id: null, expected_context_hash: "b".repeat(64) }) }) }));
});
it("locked dossier never offers an enabled confirmation even with completed fields", async () => {
  const s = state(); s.read_only = true;
  io.invoke.mockResolvedValue({ data: s, error: null }); mount();
  expect(await screen.findByText("Dossier verrouillé : consultation uniquement.")).toBeInTheDocument();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Source et justification de la catégorie"), "Synthetic evidence");
  await user.type(screen.getByLabelText("Source du poids et de l’allocation du groupe"), "Synthetic weight evidence");
  await user.click(screen.getByRole("checkbox"));
  expect(screen.getByRole("button", { name: "Confirmer pour le devis" })).toBeDisabled();
  expect(io.invoke).toHaveBeenCalledTimes(1);
});
it("missing weight prevents confirmation and service failure exposes no usable confirmation", async () => {
  const s = state(); s.context.groups[0].total_weight_kg = null as unknown as number;
  io.invoke.mockResolvedValue({ data: s, error: null }); const rendered = mount();
  expect(await screen.findByText("Poids total : à préciser")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirmer pour le devis" })).toBeDisabled();
  rendered.unmount(); io.invoke.mockResolvedValue({ data: null, error: new Error("unavailable") }); mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Lecture des confirmations indisponible");
  expect(screen.queryByRole("button", { name: "Confirmer pour le devis" })).not.toBeInTheDocument();
});
