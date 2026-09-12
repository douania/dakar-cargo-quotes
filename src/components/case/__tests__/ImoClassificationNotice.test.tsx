import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ImoClassificationNotice from "../ImoClassificationNotice";

afterEach(cleanup);
const un = { fact_key: "cargo.un_number", value_text: "UN3536" };
describe("affichage de la classification automatique", () => {
  it("affiche la classe 9 et la provenance sans ajouter de fait", () => {
    render(<ImoClassificationNotice facts={[un]} />);
    expect(screen.getByRole("status")).toHaveTextContent("classe IMDG 9");
    expect(screen.getByText(/Classe déterminée automatiquement/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /BAM/ })).toHaveAttribute("href", "https://tes.bam.de/en/dangerous-goods-database/products/dangerous-goods-dataservice");
  });
  it("prévisualise un nouveau numéro pendant la saisie", () => {
    const { rerender } = render(<ImoClassificationNotice facts={[]} pendingFact={{ key: "cargo.un_number", value: "3536" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("aperçu avant enregistrement");
    expect(screen.getByRole("status")).toHaveTextContent("classe IMDG 9");
    rerender(<ImoClassificationNotice facts={[]} pendingFact={{ key: "cargo.un_number", value: "1203" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("classe IMDG 3");
  });
  it("signale les contradictions avant de chiffrer", () => {
    render(<ImoClassificationNotice facts={[un, { fact_key: "cargo.imo_class", value_text: "3" }]} />);
    expect(screen.getByRole("alert")).toHaveTextContent("À corriger avant le chiffrage");
  });
  it("nomme la portée dossier en multi-lot", () => {
    render(<ImoClassificationNotice facts={[un]} isMultiLot />);
    expect(screen.getByRole("status")).toHaveTextContent("ne s’applique pas automatiquement à tous les lots");
  });
  it("reste absent d'un dossier sans information IMO", () => {
    const { container } = render(<ImoClassificationNotice facts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
