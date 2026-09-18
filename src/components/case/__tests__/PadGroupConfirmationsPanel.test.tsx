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

it("prefills editable proposals, never attests, clears category evidence on category change", async () => {
  const s = { ...state(), assistance: { a: { excerpt: "2 transformers, 18t/unit", reference: "mail-test", calculation: "2 × 18 000 kg = 36 000 kg", weightDraft: "Mail-test : 2 x 18t, allocation à vérifier", warnings: [] } } };
  io.invoke.mockResolvedValue({ data: s, error: null }); mount();
  expect(await screen.findByText(/Extrait client : 2 transformers/)).toBeInTheDocument();
  expect(screen.getByLabelText("Source et justification de la catégorie")).toHaveValue("Proposition à vérifier (T02) : Équipements électriques");
  expect(screen.getByLabelText("Source du poids et de l’allocation du groupe")).toHaveValue(s.assistance.a.weightDraft);
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Confirmer pour le devis" })).toBeDisabled();
  const user = userEvent.setup(); await user.click(screen.getByRole("checkbox"));
  expect(screen.getByRole("button", { name: "Confirmer pour le devis" })).toBeEnabled();
  await user.selectOptions(screen.getByLabelText("Catégorie PAD"), "T03");
  expect(screen.getByLabelText("Source et justification de la catégorie")).toHaveValue("");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(io.invoke).toHaveBeenCalledTimes(1);
});

it("explains dossier conflict and does not manufacture a source for a range", async () => {
  const s = { ...state(), dossier_weight_kg: 35000, issues: [{ unit_ref: "", code: "PAD_GROUP_WEIGHT_CONFLICT" }],
    assistance: { a: { excerpt: "10–18t/unit", reference: "mail", calculation: "2 × 18 000 kg = 36 000 kg", weightDraft: "", warnings: ["Borne haute, poids exact non confirmé"] } } };
  io.invoke.mockResolvedValue({ data: s, error: null }); mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(/35.*000 kg/);
  expect(screen.getByRole("alert")).toHaveTextContent("Remplir les justifications ne résout pas cet écart");
  expect(screen.getByLabelText("Source du poids et de l’allocation du groupe")).toHaveValue("");
  await userEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByRole("button", { name: "Confirmer pour le devis" })).toBeDisabled();
});
it("never presents a partial sum as a total when a group weight is unknown", async () => {
  const s = state(); s.context.groups[0].total_weight_kg = null as unknown as number;
  s.issues = [{ unit_ref: "", code: "PAD_GROUP_WEIGHT_CONFLICT" }];
  io.invoke.mockResolvedValue({ data: s, error: null }); mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("non déterminé (poids manquant)");
  expect(screen.getByRole("alert")).not.toHaveTextContent("scénario : 0 kg");
});

it("range can be retained explicitly with reserve, never automatically attested", async () => {
  const s = { ...state(), assistance: { a: { excerpt: "10–18t/container", reference: "mail", calculation: "2 × 18 000 kg = 36 000 kg", weightDraft: "", warnings: [] } } };
  io.invoke.mockResolvedValue({ data: s, error: null }); mount();
  await screen.findByText(/Extrait client/);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Nature du poids retenu"), "provisional");
  expect((screen.getByLabelText("Source du poids et de l’allocation du groupe") as HTMLTextAreaElement).value).toContain("Base de cotation");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Retenir avec réserve pour le devis" })).toBeDisabled();
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Retenir avec réserve pour le devis" }));
  await waitFor(() => expect(io.invoke).toHaveBeenCalledWith("manage-pad-group-confirmation", { body: expect.objectContaining({ action: "record", decision: expect.objectContaining({ weight_basis: "provisional", weight_reservation: expect.stringContaining("révisables") }) }) }));
});

it("reconciles a weight conflict explicitly without resubmitting category decisions", async () => {
  const base = state();
  const s = { ...base, issues: [{ unit_ref: "", code: "PAD_GROUP_WEIGHT_CONFLICT" }], all_heads: [],
    weight_facts: [{ id: "fact", number: 35000, text: null, source_type: "ai_extraction", source_email_id: "mail" }],
    weight_reconciliation: null };
  io.invoke.mockResolvedValue({ data: s, error: null }); mount();
  const button = await screen.findByRole("button", { name: "Retenir la base révisable" });
  expect(button).toBeDisabled();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Source et justification de l’écart"), "Source client : deux transformateurs de 18 tonnes, somme extraite incorrecte.");
  expect(button).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /J’ai rapproché les sources/ }));
  await user.click(button);
  await waitFor(() => expect(io.invoke).toHaveBeenCalledWith("manage-pad-group-confirmation", { body: expect.objectContaining({ action: "reconcile_weight",
    decision: expect.objectContaining({ action: "retain", expected_head_id: null, expected_heads: [], reservation: expect.stringContaining("révisable") }) }) }));
  expect(io.invoke.mock.calls.some(([, args]) => args.body.action === "record")).toBe(false);
});

it("does not offer commercial override of an operator-confirmed contradictory fact", async () => {
  io.invoke.mockResolvedValue({ data: { ...state(), issues: [{ unit_ref: "", code: "PAD_GROUP_WEIGHT_CONFLICT" }],
    weight_facts: [{ id: "fact", number: 35000, source_type: "operator" }] }, error: null }); mount();
  await screen.findByRole("alert");
  expect(screen.queryByRole("button", { name: "Retenir la base révisable" })).not.toBeInTheDocument();
});
