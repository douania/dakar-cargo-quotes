import { afterEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ScenarioEstimateResult, type SelectedScenarioEstimate } from "../ScenarioEstimateResult";
import { PricingFreshnessNotice } from "../../puzzle/PricingFreshnessNotice";
import { classifyEstimateReservations } from "@/pages/case-view/estimatePresentation";
import { storageStayInformation, demurrageStayInformation, unknownCarrierStayInformation } from "../../../../supabase/functions/_shared/stay-information";
afterEach(cleanup);
it("shows two documented references and hypothetical group examples without selecting a carrier or changing the total", () => {
  const info = unknownCarrierStayInformation({ carrier: null, equipment: "40HC", unit: { unit_kind: "CONTAINER", ownership: "COC", quantity: 3,
    dangerous_goods: null, temperature_control_required: false }, movement_direction: "IMPORT", destination_country: "SN", discharge_port: "Dakar", is_transit: false, as_of: "2026-09-21" });
  const e = estimate(); e.run!.tariff_lines = [{ id: "demurrage_estimate_example", category: "Surestaries", description: "Surestaries du lot", amount: null, source: { type: "TO_CONFIRM" }, stay_information: info }];
  const before = JSON.stringify(e);
  const { rerender } = render(<ScenarioEstimateResult estimate={e} />);
  const comparison = screen.getByRole("region", { name: "Comparaison indicative des armateurs" });
  expect(screen.getByText("Franchise : à confirmer")).toBeInTheDocument();
  expect(within(comparison).getByText(/CMA CGM — franchise de référence : 10 jours calendaires/)).toBeInTheDocument();
  expect(within(comparison).getByText(/Hapag-Lloyd — franchise de référence : 10 jours calendaires/)).toBeInTheDocument();
  for (const days of [15, 20, 25]) expect(within(comparison).getByText(`${days} jours`)).toBeInTheDocument();
  expect(within(comparison).getByText(/Danger du lot inconnu/)).toBeInTheDocument();
  expect(within(comparison).getByRole("link", { name: "Source officielle CMA CGM" })).toHaveAttribute("href", expect.stringContaining("cma-cgm.com"));
  expect(within(comparison).getByText(/531\s*325 FCFA à 570\s*750 FCFA/)).toBeInTheDocument();
  expect(screen.getByText(/Sous-total indicatif/)).toHaveTextContent(/1\s*000/);
  expect(screen.queryByText(/Exemple à compléter/)).not.toBeInTheDocument();
  expect(JSON.stringify(e)).toBe(before);
  e.run!.tariff_lines = [{ id: "demurrage_estimate_legacy", category: "Surestaries", amount: null, notes: "Ancien résultat sans comparatif", source: { type: "TO_CONFIRM" } }];
  rerender(<ScenarioEstimateResult estimate={e} />);
  expect(screen.queryByRole("region", { name: "Comparaison indicative des armateurs" })).not.toBeInTheDocument();
  expect(screen.getByText("Ancien résultat sans comparatif")).toBeInTheDocument();
});
it("shows franchise then complete periods and a separate cargo example, with access to the existing editor", async () => {
  const info = storageStayInformation({ unit_ref: "example", equipment_code: "40HQ", quantity: 3, ownership: "COC", provider: "DPW", storage_p1_code: "412", storage_days: 10, demurrage_days: null }, 30000, true, "Sous hypothèse");
  const e = estimate();
  e.run!.tariff_lines = [{ id: "warehouse_franchise_example", category: "Magasinage", description: "Magasinage exemple", amount: 0, source: { type: "CALCULATED" }, stay_information: info }];
  const before = JSON.stringify(e); const review = vi.fn();
  render(<ScenarioEstimateResult estimate={e} onStayReview={review} />);
  expect(screen.getByText("Franchise : 10 jours")).toBeInTheDocument();
  for (const period of ["Du jour 11 au jour 25", "Du jour 26 au jour 40", "À partir du jour 41"]) expect(screen.getByText(period)).toBeInTheDocument();
  expect(screen.getByText(/30 tonnes de ce lot × 2 jours facturables × 197 FCFA\/tonne\/jour/)).toHaveTextContent(/11\s*820 FCFA/);
  expect(screen.getByText(/Illustration non ajoutée au total/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Renseigner les hypothèses de séjour" }));
  expect(review).toHaveBeenCalledOnce(); expect(JSON.stringify(e)).toBe(before);
});
it("preserves decimals on informative native-currency tiers and examples", () => {
  const info = demurrageStayInformation([{ day_from: 11, day_to: null, rate_per_day: "10.25", currency: "EUR", evidence_level: "official", source_document: "Synthetic" }], 10, 1, true, "");
  const e = estimate(); e.run!.tariff_lines = [{ id: "demurrage_estimate_example", category: "Surestaries", amount: null, source: { type: "TO_CONFIRM" }, stay_information: info }];
  render(<ScenarioEstimateResult estimate={e} />);
  expect(screen.getByText("10,25 EUR")).toBeInTheDocument();
  expect(screen.getByText(/= 20,5 EUR/)).toBeInTheDocument();
});
it("flags an older saved pricing without claiming tariffs expired or changing it", () => {
  const { rerender } = render(<PricingFreshnessNotice pricingAt="2026-06-07T10:31:00Z" estimateAt="2026-09-21T12:36:00Z" />);
  expect(screen.getByRole("note")).toHaveTextContent("n’a pas été actualisé");
  expect(screen.getByRole("note")).toHaveTextContent("ne prouve pas");
  for (const pricingAt of [undefined, "bad-date", "2026-09-21T12:36:00Z", "2026-09-22T00:00:00Z"]) {
    rerender(<PricingFreshnessNotice pricingAt={pricingAt} estimateAt="2026-09-21T12:36:00Z" />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  }
});
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
  const table = screen.getByRole("table", { name: "Prestations de cette estimation" });
  expect(within(table).getAllByRole("columnheader").map(cell => cell.textContent)).toEqual([
    "Prestation", "Montant", "Base", "Statut", "Détail",
  ]);
  expect(within(table).getByText("Destination à préciser").closest("tr")).toHaveTextContent("À confirmer");
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

it("classifies blockers and uncertain reservations as actionable while keeping standard mentions folded", () => {
  const lines = [
    { id: "priced", amount: 1000, notes: "Mention liée au poste chiffré.", source: { type: "CALCULATED" } },
    { id: "pending", amount: null, notes: "Tarif partenaire à confirmer.", source: { type: "TO_CONFIRM" } },
  ];
  const before = JSON.stringify(lines);
  const groups = classifyEstimateReservations({
    lines,
    blockers: ["RATE_PENDING_CONFIRMATION"],
    reservations: ["SCENARIO_DAP_SERVICES_ONLY", "FUTURE_CODE"],
  });
  expect(groups.actionable.map(item => item.message)).toEqual(expect.arrayContaining([
    "Tarif partenaire à confirmer.",
    expect.stringContaining("tarifs restent à confirmer"),
    "Point de contrôle à examiner dans les détails techniques.",
  ]));
  expect(groups.standard.map(item => item.message)).toEqual(expect.arrayContaining([
    "Mention liée au poste chiffré.",
    expect.stringContaining("prestations DAP"),
  ]));
  expect(JSON.stringify(lines)).toBe(before);
});

it("places the stay section after the service table", () => {
  const e = estimate();
  e.run!.tariff_lines = [{ id: "warehouse_franchise_example", category: "Magasinage",
    description: "Magasinage exemple", amount: 0, source: { type: "CALCULATED" },
    stay_information: storageStayInformation({ unit_ref: "example", equipment_code: "40HQ", quantity: 1,
      ownership: "COC", provider: "DPW", storage_p1_code: "412", storage_days: 10, demurrage_days: null }, 10000, true, "Sous hypothèse") }];
  render(<ScenarioEstimateResult estimate={e} />);
  const table = screen.getByRole("table", { name: "Prestations de cette estimation" });
  const stay = screen.getByRole("region", { name: "Franchises et tranches de séjour" });
  expect(table.compareDocumentPosition(stay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
  expect(screen.getByText('Destination à préciser').closest('details')).toHaveAttribute('open');
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
