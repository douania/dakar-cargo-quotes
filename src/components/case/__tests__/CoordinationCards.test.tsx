import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const state = vi.hoisted(() => ({
  cockpit: {
    status: "PRICED_DRAFT", isTerminal: false, blockingGapsCount: 1, padReviewCount: 0,
    openPartnerRequests: 0, totalPartnerRequests: 0, pendingPartnerFacts: 0,
    openClientGaps: 1, activeClientGaps: 1, draftPartnerRequests: 0,
    unsentPartnerRequests: 0, draftedClientGaps: 0, answeredClientGaps: 0,
    hasSelectedVersion: true, hasPdf: true, hasDraftEmail: true,
    collectionVerdict: "neutral" as const, exploitablePartnerRequests: 0,
    selectedPartnerName: null,
  },
}));

vi.mock("@/hooks/useCockpitState", () => ({
  useCockpitState: () => ({ data: state.cockpit, isLoading: false }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { CaseActionPlan } from "../CaseActionPlan";
import { CommunicationSummaryCard } from "../CommunicationSummaryCard";
import { PartnerCollectionReadinessCard } from "@/components/puzzle/PartnerCollectionReadinessCard";
import { getPartnerScopeExplanation } from "@/lib/partnerScopePresentation";

afterEach(cleanup);

it("met en évidence l’étape restante et son blocage sans appel au montage", () => {
  const frozen = Object.freeze({ ...state.cockpit });
  state.cockpit = frozen as typeof state.cockpit;
  render(<CaseActionPlan caseId="case-test" />);
  expect(screen.getByText("Résoudre les points du devis confirmé")).toBeInTheDocument();
  expect(screen.getByText(/bloqué : 1 point à résoudre/)).toBeInTheDocument();
  expect(screen.getByText(/terminées/)).toBeInTheDocument();
  expect(state.cockpit).toEqual(frozen);
});

it("affiche les trois lignes client et ouvre les blocs existants", async () => {
  const openDrafts = vi.fn();
  const openClosed = vi.fn();
  render(<CommunicationSummaryCard caseId="case-test" clientEmail={null}
    openClientQuestions={2} blockingClientQuestions={1} lastReplyAnalysis={null}
    draftsCount={1} closedActionsCount={2}
    onOpenDrafts={openDrafts} onOpenClosedActions={openClosed} />);
  expect(screen.getByText(/Adresse e-mail/)).toHaveTextContent("manquante");
  expect(screen.getByText(/Questions ouvertes au client/)).toHaveTextContent("2 · 1 bloquante · 1 envoyée au client");
  expect(screen.getByText(/Dernière réponse client analysée/)).toHaveTextContent("aucune");
  expect(screen.queryByText("Complète")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Brouillons de réponse (1)" }));
  await userEvent.click(screen.getByRole("button", { name: "Actions clôturées (2)" }));
  expect(openDrafts).toHaveBeenCalledOnce();
  expect(openClosed).toHaveBeenCalledOnce();
});

it("nomme l’e-mail manquant lorsque c’est le seul défaut", () => {
  state.cockpit = { ...state.cockpit, openClientGaps: 0 };
  render(<CommunicationSummaryCard caseId="case-test" clientEmail={null}
    openClientQuestions={0} blockingClientQuestions={0} lastReplyAnalysis={null}
    draftsCount={0} closedActionsCount={0} onOpenDrafts={vi.fn()} onOpenClosedActions={vi.fn()} />);
  expect(screen.getByText("E-mail client manquant")).toBeInTheDocument();
  expect(screen.getByText(/Questions ouvertes au client/)).toHaveTextContent("0 · non bloquantes");
});

it("affiche l’état de collecte directe déjà calculé", () => {
  render(<PartnerCollectionReadinessCard caseId="case-test" />);
  expect(screen.getByText("Pricing direct, aucune sollicitation nécessaire")).toBeInTheDocument();
});

it("réserve la phrase DAP/DDP au scope explicitement hors périmètre", () => {
  const actual = "freight explicitement hors périmètre";
  expect(getPartnerScopeExplanation("out_of_scope", true, actual)).toBe(
    "Hors périmètre DAP de ce devis. À solliciter seulement si le client demande le fret.",
  );
  expect(getPartnerScopeExplanation("confirmed", true, actual)).toBe(actual);
  expect(getPartnerScopeExplanation("out_of_scope", false, actual)).toBe(actual);
});