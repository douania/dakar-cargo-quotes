import { afterEach, expect, it } from "vitest";
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
