import { describe, expect, it } from "vitest";
import type { CockpitState } from "@/hooks/useCockpitState";
import { buildPilotageViewModel, guidedActionLabel, guidedSituation, presentGuidedGap, readGuidedQuote, selectPilotageAction } from "../presentation";
import { PAD_REVIEW_GAP_KEY, PAD_WEIGHT_REVIEW_FR } from "@/lib/padGapReview";

describe("guided control wording", () => {
  it("summarizes the danger scope without inferring safety and preserves the full diagnostic", () => {
    const original = "Contrôle du périmètre IMO. NO_DIRECT_BINDING, UN_WITHOUT_PROVEN_GROUP. Lot 2 : source client à vérifier.";
    const result = presentGuidedGap({ gap_key: "cargo.imo_goods_scope_confirmation", question_fr: original });
    expect(result.label).not.toMatch(/NO_DIRECT_BINDING|UN_WITHOUT/);
    expect(result.guidance).toContain("statut dangereux");
    expect(result.guidance).toContain("contrôle reste à résoudre");
    expect(result.detail).toBe(original);
  });
  it("distinguishes a weight reconciliation from a port category review", () => {
    const weight = presentGuidedGap({ gap_key: PAD_REVIEW_GAP_KEY, question_fr: PAD_WEIGHT_REVIEW_FR });
    const category = presentGuidedGap({ gap_key: PAD_REVIEW_GAP_KEY });
    expect(weight.label).toContain("poids extrait");
    expect(weight.guidance).toBe(PAD_WEIGHT_REVIEW_FR);
    expect(category.label).toContain("catégories portuaires");
    expect(category.label).not.toBe(weight.label);
  });
  it("never hides an unknown question or invents a meaning for an unknown key", () => {
    const question = "Vérifier SPECIAL_UNRECOGNIZED pour le lot 3, seulement après réception du document.";
    expect(presentGuidedGap({ gap_key: "custom.special", question_fr: question }).label).toBe(question);
    const fallback = presentGuidedGap({ gap_key: "custom.special", question_fr: null });
    expect(fallback.detail).toBe("custom.special");
    expect(fallback.label).toContain("préciser");
  });
});

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

describe("guided presentation without changing commercial state", () => {
  it("keeps partial money and all pending items together, including multi-lot legacy sources", () => {
    const state = cockpit({ hasSelectedVersion: true, selectedVersionNumber: 2,
      selectedVersionSnapshot: { totals: { total_payable: 1200, currency: "XOF" },
        meta: { quoteQualification: { level: "firm", reasons: [] } },
        raw_lines: [
          { description: "Livraison", lot_index: 1, source: { type: "to_confirm+note" }, amount: null },
          { label: "Séjour", lot_index: 2, source: "TO_CONFIRM:external", amount: 0 },
          { description: "Service gratuit", source: "OFFICIAL", amount: 0 },
        ] } });
    const before = JSON.stringify(state);
    expect(readGuidedQuote(state)).toMatchObject({ amount: { amount: 1200, currency: "XOF" },
      qualification: "Total partiel — hors postes réservés",
      pendingItems: ["Lot 1 · Livraison — à confirmer", "Lot 2 · Séjour — à confirmer"] });
    expect(JSON.stringify(state)).toBe(before);
  });
  it("does not invent a version, money or a firm qualification", () => {
    expect(readGuidedQuote(cockpit())).toBeNull();
    expect(readGuidedQuote(cockpit({ hasSelectedVersion: true, selectedVersionNumber: 1,
      selectedVersionSnapshot: { totals: { total_ttc: null, currency: "XOF" } } })))
      .toMatchObject({ amount: null, qualification: "Montant de la version — qualification à vérifier" });
  });
  it("retains explicit reservations and operator bases even with a zero total", () => {
    expect(readGuidedQuote(cockpit({ hasSelectedVersion: true, selectedVersionNumber: 3,
      selectedVersionSnapshot: { totals: { total_payable: 0, currency: "XOF" }, operator_basis: {},
        meta: { quoteQualification: { level: "provisional", reasons: [{ message: "Durée à confirmer" }] } } } })))
      .toMatchObject({ amount: { amount: 0 }, qualification: "Montant provisoire — avec réserves",
        reservations: ["Durée à confirmer", expect.stringContaining("bases opérateur")] });
  });
  it("keeps the scope and text of operator reservations and open points next to the version total", () => {
    const summary = readGuidedQuote(cockpit({ hasSelectedVersion: true, selectedVersionNumber: 1,
      selectedVersionSnapshot: { totals: { total_payable: 900, currency: "XOF" }, operator_basis: {
        reservations: ["SCENARIO_DG_UNKNOWN", { unit_ref: "lot-2", message: "Transport spécialisé à consulter" }],
        open_points: [{ ref: "lot-1", statement: "Durée de séjour à préciser" }],
      } } }));
    expect(summary?.reservations).toContain("Périmètre lot-2 : Transport spécialisé à consulter");
    expect(summary?.reservations).toContain("Périmètre lot-1 : Durée de séjour à préciser");
    expect(summary?.reservations.some(text => text.includes("SCENARIO_DG_UNKNOWN"))).toBe(false);
    expect(summary?.qualification).toBe("Montant provisoire — avec réserves");
  });
  it("changes navigation words without changing the prioritized target or send semantics", () => {
    const action = selectPilotageAction(cockpit({ status: "QUOTED_VERSIONED", hasSelectedVersion: true,
      hasPdf: true, hasDraftEmail: true }), false, null)!;
    expect(action.kind).toBe("mark_sent");
    expect(guidedActionLabel(action)).toContain("envoi manuel");
    expect(action.targetId).toBe("section-version");
    expect(guidedSituation("QUOTED_VERSIONED", action)).toContain("à vérifier");
    expect(guidedSituation("UNEXPECTED", null)).toBe("Situation du dossier à vérifier");
    expect(guidedSituation("SENT", null)).toBe("Envoi du devis enregistré");
  });
});
