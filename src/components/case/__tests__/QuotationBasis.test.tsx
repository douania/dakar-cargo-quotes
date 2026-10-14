import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuotationBasis } from "../QuotationBasis";

afterEach(cleanup);

it("keeps recorded effective weight separate from the original facts, including zero", () => {
  render(<QuotationBasis context="Calcul n° 3" inputs={{ cargoWeight: 12, cargoVolume: 0 }} facts={[
    { key: "cargo.weight_kg", value_number: 10000, source_type: "manual_input" },
  ]} />);
  expect(screen.getByText("Poids retenu (tonnes)").nextElementSibling).toHaveTextContent("12");
  expect(screen.getByText("Volume (m³)").nextElementSibling).toHaveTextContent("0");
  const factsDetails = screen.getByText(/Faits conservés/).closest("details");
  expect(factsDetails).not.toHaveAttribute("open");
  expect(screen.getByText(/10\s000/)).not.toBeVisible();
  fireEvent.click(screen.getByText(/Faits conservés/));
  expect(factsDetails).toHaveAttribute("open");
  expect(screen.getByText(/10\s000/)).toBeVisible();
  expect(screen.getByText(/Contexte enregistré/)).toBeVisible();
});

it("folds the same saved bases behind a readable digest and translates recorded codes", () => {
  const onReview = vi.fn();
  render(<QuotationBasis collapsed context="Version v2" onReview={onReview}
    inputs={{ incoterm: "DAP", cargoWeight: 10, servicePackage: "DAP_PROJECT_IMPORT", transportMode: "MARITIME" }}
    facts={[
      { key: "service.mode", value_text: "SEA_FCL_IMPORT", source_type: "email_body" },
      { key: "cargo.dangerous_goods", value_text: "false", source_type: "ai_assumption" },
    ]} />);
  const summary = screen.getByText("Bases retenues pour cette cotation").closest("summary")!;
  expect(summary).toHaveTextContent("Version v2 · Incoterm : DAP · Poids retenu (tonnes) : 10");
  expect(summary.closest("details")).not.toHaveAttribute("open");
  expect(screen.getByText("DAP PROJECT IMPORT")).not.toBeVisible();
  expect(screen.getByRole("button", { name: "Revoir les bases dans Marchandise", hidden: true })).not.toBeVisible();
  fireEvent.click(summary);
  fireEvent.click(screen.getByText(/Faits conservés/));
  expect(screen.getByText("DAP PROJECT IMPORT")).toBeVisible();
  expect(screen.getByText("Maritime")).toBeVisible();
  expect(screen.getByText("Maritime FCL import")).toBeVisible();
  expect(screen.getByText("Non")).toBeVisible();
  expect(screen.getByText("Origine enregistrée : Hypothèse assistée")).toBeVisible();
  expect(screen.queryByText(/SEA_FCL_IMPORT|DAP_PROJECT_IMPORT/)).toBeNull();
  expect(onReview).not.toHaveBeenCalled();
});

it("names the lot reference of saved containers in the folded digest", () => {
  render(<QuotationBasis collapsed context="Version v1" inputs={{ containers: [{ type: "20HQ", coc_soc: "SOC", quantity: 39, unit_ref: "lot-1" }] }} />);
  const summary = screen.getByText("Bases retenues pour cette cotation").closest("summary")!;
  expect(summary).toHaveTextContent("Conteneurs : Type : 20HQ · Propriété : SOC · Quantité : 39 · Lot : lot 1");
  expect(summary).not.toHaveTextContent("unit_ref");
});

it("keeps unknown codes exactly as recorded", () => {
  render(<QuotationBasis context="Calcul n° 5" inputs={{ incoterm: "XYZ_CODE" }} facts={[{ key: "routing.incoterm", value_text: "CUSTOM_CODE", source_type: "partner_note" }]} />);
  expect(screen.getAllByText("XYZ_CODE")[0]).toBeVisible();
  expect(screen.getByText("CUSTOM_CODE")).toBeInTheDocument();
  expect(screen.getByText("Origine enregistrée : partner_note")).toBeInTheDocument();
});

it("replaces all displayed bases when the selected version changes and reports missing history", () => {
  const { rerender } = render(<QuotationBasis context="Version v1 sélectionnée" inputs={{ origin: "Dakar", destination: "Bamako" }} />);
  expect(screen.getByText("Bamako")).toBeVisible();
  rerender(<QuotationBasis context="Version v2 sélectionnée" inputs={null} />);
  expect(screen.queryByText("Bamako")).toBeNull();
  expect(screen.queryByText("Dakar")).toBeNull();
  expect(screen.getByText(/Détail des entrées non conservé/)).toBeVisible();
});

it("renders every lot and joins its own saved inputs by index rather than array position", () => {
  const lots = Array.from({ length: 6 }, (_, i) => ({ lot_index: i + 1, lot_label: `Marchandise ${i + 1}` }));
  render(<QuotationBasis context="Calcul n° 4" lots={lots} inputs={{ lots: [
    { lot_index: 6, service_package: "EXPORT_6" }, { lot_index: 1, service_package: "IMPORT_1" },
  ] }} />);
  for (let i = 1; i <= 6; i++) expect(screen.getByText(`Marchandise ${i}`)).toBeVisible();
  const sixth = screen.getByText("Marchandise 6").closest(".border-l-2")!;
  expect(sixth).toHaveTextContent("EXPORT 6");
  expect(sixth).not.toHaveTextContent("IMPORT 1");
});

it("shows scenario snapshots with their assumptions and keeps review an explicit navigation action", () => {
  const onReview = vi.fn();
  render(<QuotationBasis context="Estimation n° 2" facts={[
    { fact_key: "routing.origin_port", value_text: "Anvers", source_type: "client_reply" },
  ]} assumptions={[{ statement: "Séjour estimé à dix jours", basis: "Instruction opérateur" }]} onReview={onReview} />);
  fireEvent.click(screen.getByText(/Faits conservés/));
  expect(screen.getByText("Anvers")).toBeVisible();
  expect(screen.getByText("Séjour estimé à dix jours")).toBeVisible();
  expect(onReview).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Revoir les bases dans Marchandise" }));
  expect(onReview).toHaveBeenCalledTimes(1);
});

it("uses the immutable cargo block for digest and detail, hiding old global containers/weight", () => {
  const basis = { schema_version: 1, source: "pricing_run", source_id: "run-2", lots: [
    { lot_index: 1, label: "Lot A", source_id: "run-2", containers: [{ type: "40HC", quantity: 3 }], weight: { status: "known", kg: 45000, recorded_value: null, source_keys: ["engine.cargoWeight_t"] } },
    { lot_index: 2, label: "Lot B", source_id: "run-2", containers: [{ type: "20DV", quantity: 1 }], weight: { status: "known", kg: 12000, recorded_value: null, source_keys: ["engine.cargoWeight_t"] } },
  ] };
  render(<QuotationBasis context="Version v2" inputs={{ cargo_weight: 36, containers: [{ type: "20GP", quantity: 1 }], cargo_basis: basis }} />);
  const summary = screen.getByText("Bases retenues pour cette cotation").closest("summary")!;
  expect(summary).toHaveTextContent(/45\s000 kg/);
  expect(summary).toHaveTextContent(/12\s000 kg/);
  expect(summary).toHaveTextContent("3 × 40HC");
  expect(summary).not.toHaveTextContent("20GP");
  expect(screen.queryByText("Poids enregistré (unité non précisée)")).toBeNull();
  expect(screen.getByRole("region", { name: "Poids et conteneurs enregistrés par lot" })).toHaveTextContent(/45\s000 kg/);
});

it("displays the same retained basis from the successful run before creating a version", () => {
  render(<QuotationBasis context="Calcul n° 4" inputs={{ mode: "multi_lot" }} pricingRun={{
    id: "run-4", inputs_json: { mode: "multi_lot" }, outputs_json: { multi_lot: true, lots: [{ lot_index: 1, label: "Lot révisé" }] },
    engine_request: { mode: "multi_lot", lots: [{ lot_index: 1, params: { cargoWeight: 45, containers: [{ type: "40HC", quantity: 3 }] } }] },
  }} />);
  expect(screen.getByRole("region", { name: "Poids et conteneurs enregistrés par lot" })).toHaveTextContent(/45\s000 kg/);
  expect(screen.getByRole("region", { name: "Poids et conteneurs enregistrés par lot" })).toHaveTextContent("3 × 40HC");
});

it("signals invalid new saved bases without presenting the old global as replacement", () => {
  render(<QuotationBasis context="Version endommagée" inputs={{ cargo_weight: 36, cargo_basis: null }} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Bases de poids indisponibles");
  expect(screen.queryByText("Poids enregistré (unité non précisée)")).toBeNull();
});

it("keeps adopted operator run aggregates out of the per-lot cargo block", () => {
  render(<QuotationBasis context="Calcul adopté" inputs={{ origin: "Dakar" }} pricingRun={{ engine_request: { cargoWeight: 57 }, outputs_json: { operator_basis: {
    schema_version: 1, title: "Scénario", revision_no: 1, calculated_at: "2026-10-08T00:00:00Z", source_run_id: "scenario-run", scope_hash: "a".repeat(64), scope: { cargo_units: [] }, assumptions: [], overlay: [], reservations: [], open_points: [],
  } } }} />);
  expect(screen.queryByRole("region", { name: "Poids et conteneurs enregistrés par lot" })).toBeNull();
  expect(screen.queryByText(/57\s000 kg/)).toBeNull();
});
it("rejects an empty saved run block before both digest and detail can use old globals", () => {
  render(<QuotationBasis context="Version vide" inputs={{ cargo_weight: 36, containers: [{type:"20GP",quantity:1}], cargo_basis: {schema_version:1,source:"pricing_run",source_id:"run",lots:[]} }} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Bases de poids indisponibles");
  expect(screen.getByText("Bases retenues pour cette cotation").closest("summary")).not.toHaveTextContent("20GP");
  expect(screen.queryByText("Poids enregistré (unité non précisée)")).toBeNull();
});
