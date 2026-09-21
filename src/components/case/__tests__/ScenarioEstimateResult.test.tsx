import { afterEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ScenarioEstimateResult, type SelectedScenarioEstimate } from "../ScenarioEstimateResult";
afterEach(cleanup);
it("distinguishes an ownership exclusion from a free service and shows the priced-base qualification", () => {
  const e = estimate(); e.run!.tariff_lines = [
    { id: "excluded", description: "Retour COC", category: "EMPTY_RETURN", amount: 0, notes: "Responsabilité contractuelle à vérifier", source: { type: "EXCLUDED_BY_RULE", reference: "TECHNICAL_CODE" } },
    { id: "base", description: "Base manutention", amount: 1000, notes: "Supplément IMO non compris", source: { type: "CALCULATED", reference: "Barème vérifié" } },
  ];
  render(<ScenarioEstimateResult estimate={e} />);
  expect(screen.getByText("Exclu sous hypothèse")).toBeInTheDocument();
  expect(screen.getByText("Responsabilité contractuelle à vérifier")).toBeInTheDocument();
  expect(screen.getByText("Supplément IMO non compris")).toBeInTheDocument();
  expect(screen.queryByText("TECHNICAL_CODE")).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Postes à compléter" })).not.toBeInTheDocument();
});
const estimate = (): SelectedScenarioEstimate => ({ caseId:"test", title:"Scenario courant", pending:false, error:null,
  run:{ id:"run", scenario_id:"scenario", run_seq:4,status:"success",qualification:"partial",completed_at:"2026-09-15T14:03:00Z",
    blockers:[],reservations:[],assumptions_snapshot:[],firm_total_ht:0,firm_total_ttc:0,indicative_total_ht:1000,indicative_total_ttc:1000,currency:"XOF",
    tariff_lines:[{ id:"pad-a",description:"PAD groupe a",amount:1000,source:{type:"official",reference:"Catalogue synthétique"}},
      { id:"transport",description:"Transport groupe b",amount:null,notes:"Destination à préciser",source:{type:"TO_CONFIRM"}}] } });
it("displays current detailed partial result without pricing unknown posts as zero",()=>{
  render(<ScenarioEstimateResult estimate={estimate()} />);
  expect(screen.getByText(/Sous-total indicatif/)).toBeInTheDocument();
  expect(screen.getByText("PAD groupe a")).toBeInTheDocument();
  expect(screen.getByText("À confirmer")).toBeInTheDocument(); expect(screen.getByText("Destination à préciser")).toBeInTheDocument();
});
it("shows each stay franchise, tier calculation and source without changing totals",()=>{
  const e=estimate();
  e.run!.tariff_lines=[
    {id:"warehouse_franchise_lot-a",category:"Magasinage",description:"Magasinage — lot lot-a",amount:7880,currency:"FCFA",source:{type:"CALCULATED",reference:"STORAGE_P1_OPERATOR_1111_20260916"},notes:"Franchise retenue 10j ; P1 2j ×394 FCFA/t/j = 7880 FCFA."},
    {id:"demurrage_estimate_lot-b",category:"Surestaries",description:"Surestaries CMA CGM — lot COC lot-b",amount:38050,currency:"XOF",source:{type:"CALCULATED",reference:"Barème armateur synthétique"},notes:"Séjour armateur 11j franchise comprise (10j). J11–J20 : 1j × 38050 XOF × 1 TC = 38050 XOF."},
  ];
  const before=JSON.stringify(e);
  render(<ScenarioEstimateResult estimate={e} />);
  const section=screen.getByRole("region",{name:"Franchises et tranches de séjour"});
  expect(within(section).getByText("Franchise retenue 10j ; P1 2j ×394 FCFA/t/j = 7880 FCFA.")).toBeInTheDocument();
  expect(within(section).getByText(/Séjour armateur 11j franchise comprise/)).toBeInTheDocument();
  expect(within(section).getByText("Source : STORAGE_P1_OPERATOR_1111_20260916")).toBeInTheDocument();
  expect(JSON.stringify(e)).toBe(before);
});
it("never presents a previous success as the pending or failed relaunch",()=>{
  const e=estimate(); e.pending=true; e.error="Erreur réseau";
  render(<ScenarioEstimateResult estimate={e} />);
  expect(screen.getByRole("status")).toHaveTextContent("n’est pas le résultat de cette relance");
  expect(screen.getByRole("alert")).toHaveTextContent("Aucun nouveau montant validé");
  expect(screen.getByText(/Dernier résultat enregistré/)).toBeInTheDocument();
});
it("blocked run cannot display a stored numeric amount as a quote",()=>{
  const e=estimate(); e.run!.status="blocked";
  render(<ScenarioEstimateResult estimate={e} />);
  expect(screen.getByRole("alert")).toHaveTextContent("aucun montant retenu");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
it("groups unpriced PAD posts, preserves zero-priced services, and opens review without mutation", async()=>{
  const e=estimate(); const review=vi.fn();
  e.run!.tariff_lines=[{id:"free",category:"STORAGE",amount:0,source:{type:"official"}},
    {id:"pad1",category:"PAD_DROIT_PASSAGE",amount:null,source:{type:"TO_CONFIRM"}},
    {id:"pad2",category:"PAD_DROIT_PASSAGE",amount:null,source:{type:"TO_CONFIRM"}}];
  const before=JSON.stringify(e);
  render(<ScenarioEstimateResult estimate={e} onReview={review} />);
  expect(screen.getByText(/Droit de passage portuaire — 2 postes non chiffrés/)).toBeInTheDocument();
  expect(screen.getByText(/Détail des prestations et sources/).closest('details')).not.toHaveAttribute('open');
  await userEvent.click(screen.getByRole('button',{name:'Vérifier les choix PAD par groupe'}));
  expect(review).toHaveBeenCalledTimes(1); expect(JSON.stringify(e)).toBe(before);
});
it("keeps unknown support codes tucked away and human-readable reservations available",()=>{
  const e=estimate(); e.run!.reservations=['SCENARIO_DG_UNKNOWN','FUTURE_CODE'];
  render(<ScenarioEstimateResult estimate={e} />);
  expect(screen.getByText(/Le caractère dangereux/)).toBeInTheDocument();
  expect(screen.getByText('Point de contrôle à examiner dans les détails techniques.')).toBeInTheDocument();
  expect(screen.getByText(/FUTURE_CODE/).closest('details')).not.toHaveAttribute('open');
  expect(screen.queryByText('SCENARIO_DG_UNKNOWN',{selector:'li'})).toBeNull();
});
it("does not call an empty or failed scenario available",()=>{
  const e=estimate(); e.run=null;
  const {rerender}=render(<ScenarioEstimateResult estimate={e} />);
  expect(screen.queryByText(/Estimation disponible/)).toBeNull();
  e.run=estimate().run; e.run!.status='failed';
  rerender(<ScenarioEstimateResult estimate={e} />);
  expect(screen.queryByText(/Sous-total indicatif/)).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent('aucun montant retenu');
});
it("opens the exact service details from an unpriced transport action",async()=>{
  render(<ScenarioEstimateResult estimate={estimate()} />);
  await userEvent.click(screen.getByRole('link',{name:'Consulter les postes et tarifs manquants'}));
  expect(screen.getByText(/Détail des prestations et sources/).closest('details')).toHaveAttribute('open');
});

it.each(["calculated", "unpriced", "mixed", "zero"] as const)(
  "keeps the terminal summary consistent with %s storage without changing the result",
  (state) => {
    const e = estimate();
    const priced = { id: "storage-a", category: "Magasinage", description: "Magasinage lot A",
      amount: state === "zero" ? 0 : 7880, source: { type: "CALCULATED", reference: "STORAGE_P1_OPERATOR_1111_20260916" },
      notes: "P1 estimé par coefficient opérateur ×1,111, à corroborer sur facture." };
    const unpriced = { id: "storage-b", category: "Magasinage", description: "Magasinage lot B",
      amount: null, source: { type: "TO_CONFIRM" }, notes: "Durée de séjour à préciser" };
    e.run!.tariff_lines = state === "unpriced" ? [unpriced] : state === "mixed" ? [priced, unpriced] : [priced];
    e.run!.indicative_total_ht = e.run!.indicative_total_ttc = state === "unpriced" || state === "zero" ? 0 : 7880;
    e.run!.reservations = [{ code: "SCENARIO_TERMINAL_ANCILLARIES_TO_CONFIRM" }];
    const before = JSON.stringify(e);
    render(<ScenarioEstimateResult estimate={e} />);
    expect(screen.queryByText(/Frais annexes terminal et magasinage à confirmer : non chiffrés/)).not.toBeInTheDocument();
    expect(screen.getByText(/Seuls les postes non chiffrés sont exclus du sous-total/)).toBeInTheDocument();
    if (state !== "unpriced") {
      expect(screen.getByText(priced.notes)).toBeInTheDocument();
      const row = within(screen.getByRole("table")).getByText("Magasinage lot A").closest("tr")!;
      expect(within(row).queryByText("À confirmer")).not.toBeInTheDocument();
      expect(row).toHaveTextContent(state === "zero" ? /0\s+F/ : /7\s*880/);
    }
    if (state === "unpriced" || state === "mixed") {
      expect(within(screen.getByRole("region", { name: "Postes à compléter" })).getByText(/Magasinage lot B — 1 poste non chiffré/)).toBeInTheDocument();
      expect(screen.getByText("Durée de séjour à préciser")).toBeInTheDocument();
    } else {
      expect(screen.queryByRole("region", { name: "Postes à compléter" })).not.toBeInTheDocument();
    }
    expect(JSON.stringify(e)).toBe(before);
  },
);
