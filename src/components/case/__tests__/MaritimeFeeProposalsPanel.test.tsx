/**
 * DCQ-MARITIME-FEES-RUNTIME-UI-B3 — Tests UI doctrine du panneau propositions maritimes.
 *
 * Objet : verrouiller la doctrine côté UI (read-only, proposal_only, jamais compté) :
 * - déclenchement manuel uniquement (aucun appel automatique au montage) ;
 * - badge "Non inclus dans le total" toujours visible ;
 * - "Montant indicatif", "À confirmer" quand suggested_amount_xof est null ;
 * - amount ferme reste null ;
 * - AUCUN bouton d'inclusion / création de ligne / version / envoi client.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
  },
}));

import { supabase } from "@/integrations/supabase/client";
import MaritimeFeeProposalsPanel from "../MaritimeFeeProposalsPanel";

const invokeMock = supabase.functions.invoke as unknown as ReturnType<
  typeof vi.fn
>;

const FORBIDDEN_BUTTONS = [
  /ajouter au devis/i,
  /créer ligne/i,
  /inclure/i,
  /créer version/i,
  /envoyer client/i,
];

function envelopeWith(proposalOverrides: Record<string, unknown>) {
  return {
    ok: true,
    mode: "proposal_only",
    accounting_effect: "none",
    amount_policy: "HUMAN_CONFIRMATION_REQUIRED_DO_NOT_COUNT",
    proposals: [
      {
        id: "pad-taxe-de-port",
        category: "taxe_de_port",
        label: "Taxe de port (PAD — droit de passage)",
        amount: null,
        currency: "XOF",
        suggested_amount_xof: null,
        suggested_formula: null,
        source_reference: "PAD REDEVANCES_PORTUAIRES_2006",
        evidence_level: "official",
        needs_human_confirmation: true,
        reason: "Barème PAD officiel.",
        missing_confirmation: ["tonnage"],
        ...proposalOverrides,
      },
    ],
    warnings: [] as string[],
    input_debug: {
      operation_type: "IMPORT",
      cargo_mode: "CONTENEUR",
      carrier: null,
      has_tonnage: false,
      has_seafreight: false,
    },
  };
}

describe("MaritimeFeeProposalsPanel", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("idle par défaut : bouton manuel + badge doctrine, aucun appel automatique", () => {
    render(<MaritimeFeeProposalsPanel caseId="case-1" />);
    expect(
      screen.getByText(/Propositions maritimes à confirmer/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Non inclus dans le total/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Voir propositions maritimes/i }),
    ).toBeInTheDocument();
    // Aucun appel réseau tant que l'opérateur n'a pas cliqué.
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("au clic : invoque l'endpoint avec case_id et affiche 'Montant indicatif' / 'À confirmer'", async () => {
    invokeMock.mockResolvedValue({
      data: envelopeWith({ suggested_amount_xof: null }),
      error: null,
    });
    const user = userEvent.setup();
    render(<MaritimeFeeProposalsPanel caseId="case-42" />);

    await user.click(
      screen.getByRole("button", { name: /Voir propositions maritimes/i }),
    );

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("maritime-fee-proposals", {
        body: { case_id: "case-42" },
      }),
    );
    expect(screen.getByText(/Montant indicatif/i)).toBeInTheDocument();
    // Valeur du montant indicatif = "À confirmer" (correspondance exacte pour ne
    // pas capturer le label "À confirmer :" des missing_confirmation).
    expect(screen.getByText("À confirmer")).toBeInTheDocument();
    // Badge missing_confirmation propagé.
    expect(screen.getByText(/tonnage/i)).toBeInTheDocument();
  });

  it("aucun bouton d'inclusion / ligne / version / envoi client après chargement", async () => {
    invokeMock.mockResolvedValue({
      data: envelopeWith({ suggested_amount_xof: 988218 }),
      error: null,
    });
    const user = userEvent.setup();
    render(<MaritimeFeeProposalsPanel caseId="case-7" />);
    await user.click(
      screen.getByRole("button", { name: /Voir propositions maritimes/i }),
    );
    await screen.findByText(/Montant indicatif/i);

    for (const forbidden of FORBIDDEN_BUTTONS) {
      expect(screen.queryByRole("button", { name: forbidden })).toBeNull();
    }
    // Le montant indicatif est affiché mais amount ferme reste null (preuve doctrine).
    expect(screen.getByText(/Montant ferme\s*:\s*null/i)).toBeInTheDocument();
  });

  it("export/hors-scope : proposals vide + warning affiché, aucune proposition", async () => {
    invokeMock.mockResolvedValue({
      data: {
        ok: true,
        mode: "proposal_only",
        accounting_effect: "none",
        amount_policy: "HUMAN_CONFIRMATION_REQUIRED_DO_NOT_COUNT",
        proposals: [],
        warnings: ["Périmètre non IMPORT (operation_type=EXPORT)."],
        input_debug: {
          operation_type: "EXPORT",
          cargo_mode: "CONTENEUR",
          carrier: null,
          has_tonnage: true,
          has_seafreight: false,
        },
      },
      error: null,
    });
    const user = userEvent.setup();
    render(<MaritimeFeeProposalsPanel caseId="case-9" />);
    await user.click(
      screen.getByRole("button", { name: /Voir propositions maritimes/i }),
    );

    expect(
      await screen.findByText(/Aucune proposition maritime/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Périmètre non IMPORT/i)).toBeInTheDocument();
  });
});
