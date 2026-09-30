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
  expect(screen.getByText(/10\s000/)).toBeVisible();
  expect(screen.getByText(/Contexte enregistré/)).toBeVisible();
  expect(screen.getByText(/Faits conservés/).closest("details")).toHaveAttribute("open");
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
  expect(sixth).toHaveTextContent("EXPORT_6");
  expect(sixth).not.toHaveTextContent("IMPORT_1");
});

it("shows scenario snapshots with their assumptions and keeps review an explicit navigation action", () => {
  const onReview = vi.fn();
  render(<QuotationBasis context="Estimation n° 2" facts={[
    { fact_key: "routing.origin_port", value_text: "Anvers", source_type: "client_reply" },
  ]} assumptions={[{ statement: "Séjour estimé à dix jours", basis: "Instruction opérateur" }]} onReview={onReview} />);
  expect(screen.getByText("Anvers")).toBeVisible();
  expect(screen.getByText("Séjour estimé à dix jours")).toBeVisible();
  expect(onReview).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Revoir les bases dans Marchandise" }));
  expect(onReview).toHaveBeenCalledTimes(1);
});
