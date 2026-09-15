import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ScenarioProposalPanel } from "../ScenarioProposalPanel";
import { proposeGroups } from "../../../../supabase/functions/recommend-pad-category/scenario-domain";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
const CASE = "11111111-1111-4111-8111-111111111111";
function result() { return { ...proposeGroups("client@example.invalid", [{ id: "22222222-2222-4222-8222-222222222222",
  from_address: "client@example.invalid", body_text: "1.8 cabinets: 55t/unit, 20HQ SOC, UN3536" }]),
  case_id: CASE, source_fingerprint: "a".repeat(64), pad_candidates: [] }; }
beforeEach(() => mocks.invoke.mockReset());
afterEach(cleanup);
const proposeButton = () => screen.getByRole("button", { name: "Proposer les groupes et catégories PAD depuis les e-mails" });

it("discloses the AI transfer and displays the real server refusal from a 4xx context", async () => {
  mocks.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: "Source complète non vérifiable" }), { status: 422 }) } });
  render(<ScenarioProposalPanel caseId={CASE} onUseDraft={vi.fn()} />);
  expect(screen.getByText(/transmis au fournisseur IA/)).toBeInTheDocument();
  fireEvent.click(proposeButton());
  expect(await screen.findByRole("alert")).toHaveTextContent("Source complète non vérifiable");
});

it("never invokes on mount, proposes read-only, and verifies source before filling a draft", async () => {
  const useDraft = vi.fn(); mocks.invoke.mockResolvedValueOnce({ data: result(), error: null }).mockResolvedValueOnce({ data: { verified: true }, error: null });
  render(<ScenarioProposalPanel caseId={CASE} onUseDraft={useDraft} />);
  expect(mocks.invoke).not.toHaveBeenCalled(); fireEvent.click(proposeButton());
  const button = await screen.findByRole("button", { name: "Reprendre cette proposition dans un brouillon" });
  expect(useDraft).not.toHaveBeenCalled(); expect(screen.getByText(/Hypothèse à vérifier/)).toBeInTheDocument();
  fireEvent.click(button); await waitFor(() => expect(useDraft).toHaveBeenCalledTimes(1));
  expect(mocks.invoke.mock.calls.map(c => c[1].body.action)).toEqual(["propose_scenario", "verify_scenario_source"]);
  expect(useDraft.mock.lastCall![0].status).toBe("draft");
});

it("refuses changed source and never creates a scenario or replaces a draft", async () => {
  const useDraft = vi.fn(); mocks.invoke.mockResolvedValueOnce({ data: result(), error: null }).mockResolvedValueOnce({ data: null, error: new Error("409") });
  render(<ScenarioProposalPanel caseId={CASE} onUseDraft={useDraft} />); fireEvent.click(proposeButton());
  fireEvent.click(await screen.findByRole("button", { name: "Reprendre cette proposition dans un brouillon" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Aucun brouillon remplacé"); expect(useDraft).not.toHaveBeenCalled();
});

it("ignores an in-flight response after leaving the proposal panel", async () => {
  let resolve!: (value: unknown) => void;
  const useDraft = vi.fn(); mocks.invoke.mockResolvedValueOnce({ data: result(), error: null }).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const rendered = render(<ScenarioProposalPanel caseId={CASE} onUseDraft={useDraft} />); fireEvent.click(proposeButton());
  fireEvent.click(await screen.findByRole("button", { name: "Reprendre cette proposition dans un brouillon" }));
  rendered.unmount(); await act(async () => resolve({ data: { verified: true }, error: null }));
  expect(useDraft).not.toHaveBeenCalled();
});

it("presents verified candidate sources without applying their rates to the draft", async () => {
  const data = { ...result(), pad_candidates: [{ unit_ref: "lot-1", category: "T02", justification: "Contexte électrique à vérifier",
    matching_aliases: ["alias validé"], rate: 100, qualification: "PROPOSAL_ONLY", tariff_source: { id: "rate", source_document: "Source synthétique", evidence_level: "official", effective_date: "2025-01-01" } }] };
  mocks.invoke.mockResolvedValue({ data, error: null }); render(<ScenarioProposalPanel caseId={CASE} onUseDraft={vi.fn()} />); fireEvent.click(proposeButton());
  expect(await screen.findByText(/proposition, non appliquée au calcul/)).toBeInTheDocument();
  expect(screen.getByText(/Source synthétique/)).toBeInTheDocument(); expect(screen.getByText(/ce n’est pas le montant du lot/)).toBeInTheDocument();
});

it("operator selection is retained only after source recheck, never auto-selects a PAD candidate",async()=>{
  const data={...result(),pad_candidates:[{unit_ref:"lot-1",category:"T02",justification:"Équipement",matching_aliases:["equipement"],rate:100,qualification:"PROPOSAL_ONLY",tariff_source:null}]};
  const useDraft=vi.fn(); mocks.invoke.mockResolvedValueOnce({data,error:null}).mockResolvedValueOnce({data:{verified:true},error:null});
  render(<ScenarioProposalPanel caseId={CASE} onUseDraft={useDraft}/>);fireEvent.click(proposeButton());
  const select=await screen.findByLabelText("Choix PAD pour lot-1");expect(select).toHaveValue("");
  fireEvent.change(select,{target:{value:"T02"}});
  fireEvent.click(screen.getByRole("button",{name:"Reprendre cette proposition dans un brouillon"}));
  await waitFor(()=>expect(useDraft).toHaveBeenCalledOnce());
  expect(useDraft.mock.lastCall![0]).toMatchObject({schemaVersion:3,padChoices:[{unit_ref:"lot-1",category:"T02"}]});
  expect(JSON.stringify(useDraft.mock.lastCall![0])).not.toContain('"rate":');
});
