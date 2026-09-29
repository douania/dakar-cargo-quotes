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
function mount(onConflictFactKeysChange?: (factKeys: ReadonlySet<string>) => void) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
  <PadGroupConfirmationsPanel caseId="case" onChanged={vi.fn()} onEstimateReview={vi.fn()} onConflictFactKeysChange={onConflictFactKeysChange} />
</QueryClientProvider>); }
it("distinguishes estimation from explicit category/weight confirmation without automatic writes", async () => {
  io.invoke.mockResolvedValue({ data: state(), error: null }); mount();
  expect(await screen.findByText(/catégorie proposée T02/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirmer T02 pour le devis" })).toBeDisabled();
  expect(io.invoke).toHaveBeenCalledTimes(1);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Source et justification de la catégorie"), "Document électrique source");
  await user.type(screen.getByLabelText("Source du poids et de l’allocation du groupe"), "Deux unités de 18 tonnes dans la source");
  await user.click(screen.getByRole("checkbox", { name: "Source vérifiée" }));
  await user.click(screen.getByRole("checkbox", { name: "Je confirme cette catégorie pour le devis" }));
  await user.click(screen.getByRole("button", { name: "Confirmer T02 pour le devis" }));
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
  await user.click(screen.getByRole("checkbox", { name: "Source vérifiée" }));
  await user.click(screen.getByRole("checkbox", { name: "Je confirme cette catégorie pour le devis" }));
  expect(screen.getByRole("button", { name: "Confirmer T02 pour le devis" })).toBeDisabled();
  expect(io.invoke).toHaveBeenCalledTimes(1);
});
it("missing weight prevents confirmation and service failure exposes no usable confirmation", async () => {
  const s = state(); s.context.groups[0].total_weight_kg = null as unknown as number;
  io.invoke.mockResolvedValue({ data: s, error: null }); const rendered = mount();
  expect(await screen.findByText("Poids total : à préciser")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirmer T02 pour le devis" })).toBeDisabled();
  rendered.unmount(); io.invoke.mockResolvedValue({ data: null, error: new Error("unavailable") }); mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Lecture des confirmations indisponible");
  expect(screen.queryByRole("button", { name: /Confirmer T02 pour le devis/ })).not.toBeInTheDocument();
});

it("prefills editable proposals, never attests, clears category evidence on category change", async () => {
  const s = { ...state(), assistance: { a: { excerpt: "2 transformers, 18t/unit", reference: "mail-test", calculation: "2 × 18 000 kg = 36 000 kg", weightDraft: "Mail-test : 2 x 18t, allocation à vérifier", warnings: [] } } };
  io.invoke.mockResolvedValue({ data: s, error: null }); mount();
  expect(await screen.findByText(/Extrait client : 2 transformers/)).toBeInTheDocument();
  expect(screen.getByLabelText("Source et justification de la catégorie")).toHaveValue("Proposition à vérifier (T02) : Équipements électriques");
  expect(screen.getByLabelText("Source du poids et de l’allocation du groupe")).toHaveValue(s.assistance.a.weightDraft);
  expect(screen.getByRole("checkbox", { name: "Source vérifiée" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Je confirme cette catégorie pour le devis" })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Confirmer T02 pour le devis" })).toBeDisabled();
  const user = userEvent.setup(); await user.click(screen.getByRole("checkbox", { name: "Source vérifiée" }));
  expect(screen.getByRole("button", { name: "Confirmer T02 pour le devis" })).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: "Je confirme cette catégorie pour le devis" }));
  expect(screen.getByRole("button", { name: "Confirmer T02 pour le devis" })).toBeEnabled();
  await user.selectOptions(screen.getByLabelText("Catégorie PAD"), "T03");
  expect(screen.getByLabelText("Source et justification de la catégorie")).toHaveValue("");
  expect(screen.getByRole("checkbox", { name: "Source vérifiée" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Je confirme cette catégorie pour le devis" })).not.toBeChecked();
  expect(io.invoke).toHaveBeenCalledTimes(1);
});

it("choosing another category opens the weight details and focuses the PAD selector", async () => {
  Element.prototype.scrollIntoView = vi.fn();
  io.invoke.mockResolvedValue({ data: state(), error: null }); mount();
  await screen.findByText(/catégorie proposée T02/);
  const details = screen.getByText("Poids et références détaillées").closest("details")!;
  expect(details).not.toHaveAttribute("open");
  await userEvent.click(screen.getByRole("button", { name: "Choisir une autre catégorie" }));
  expect(details).toHaveAttribute("open");
  expect(screen.getByLabelText("Catégorie PAD")).toHaveFocus();
  expect(io.invoke).toHaveBeenCalledTimes(1);
});

it("explains dossier conflict and does not manufacture a source for a range", async () => {
  const s = { ...state(), dossier_weight_kg: 35000, issues: [{ unit_ref: "", code: "PAD_GROUP_WEIGHT_CONFLICT" }],
    assistance: { a: { excerpt: "10–18t/unit", reference: "mail", calculation: "2 × 18 000 kg = 36 000 kg", weightDraft: "", warnings: ["Borne haute, poids exact non confirmé"] } } };
  io.invoke.mockResolvedValue({ data: s, error: null }); mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(/35.*000 kg/);
  expect(screen.getByRole("alert")).toHaveTextContent("Remplir les justifications ne résout pas cet écart");
  expect(screen.getByLabelText("Source du poids et de l’allocation du groupe")).toHaveValue("");
  await userEvent.click(screen.getByRole("checkbox", { name: "Source vérifiée" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Je confirme cette catégorie pour le devis" }));
  expect(screen.getByRole("button", { name: "Confirmer T02 pour le devis" })).toBeDisabled();
});

it("remonte uniquement les clés liées au signal de conflit explicite lu", async () => {
  const onConflictFactKeysChange = vi.fn();
  const s = { ...state(), issues: [
    { unit_ref: "", code: "PAD_GROUP_WEIGHT_CONFLICT" },
    { unit_ref: "a", code: "PAD_CONFIRMATION_REQUIRED" },
  ] };
  io.invoke.mockResolvedValue({ data: s, error: null });
  mount(onConflictFactKeysChange);
  await waitFor(() => expect(onConflictFactKeysChange.mock.calls.some(([keys]) =>
    keys.has("cargo.weight_kg") && keys.has("cargo.weight_per_container_kg")
  )).toBe(true));
  const keys = onConflictFactKeysChange.mock.calls.at(-1)?.[0];
  expect([...keys]).toEqual(["cargo.weight_kg", "cargo.weight_per_container_kg"]);
  expect(io.invoke).toHaveBeenCalledTimes(1);
});
it("never presents a partial sum as a total when a group weight is unknown", async () => {
  const s = state(); s.context.groups[0].total_weight_kg = null as unknown as number;
  s.issues = [{ unit_ref: "", code: "PAD_GROUP_WEIGHT_CONFLICT" }];
  io.invoke.mockResolvedValue({ data: s, error: null }); mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("non déterminé (poids manquant)");
  expect(screen.getByRole("alert")).not.toHaveTextContent("scénario : 0 kg");
});

it("presents extracted and retained weights side by side with one quotation reserve", async () => {
  const s = { ...state(), issues: [{ unit_ref: "", code: "PAD_GROUP_WEIGHT_CONFLICT" }], all_heads: [],
    weight_facts: [{ id: "fact", number: 35000, text: null, source_type: "ai_extraction", source_email_id: "mail" }],
    weight_reconciliation: null };
  io.invoke.mockResolvedValue({ data: s, error: null });
  mount();
  expect(await screen.findByText("Extrait des pièces")).toBeInTheDocument();
  expect(screen.getByText("Base retenue")).toBeInTheDocument();
  expect(screen.getByText("Extrait des pièces").parentElement?.parentElement).toHaveClass("sm:grid-cols-2");
  expect(screen.getAllByLabelText("Réserve reprise telle quelle dans le devis")).toHaveLength(1);
});

it("does not mutate loaded group data and performs no write on mount", async () => {
  const s = state();
  const before = JSON.stringify(s);
  io.invoke.mockResolvedValue({ data: s, error: null }); mount();
  await screen.findByText(/catégorie proposée T02/);
  expect(JSON.stringify(s)).toBe(before);
  expect(io.invoke).toHaveBeenCalledTimes(1);
  expect(io.invoke).toHaveBeenCalledWith("manage-pad-group-confirmation", { body: { case_id: "case", action: "read" } });
});

it("range can be retained explicitly with reserve, never automatically attested", async () => {
  const s = { ...state(), assistance: { a: { excerpt: "10–18t/container", reference: "mail", calculation: "2 × 18 000 kg = 36 000 kg", weightDraft: "", warnings: [] } } };
  io.invoke.mockResolvedValue({ data: s, error: null }); mount();
  await screen.findByText(/Extrait client/);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Nature du poids retenu"), "provisional");
  expect((screen.getByLabelText("Source du poids et de l’allocation du groupe") as HTMLTextAreaElement).value).toContain("Base de cotation");
  expect(screen.getByRole("checkbox", { name: "Source vérifiée" })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Confirmer T02 pour le devis" })).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: "Source vérifiée" }));
  await user.click(screen.getByRole("checkbox", { name: "Je confirme cette catégorie pour le devis" }));
  await user.click(screen.getByRole("button", { name: "Confirmer T02 pour le devis" }));
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

it("guided: required fields precede confirmation, preserve values across rollback and keep the request contract", async () => {
  const s = state();
  io.invoke.mockResolvedValue({ data: s, error: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (guided: boolean) => <QueryClientProvider client={client}><PadGroupConfirmationsPanel guided={guided} caseId="case" onChanged={vi.fn()} onEstimateReview={vi.fn()} /></QueryClientProvider>;
  const rendered = render(view(true));
  await screen.findByText("Compléter les bases de ce groupe");
  expect(screen.getByText("Compléter les bases de ce groupe").closest("details")).not.toHaveAttribute("open");
  await userEvent.click(screen.getByText("Compléter les bases de ce groupe"));
  const source = screen.getByLabelText("Source du poids et de l’allocation du groupe");
  expect(source.closest("details")).toHaveAttribute("open");
  expect(screen.getByLabelText("Catégorie PAD").closest("details")).toHaveAttribute("open");
  expect(source.compareDocumentPosition(screen.getByRole("button", { name: "Confirmer T02 pour le devis" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText("Moyenne calculée par conteneur")).toBeInTheDocument();
  const user = userEvent.setup();
  await user.type(source, "Deux conteneurs de 18 tonnes — pièce synthétique");
  rendered.rerender(view(false));
  expect(screen.getByLabelText("Source du poids et de l’allocation du groupe")).toHaveValue("Deux conteneurs de 18 tonnes — pièce synthétique");
  rendered.rerender(view(true));
  if (!screen.getByText("Compléter les bases de ce groupe").closest("details")?.open) await userEvent.click(screen.getByText("Compléter les bases de ce groupe"));
  expect(screen.getByLabelText("Source du poids et de l’allocation du groupe")).toHaveValue("Deux conteneurs de 18 tonnes — pièce synthétique");
  await user.click(screen.getByRole("checkbox", { name: "Source vérifiée" }));
  await user.click(screen.getByRole("checkbox", { name: "Je confirme cette catégorie pour le devis" }));
  await user.click(screen.getByRole("button", { name: "Confirmer T02 pour le devis" }));
  await waitFor(() => expect(io.invoke).toHaveBeenCalledWith("manage-pad-group-confirmation", { body: {
    case_id: "case", action: "record", decision: { unit_ref: "a", action: "confirm", category: "T02",
      source_reference: "Proposition à vérifier (T02) : Équipements électriques", weight_source_reference: "Deux conteneurs de 18 tonnes — pièce synthétique",
      weight_basis: "confirmed", weight_reservation: "", expected_context_hash: "b".repeat(64), expected_head_id: null, idempotency_key: expect.any(String) }
  } }));
});

it("guided: provisional weight remains explicit, a refused save preserves input and shows the error outside details", async () => {
  io.invoke.mockImplementation((_name, { body }) => Promise.resolve(body.action === "read" ? { data: state(), error: null } : { error: new Error("conflict") }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PadGroupConfirmationsPanel guided caseId="case" onChanged={vi.fn()} onEstimateReview={vi.fn()} /></QueryClientProvider>);
  await userEvent.click(await screen.findByText("Compléter les bases de ce groupe"));
  const user = userEvent.setup();
  await user.click(screen.getByRole("radio", { name: "Poids provisoire, avec réserve" }));
  expect(screen.getByLabelText("Réserve à reproduire dans la cotation").closest("details")).toHaveAttribute("open");
  await user.type(screen.getByLabelText("Source du poids et de l’allocation du groupe"), "Pièce synthétique à rapprocher");
  await user.click(screen.getByRole("checkbox", { name: "Source vérifiée" }));
  await user.click(screen.getByRole("checkbox", { name: "Je confirme cette catégorie pour le devis" }));
  await user.click(screen.getByRole("button", { name: "Confirmer T02 pour le devis" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Enregistrement non confirmé");
  expect(screen.getByRole("alert").closest("details")).toBeNull();
  expect(screen.getByLabelText("Source du poids et de l’allocation du groupe")).toHaveValue("Pièce synthétique à rapprocher");
  expect(io.invoke.mock.calls.find(([, args]) => args.body.action === "record")?.[1].body.decision).toMatchObject({ weight_basis: "provisional", weight_reservation: expect.stringContaining("révisables") });
});

it("guided: stale confirmations never become a confirmed summary, and read errors clear it", async () => {
  const stale = { ...state(), heads: [{ id: "old", unit_ref: "a", action: "confirm", category: "T02", context_hash: "old", weight_basis: "confirmed" }], issues: [{ unit_ref: "a", code: "PAD_CONFIRMATION_STALE" }] };
  const onSummaryChange = vi.fn();
  io.invoke.mockResolvedValue({ data: stale, error: null });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PadGroupConfirmationsPanel guided caseId="case" onChanged={vi.fn()} onEstimateReview={vi.fn()} onSummaryChange={onSummaryChange} /></QueryClientProvider>);
  expect(await screen.findByText("À revérifier")).toBeInTheDocument();
  await userEvent.click(screen.getByText("Compléter les bases de ce groupe"));
  expect(screen.getByRole("radio", { name: "Poids confirmé par une source" }).closest("details")).toHaveAttribute("open");
  expect(onSummaryChange).toHaveBeenLastCalledWith("catégorie PAD à confirmer");
  io.invoke.mockResolvedValue({ data: null, error: new Error("offline") });
  await userEvent.click(screen.getByRole("button", { name: "Actualiser les confirmations" }));
  await screen.findByRole("alert");
  await waitFor(() => expect(onSummaryChange).toHaveBeenLastCalledWith(""));
  expect(screen.queryByText("À revérifier")).not.toBeInTheDocument();
});

it("guided: locked groups stay read-only and missing weight never appears as zero", async () => {
  const s = state(); s.read_only = true; s.context.groups[0].total_weight_kg = null as unknown as number;
  io.invoke.mockResolvedValue({ data: s, error: null });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PadGroupConfirmationsPanel guided caseId="case" onChanged={vi.fn()} onEstimateReview={vi.fn()} /></QueryClientProvider>);
  await userEvent.click(await screen.findByText("Compléter les bases de ce groupe"));
  expect(screen.getByRole("radio", { name: "Poids confirmé par une source" })).toBeDisabled();
  expect(screen.getByLabelText("Catégorie PAD")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Confirmer T02 pour le devis" })).toBeDisabled();
  expect(screen.getByText("Poids total du groupe").parentElement).toHaveTextContent("À préciser");
  expect(io.invoke).toHaveBeenCalledTimes(1);
});
