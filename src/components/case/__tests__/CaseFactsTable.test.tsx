import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { operatorCargoFactInput } from "../../../../supabase/functions/_shared/operator-cargo-fact-write";
import type { CaseFact } from "../CaseFactsTable";

vi.mock("@/pages/case-view/FactHistoryPopover", () => ({ FactHistoryPopover: () => <span>Historique du fait</span> }));

import { CaseFactsTable } from "../CaseFactsTable";

afterEach(cleanup);

it.each([
  ['cargo.dimensions', 'Dimensions retenues', '48x36x29 cm x28 ; 44x27x24 cm x2'],
  ['cargo.weight_net_kg', 'Poids net (kg)', '151'],
  ['cargo.value_currency', 'Devise de la valeur marchandise', 'eur'],
])('permet la correction opérateur de %s avec aide et payload typé', (key, label, raw) => {
  const row = fact({ id: key, fact_key: key, fact_category: 'cargo', source_type: 'attachment_extracted', confidence: .9, value_json: null });
  const onStart = vi.fn(), onSave = vi.fn((f) => operatorCargoFactInput(f.fact_key, raw));
  const props = { caseId: 'case-test', facts: [row], editValue: raw, isLocked: false, isMultiLot: false, isSavingFact: false, onEditValueChange: vi.fn(), onStartEdit: onStart, onCancelEdit: vi.fn(), onSaveFact: onSave };
  const { rerender } = render(<CaseFactsTable {...props} editingFactId={null} />);
  fireEvent.click(screen.getByRole('button', { name: `Modifier ${label}` }));
  expect(onStart).toHaveBeenCalledWith(row);
  rerender(<CaseFactsTable {...props} editingFactId={row.id} />);
  const editor = screen.getByRole('textbox', { name: label });
  expect(editor).toHaveAccessibleDescription();
  fireEvent.keyDown(editor, { key: 'Enter' });
  expect(onSave).toHaveBeenCalledWith(row);
  expect(onSave.mock.results[0].value?.ok).toBe(true);
  const payload = onSave.mock.results[0].value?.value;
  expect(key.endsWith('_kg') ? payload.value_number : payload.value_text).toBe(key.endsWith('_kg') ? 151 : key.endsWith('currency') ? 'EUR' : raw);
  rerender(<CaseFactsTable {...props} isSavingFact={true} editingFactId={row.id} />);
  fireEvent.keyDown(screen.getByRole('textbox', { name: label }), { key: 'Enter' });
  expect(onSave).toHaveBeenCalledTimes(1);
});

const base = { case_id: "case-test", created_at: null, is_current: true, is_validated: false,
  source_attachment_id: null, source_email_id: null, source_revision_id: null, source_excerpt: null, supersedes_fact_id: null,
  updated_at: null, validated_at: null, validated_by: null, value_date: null, value_number: null,
  value_text: null };

function fact(values: Partial<CaseFact> & Pick<CaseFact, "id" | "fact_key" | "fact_category" | "source_type" | "confidence" | "value_json">): CaseFact {
  return { ...base, ...values };
}

it("présente libellés, clés, domaines et origines sans mutation ni appel au montage", () => {
  const facts = Object.freeze([
    Object.freeze(fact({ id: "1", fact_key: "routing.destination_city", fact_category: "routing", source_type: "manual_input", confidence: 1, value_text: "Dakar", value_json: null })),
    Object.freeze(fact({ id: "2", fact_key: "cargo.description", fact_category: "cargo", source_type: "ai_extraction", confidence: .7, value_text: "Machines", value_json: null })),
    Object.freeze(fact({ id: "3", fact_key: "unknown.key", fact_category: "other", source_type: "partner_reply", confidence: .95, value_text: "Valeur", value_json: null })),
  ]);
  const before = JSON.stringify(facts);
  const onSaveFact = vi.fn();
  render(<CaseFactsTable caseId="case-test" facts={facts as unknown as CaseFact[]} editingFactId={null} editValue="" isLocked={false} isMultiLot={false} isSavingFact={false} onEditValueChange={vi.fn()} onStartEdit={vi.fn()} onCancelEdit={vi.fn()} onSaveFact={onSaveFact} />);
  expect(screen.getByText("Marchandise")).toBeInTheDocument();
  expect(screen.getByText("Acheminement")).toBeInTheDocument();
  expect(screen.getByText("Ville de destination")).toBeInTheDocument();
  expect(screen.getByText("routing.destination_city")).toBeInTheDocument();
  expect(screen.getAllByText("unknown.key")).toHaveLength(2);
  expect(screen.getByText("Opérateur")).toBeInTheDocument();
  expect(screen.getByText("Extraction")).toBeInTheDocument();
  expect(screen.getByText("Partenaire")).toBeInTheDocument();
  expect(onSaveFact).not.toHaveBeenCalled();
  expect(JSON.stringify(facts)).toBe(before);
});

it("résume le JSON hors détail et ne transforme pas une faible confiance en conflit", () => {
  render(<CaseFactsTable caseId="case-test" facts={[fact({ id: "1", fact_key: "other.structured", fact_category: "other", source_type: "client_reply", confidence: .2, value_json: { raw: true } })]} editingFactId={null} editValue="" isLocked={false} isMultiLot={false} isSavingFact={false} onEditValueChange={vi.fn()} onStartEdit={vi.fn()} onCancelEdit={vi.fn()} onSaveFact={vi.fn()} />);
  expect(screen.getByText("Données structurées à consulter")).toBeInTheDocument();
  expect(screen.getByText("Détail technique")).toBeInTheDocument();
  expect(screen.getByText("20%")).toHaveClass("text-destructive");
  expect(screen.queryByText("Conflit signalé")).not.toBeInTheDocument();
  expect(screen.queryByText(/raw/)).not.toBeVisible();
});

it("surligne uniquement une clé explicitement signalée", () => {
  render(<CaseFactsTable caseId="case-test" facts={[fact({ id: "1", fact_key: "cargo.weight_kg", fact_category: "cargo", source_type: "ai_extraction", confidence: .95, value_number: 9000, value_json: null })]} conflictFactKeys={new Set(["cargo.weight_kg"])} editingFactId={null} editValue="" isLocked={false} isMultiLot={false} isSavingFact={false} onEditValueChange={vi.fn()} onStartEdit={vi.fn()} onCancelEdit={vi.fn()} onSaveFact={vi.fn()} />);
  expect(screen.getByText("Conflit signalé")).toBeInTheDocument();
});

it('distingue hypothèse, validation humaine et allocations contradictoires sans enregistrer', () => {
  const onSaveFact = vi.fn();
  const group = (count: number, length: number) => ({ count, length, width: 36, height: 29, unit: 'cm' });
  const facts = [fact({ id: 'assumption', fact_key: 'cargo.description', fact_category: 'cargo', source_type: 'ai_assumption', confidence: .6, value_json: null, value_text: 'Hypothèse produit' }),
    fact({ id: 'weight', fact_key: 'cargo.weight_kg', fact_category: 'cargo', source_type: 'operator', confidence: 1, value_number: 190, value_json: null, is_validated: true }),
    fact({ id: 'dimensions', fact_key: 'cargo.dimensions_evidence', fact_category: 'cargo', source_type: 'attachment_extracted', confidence: .8,
      value_json: { conflict: true, sources: [{ filename: null, groups: [group(25,48), group(5,44)] }, { filename: 'packing-list.pdf', groups: [group(28,48), group(2,44)] }] } })];
  const before = JSON.stringify(facts);
  render(<CaseFactsTable caseId="case-test" facts={facts} editingFactId={null} editValue="" isLocked={false} isMultiLot={false} isSavingFact={false} onEditValueChange={vi.fn()} onStartEdit={vi.fn()} onCancelEdit={vi.fn()} onSaveFact={onSaveFact} />);
  expect(screen.getByText('Hypothèse IA')).toBeInTheDocument();
  expect(screen.getByText('Validé')).toBeInTheDocument();
  expect(screen.getAllByText('Non validé')).toHaveLength(2);
  expect(screen.getByText('190 kg')).toBeInTheDocument();
  expect(screen.getByText(/E-mail — 25 carton.*5 carton/)).toBeInTheDocument();
  expect(screen.getByText(/packing-list.pdf — 28 carton.*2 carton/)).toBeInTheDocument();
  expect(screen.getByText('Conflit signalé')).toBeInTheDocument();
  expect(onSaveFact).not.toHaveBeenCalled();
  expect(JSON.stringify(facts)).toBe(before);
});
