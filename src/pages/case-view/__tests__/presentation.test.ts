import { describe, expect, it } from "vitest";
import type { CockpitState } from "@/hooks/useCockpitState";
import { buildPilotageViewModel, selectPilotageAction } from "../presentation";

function cockpit(overrides: Partial<CockpitState> = {}): CockpitState {
  return {
    status: "PRICED_DRAFT", isTerminal: false, blockingGapsCount: 0, padReviewCount: 0,
    hasPadWeightReview: false, totalPartnerRequests: 0, draftPartnerRequests: 0,
    unsentPartnerRequests: 0, sentConfirmedPartnerRequests: 0, openPartnerRequests: 0,
    closedPartnerRequests: 0, responsePhaseRequests: 0, hasExploitableRequests: false,
    hasSelectedPartner: false, selectedPartnerName: null, exploitablePartnerRequests: 0,
    collectionVerdict: "neutral", pendingPartnerFacts: 0, pendingFactsByRequestId: new Map(),
    totalClientGaps: 0, activeClientGaps: 0, draftedClientGaps: 0, answeredClientGaps: 0,
    openClientGaps: 0, hasSelectedVersion: false, selectedVersionId: null,
    selectedVersionNumber: null, selectedVersionSnapshot: null, hasPdf: false,
    hasDraftEmail: false, seaFreightAction: null, ...overrides,
  };
}

describe("pilotage presentation", () => {
  it("marks the completed pipeline and selects the first incomplete step", () => {
    const model = buildPilotageViewModel({
      cockpit: cockpit({ hasSelectedVersion: true, selectedVersionId: "v", selectedVersionNumber: 4,
        selectedVersionSnapshot: { totals: { total_ttc: 900, currency: "XOF" } } }),
      hasCriticalUnconfirmed: false,
      selectedEstimate: { status: "success", totalTtc: 1_000, currency: "XOF" },
    });
    expect(model.steps.map((step) => [step.label, step.done, step.current])).toEqual([
      ["Estimation", true, false], ["Devis calculé", true, false], ["Version", true, false],
      ["PDF", false, true], ["Brouillon", false, false], ["Envoi client", false, false],
    ]);
  });

  it("preserves the existing first-match action priority", () => {
    expect(selectPilotageAction(cockpit({ blockingGapsCount: 1, draftPartnerRequests: 2 }), false, null)).toMatchObject({
      kind: "blocking_gap", label: "Résoudre 1 gap(s) bloquant(s)", blocker: "1 gap(s) bloquant(s)",
    });
    expect(selectPilotageAction(cockpit({ status: "ACK_READY_FOR_PRICING" }), true, null)).toMatchObject({
      kind: "confirm_scope", label: "Confirmer le périmètre du dossier",
    });
  });

  it("computes a variance only for finite totals in the same currency", () => {
    const base = cockpit({ hasSelectedVersion: true, selectedVersionNumber: 4,
      selectedVersionSnapshot: { totals: { total_payable: 900, total_ttc: 850, currency: "XOF" } } });
    expect(buildPilotageViewModel({ cockpit: base, hasCriticalUnconfirmed: false,
      selectedEstimate: { status: "success", totalTtc: 1_100, currency: "XOF" } }).variance)
      .toEqual({ amount: 200, currency: "XOF" });
    expect(buildPilotageViewModel({ cockpit: base, hasCriticalUnconfirmed: false,
      selectedEstimate: { status: "success", totalTtc: 2, currency: "EUR" } }).variance).toBeNull();
  });

  it("does not expose a client quote without a selected version", () => {
    const model = buildPilotageViewModel({ cockpit: cockpit(), hasCriticalUnconfirmed: false,
      selectedEstimate: { status: "success", totalTtc: 1_100, currency: "XOF" } });
    expect(model.confirmedQuote).toBeNull();
  });
});