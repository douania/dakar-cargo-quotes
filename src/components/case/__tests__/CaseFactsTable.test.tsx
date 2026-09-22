import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CaseFact } from "../CaseFactsTable";

vi.mock("@/pages/case-view/FactHistoryPopover", () => ({ FactHistoryPopover: () => <span>Historique du fait</span> }));

import { CaseFactsTable } from "../CaseFactsTable";

afterEach(cleanup);

const base = { case_id: "case-test", created_at: null, is_current: true, is_validated: false,
  source_attachment_id: null, source_email_id: null, source_excerpt: null, supersedes_fact_id: null,
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