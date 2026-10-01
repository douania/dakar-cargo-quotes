import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceNoteEditor, SourceText } from "../SourceText";
import { sourcePresentation } from "@/lib/sourcePresentation";

const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const hash = "a".repeat(64);
const original = `Hypothèses à vérifier; e-mail ${id}; SHA256 ${hash}; 36 000 kg, 120 000 F CFA, code SH 8504400000`;

describe("source presentation", () => {
  it("preserves business warnings, amounts and customs codes while hiding machine references", () => {
    const display = sourcePresentation(original);
    expect(display.technical).toBe(true);
    expect(display.text).toBe("Hypothèses à vérifier; e-mail de référence; 36 000 kg, 120 000 F CFA, code SH 8504400000");
    expect(sourcePresentation("Liste de colisage — 30/09/2026")).toEqual({ text: "Liste de colisage — 30/09/2026", technical: false });
    expect(sourcePresentation(`E-mail ${id.toUpperCase()}; SHA-256: ${hash.toUpperCase()}`).text).toBe("e-mail de référence");
  });

  it("retains the exact source in a closed native disclosure", () => {
    render(<SourceText text={original} label="Justification" />);
    const source = screen.getByText(original);
    const details = source.closest("details")!;
    expect(details.open).toBe(false);
    expect(source).not.toBeVisible();
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(source).toBeVisible();
    expect(source.textContent).toBe(original);
  });

  it("opens a long text on its first sentence and keeps the whole text and the exact original reachable", () => {
    const long = "Magasinage — lot lot-1 — à confirmer. Franchise : à confirmer. Franchise applicable à confirmer : terminal, équipement et conditions IMO/température à vérifier. Exemple non chiffrable avec les conditions connues. Source : https://dpw-prod-cd-1.dpworld.com/senegal/faqs (consulté le 2026-09-16)";
    render(<SourceText text={long} />);
    expect(screen.getByText("Magasinage — lot 1 — à confirmer.")).toBeVisible();
    const more = screen.getByText("Lire la suite").closest("details")!;
    expect(more.open).toBe(false);
    const whole = screen.getByText(/Exemple non chiffrable avec les conditions connues/);
    expect(whole).not.toBeVisible();
    fireEvent.click(screen.getByText("Lire la suite"));
    expect(whole).toBeVisible();
    expect(whole).toHaveTextContent("consulté le 2026-09-16");
  });

  it("translates exact known codes, keeps unknown ones, and renders nothing for an empty runtime value", () => {
    const { container, rerender } = render(<SourceText text="Au moins un poste tarifaire est en attente de confirmation (TO_CONFIRM)." />);
    expect(screen.getByText("Au moins un poste tarifaire est en attente de confirmation.")).toBeVisible();
    rerender(<SourceText text="Périmètre lot-2 : packaging_unknown ; code_inconnu_local" />);
    expect(screen.getByText("Périmètre lot-2 : Emballage inconnu ; code_inconnu_local")).toBeVisible();
    rerender(<SourceText text={null as unknown as string} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("can show every word at once where the full text must be read before acting", () => {
    const long = `${"Condition importante à lire avant validation, ".repeat(6)}fin du texte.`;
    render(<SourceText text={long} unfolded />);
    expect(screen.getByText(/fin du texte\./)).toBeVisible();
    expect(screen.queryByText("Lire la suite")).toBeNull();
  });

  it("keeps the complete source in the editable value and submitted payload", () => {
    let saved = "";
    function Editor() {
      const [value, setValue] = useState(original);
      return <form noValidate onSubmit={e => { e.preventDefault(); saved = value; }}>
        <SourceNoteEditor value={value}><label>Justification<textarea className="resize-none" value={value} onChange={e => setValue(e.target.value)} /></label></SourceNoteEditor>
        <button>Enregistrer</button>
      </form>;
    }
    render(<Editor />);
    fireEvent.click(screen.getByText("Enregistrer"));
    expect(saved).toBe(original);
    const field = screen.getByLabelText("Justification");
    const details = field.closest("details")!;
    details.open = true;
    fireEvent.change(field, { target: { value: original + "; réserve confirmée" } });
    expect(details.open).toBe(true);
    fireEvent.click(screen.getByText("Enregistrer"));
    expect(saved).toBe(original + "; réserve confirmée");
  });
});
