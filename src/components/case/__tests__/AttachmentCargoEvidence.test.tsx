import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AttachmentCargoEvidence } from "../AttachmentCargoEvidence";
afterEach(cleanup);

it("sépare les montants FOC, conserve le HS8 et reste une lecture sans adoption", () => {
  const data = Object.freeze({ confidence: .9, extracted_info: { document_type: "NON-COMMERCIAL INVOICE", payment_terms: "FOC", hs_code: "3004.9099", total_amount: 101.96, total_currency: "€" },
    tariff_lines: [{ service: "FOB VALUE", amount: 89.72, currency: "€" }, { service: "FREIGHT", amount: 10.2, currency: "€" }, { service: "INSURANCE", amount: 2.04, currency: "€" }] });
  const before = JSON.stringify(data);
  render(<AttachmentCargoEvidence extractedData={data} />);
  expect(screen.getByText(/FOB déclaré/)).toHaveTextContent("89,72 EUR");
  expect(screen.getByText(/Total facture/)).toHaveTextContent("101,96 EUR");
  expect(screen.getByText(/Fret déclaré/)).toHaveTextContent("10,2 EUR");
  expect(screen.getByText(/Assurance déclarée/)).toHaveTextContent("2,04 EUR");
  expect(screen.getByText(/HS déclaré/)).toHaveTextContent("8 chiffres");
  expect(screen.getByText(/Facture non commerciale/)).toHaveTextContent("ne valide pas la valeur douanière");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(JSON.stringify(data)).toBe(before);
});

it("affiche poids brut et net en kg et rien pour une extraction absente", () => {
  const { rerender } = render(<AttachmentCargoEvidence extractedData={{ extracted_info: { total_cartons: 30, total_gross_weight_kg: 190, total_net_weight_kg: 151 } }} />);
  expect(screen.getByText(/Poids brut/)).toHaveTextContent("190 kg");
  expect(screen.getByText(/Poids net/)).toHaveTextContent("151 kg");
  expect(screen.getByText(/cartons déclarés/)).toHaveTextContent("30");
  rerender(<AttachmentCargoEvidence extractedData={null} />);
  expect(screen.queryByText("Données déclarées dans le document")).not.toBeInTheDocument();
});
