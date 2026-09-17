import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ContainerStayEstimateFields } from "../ContainerStayEstimateFields";
import { StorageDesignationProposal } from "../StorageDesignationProposal";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
afterEach(cleanup); beforeEach(() => { invoke.mockReset(); });
const group = { unit_ref: "lot-1", equipment_code: "20GP", quantity: 1, ownership: "SOC", provider: "DPW" };
const result = () => ({ qualification: "PROPOSAL_ONLY", scenario_id: "s1", scope_hash: "hash", unit_ref: "lot-1", description: "transformers",
  source: "Catalogue test, hypothèse", generated_at: "2026-09-17", warning: null,
  candidates: [{ id: "a", label: "Transformateurs", code: "414", unit: "tonne_per_day", method: "alias", justification: "Alias validé", applicable: true }] });
it("proposes without adopting and reverifies before explicit choice", async () => {
  invoke.mockResolvedValue({ data: result() }); const adopt = vi.fn();
  render(<StorageDesignationProposal caseId="case" group={group} onAdopt={adopt} />);
  fireEvent.click(screen.getByText("Proposer une désignation magasinage"));
  const button = await screen.findByRole("button", { name: /Retenir sous hypothèse/ });
  expect(adopt).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() => expect(adopt).toHaveBeenCalledWith("414", expect.stringContaining("tarif distinct à corroborer")));
  expect(invoke).toHaveBeenCalledTimes(2);
});
it("refuses adoption after selected scenario changes", async () => {
  invoke.mockResolvedValueOnce({ data: result() }).mockResolvedValueOnce({ data: { ...result(), scope_hash: "new" } });
  const adopt = vi.fn(); render(<StorageDesignationProposal caseId="case" group={group} onAdopt={adopt} />);
  fireEvent.click(screen.getByText("Proposer une désignation magasinage"));
  fireEvent.click(await screen.findByRole("button", { name: /Retenir sous hypothèse/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("a changé"); expect(adopt).not.toHaveBeenCalled();
});
it("unsupported designation remains visible but not adoptable", async () => {
  const data = result(); data.candidates[0].applicable = false; invoke.mockResolvedValue({ data });
  render(<StorageDesignationProposal caseId="case" group={group} onAdopt={vi.fn()} />);
  fireEvent.click(screen.getByText("Proposer une désignation magasinage"));
  expect(await screen.findByText(/Code ou unité hors calcul/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Retenir/ })).not.toBeInTheDocument();
});
it("unmounted form ignores late replies and errors do not adopt", async () => {
  let resolve!: (v: unknown) => void; invoke.mockImplementation(() => new Promise(r => { resolve = r; }));
  const adopt = vi.fn(); const ui = render(<StorageDesignationProposal caseId="case" group={group} onAdopt={adopt} />);
  fireEvent.click(screen.getByText("Proposer une désignation magasinage")); ui.unmount(); resolve({ data: result() });
  await Promise.resolve(); expect(adopt).not.toHaveBeenCalled();
});

it("editing stay source while adoption is pending invalidates the old callback", async () => {
  let resolve!: (v: unknown) => void;
  invoke.mockResolvedValueOnce({ data: result() }).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const adopt = vi.fn();
  function Form() {
    const [value, set] = useState(JSON.stringify({ schema_version: 1, source: "ancien", verified_on: "2026-09-17", groups: [group] }));
    return <ContainerStayEstimateFields caseId="case" value={value} onChange={set} onAdopt={adopt} />;
  }
  render(<Form />); fireEvent.click(screen.getByText("Proposer une désignation magasinage"));
  fireEvent.click(await screen.findByRole("button", { name: /Retenir sous hypothèse/ }));
  fireEvent.change(screen.getByLabelText("Source et convention de décompte du séjour"), { target: { value: "nouvelle saisie" } });
  await act(async () => { resolve({ data: result() }); });
  expect(adopt).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Source et convention de décompte du séjour")).toHaveValue("nouvelle saisie");
});

it("external draft revision invalidates adoption without remounting focused stay inputs", async () => {
  let resolve!: (v: unknown) => void;
  invoke.mockResolvedValueOnce({ data: result() }).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const adopt = vi.fn(); const value = JSON.stringify({ source: "saisie", groups: [group] });
  const ui = render(<ContainerStayEstimateFields proposalRevision="statement A" caseId="case" value={value} onChange={vi.fn()} onAdopt={adopt} />);
  fireEvent.click(screen.getByText("Proposer une désignation magasinage"));
  fireEvent.click(await screen.findByRole("button", { name: /Retenir sous hypothèse/ }));
  const input = screen.getByLabelText("Source et convention de décompte du séjour"); input.focus();
  ui.rerender(<ContainerStayEstimateFields proposalRevision="statement B" caseId="case" value={value} onChange={vi.fn()} onAdopt={adopt} />);
  expect(screen.getByLabelText("Source et convention de décompte du séjour")).toBe(input); expect(input).toHaveFocus();
  await act(async () => { resolve({ data: result() }); });
  expect(adopt).not.toHaveBeenCalled();
});
