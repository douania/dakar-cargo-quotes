import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

import { supabase } from "@/integrations/supabase/client";
import MaritimeFeeProposalsPanel from "../MaritimeFeeProposalsPanel";

const invokeMock = supabase.functions.invoke as unknown as ReturnType<
  typeof vi.fn
>;

function envelopeWith(
  proposalOverrides: Record<string, unknown> = {},
  envelopeOverrides: Record<string, unknown> = {},
) {
  return {
    ok: true,
    mode: "human_decision_support",
    accounting_effect: "none",
    amount_policy: "DECISIONS_RECORDED_BUT_NEVER_COUNTED_BEFORE_P1_B2",
    proposals: [
      {
        id: "pad-taxe-de-port",
        category: "taxe_de_port",
        label: "Taxe de port (PAD — droit de passage)",
        amount: null,
        currency: "XOF",
        suggested_amount_xof: 96_780,
        suggested_formula: "9678 × 10",
        source_reference: "PAD REDEVANCES_PORTUAIRES_2006",
        evidence_level: "official",
        needs_human_confirmation: true,
        reason: "Barème PAD officiel.",
        missing_confirmation: [] as string[],
        decision_key: "PAD_DROIT_PASSAGE",
        proposal_fingerprint: "a".repeat(64),
        current_decision: null,
        ...proposalOverrides,
      },
    ],
    current_decisions: [],
    unmatched_current_decisions: [],
    decision_history: [],
    warnings: [] as string[],
    ...envelopeOverrides,
  };
}

describe("MaritimeFeeProposalsPanel recovery regressions", () => {
  beforeEach(() => invokeMock.mockReset());

  const orphan = {
    id: "orphan-cma", decision_key: "CARRIER_DEBOURS_COMMISSION:CMA_CGM",
    proposal_id: "commission-cma", proposal_category: "commission_debours",
    decision_action: "confirm", suggested_amount_xof: 2800, decided_amount_xof: 3304,
    decision_version: 3, decision_source: "FACTURE_CMA_FIXTURE",
    source_reference: "SOURCE_CMA_FIXTURE", justification: "Ancienne pièce contrôlée",
    created_at: "2026-08-30T10:00:00Z", is_stale: true,
  };
  const grimaldi = {
    id: "commission-grimaldi", category: "commission_debours", label: "Commission GRIMALDI",
    decision_key: "CARRIER_DEBOURS_COMMISSION:GRIMALDI", suggested_amount_xof: 4000,
  };
  function pendingReply() {
    let resolve!: (value: { data: ReturnType<typeof envelopeWith> | null; error: Error | null }) => void;
    const promise = new Promise<{ data: ReturnType<typeof envelopeWith> | null; error: Error | null }>(
      (done) => { resolve = done; },
    );
    return { promise, resolve };
  }
  async function fillReason(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/Source de la décision/i), "PIECE_FIXTURE");
    await user.type(screen.getByLabelText(/Justification opérateur/i), "Annulation après changement");
  }

  for (const hasOtherProposals of [false, true]) {
    it(`affiche et révoque l'ancienne décision CMA sans la réaffecter à GRIMALDI (autres=${hasOtherProposals})`, async () => {
      const loaded = envelopeWith(grimaldi, {
        ...(hasOtherProposals ? {} : { proposals: [] }),
        unmatched_current_decisions: [orphan],
      });
      invokeMock.mockResolvedValueOnce({ data: loaded, error: null })
        .mockResolvedValueOnce({ data: envelopeWith(grimaldi), error: null });
      const user = userEvent.setup();
      render(<MaritimeFeeProposalsPanel caseId="orphan-case" />);
      await user.click(screen.getByRole("button", { name: /Voir propositions maritimes/i }));
      expect(await screen.findByText(/Décisions orphelines actives/i)).toBeInTheDocument();
      expect(screen.getByText(orphan.decision_key)).toBeInTheDocument();
      expect(screen.getByText(/Source initiale : SOURCE_CMA_FIXTURE/)).toBeInTheDocument();
      expect(screen.getByText(/Source opérateur : FACTURE_CMA_FIXTURE/)).toBeInTheDocument();
      expect(screen.getByText(/Décision v3 : Confirmation/)).toBeInTheDocument();
      expect(screen.getByText(/Montant décidé : 3 304 FCFA/)).toBeInTheDocument();
      expect(screen.getByText(/Obsolète : proposition disparue/)).toBeInTheDocument();
      expect(screen.queryAllByRole("button", { name: /^Confirmer$/ })).toHaveLength(hasOtherProposals ? 1 : 0);
      expect(screen.queryAllByRole("button", { name: /^Ajuster$/ })).toHaveLength(hasOtherProposals ? 1 : 0);
      expect(screen.queryAllByRole("button", { name: /^Rejeter$/ })).toHaveLength(hasOtherProposals ? 1 : 0);
      await user.click(screen.getByRole("button", { name: /Révoquer la décision/i }));
      expect(screen.queryByRole("checkbox")).toBeNull();
      expect(screen.getByRole("button", { name: /Enregistrer la révocation/i })).toBeDisabled();
      await fillReason(user);
      await user.click(screen.getByRole("button", { name: /Enregistrer la révocation/i }));
      await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
      const body = invokeMock.mock.calls[1][1].body;
      expect(body).toEqual({
        operation: "revoke", case_id: "orphan-case", decision_key: orphan.decision_key,
        expected_decision_version: 3, decision_source: "PIECE_FIXTURE",
        justification: "Annulation après changement", idempotency_key: expect.stringMatching(/^maritime-ui-/),
      });
      expect(invokeMock.mock.calls.every(([name]) => name === "manage-maritime-fee-decision")).toBe(true);
    });
  }

  it("montre le rejet orphelin sans fabriquer de montant décidé et masque une révocation achevée", async () => {
    invokeMock.mockResolvedValue({ data: envelopeWith({}, {
      proposals: [],
      unmatched_current_decisions: [
        { ...orphan, decision_action: "reject", decided_amount_xof: null },
        { ...orphan, id: "already-revoked", decision_action: "revoke" },
      ],
    }), error: null });
    const user = userEvent.setup();
    render(<MaritimeFeeProposalsPanel caseId="orphan-case" />);
    await user.click(screen.getByRole("button", { name: /Voir propositions maritimes/i }));
    expect(await screen.findByText(/Décision v3 : Rejet/)).toBeInTheDocument();
    expect(screen.getByText(/Aucun montant décidé.*Ancien montant indicatif : 2 800 FCFA.*non compté/)).toBeInTheDocument();
    expect(screen.queryByText(/Montant décidé : 3 304/)).toBeNull();
    expect(screen.getAllByRole("button", { name: /Révoquer la décision/i })).toHaveLength(1);
  });

  it("conserve la clé et le brouillon après erreur en vue vide ; double clic en vol = un seul appel", async () => {
    const before = envelopeWith({}, { proposals: [], unmatched_current_decisions: [orphan] });
    const saved = pendingReply();
    invokeMock.mockResolvedValueOnce({ data: before, error: null })
      .mockResolvedValueOnce({ data: null, error: new Error("Réseau fixture indisponible") })
      .mockReturnValueOnce(saved.promise);
    const user = userEvent.setup();
    render(<MaritimeFeeProposalsPanel caseId="orphan-case" />);
    await user.click(screen.getByRole("button", { name: /Voir propositions maritimes/i }));
    await user.click(await screen.findByRole("button", { name: /Révoquer la décision/i }));
    await fillReason(user);
    await user.click(screen.getByRole("button", { name: /Enregistrer la révocation/i }));
    expect(await screen.findByText(/Réseau fixture indisponible/)).toBeInTheDocument();
    const firstBody = invokeMock.mock.calls[1][1].body;
    await user.dblClick(screen.getByRole("button", { name: /Enregistrer la révocation/i }));
    expect(invokeMock).toHaveBeenCalledTimes(3);
    expect(invokeMock.mock.calls[2][1].body).toEqual(firstBody);
    await act(async () => saved.resolve({ data: envelopeWith({}, { proposals: [] }), error: null }));
    expect(screen.queryByText(/Décisions orphelines actives/)).toBeNull();
  });

  for (const orphanMode of [false, true]) {
    it(`changement de dossier invalide enveloppe et brouillon (orphelin=${orphanMode})`, async () => {
      const before = orphanMode
        ? envelopeWith({}, { proposals: [], unmatched_current_decisions: [orphan] })
        : envelopeWith();
      invokeMock.mockResolvedValue({ data: before, error: null });
      const user = userEvent.setup();
      const view = render(<MaritimeFeeProposalsPanel caseId="case-old" />);
      await user.click(screen.getByRole("button", { name: /Voir propositions maritimes/i }));
      await user.click(await screen.findByRole("button", {
        name: orphanMode ? /Révoquer la décision/i : /^Confirmer$/,
      }));
      await fillReason(user);
      view.rerender(<MaritimeFeeProposalsPanel caseId="case-new" />);
      expect(screen.getByRole("button", { name: /Voir propositions maritimes/i })).toBeInTheDocument();
      expect(screen.queryByLabelText(/Source de la décision/i)).toBeNull();
      expect(screen.queryByText(/Décisions orphelines actives/i)).toBeNull();
      expect(screen.queryByRole("button", { name: /Enregistrer/i })).toBeNull();
      expect(invokeMock).toHaveBeenCalledTimes(1);
    });
  }

  for (const failed of [false, true]) {
    it(`ignore une réponse list tardive de l'ancien dossier (erreur=${failed})`, async () => {
      const old = pendingReply();
      invokeMock.mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce({ data: envelopeWith({ label: "Proposition dossier nouveau" }), error: null });
      const user = userEvent.setup();
      const view = render(<MaritimeFeeProposalsPanel caseId="case-old" />);
      await user.click(screen.getByRole("button", { name: /Voir propositions maritimes/i }));
      view.rerender(<MaritimeFeeProposalsPanel caseId="case-new" />);
      await user.click(screen.getByRole("button", { name: /Voir propositions maritimes/i }));
      expect(await screen.findByText("Proposition dossier nouveau")).toBeInTheDocument();
      await act(async () => old.resolve(failed
        ? { data: null, error: new Error("Erreur dossier ancien") }
        : { data: envelopeWith({ label: "Proposition dossier ancien" }), error: null }));
      expect(screen.getByText("Proposition dossier nouveau")).toBeInTheDocument();
      expect(screen.queryByText(/Proposition dossier ancien|Erreur dossier ancien/)).toBeNull();
    });
  }

  for (const orphanMode of [false, true]) {
    it(`ignore une mutation tardive sans altérer la sauvegarde du nouveau dossier (orphelin=${orphanMode})`, async () => {
      const oldMutation = pendingReply();
      const newMutation = pendingReply();
      invokeMock
        .mockResolvedValueOnce({ data: orphanMode
          ? envelopeWith({}, { proposals: [], unmatched_current_decisions: [orphan] })
          : envelopeWith(), error: null })
        .mockReturnValueOnce(oldMutation.promise)
        .mockResolvedValueOnce({ data: envelopeWith({ label: "Nouveau dossier" }), error: null })
        .mockReturnValueOnce(newMutation.promise);
      const user = userEvent.setup();
      const view = render(<MaritimeFeeProposalsPanel caseId="case-old" />);
      await user.click(screen.getByRole("button", { name: /Voir propositions maritimes/i }));
      await user.click(await screen.findByRole("button", {
        name: orphanMode ? /Révoquer la décision/i : /^Confirmer$/,
      }));
      await fillReason(user);
      await user.click(screen.getByRole("button", {
        name: orphanMode ? /Enregistrer la révocation/i : /Enregistrer la décision/i,
      }));
      view.rerender(<MaritimeFeeProposalsPanel caseId="case-new" />);
      await user.click(screen.getByRole("button", { name: /Voir propositions maritimes/i }));
      await user.click(await screen.findByRole("button", { name: /^Confirmer$/ }));
      await fillReason(user);
      await user.click(screen.getByRole("button", { name: /Enregistrer la décision/i }));
      expect(screen.getByRole("button", { name: /Enregistrer la décision/i })).toBeDisabled();
      await act(async () => oldMutation.resolve({
        data: envelopeWith({ label: "Ancien dossier terminé" }), error: null,
      }));
      expect(screen.getByText("Nouveau dossier")).toBeInTheDocument();
      expect(screen.queryByText("Ancien dossier terminé")).toBeNull();
      expect(screen.getByRole("button", { name: /Enregistrer la décision/i })).toBeDisabled();
      expect(invokeMock.mock.calls[1][1].body.case_id).toBe("case-old");
      expect(invokeMock.mock.calls[3][1].body.case_id).toBe("case-new");
      await act(async () => newMutation.resolve({
        data: envelopeWith({ label: "Nouveau dossier sauvegardé" }), error: null,
      }));
      expect(screen.getByText("Nouveau dossier sauvegardé")).toBeInTheDocument();
      expect(invokeMock).toHaveBeenCalledTimes(4);
    });
  }
});

describe("MaritimeFeeProposalsPanel P1-B2 TTC fournisseur", () => {
  beforeEach(() => invokeMock.mockReset());

  const commission = {id: "commission-debours", category: "commission_debours",
    label: "Commission CMA CGM", decision_key: "CARRIER_DEBOURS_COMMISSION:CMA_CGM",
    suggested_amount_xof: 2800};

  for (const action of ["confirm", "adjust"] as const) {
    it(`${action} exige attestation TTC ; aucune taxe ajoutée au montant`, async () => {
      invokeMock.mockResolvedValue({data: envelopeWith(commission), error: null});
      const user = userEvent.setup();
      render(<MaritimeFeeProposalsPanel caseId="ttc-case" />);
      await user.click(screen.getByRole("button", {name: /Voir propositions maritimes/i}));
      await user.click(await screen.findByRole("button", {name: action === "confirm" ? /^Confirmer$/ : /^Ajuster$/}));
      expect(screen.getByText(/pas un TTC fournisseur vérifié/i)).toBeInTheDocument();
      if (action === "adjust") {
        const amount = screen.getByLabelText(/Montant TTC de ce frais/i);
        expect(amount).toHaveValue(null); // jamais prérempli avec la formule indicative
        await user.type(amount, "3304");
      }
      await user.type(screen.getByLabelText(/Source de la décision/i), "Facture fournisseur test");
      await user.type(screen.getByLabelText(/Justification opérateur/i), "TTC du frais contrôlé sur pièce");
      const save = screen.getByRole("button", {name: /Enregistrer la décision/i});
      expect(save).toBeDisabled();
      await user.click(screen.getByRole("checkbox", {name: /J'atteste/i}));
      await user.click(save);
      await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
      const body = invokeMock.mock.calls[1][1].body;
      expect(body.supplier_invoice_ttc_confirmed).toBe(true);
      expect(body.operation).toBe(action);
      expect(body.amount_xof).toBe(action === "adjust" ? 3304 : undefined);
      expect(invokeMock.mock.calls.map(call => call[0])).toEqual([
        "manage-maritime-fee-decision", "manage-maritime-fee-decision",
      ]);
    });
  }

  it("une décision rejetée ou obsolète reste révocable sans attester un TTC", async () => {
    invokeMock.mockResolvedValue({data: envelopeWith({...commission, current_decision: {
      id: "old", decision_key: commission.decision_key, decision_action: "reject",
      decided_amount_xof: null, decision_version: 2, decision_source: "Ancienne pièce",
      justification: "Refus", created_at: "2026-08-30", is_stale: true,
    }}), error: null});
    const user = userEvent.setup();
    render(<MaritimeFeeProposalsPanel caseId="ttc-case" />);
    await user.click(screen.getByRole("button", {name: /Voir propositions maritimes/i}));
    await user.click(await screen.findByRole("button", {name: /Révoquer la décision/i}));
    expect(screen.queryByRole("checkbox")).toBeNull();
    await user.type(screen.getByLabelText(/Source de la décision/i), "Pièce annulée");
    await user.type(screen.getByLabelText(/Justification opérateur/i), "Reprise du dossier");
    await user.click(screen.getByRole("button", {name: /Enregistrer la décision/i}));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    expect(invokeMock.mock.calls[1][1].body).toMatchObject({operation: "revoke", expected_decision_version: 2});
  });
});

describe("MaritimeFeeProposalsPanel P1-B1", () => {
  beforeEach(() => invokeMock.mockReset());

  it("reste manuel au montage et affiche la doctrine anti-comptage", () => {
    render(<MaritimeFeeProposalsPanel caseId="case-1" />);
    expect(screen.getByText(/Propositions maritimes à confirmer/i))
      .toBeInTheDocument();
    expect(screen.getByText(/Recalcul requis pour intégrer une décision/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Voir propositions maritimes/i }))
      .toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("charge le support de décision sans appeler le pricing", async () => {
    invokeMock.mockResolvedValue({ data: envelopeWith(), error: null });
    const user = userEvent.setup();
    render(<MaritimeFeeProposalsPanel caseId="case-42" />);
    await user.click(
      screen.getByRole("button", { name: /Voir propositions maritimes/i }),
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("manage-maritime-fee-decision", {
        body: { operation: "list", case_id: "case-42" },
      })
    );
    expect(screen.getByText("96 780 FCFA")).toBeInTheDocument();
    expect(screen.getByText(/Montant ferme\s*:\s*null/i)).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "run-pricing",
      expect.anything(),
    );
  });

  it("une proposition incomplète peut être rejetée mais ni confirmée ni ajustée", async () => {
    invokeMock.mockResolvedValue({
      data: envelopeWith({
        suggested_amount_xof: null,
        missing_confirmation: ["tonnage"],
      }),
      error: null,
    });
    const user = userEvent.setup();
    render(<MaritimeFeeProposalsPanel caseId="case-7" />);
    await user.click(
      screen.getByRole("button", { name: /Voir propositions maritimes/i }),
    );
    expect(await screen.findByRole("button", { name: /^Confirmer$/i }))
      .toBeDisabled();
    expect(screen.getByRole("button", { name: /^Ajuster$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Rejeter$/i })).toBeEnabled();
    expect(screen.getByText(/tonnage/i)).toBeInTheDocument();
  });

  it("confirme avec source, justification et clé idempotente sans doubler un double clic", async () => {
    const before = envelopeWith();
    const after = envelopeWith({
      current_decision: {
        id: "decision-1",
        decision_key: "PAD_DROIT_PASSAGE",
        decision_action: "confirm",
        decided_amount_xof: 96_780,
        decision_version: 1,
        decision_source: "Facture vérifiée",
        justification: "Montant contrôlé",
        created_at: "2026-08-29T00:00:00Z",
        is_stale: false,
      },
    });
    invokeMock
      .mockResolvedValueOnce({ data: before, error: null })
      .mockResolvedValueOnce({ data: after, error: null });
    const user = userEvent.setup();
    render(<MaritimeFeeProposalsPanel caseId="case-8" />);
    await user.click(
      screen.getByRole("button", { name: /Voir propositions maritimes/i }),
    );
    await user.click(
      await screen.findByRole("button", { name: /^Confirmer$/i }),
    );
    await user.type(
      screen.getByLabelText(/Source de la décision/i),
      "Facture vérifiée",
    );
    await user.type(
      screen.getByLabelText(/Justification opérateur/i),
      "Montant contrôlé",
    );
    await user.dblClick(
      screen.getByRole("button", { name: /Enregistrer la décision/i }),
    );

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    expect(invokeMock).toHaveBeenLastCalledWith(
      "manage-maritime-fee-decision",
      {
        body: expect.objectContaining({
          operation: "confirm",
          case_id: "case-8",
          proposal_id: "pad-taxe-de-port",
          expected_proposal_fingerprint: "a".repeat(64),
          decision_source: "Facture vérifiée",
          justification: "Montant contrôlé",
          idempotency_key: expect.stringMatching(/^maritime-ui-/),
        }),
      },
    );
    expect(screen.getByText(/Décision v1 : Confirmation/i)).toBeInTheDocument();
    expect(screen.getByText(/Montant décidé : 96 780 FCFA/i))
      .toBeInTheDocument();
  });

  it("l'ajustement envoie uniquement un entier XOF explicite", async () => {
    invokeMock
      .mockResolvedValueOnce({ data: envelopeWith(), error: null })
      .mockResolvedValueOnce({ data: envelopeWith(), error: null });
    const user = userEvent.setup();
    render(<MaritimeFeeProposalsPanel caseId="case-9" />);
    await user.click(
      screen.getByRole("button", { name: /Voir propositions maritimes/i }),
    );
    await user.click(await screen.findByRole("button", { name: /^Ajuster$/i }));
    await user.clear(screen.getByLabelText(/Montant final XOF/i));
    await user.type(screen.getByLabelText(/Montant final XOF/i), "97000");
    await user.type(
      screen.getByLabelText(/Source de la décision/i),
      "Facture rectificative",
    );
    await user.type(
      screen.getByLabelText(/Justification opérateur/i),
      "Montant final attesté",
    );
    await user.click(
      screen.getByRole("button", { name: /Enregistrer la décision/i }),
    );
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    expect(invokeMock).toHaveBeenLastCalledWith(
      "manage-maritime-fee-decision",
      {
        body: expect.objectContaining({
          operation: "adjust",
          amount_xof: 97_000,
        }),
      },
    );
  });

  it("une décision ferme courante peut être révoquée avec sa version exacte", async () => {
    const current = {
      id: "decision-2",
      decision_key: "PAD_DROIT_PASSAGE",
      decision_action: "adjust",
      decided_amount_xof: 97_000,
      decision_version: 2,
      decision_source: "Facture rectificative",
      justification: "Montant final",
      created_at: "2026-08-29T00:00:00Z",
      is_stale: false,
    };
    invokeMock
      .mockResolvedValueOnce({
        data: envelopeWith({ current_decision: current }),
        error: null,
      })
      .mockResolvedValueOnce({ data: envelopeWith(), error: null });
    const user = userEvent.setup();
    render(<MaritimeFeeProposalsPanel caseId="case-10" />);
    await user.click(
      screen.getByRole("button", { name: /Voir propositions maritimes/i }),
    );
    await user.click(
      await screen.findByRole("button", { name: /Révoquer la décision/i }),
    );
    await user.type(
      screen.getByLabelText(/Source de la décision/i),
      "Contrôle documentaire",
    );
    await user.type(
      screen.getByLabelText(/Justification opérateur/i),
      "Pièce annulée",
    );
    await user.click(
      screen.getByRole("button", { name: /Enregistrer la décision/i }),
    );
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    expect(invokeMock).toHaveBeenLastCalledWith(
      "manage-maritime-fee-decision",
      {
        body: expect.objectContaining({
          operation: "revoke",
          decision_key: "PAD_DROIT_PASSAGE",
          expected_decision_version: 2,
        }),
      },
    );
  });

  it("hors périmètre affiche le warning sans action client", async () => {
    invokeMock.mockResolvedValue({
      data: envelopeWith({}, {
        proposals: [],
        warnings: ["Périmètre non IMPORT (operation_type=EXPORT)."],
      }),
      error: null,
    });
    const user = userEvent.setup();
    render(<MaritimeFeeProposalsPanel caseId="case-11" />);
    await user.click(
      screen.getByRole("button", { name: /Voir propositions maritimes/i }),
    );
    expect(await screen.findByText(/Aucune proposition maritime/i))
      .toBeInTheDocument();
    expect(screen.getByText(/Périmètre non IMPORT/i)).toBeInTheDocument();
    for (
      const forbidden of [
        /ajouter au devis/i,
        /créer ligne/i,
        /créer version/i,
        /envoyer client/i,
      ]
    ) {
      expect(screen.queryByRole("button", { name: forbidden })).toBeNull();
    }
  });
});
