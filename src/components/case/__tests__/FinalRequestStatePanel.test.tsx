import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));
import { supabase } from "@/integrations/supabase/client";
import { FinalRequestStatePanel } from "../FinalRequestStatePanel";

const invokeMock = supabase.functions.invoke as unknown as ReturnType<
  typeof vi.fn
>;
const CASE = "22222222-2222-4222-8222-222222222222";
const REV = "55555555-5555-4555-8555-555555555555";
beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: () => false },
    setPointerCapture: { configurable: true, value: () => undefined },
    releasePointerCapture: { configurable: true, value: () => undefined },
    scrollIntoView: { configurable: true, value: () => undefined },
  });
});
function envelope(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: {
      head: { generation: 2, revision_id: REV, capture_id: "cap" },
      revision: { id: REV },
      captureRecord: {
        capture: { limitations: [] },
        inventory: { sources: [] },
        sourceAttestationRefs: [],
      },
      reviews: [],
      history: [],
      historyTruncated: false,
      selectedRevisionMatchesHeadCapture: true,
      reviewTargets: [],
      calculationStatus: { kind: "calculated" },
      pricingAuthorized: false,
      ...overrides,
    },
  };
}
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function choose(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp,
  option: RegExp,
) {
  await user.click(screen.getByRole("combobox", { name }));
  await user.click(screen.getByRole("option", { name: option }));
}

describe("FinalRequestStatePanel P1-C2-B", () => {
  beforeEach(() => invokeMock.mockReset());

  it("reste manuel au montage et n'expose aucune action de pricing", async () => {
    render(<FinalRequestStatePanel caseId={CASE} />);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Sans pricing/i)).toBeInTheDocument();
    expect(screen.queryByText(/prêt à coter/i)).toBeNull();
    await userEvent.setup().click(
      screen.getByRole("button", { name: /Ouvrir la revue/i }),
    );
    expect(invokeMock).toHaveBeenCalledWith("manage-final-request-state", {
      body: { operation: "read", case_id: CASE },
    });
  });

  it("enregistre une assertion typée avec le sourceId versionné et un body fermé", async () => {
    const sourceVersion = {
      id: "source-version-1",
      kind: "email",
      authorRole: "client",
      roleVerified: true,
      contentClass: "current",
      sentAt: "2026-08-30T10:00:00Z",
      text: "Le client confirme un poids total de 1200 kg.",
    };
    const loaded = envelope({
      head: { generation: 1, revision_id: null, capture_id: "capture-1" },
      revision: null,
      captureRecord: {
        capture: {
          captureId: "capture-1",
          limitations: [],
          baseInput: {
            sources: [sourceVersion],
            lotIds: [],
            quotationVersionIds: [],
          },
        },
        inventory: {
          sources: [{
            id: "raw-email-id",
            kind: "email",
            text: sourceVersion.text,
          }],
        },
        sourceAttestationRefs: [],
      },
      selectedRevisionMatchesHeadCapture: false,
      calculationStatus: { kind: "not_calculated" },
    });
    invokeMock.mockResolvedValueOnce({ data: loaded, error: null })
      .mockResolvedValueOnce({
        data: { ok: true, data: { pricingAuthorized: false } },
        error: null,
      })
      .mockResolvedValueOnce({ data: loaded, error: null });

    render(<FinalRequestStatePanel caseId={CASE} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Ouvrir la revue/i }));
    await choose(user, /Information concernée/i, /Poids total/i);
    await user.type(
      screen.getByRole("textbox", { name: /Valeur confirmée par le client/i }),
      "1200",
    );
    await user.type(
      screen.getByLabelText(/Extrait exact/i),
      "poids total de 1200 kg",
    );
    await user.click(
      screen.getByRole("button", { name: /Ajouter cette instruction/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /Enregistrer cette révision/i }),
    );
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(3));

    const body = invokeMock.mock.calls[1][1].body;
    expect(Object.keys(body).sort()).toEqual([
      "assertions",
      "capture_id",
      "case_id",
      "expected_generation",
      "expected_revision_id",
      "idempotency_key",
      "operation",
    ].sort());
    expect(body).toMatchObject({
      operation: "commit",
      case_id: CASE,
      capture_id: "capture-1",
      expected_revision_id: null,
      expected_generation: 1,
    });
    expect(body.idempotency_key).toMatch(/^frs-ui-commit-/);
    expect(body.assertions).toHaveLength(1);
    expect(body.assertions[0]).toMatchObject({
      sourceId: "source-version-1",
      operation: "set",
      field: "cargo.weight_kg",
      value: 1200,
      excerpt: "poids total de 1200 kg",
    });
    expect(JSON.stringify(body)).not.toContain("raw-email-id");
    expect(body).not.toHaveProperty("actor");
    expect(body).not.toHaveProperty("result");
    expect(body).not.toHaveProperty("sourceHash");
  });

  it("conserve assertion et clé de commit après erreur, puis bloque le double clic en vol", async () => {
    const sourceVersion = {
      id: "source-version-1",
      kind: "email",
      authorRole: "client",
      roleVerified: true,
      contentClass: "current",
      sentAt: "2026-08-30T10:00:00Z",
      text: "Merci de prendre en compte cette instruction.",
    };
    const loaded = envelope({
      head: { generation: 1, revision_id: null, capture_id: "capture-1" },
      revision: null,
      captureRecord: {
        capture: {
          captureId: "capture-1",
          limitations: [],
          baseInput: {
            sources: [sourceVersion],
            lotIds: [],
            quotationVersionIds: [],
          },
        },
        inventory: { sources: [] },
        sourceAttestationRefs: [],
      },
      selectedRevisionMatchesHeadCapture: false,
    });
    const retry = pending<{
      data: { ok: true; data: { pricingAuthorized: false } };
      error: null;
    }>();
    invokeMock.mockResolvedValueOnce({ data: loaded, error: null })
      .mockResolvedValueOnce({ data: null, error: new Error("Réseau commit") })
      .mockReturnValueOnce(retry.promise)
      .mockResolvedValueOnce({ data: loaded, error: null });

    render(<FinalRequestStatePanel caseId={CASE} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Ouvrir la revue/i }));
    await choose(user, /Action explicite/i, /Accusé de réception/i);
    await user.type(screen.getByLabelText(/Extrait exact/i), "Merci");
    await user.click(
      screen.getByRole("button", { name: /Ajouter cette instruction/i }),
    );
    const commit = screen.getByRole("button", {
      name: /Enregistrer cette révision/i,
    });
    await user.click(commit);
    expect(await screen.findByText("Réseau commit")).toBeInTheDocument();
    const firstBody = invokeMock.mock.calls[1][1].body;
    expect(screen.getByText(/Accusé de réception \(dossier\)/i))
      .toBeInTheDocument();

    await user.dblClick(commit);
    expect(invokeMock).toHaveBeenCalledTimes(3);
    const retryBody = invokeMock.mock.calls[2][1].body;
    expect(retryBody.idempotency_key).toBe(firstBody.idempotency_key);
    expect(retryBody.assertions).toEqual(firstBody.assertions);
    await act(async () =>
      retry.resolve({
        data: { ok: true, data: { pricingAuthorized: false } },
        error: null,
      })
    );
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(4));
  });

  it("ne recharge jamais les assertions d'une autre capture", async () => {
    const sourceVersion = {
      id: "source-version-1",
      kind: "email",
      authorRole: "client",
      roleVerified: true,
      contentClass: "current",
      sentAt: "2026-08-30T10:00:00Z",
      text: "Merci de prendre en compte cette instruction.",
    };
    invokeMock.mockResolvedValue({
      data: envelope({
        head: { generation: 3, revision_id: REV, capture_id: "capture-new" },
        revision: {
          id: REV,
          capture_id: "capture-old",
          input: {
            assertions: [{
              id: "old-assertion",
              sourceId: sourceVersion.id,
              scope: "case",
              operation: "acknowledge",
              excerpt: "Merci",
            }],
          },
        },
        captureRecord: {
          capture: {
            captureId: "capture-new",
            limitations: [],
            baseInput: {
              sources: [sourceVersion],
              lotIds: [],
              quotationVersionIds: [],
            },
          },
          inventory: { sources: [] },
          sourceAttestationRefs: [],
        },
        selectedRevisionMatchesHeadCapture: true,
      }),
      error: null,
    });
    render(<FinalRequestStatePanel caseId={CASE} />);
    await userEvent.setup().click(
      screen.getByRole("button", { name: /Ouvrir la revue/i }),
    );
    expect(await screen.findByText(/Instructions client structurées/i))
      .toBeInTheDocument();
    expect(screen.queryByText(/Brouillon de révision/i)).toBeNull();
    expect(screen.queryByText(/Accusé de réception \(dossier\)/i)).toBeNull();
  });

  it("affiche les limitations et jamais une autorisation de pricing", async () => {
    invokeMock.mockResolvedValue({
      data: envelope({
        captureRecord: {
          capture: { limitations: ["SOURCE_UNATTESTED:fixture"] },
          inventory: { sources: [] },
          sourceAttestationRefs: [],
        },
      }),
      error: null,
    });
    render(<FinalRequestStatePanel caseId={CASE} />);
    await userEvent.setup().click(
      screen.getByRole("button", { name: /Ouvrir la revue/i }),
    );
    expect(await screen.findByText("SOURCE_UNATTESTED:fixture"))
      .toBeInTheDocument();
    expect(screen.getByText(/Autorisation de pricing : non/i))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Valider cette capture/i }))
      .toBeNull();
  });

  it("n'affiche jamais le hash d'attestation PostgreSQL", async () => {
    invokeMock.mockResolvedValue({
      data: envelope({
        captureRecord: {
          capture: { limitations: [], inventoryHash: "a".repeat(64) },
          inventory: {
            sources: [{
              kind: "email",
              id: "source-1",
              author: "client@sandbox.invalid",
              text: "Texte fixture",
            }],
          },
          sourceAttestationRefs: [{
            originKind: "email",
            originId: "source-1",
          }],
        },
      }),
      error: null,
    });
    render(<FinalRequestStatePanel caseId={CASE} />);
    await userEvent.setup().click(
      screen.getByRole("button", { name: /Ouvrir la revue/i }),
    );
    expect(await screen.findByText("Texte fixture")).toBeInTheDocument();
    expect(screen.queryByText(/[a-f0-9]{64}/)).toBeNull();
    expect(screen.getByRole("button", { name: /Attester cette source/i }))
      .toBeInTheDocument();
  });

  it("conserve la clé de capture après erreur et bloque le double clic en vol", async () => {
    const save = pending<{ data: ReturnType<typeof envelope>; error: null }>();
    invokeMock.mockResolvedValueOnce({ data: envelope(), error: null })
      .mockReturnValueOnce(save.promise)
      .mockResolvedValueOnce({ data: envelope(), error: null });
    render(<FinalRequestStatePanel caseId={CASE} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Ouvrir la revue/i }));
    const button = await screen.findByRole("button", {
      name: /Créer une nouvelle capture/i,
    });
    await user.dblClick(button);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    const body = invokeMock.mock.calls[1][1].body;
    expect(body.idempotency_key).toMatch(/^frs-ui-capture-/);
    await act(async () => save.resolve({ data: envelope(), error: null }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(3));
  });

  it("conserve brouillon et clé d'attestation après erreur", async () => {
    const loaded = envelope({
      captureRecord: {
        capture: { limitations: [] },
        inventory: {
          sources: [
            {
              kind: "email",
              id: "source-1",
              author: "Client fixture",
              text: "Instruction fixture",
            },
          ],
        },
        sourceAttestationRefs: [{ originKind: "email", originId: "source-1" }],
      },
    });
    invokeMock.mockResolvedValueOnce({ data: loaded, error: null })
      .mockResolvedValueOnce({ data: null, error: new Error("Réseau fixture") })
      .mockResolvedValueOnce({
        data: { ok: true, data: { pricingAuthorized: false } },
        error: null,
      })
      .mockResolvedValueOnce({ data: loaded, error: null });
    render(<FinalRequestStatePanel caseId={CASE} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Ouvrir la revue/i }));
    await user.click(
      await screen.findByRole("button", { name: /Attester cette source/i }),
    );
    await user.type(
      screen.getByLabelText(/Justification/i),
      "Contrôle fixture",
    );
    await user.click(
      screen.getByRole("button", { name: /Enregistrer l’attestation/i }),
    );
    expect(await screen.findByText("Réseau fixture")).toBeInTheDocument();
    const first = invokeMock.mock.calls[1][1].body;
    expect(screen.getByLabelText(/Justification/i)).toHaveValue(
      "Contrôle fixture",
    );
    await user.click(
      screen.getByRole("button", { name: /Enregistrer l’attestation/i }),
    );
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(4));
    expect(invokeMock.mock.calls[2][1].body.idempotency_key).toBe(
      first.idempotency_key,
    );
    expect(first).not.toHaveProperty("expectedSourceHash");
  });

  it("ignore la réponse tardive de l'ancien dossier et efface les brouillons", async () => {
    const old = pending<{ data: ReturnType<typeof envelope>; error: null }>();
    invokeMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce({
      data: envelope(),
      error: null,
    });
    const ui = render(
      <FinalRequestStatePanel caseId="11111111-1111-4111-8111-111111111111" />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Ouvrir la revue/i }));
    ui.rerender(<FinalRequestStatePanel caseId={CASE} />);
    expect(screen.getByRole("button", { name: /Ouvrir la revue/i }))
      .toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Ouvrir la revue/i }));
    expect(await screen.findByText(/Génération 2/)).toBeInTheDocument();
    await act(async () =>
      old.resolve({
        data: envelope({
          head: { generation: 99, revision_id: REV, capture_id: "old" },
        }),
        error: null,
      })
    );
    expect(screen.queryByText(/Génération 99/)).toBeNull();
  });

  it("envoie la cible et le candidat fournis par le serveur, avec CAS exact", async () => {
    const targetId = '["field","case","cargo.weight_kg"]';
    const loaded = envelope({
      reviewTargets: [{
        targetId,
        kind: "field",
        field: "cargo.weight_kg",
        protectedFact: null,
        candidates: [{
          assertionId: "a1",
          sourceId: "s1",
          actions: ["confirm_instruction"],
          needsFactReconciliation: false,
        }],
      }],
    });
    invokeMock.mockResolvedValueOnce({ data: loaded, error: null })
      .mockResolvedValueOnce({
        data: { ok: true, data: { pricingAuthorized: false } },
        error: null,
      })
      .mockResolvedValueOnce({ data: loaded, error: null });
    render(<FinalRequestStatePanel caseId={CASE} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Ouvrir la revue/i }));
    await user.click(
      await screen.findByRole("button", { name: /Confirmer l’instruction/i }),
    );
    await user.type(
      screen.getByLabelText(/Justification de la décision/i),
      "Source vérifiée",
    );
    await user.click(
      screen.getByRole("button", { name: /Enregistrer la décision/i }),
    );
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(3));
    expect(invokeMock.mock.calls[1][1].body).toMatchObject({
      operation: "review",
      case_id: CASE,
      expected_revision_id: REV,
      expected_generation: 2,
      decision: "confirm_instruction",
      target_id: targetId,
      candidate_ref: "a1",
      previous_event_id: null,
      reason: "Source vérifiée",
    });
  });

  it("propose la révocation de la dernière décision sans supprimer l'historique", async () => {
    const target = ["field", "case", "cargo.weight_kg"];
    const loaded = envelope({
      reviews: [{
        id: "event-1",
        target,
        action: "confirm_instruction",
        reason: "Fixture active",
        generation: 2,
      }],
    });
    invokeMock.mockResolvedValueOnce({ data: loaded, error: null })
      .mockResolvedValueOnce({
        data: { ok: true, data: { pricingAuthorized: false } },
        error: null,
      })
      .mockResolvedValueOnce({ data: loaded, error: null });
    render(<FinalRequestStatePanel caseId={CASE} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Ouvrir la revue/i }));
    await user.click(
      await screen.findByRole("button", { name: /Révoquer la décision/i }),
    );
    await user.type(
      screen.getByLabelText(/Justification de la décision/i),
      "Décision à reprendre",
    );
    await user.click(
      screen.getByRole("button", { name: /Enregistrer la décision/i }),
    );
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(3));
    expect(invokeMock.mock.calls[1][1].body).toMatchObject({
      decision: "revoke_decision",
      target_id: JSON.stringify(target),
      candidate_ref: null,
      previous_event_id: "event-1",
    });
  });
});
