import { afterEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen } from "@testing-library/react";
import { ScenarioEstimateResult, type SelectedScenarioEstimate } from "../ScenarioEstimateResult";
afterEach(cleanup);
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
